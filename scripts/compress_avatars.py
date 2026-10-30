"""
Compress PNG avatar images to under 100KB.
"""
from PIL import Image
import os
import sys

AV_DIR = os.path.join(os.path.dirname(__file__), '..', 'client', 'ruliad', 'public', 'avatars')
MAX_SIZE = 100 * 1024  # 100 KB

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

def try_compress(img, filepath, max_dim, colors):
    """Try to save image with given constraints, return size."""
    w, h = img.size
    scale = min(max_dim / max(w, h), 1.0)
    if scale < 1.0:
        resized = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    else:
        resized = img.copy()
    
    # Ensure RGB
    if resized.mode in ('RGBA', 'P'):
        resized = resized.convert('RGB')
    
    quantized = resized.quantize(colors=colors, method=Image.MEDIANCUT)
    quantized_rgb = quantized.convert('RGB')
    quantized_rgb.save(filepath, 'PNG', optimize=True, compress_level=9)
    return os.path.getsize(filepath)

def compress_png(filepath):
    img = Image.open(filepath)
    original_size = os.path.getsize(filepath)
    print(f'  Current: {img.size[0]}x{img.size[1]}, {original_size/1024:.1f} KB')
    
    attempts = [
        (256, 128),
        (224, 96),
        (192, 64),
        (176, 64),
        (160, 48),
        (144, 48),
    ]
    
    for max_dim, colors in attempts:
        size = try_compress(img, filepath, max_dim, colors)
        w = int(img.size[0] * min(max_dim / max(img.size), 1.0))
        h = int(img.size[1] * min(max_dim / max(img.size), 1.0))
        ok = '[OK]' if size <= MAX_SIZE else '[--]'
        print(f'  {ok} {w}x{h} @ {colors} colors: {size/1024:.1f} KB')
        if size <= MAX_SIZE:
            return size
    
    print(f'  WARNING: Could not get below 100KB')
    return size

if __name__ == '__main__':
    files = [f for f in os.listdir(AV_DIR) if f.endswith('.png')]
    files.sort()
    
    for f in files:
        fp = os.path.join(AV_DIR, f)
        size = os.path.getsize(fp)
        print(f'\nProcessing {f} ({size/1024:.1f} KB)...')
        if size <= MAX_SIZE:
            print(f'  Already under 100KB, skipping.')
            continue
        compress_png(fp)
    
    print('\n' + '='*50)
    print('Final results:')
    all_ok = True
    for f in sorted(os.listdir(AV_DIR)):
        if f.endswith('.png'):
            fp = os.path.join(AV_DIR, f)
            sz = os.path.getsize(fp)
            status = '[OK]' if sz <= MAX_SIZE else '[OVER]'
            if sz > MAX_SIZE:
                all_ok = False
            print(f'  {status} {f}: {sz/1024:.1f} KB')
    
    if all_ok:
        print('\nAll PNG files are under 100KB!')
