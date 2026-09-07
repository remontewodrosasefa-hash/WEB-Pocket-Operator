#!/usr/bin/env python3
"""Generate the PWA icons (no external deps). Run from project root:
    python3 scripts/make-icons.py
"""
import struct, zlib, math, os

BG = (13, 13, 15)
ORANGE = (255, 122, 26)
BLACK = (5, 5, 5)


def png(path, size, pad):
	"""pad = fraction of the canvas kept as background margin (for maskable)."""
	cx = cy = size / 2
	inner = size * (1 - 2 * pad)
	sq = inner * 0.62          # orange square side
	r = sq * 0.30              # black circle radius
	row = bytearray()
	raw = bytearray()
	for y in range(size):
		raw.append(0)  # filter type 0
		for x in range(size):
			px = BG
			if abs(x - cx) <= sq / 2 and abs(y - cy) <= sq / 2:
				px = ORANGE
			if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
				px = BLACK
			raw += bytes(px)
	def chunk(tag, data):
		return (struct.pack(">I", len(data)) + tag + data +
				struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
	sig = b"\x89PNG\r\n\x1a\n"
	ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
	idat = zlib.compress(bytes(raw), 9)
	with open(path, "wb") as f:
		f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))
	print("wrote", path)


if __name__ == "__main__":
	os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
	png("icon-192.png", 192, 0.06)
	png("icon-512.png", 512, 0.06)
	png("icon-maskable.png", 512, 0.18)
	png("apple-touch-icon.png", 180, 0.04)
