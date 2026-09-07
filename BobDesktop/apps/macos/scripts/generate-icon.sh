#!/usr/bin/env bash
# ============================================================
# Bob Work - Icon Generator
# Creates a professional app icon for Bob Work
# ============================================================
set -e

ICONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../src-tauri/icons" && pwd)"

echo "Generating Bob Work icons in $ICONS_DIR..."

# Generate 1024x1024 master icon using built-in macOS tools
# Professional indigo gradient with "BW" monogram
python3 - <<'PYTHON'
import struct, zlib, os, math

def write_png(filename, width, height, pixels):
    """Write RGB pixels to PNG file"""
    def png_chunk(chunk_type, data):
        chunk_len = struct.pack('>I', len(data))
        chunk_data = chunk_type + data
        chunk_crc = struct.pack('>I', zlib.crc32(chunk_data) & 0xffffffff)
        return chunk_len + chunk_data + chunk_crc
    
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = png_chunk(b'IHDR', ihdr_data)
    
    # IDAT - compress raw image data
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter type none
        for x in range(width):
            r, g, b = pixels[y][x]
            raw_data += bytes([r, g, b])
    
    compressed = zlib.compress(raw_data, 9)
    idat = png_chunk(b'IDAT', compressed)
    
    # IEND
    iend = png_chunk(b'IEND', b'')
    
    with open(filename, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(ihdr)
        f.write(idat)
        f.write(iend)

def generate_icon(size):
    pixels = []
    cx, cy = size / 2, size / 2
    r = size / 2
    corner_r = size * 0.22  # Apple icon corner radius ratio
    
    for y in range(size):
        row = []
        for x in range(size):
            # Rounded rectangle mask (Apple icon shape)
            dx = abs(x - cx) - (r - corner_r)
            dy = abs(y - cy) - (r - corner_r)
            
            if dx > 0 and dy > 0:
                dist = math.sqrt(dx*dx + dy*dy)
                inside = dist <= corner_r
            elif dx > corner_r or dy > corner_r:
                inside = False
            else:
                inside = True
            
            if not inside:
                row.append((0, 0, 0))  # transparent (we'll use white bg instead)
                continue
            
            # Gradient: deep indigo (#3730a3) to blue-petrol (#0891b2)
            # Diagonal gradient top-left to bottom-right
            t = (x + y) / (2 * size)
            
            # Color stops: indigo → blue
            r1, g1, b1 = 0x37, 0x30, 0xa3  # indigo-800
            r2, g2, b2 = 0x08, 0x91, 0xb2  # cyan-600
            
            pr = int(r1 + (r2 - r1) * t)
            pg = int(g1 + (g2 - g1) * t)
            pb = int(b1 + (b2 - b1) * t)
            
            # Inner shadow at edges
            edge_dist = min(
                abs(x - cx) / r,
                abs(y - cy) / r,
            )
            if edge_dist > 0.85:
                factor = 0.85 + 0.15 * (1 - (edge_dist - 0.85) / 0.15)
                pr = int(pr * factor)
                pg = int(pg * factor)
                pb = int(pb * factor)
            
            row.append((pr, pg, pb))
        pixels.append(row)
    
    # Draw "BW" text using pixel art
    # Scale letters relative to icon size
    lw = size // 7   # letter width
    lh = size // 2.8  # letter height  
    lh = int(lh)
    lw = int(lw)
    stroke = max(2, size // 64)
    
    # Center the two letters with gap
    gap = size // 16
    total_w = lw * 2 + gap
    start_x = int(cx - total_w / 2)
    start_y = int(cy - lh / 2)
    
    text_color = (255, 255, 255)
    alpha = 0.92
    
    def blend_pixel(x, y, color, a=1.0):
        if 0 <= y < size and 0 <= x < size:
            bg = pixels[y][x]
            r = int(bg[0] * (1-a) + color[0] * a)
            g = int(bg[1] * (1-a) + color[1] * a)
            b = int(bg[2] * (1-a) + color[2] * a)
            pixels[y][x] = (r, g, b)
    
    def draw_rect(x, y, w, h, color=(255,255,255)):
        for py in range(max(0,y), min(size, y+h)):
            for px in range(max(0,x), min(size, x+w)):
                blend_pixel(px, py, color, alpha)
    
    # Draw "B"
    bx = start_x
    by = start_y
    # Vertical stroke
    draw_rect(bx, by, stroke, lh)
    # Top horizontal
    draw_rect(bx, by, lw - stroke*2, stroke)
    # Middle horizontal
    draw_rect(bx, by + lh//2 - stroke//2, lw - stroke*2, stroke)
    # Bottom horizontal
    draw_rect(bx, by + lh - stroke, lw - stroke*2, stroke)
    # Top right vertical
    draw_rect(bx + lw - stroke*2, by, stroke*2, lh//2)
    # Bottom right vertical
    draw_rect(bx + lw - stroke*2, by + lh//2, stroke*2, lh//2)
    
    # Draw "W"
    wx = start_x + lw + gap
    wy = start_y
    # Left stroke going down-right
    for i in range(lh):
        slope_x = int(i * lw * 0.15 / lh)
        draw_rect(wx + slope_x, wy + i, stroke, 1)
    # Right stroke going down-left  
    for i in range(lh):
        slope_x = int((lh - i) * lw * 0.15 / lh)
        draw_rect(wx + lw - stroke - slope_x, wy + i, stroke, 1)
    # Middle-left stroke going up
    for i in range(lh // 2):
        slope_x = int(i * lw * 0.15 / (lh//2))
        draw_rect(wx + lw//2 - stroke - slope_x, wy + lh//2 + i, stroke, 1)
    # Middle-right stroke going down
    for i in range(lh // 2):
        slope_x = int(i * lw * 0.15 / (lh//2))
        draw_rect(wx + lw//2 + slope_x, wy + lh//2 + i, stroke, 1)
    
    return pixels

icons_dir = os.environ.get('ICONS_DIR', 'src-tauri/icons')
os.makedirs(icons_dir, exist_ok=True)

sizes = [16, 32, 64, 128, 256, 512, 1024]
for sz in sizes:
    print(f"  Generating {sz}x{sz}...")
    px = generate_icon(sz)
    write_png(f"{icons_dir}/icon_{sz}.png", sz, sz, px)
    if sz == 128:
        write_png(f"{icons_dir}/128x128.png", sz, sz, px)
    if sz == 32:
        write_png(f"{icons_dir}/32x32.png", sz, sz, px)
    if sz == 256:
        write_png(f"{icons_dir}/128x128@2x.png", sz, sz, px)

# Also write the main icon.png (1024x1024)
import shutil
shutil.copy(f"{icons_dir}/icon_1024.png", f"{icons_dir}/icon.png")

print("  PNG icons generated successfully.")
PYTHON

echo "Generating .icns file..."
# Use iconutil to create .icns from the generated PNGs
ICONSET_DIR="$(mktemp -d)/bobwork.iconset"
mkdir -p "$ICONSET_DIR"

# iconutil expects specific naming convention
for size in 16 32 128 256 512; do
    cp "$ICONS_DIR/icon_${size}.png" "$ICONSET_DIR/icon_${size}x${size}.png" 2>/dev/null || true
    # @2x versions
    double=$((size * 2))
    if [ -f "$ICONS_DIR/icon_${double}.png" ]; then
        cp "$ICONS_DIR/icon_${double}.png" "$ICONSET_DIR/icon_${size}x${size}@2x.png"
    fi
done

iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
echo "  Generated icon.icns ($(du -h "$ICONS_DIR/icon.icns" | cut -f1))"

rm -rf "$(dirname "$ICONSET_DIR")"
echo "✓ Icons generated successfully"
