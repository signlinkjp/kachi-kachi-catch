#!/usr/bin/env python3
"""アプリアイコン(1024) と スプラッシュ(2732) を作る。
文字なし・アイコン枠で映えるように、ウサギローとポコ丸を中央に配置する。
"""
import os
from PIL import Image, ImageDraw, ImageFilter

SRC = "/workspace/downloads/kachitrap-char-hybrid.png"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
IOS_ICON = os.path.join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset")
IOS_SPLASH = os.path.join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset")
os.makedirs(IOS_ICON, exist_ok=True)
os.makedirs(IOS_SPLASH, exist_ok=True)

src = Image.open(SRC).convert("RGB")


def vertical_gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.point((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img.resize((w, h), Image.BICUBIC)


def radial(size, center, radius, inner, outer):
    w, h = size
    layer = Image.new("RGB", (w, h), outer)
    d = ImageDraw.Draw(layer)
    steps = 48
    for i in range(steps, 0, -1):
        r = radius * i / steps
        t = i / steps
        color = tuple(int(outer[k] + (inner[k] - outer[k]) * (1 - t) ** 2) for k in range(3))
        d.ellipse((center[0] - r, center[1] - r, center[0] + r, center[1] + r), fill=color)
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.03))


def compose(size=1024, chars_scale=1.0, y_shift=0):
    """クリーム地に2人。地の色を元画像と同じにして、切り抜きの継ぎ目を出さない。"""
    S = size
    cream = (254, 237, 202)
    bg = Image.new("RGBA", (S, S), cream + (255,))

    # 右上の朱（控えめなアクセント。キャラには重ねない）
    accent = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ad = ImageDraw.Draw(accent)
    ar = int(S * 0.20)
    ad.ellipse((S - ar - int(S * 0.06), -ar + int(S * 0.02), S + ar - int(S * 0.06), 2 * ar + int(S * 0.02)), fill=(229, 87, 46, 235))
    accent = accent.filter(ImageFilter.GaussianBlur(S * 0.003))
    bg.alpha_composite(accent)

    # 足元の影
    chars = src.crop((30, 195, 1380, 1015))
    cw = int(S * 0.96 * chars_scale)
    ch = int(chars.height * cw / chars.width)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    base_y = int(S * 0.5 + ch * 0.30) + y_shift
    sd.ellipse((S * 0.16, base_y - S * 0.035, S * 0.84, base_y + S * 0.03), fill=(120, 70, 30, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.025))
    bg.alpha_composite(shadow)

    chars = chars.resize((cw, ch), Image.LANCZOS).convert("RGBA")
    x = (S - cw) // 2
    y = int(S * 0.5 - ch * 0.50) + y_shift
    bg.alpha_composite(chars, (x, y))

    # 四隅を少しだけ焼く（キャラの上から一定にかける＝継ぎ目が出ない）
    vig = Image.new("L", (S, S), 0)
    vd = ImageDraw.Draw(vig)
    for i in range(70):
        r = int(S * (1.02 - i * 0.012))
        vd.ellipse((S // 2 - r, S // 2 - r, S // 2 + r, S // 2 + r), fill=int(4 + i * 1.5))
    vig = vig.filter(ImageFilter.GaussianBlur(S * 0.05))
    dark = Image.new("RGBA", (S, S), (198, 152, 98, 255))
    bg = Image.composite(dark, bg, vig.point(lambda v: int(v * 0.5)))

    # 全体に淡い網目（罠のモチーフ）
    net = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    nd = ImageDraw.Draw(net)
    step = max(6, int(S * 0.055))
    for k in range(-S, S * 2, step):
        nd.line((k, 0, k + S, S), fill=(120, 90, 60, 16), width=max(1, int(S * 0.0035)))
        nd.line((k, S, k + S, 0), fill=(120, 90, 60, 14), width=max(1, int(S * 0.0035)))
    bg.alpha_composite(net)

    return bg.convert("RGB")


icon = compose(1024)
icon.save(os.path.join(ASSETS, "kachi-appicon-1024.png"))
icon.save(os.path.join(IOS_ICON, "AppIcon-512@2x.png"))
print("icon", icon.size, icon.mode)

# スプラッシュ（2732角・クリーム地にキャラ）
splash = Image.new("RGB", (2732, 2732), (255, 248, 234))
char = compose(1024).resize((1200, 1200), Image.LANCZOS)
splash.paste(char, ((2732 - 1200) // 2, (2732 - 1200) // 2))
for name in ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]:
    splash.save(os.path.join(IOS_SPLASH, name))
print("splash ok")
