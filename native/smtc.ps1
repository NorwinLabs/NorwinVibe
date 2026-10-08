# Bridges the Windows System Media Transport Controls (SMTC) to stdout as JSON lines
# and accepts commands on stdin. Must run under Windows PowerShell 5.1 (WinRT access).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int _0(); int _1(); int _2(); int _3();
    int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int _5();
    int GetMasterVolumeLevelScalar(out float level);
    int _7(); int _8(); int _9(); int _10();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, IntPtr p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class MasterVol {
    static IAudioEndpointVolume Ep() {
        var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
        Guid iid = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
        d.Activate(ref iid, 23, IntPtr.Zero, out v); return v;
    }
    public static float Get() { float l; Ep().GetMasterVolumeLevelScalar(out l); return l; }
    public static void Set(float l) { Guid g = Guid.Empty; Ep().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, l)), ref g); }
    public static bool GetMute() { bool m; Ep().GetMute(out m); return m; }
    public static void SetMute(bool m) { Guid g = Guid.Empty; Ep().SetMute(m, ref g); }
}
'@

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [type]$type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $t.Wait(5000)
    $t.Result
}

function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)) }

$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream]))
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$mgr = Await ($mgrType::RequestAsync()) $mgrType

$selected = $null
$vol = 0.0; $muted = $false; $tick = 0
$lastKey = ''; $artHash = ''; $artTries = 0; $artSince = [DateTime]::UtcNow; $artNext = [DateTime]::UtcNow
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$readTask = $stdin.ReadLineAsync()
$burstUntil = [DateTime]::UtcNow            # after a button press the loop polls fast for a moment, so the app shows the result right away
$sessCache = @(); $sessAt = [DateTime]::MinValue

while ($true) {
    try {
        if ($tick++ % 3 -eq 0) { try { $vol = [MasterVol]::Get(); $muted = [MasterVol]::GetMute() } catch {} }
        $all = @($mgr.GetSessions())
        $s = $null
        if ($selected) { $s = $all | Where-Object { $_.SourceAppUserModelId -eq $selected } | Select-Object -First 1 }
        if ($null -eq $s) { $s = $mgr.GetCurrentSession() }

        # ---- commands from the app ----
        while ($readTask.IsCompleted) {
            $line = $readTask.Result
            if ($null -eq $line) { exit 0 }
            $readTask = $stdin.ReadLineAsync()
            $parts = $line.Trim().Split(':', 2)
            $burstUntil = [DateTime]::UtcNow.AddMilliseconds(1500)
            if ($parts[0] -eq 'select') { $selected = $(if ($parts[1] -eq 'auto') { $null } else { $parts[1] }); continue }
            if ($null -eq $s -and $parts[0] -notmatch '^(volume|volstep|mute)$') { continue }
            switch ($parts[0]) {
                'volume'  { [MasterVol]::Set([float]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture)); $vol = [MasterVol]::Get() }
                'volstep' { [MasterVol]::Set([MasterVol]::Get() + [float]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture)); $vol = [MasterVol]::Get() }
                'mute'    { [MasterVol]::SetMute($parts[1] -eq '1'); $muted = [MasterVol]::GetMute() }
                'play'   { $null = $s.TryPlayAsync() }
                'pause'  { $null = $s.TryPauseAsync() }
                'toggle' { $null = $s.TryTogglePlayPauseAsync() }
                'next'   { $null = $s.TrySkipNextAsync() }
                'shuffle' { $null = $s.TryChangeShuffleActiveAsync($parts[1] -eq '1') }
                'repeat' { $null = $s.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode]$parts[1]) }
                'prev'   { $null = $s.TrySkipPreviousAsync() }
                'seek'   { $null = $s.TryChangePlaybackPositionAsync([long]([double]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture) * 10000000)) }
            }
        }

        if ($null -eq $s) {
            Emit @{ type = 'state'; active = $false; vol = [Math]::Round($vol, 3); muted = $muted }
            $lastKey = ''
        } else {
            $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
            $info = $s.GetPlaybackInfo()
            $tl = $s.GetTimelineProperties()
            $status = $info.PlaybackStatus.ToString()
            $playing = ($status -eq 'Playing')

            $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
            $pos = ($tl.Position - $tl.StartTime).TotalSeconds
            $rate = 1.0; try { if ($null -ne $info.PlaybackRate -and [double]$info.PlaybackRate -gt 0) { $rate = [Math]::Min(4.0, [Math]::Max(0.25, [double]$info.PlaybackRate)) } } catch {}
            if ($playing -and $dur -gt 0) {
                $age = ([DateTime]::UtcNow - $tl.LastUpdatedTime.UtcDateTime).TotalSeconds
                if ($age -gt 0 -and $age -lt 3600) { $pos = [Math]::Min($dur, $pos + $age * $rate) }
            }

            $app = $s.SourceAppUserModelId
            $key = "$($p.Title)|$($p.Artist)|$($p.AlbumTitle)|$app"
            if ($key -ne $lastKey) { $lastKey = $key; $artHash = ''; $artTries = 0; $artSince = [DateTime]::UtcNow; $artNext = $artSince }

            # Browsers publish a page's logo first and swap in the real video thumbnail a moment later, so keep looking for a while:
            # every loop for the first ~6 s, then every 4 s up to 2 minutes. A changed picture is sent again and replaces the old one.
            $now = [DateTime]::UtcNow
            if ($null -ne $p.Thumbnail -and $now -ge $artNext -and ($now - $artSince).TotalSeconds -lt 120) {
                $artTries++
                $artNext = $now.AddSeconds($(if ($artTries -lt 15) { 0 } else { 4 }))
                try {
                    $ras = Await ($p.Thumbnail.OpenReadAsync()) $streamType
                    $st = $asStreamForRead.Invoke($null, @($ras)) # (a plain [..]::AsStreamForRead($ras) call cannot bind: $ras is an opaque COM object)
                    $ms = New-Object System.IO.MemoryStream
                    $st.CopyTo($ms); $st.Dispose()
                    $bytes = $ms.ToArray()
                    $h = ''; if ($bytes.Length -gt 0) { $h = [Convert]::ToBase64String([Security.Cryptography.MD5]::Create().ComputeHash($bytes)) }
                    if ($bytes.Length -gt 0 -and $h -ne $artHash) {
                        # the stream's own ContentType is not reachable either, so identify the image from its first bytes
                        $mime = 'image/jpeg'
                        if ($bytes.Length -gt 3 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4E) { $mime = 'image/png' }
                        elseif ($bytes.Length -gt 12 -and $bytes[0] -eq 0x52 -and $bytes[1] -eq 0x49 -and $bytes[8] -eq 0x57 -and $bytes[9] -eq 0x45) { $mime = 'image/webp' }
                        elseif ($bytes.Length -gt 2 -and $bytes[0] -eq 0x42 -and $bytes[1] -eq 0x4D) { $mime = 'image/bmp' }
                        elseif ($bytes.Length -gt 2 -and $bytes[0] -eq 0x47 -and $bytes[1] -eq 0x49) { $mime = 'image/gif' }
                        Emit @{ type = 'art'; key = $key; data = "data:$mime;base64," + [Convert]::ToBase64String($bytes) }
                        $artHash = $h
                    }
                } catch { [Console]::Error.WriteLine("thumbnail: $($_.Exception.Message)") }
            }

            # the list of other players is only refreshed every couple of seconds (it costs a round trip per player)
            if (([DateTime]::UtcNow - $sessAt).TotalMilliseconds -gt 2500 -or $sessCache.Count -ne $all.Count) {
                $sessCache = @($all | ForEach-Object {
                    $sp = $null; try { $sp = Await ($_.TryGetMediaPropertiesAsync()) $propsType } catch {}
                    @{ id = $_.SourceAppUserModelId; title = $sp.Title; artist = $sp.Artist; playing = ($_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') }
                })
                $sessAt = [DateTime]::UtcNow
            }
            $sessions = $sessCache
            $rep = $null; if ($null -ne $info.AutoRepeatMode) { $rep = $info.AutoRepeatMode.ToString() }
            $shuf = $null; if ($null -ne $info.IsShuffleActive) { $shuf = [bool]$info.IsShuffleActive }

            Emit @{
                type = 'state'; active = $true; vol = [Math]::Round($vol, 3); muted = $muted; sessions = $sessions; selected = [bool]$selected; appId = $app
                shuffle = $shuf; repeat = $rep; rate = [Math]::Round($rate, 3)
                canShuffle = [bool]$info.Controls.IsShuffleEnabled; canRepeat = [bool]$info.Controls.IsRepeatEnabled; key = $key; app = $app
                playing = $playing; status = $status
                title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
                pos = [Math]::Round($pos, 2); dur = [Math]::Round($dur, 2)
                canPrev = [bool]$info.Controls.IsPreviousEnabled
                canNext = [bool]$info.Controls.IsNextEnabled
                canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
            }
        }
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
    }
    # wait for the next poll, but wake the moment a command arrives (it used to wait out the whole 400 ms first)
    $wait = 400; if ([DateTime]::UtcNow -lt $burstUntil) { $wait = 90 }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $wait -and -not $readTask.IsCompleted) { Start-Sleep -Milliseconds 8 }
}
