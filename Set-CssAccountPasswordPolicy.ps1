<#
.SYNOPSIS
    Prevents the CSS account from changing its password and disables password expiration.

.DESCRIPTION
    Local account (default): uses Set-LocalUser and "net user /passwordchg:no".
    Domain account (-Domain): uses Set-ADUser (requires the ActiveDirectory module / RSAT).
    Must be run from an elevated PowerShell session.

.EXAMPLE
    .\Set-CssAccountPasswordPolicy.ps1
    .\Set-CssAccountPasswordPolicy.ps1 -UserName CSS -Domain
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$UserName = 'CSS',
    [switch]$Domain
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw 'This script must be run as Administrator.'
}

if ($Domain) {
    Import-Module ActiveDirectory
    if ($PSCmdlet.ShouldProcess($UserName, 'Set CannotChangePassword and PasswordNeverExpires (AD)')) {
        Set-ADUser -Identity $UserName -CannotChangePassword $true -PasswordNeverExpires $true
    }
    Get-ADUser -Identity $UserName -Properties CannotChangePassword, PasswordNeverExpires |
        Select-Object SamAccountName, CannotChangePassword, PasswordNeverExpires
}
else {
    $user = Get-LocalUser -Name $UserName

    if ($PSCmdlet.ShouldProcess($UserName, 'Disable password change and password expiration (local)')) {
        Set-LocalUser -Name $UserName -PasswordNeverExpires $true

        # Set-LocalUser has no "user cannot change password" option; net user does.
        & net.exe user $UserName /passwordchg:no | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "net user failed with exit code $LASTEXITCODE"
        }
    }

    Get-LocalUser -Name $UserName | Select-Object Name, Enabled, PasswordExpires, UserMayChangePassword
}
