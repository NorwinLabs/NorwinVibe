package com.norwinlabs.vibe;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * Reads a song's ReplayGain (the loudness correction in dB that tag editors store) from its tags: ID3v2 (MP3) and FLAC.
 * Returns null when the file has none or is in a format this does not read, in which case the song just plays at its own level.
 */
final class ReplayGain {
    private ReplayGain() { }

    static Float read(String path) {
        try (RandomAccessFile f = new RandomAccessFile(path, "r")) {
            byte[] head = new byte[10];
            f.readFully(head);
            if (head[0] == 'I' && head[1] == 'D' && head[2] == '3') return fromId3(f, head);
            if (head[0] == 'f' && head[1] == 'L' && head[2] == 'a' && head[3] == 'C') return fromFlac(f);
        } catch (IOException | RuntimeException ignored) { }
        return null;
    }

    private static Float parseDb(String s) {
        if (s == null) return null;
        s = s.trim().toLowerCase().replace("db", "").replace(',', '.').trim();
        try { return Float.parseFloat(s); } catch (NumberFormatException e) { return null; }
    }

    private static int syncsafe(byte[] b, int o) { return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f); }
    private static int be32(byte[] b, int o) { return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff); }

    private static Float fromId3(RandomAccessFile f, byte[] head) throws IOException {
        int version = head[3] & 0xff;                       // 3 = ID3v2.3, 4 = ID3v2.4
        int size = Math.min(syncsafe(head, 6), 512 * 1024);
        if (version < 3 || size <= 0) return null;
        byte[] tag = new byte[size];
        f.readFully(tag);
        Float track = null, album = null;
        int p = 0;
        if ((head[5] & 0x40) != 0 && size > 4) p = Math.min(size, version == 4 ? syncsafe(tag, 0) : be32(tag, 0) + 4); // skip an extended header
        while (p + 10 <= size) {
            String id = new String(tag, p, 4, StandardCharsets.ISO_8859_1);
            int len = version == 4 ? syncsafe(tag, p + 4) : be32(tag, p + 4);
            if (id.charAt(0) == 0 || len <= 0 || p + 10 + len > size) break;
            if (id.equals("TXXX") && len > 2) {
                int enc = tag[p + 10] & 0xff;
                String text = decode(tag, p + 11, len - 1, enc);
                int sep = text.indexOf('\0');
                if (sep > 0) {
                    String desc = text.substring(0, sep).toLowerCase(), value = text.substring(sep + 1);
                    if (desc.equals("replaygain_track_gain")) track = parseDb(value);
                    else if (desc.equals("replaygain_album_gain")) album = parseDb(value);
                }
            }
            p += 10 + len;
        }
        return track != null ? track : album;
    }

    private static String decode(byte[] b, int off, int len, int enc) {
        java.nio.charset.Charset cs = enc == 1 ? StandardCharsets.UTF_16 : enc == 2 ? StandardCharsets.UTF_16BE : enc == 3 ? StandardCharsets.UTF_8 : StandardCharsets.ISO_8859_1;
        String s = new String(b, off, len, cs);
        if (enc == 1 || enc == 2) s = s.replace("\u0000\u0000", "\u0000"); // keep the single separator
        return s;
    }

    private static Float fromFlac(RandomAccessFile f) throws IOException {
        f.seek(4);
        for (int blocks = 0; blocks < 64; blocks++) {
            int h = f.readUnsignedByte();
            boolean last = (h & 0x80) != 0;
            int type = h & 0x7f;
            int len = (f.readUnsignedByte() << 16) | (f.readUnsignedByte() << 8) | f.readUnsignedByte();
            if (type == 4) { // VORBIS_COMMENT
                if (len > 1024 * 1024) return null;
                byte[] b = new byte[len];
                f.readFully(b);
                int p = 0;
                int vendor = le32(b, p); p += 4 + vendor;
                int n = le32(b, p); p += 4;
                Float track = null, album = null;
                for (int i = 0; i < n && p + 4 <= len; i++) {
                    int cl = le32(b, p); p += 4;
                    if (cl < 0 || p + cl > len) break;
                    String c = new String(b, p, cl, StandardCharsets.UTF_8); p += cl;
                    int eq = c.indexOf('=');
                    if (eq < 0) continue;
                    String k = c.substring(0, eq).toLowerCase();
                    if (k.equals("replaygain_track_gain")) track = parseDb(c.substring(eq + 1));
                    else if (k.equals("replaygain_album_gain")) album = parseDb(c.substring(eq + 1));
                }
                return track != null ? track : album;
            }
            f.seek(f.getFilePointer() + len);
            if (last) break;
        }
        return null;
    }

    private static int le32(byte[] b, int o) { return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8) | ((b[o + 2] & 0xff) << 16) | ((b[o + 3] & 0xff) << 24); }
}
