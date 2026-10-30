"""生成 PWA 图标（纯标准库，无 PIL 依赖）：蓝底圆角 + 白色像素画 F。

运行：python generate_icons.py
输出：../../app/icon-192.png、../../app/icon-512.png（一次性生成后随仓库提交）
"""
import struct
import zlib
from pathlib import Path

BG = (8, 101, 239)      # 与应用主题色 #0865ef 一致
FG = (255, 255, 255)
# 像素画字母 F（5 列 x 7 行）
GLYPH = ['11110', '10000', '11100', '10000', '10000', '10000', '10000']


def make_icon(size: int, path: Path) -> None:
    scale = max(1, size // 11)
    glyph_w, glyph_h = 5 * scale, 7 * scale
    ox, oy = (size - glyph_w) // 2, (size - glyph_h) // 2
    radius = size // 6
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # 圆角：四角圆形遮罩外的像素透明
            dx, dy = min(x, size - 1 - x), min(y, size - 1 - y)
            if dx < radius and dy < radius and (radius - dx) ** 2 + (radius - dy) ** 2 > radius * radius:
                row += bytes((0, 0, 0, 0))
                continue
            gx, gy = (x - ox) // scale, (y - oy) // scale
            inside = 0 <= gx < 5 and 0 <= gy < 7 and GLYPH[gy][gx] == '1'
            row += bytes((*FG, 255)) if inside else bytes((*BG, 255))
        rows.append(bytes(row))
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        piece = struct.pack('>I', len(data)) + tag + data
        return piece + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    path.write_bytes(out)
    print(f'{path} ({len(out)} bytes)')


if __name__ == '__main__':
    app = Path(__file__).resolve().parents[2] / 'app'
    make_icon(192, app / 'icon-192.png')
    make_icon(512, app / 'icon-512.png')
