#!/usr/bin/env python3
"""Generate minimal solid-color PWA PNG placeholders (no third-party deps)."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_solid_png(path: Path, width: int, height: int, rgb: tuple[int, int, int]) -> None:
    r, g, b = rgb
    row = bytes([0, r, g, b] * width)
    raw = row * height
    compressed = zlib.compress(raw, level=9)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", ihdr)
    png += _chunk(b"IDAT", compressed)
    png += _chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    out_dir = Path(__file__).resolve().parents[1] / "apps" / "web" / "public"
    out_dir.mkdir(parents=True, exist_ok=True)
    color = (99, 102, 241)  # #6366F1 theme
    write_solid_png(out_dir / "icon-192.png", 192, 192, color)
    write_solid_png(out_dir / "icon-512.png", 512, 512, color)
    print(f"wrote {out_dir / 'icon-192.png'}")
    print(f"wrote {out_dir / 'icon-512.png'}")


if __name__ == "__main__":
    main()
