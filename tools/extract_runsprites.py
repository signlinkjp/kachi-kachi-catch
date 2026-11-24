"""
Build 6: オープニングの全身キャラ（走りスプライト）を作る。

  python3 tools/extract_runsprites.py

入力: tmp/raw_rabbit_sheet2.png / tmp/raw_tanuki_sheet.png
      （2x2 の走りサイクル4コマ。マゼンタ #FF00FF 背景）
出力: assets/rabbit_run.png / assets/tanuki_run.png
      （横に4コマ並べた等幅のスプライト。CSS の steps(4) で frame を進める）

やること:
  1. マゼンタ背景を色距離で透過（半透明の縁は色をアンミックスしてピンクの縁を消す）
  2. 4コマを同じ大きさのセルに切り出し、元の位置関係のまま横一列に並べる
     （セル内の位置をそのまま保つので、コマ間で体が跳ねない）
  3. 全体の余白を共通で切り落として、高さ 300px に縮小
"""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(HERE, "tmp")
ASSETS = os.path.join(HERE, "assets")

MAGENTA = np.array([255.0, 0.0, 255.0])
M_LO, M_HI = 24.0, 70.0      # マゼンタ度（min(r,b)-g）: これ以下は不透明・これ以上は透明
TARGET_H = 300               # 1コマの高さ（@2x で表示 150px 相当）


def key_magenta(im: Image.Image) -> Image.Image:
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    m = np.minimum(rgb[:, :, 0], rgb[:, :, 2]) - rgb[:, :, 1]
    # マゼンタ度が低いほど不透明
    a = np.clip((M_HI - m) / (M_HI - M_LO), 0.0, 1.0)
    # 半透明の縁からマゼンタを抜く（p = a*c + (1-a)*M を c について解く）
    safe = np.maximum(a, 0.06)[:, :, None]
    c = (rgb - (1.0 - a)[:, :, None] * MAGENTA) / safe
    c = np.clip(c, 0.0, 255.0)
    out = np.dstack([c, a * 255.0]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    # 1px の濁りを整える（アルファを少し締める）
    alpha = img.getchannel("A").filter(ImageFilter.MinFilter(3))
    img.putalpha(alpha)
    return img


def build(path: str, out: str):
    im = key_magenta(Image.open(path))
    W, H = im.size
    cw, ch = W // 2, H // 2
    cells = [im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)) for r in range(2) for c in range(2)]
    # 4コマ共通の余白を切り落とす（コマ内の位置関係はそのまま）
    boxes = [cell.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox() for cell in cells]
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    pad = 6
    left, top = max(0, left - pad), max(0, top - pad)
    right, bottom = min(cw, right + pad), min(ch, bottom + pad)
    strip = Image.new("RGBA", ((right - left) * 4, bottom - top), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        strip.paste(cell.crop((left, top, right, bottom)), (i * (right - left), 0))
    # 高さをそろえて縮小（横幅は比率のまま）
    fh = bottom - top
    scale = TARGET_H / fh
    strip = strip.resize((max(1, round(strip.width * scale)), TARGET_H), Image.LANCZOS)
    strip.save(os.path.join(ASSETS, out), optimize=True)
    print(f"{out}: {strip.size}  {os.path.getsize(os.path.join(ASSETS, out)) // 1024}KB")


build(os.path.join(TMP, "raw_rabbit_sheet2.png"), "rabbit_run.png")
build(os.path.join(TMP, "raw_tanuki_sheet.png"), "tanuki_run.png")
