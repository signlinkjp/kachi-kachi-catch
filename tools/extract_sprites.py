#!/usr/bin/env python3
"""kachitrap-char-hybrid.png から、ゲームで使う素材を作る。

白ウサギの産毛はクリーム背景と色がほぼ同じで、透過切り抜きにすると毛が欠けてしまう。
そこで brief の許容案「丸型バッジ／ソフト縁取り」を使い、背景ごと丸く切り出して
盤面・HUD・タイトルに自然に馴染ませる。

出力:
  assets/tanuki_token.png   盤面のタヌキ駒（丸型バッジ・外側透過）
  assets/rabbit_token.png   ウサギの丸型バッジ（HUD/クリア演出）
  assets/tanuki_face.png    リアクション用の顔アップ
  assets/rabbit_face.png    同上
  assets/title_hero.png     タイトル用の2ショット（四辺フェード）
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = "/workspace/downloads/kachitrap-char-hybrid.png"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(OUT, exist_ok=True)
src = Image.open(SRC).convert("RGB")


def badge(crop_box, size, ring=(226, 106, 54, 255), ring_w=0.022, pad=0.03, zoom=1.0):
    x0, y0, x1, y1 = crop_box
    c = src.crop((x0, y0, x1, y1)).convert("RGBA")
    side = max(c.width, c.height)
    sq = Image.new("RGBA", (side, side), (254, 236, 200, 255))
    sq.paste(c, ((side - c.width) // 2, (side - c.height) // 2))

    S = size * 4
    tw = int(S * zoom)
    sq = sq.resize((tw, tw), Image.LANCZOS)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.paste(sq, ((S - tw) // 2, (S - tw) // 2), sq)

    m = Image.new("L", (S, S), 0)
    inset = int(S * pad)
    ImageDraw.Draw(m).ellipse((inset, inset, S - inset, S - inset), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(S * 0.005))
    canvas.putalpha(m)

    ring_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(ring_layer)
    w = max(2, int(S * ring_w))
    dr.ellipse((inset + w // 2, inset + w // 2, S - inset - w // 2, S - inset - w // 2),
               outline=ring, width=w)
    canvas.alpha_composite(ring_layer)
    return canvas.resize((size, size), Image.LANCZOS)


def hero(size_w=1400):
    hero = src.crop((30, 200, 1380, 1010))
    W = size_w
    H = int(hero.height * W / hero.width)
    hero = hero.resize((W, H), Image.LANCZOS).convert("RGBA")
    alpha = Image.new("L", (W, H), 255)
    da = ImageDraw.Draw(alpha)
    fx, fy = int(W * 0.07), int(H * 0.09)
    for i in range(fx):
        v = int(255 * (i / fx) ** 0.75)
        da.line((i, 0, i, H), fill=v)
        da.line((W - 1 - i, 0, W - 1 - i, H), fill=v)
    for j in range(fy):
        v = int(255 * (j / fy) ** 0.8)
        da.line((0, j, W, j), fill=v)
        da.line((0, H - 1 - j, W, H - 1 - j), fill=v)
    hero.putalpha(alpha)
    return hero


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        # 候補比較シート
        cands = [
            ("tkA", (780, 240, 1400, 860), 0.95, (214, 92, 48, 255)),
            ("tkB", (820, 270, 1380, 830), 0.88, (214, 92, 48, 255)),
            ("tkC", (740, 210, 1410, 880), 1.0, (214, 92, 48, 255)),
            ("rbA", (120, 240, 780, 900), 0.85, (52, 92, 176, 255)),
            ("rbB", (180, 300, 760, 880), 0.95, (52, 92, 176, 255)),
            ("rbC", (40, 180, 780, 920), 0.9, (52, 92, 176, 255)),
        ]
        sheet = Image.new("RGB", (6 * 250, 280), (255, 252, 243))
        d = ImageDraw.Draw(sheet)
        for i, (name, box, zoom, ring) in enumerate(cands):
            im = badge(box, 230, ring=ring, zoom=zoom)
            sheet.paste(im, (10 + i * 250, 25), im)
            d.text((16 + i * 250, 8), name, fill=(40, 30, 20))
        sheet.save(os.path.join(OUT, "_cands.png"))
        print("preview saved")
        raise SystemExit

    badge((820, 270, 1380, 830), 512, ring=(214, 92, 48, 255), zoom=0.88).save(
        os.path.join(OUT, "tanuki_token.png"))
    badge((860, 330, 1360, 830), 256, ring=(214, 92, 48, 255), zoom=0.95).save(
        os.path.join(OUT, "tanuki_face.png"))
    badge((180, 300, 760, 880), 512, ring=(52, 92, 176, 255), zoom=0.95).save(
        os.path.join(OUT, "rabbit_token.png"))
    badge((210, 330, 720, 840), 256, ring=(52, 92, 176, 255), zoom=0.95).save(
        os.path.join(OUT, "rabbit_face.png"))
    h = hero()
    h.save(os.path.join(OUT, "title_hero.png"))
    print("hero", h.size, "-> assets/")
