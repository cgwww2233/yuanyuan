# stamp_icon.py - Inject an .ico into a Windows exe using the Win32 UpdateResource API.
# Self-contained: no winCodeSign, no rcedit download, no symlink privilege needed.
import sys, ctypes
from ctypes import wintypes

kernel32 = ctypes.windll.kernel32

RT_ICON = 3
RT_GROUP_ICON = 14

kernel32.BeginUpdateResourceW.argtypes = [ctypes.c_wchar_p, ctypes.c_bool]
kernel32.BeginUpdateResourceW.restype = ctypes.c_void_p
kernel32.UpdateResourceW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ushort, ctypes.c_void_p, ctypes.c_uint]
kernel32.UpdateResourceW.restype = ctypes.c_bool
kernel32.EndUpdateResourceW.argtypes = [ctypes.c_void_p, ctypes.c_bool]
kernel32.EndUpdateResourceW.restype = ctypes.c_bool


def main():
    if len(sys.argv) < 3:
        print("usage: stamp_icon.py <exe> <ico>")
        sys.exit(2)
    exe_path = sys.argv[1]
    ico_path = sys.argv[2]
    data = open(ico_path, "rb").read()

    if data[:4] != b"\x00\x00\x01\x00":
        print("ERROR: not an ICO file")
        sys.exit(1)

    count = int.from_bytes(data[4:6], "little")
    entries = []
    for i in range(count):
        off = 6 + i * 16
        bw = data[off]
        bh = data[off + 1]
        bcc = data[off + 2]
        br = data[off + 3]
        wPlanes = int.from_bytes(data[off + 4:6], "little")
        wBitCount = int.from_bytes(data[off + 6:8], "little")
        dwBytes = int.from_bytes(data[off + 8:off + 12], "little")
        dwOffset = int.from_bytes(data[off + 12:off + 16], "little")
        img = data[dwOffset:dwOffset + dwBytes]
        entries.append((bw, bh, bcc, br, wPlanes, wBitCount, dwBytes, img))

    # Build RT_GROUP_ICON directory
    group = bytearray()
    group += b"\x00\x00"            # reserved
    group += b"\x01\x00"            # type = icon
    group += count.to_bytes(2, "little")
    for idx, (bw, bh, bcc, br, wPlanes, wBitCount, dwBytes, _img) in enumerate(entries, start=1):
        group += bytes([bw, bh, bcc, br])
        group += wPlanes.to_bytes(2, "little")
        group += wBitCount.to_bytes(2, "little")
        group += dwBytes.to_bytes(4, "little")
        group += idx.to_bytes(2, "little")  # wId -> RT_ICON id

    h = kernel32.BeginUpdateResourceW(ctypes.c_wchar_p(exe_path), False)
    if not h:
        print("ERROR: BeginUpdateResourceW failed (is the file locked/writable?)")
        sys.exit(1)

    ok = True
    for idx, (_bw, _bh, _bcc, _br, _wp, _wb, _db, img) in enumerate(entries, start=1):
        buf = ctypes.create_string_buffer(img, len(img))
        res = kernel32.UpdateResourceW(
            h, ctypes.c_void_p(RT_ICON), ctypes.c_void_p(idx), 0,
            ctypes.cast(buf, ctypes.c_void_p), len(img),
        )
        if not res:
            print("WARN: UpdateResource RT_ICON id", idx, "failed err=%d len=%d" % (ctypes.GetLastError(), len(img)))
            ok = False

    gbuf = ctypes.create_string_buffer(bytes(group), len(group))
    res = kernel32.UpdateResourceW(
        h, ctypes.c_void_p(RT_GROUP_ICON), ctypes.c_void_p(1), 0,
        ctypes.cast(gbuf, ctypes.c_void_p), len(group),
    )
    if not res:
        print("WARN: UpdateResource RT_GROUP_ICON failed err=%d" % ctypes.GetLastError())
        ok = False

    committed = kernel32.EndUpdateResourceW(h, False)
    if not committed:
        print("ERROR: EndUpdateResourceW failed")
        sys.exit(1)

    print("ICON_STAMPED_OK icons=%d" % count)


if __name__ == "__main__":
    main()
