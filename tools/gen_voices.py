#!/usr/bin/env python3
"""Kachi Kachi Catch のボイスを edge-tts で作る。

  pip install edge-tts
  python3 tools/gen_voices.py            # 全部つくる
  python3 tools/gen_voices.py ja usagiro # 言語とキャラを絞る

tools/voices.json の台本を読み、assets/voices/<lang>/<char>-<key>.mp3 を書き出す。
書き出したあと、頭と語尾の余分な無音を落としてモノラル 32kbps に軽くする
（切りすぎると最後の一音が消えるので、無音の長さを測って切る）。
"""
import asyncio
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import wave

import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "voices"
SCRIPT = ROOT / "tools" / "voices.json"
RATE = 24000
BITRATE = "32k"
HEAD_KEEP = 0.03  # 話し始めの手前を残す秒数
TAIL_KEEP = 0.12  # 話し終わりのあとを残す秒数


def ffmpeg_path():
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def wav_duration(path):
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def silence_edges(wav, threshold_db=-42.0):
    """先頭・末尾の無音の長さ（秒）を返す。numpy が無ければ None。"""
    try:
        import numpy as np
    except Exception:
        return None
    with wave.open(str(wav), "rb") as w:
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())
    data = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if data.size == 0:
        return None
    peak = float(np.max(np.abs(data))) or 1.0
    limit = peak * (10 ** (threshold_db / 20.0))
    loud = np.nonzero(np.abs(data) > limit)[0]
    if loud.size == 0:
        return None
    return loud[0] / rate, (data.size - 1 - loud[-1]) / rate


def encode(ff, src, dst, start=None, end=None):
    cmd = [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    cmd += ["-af", "loudnorm=I=-17:TP=-2:LRA=9", "-ac", "1", "-ar", str(RATE), "-b:a", BITRATE, str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0 and dst.exists() and dst.stat().st_size > 500, r.stderr


def trim(src, dst):
    ff = ffmpeg_path()
    if not ff:
        shutil.copyfile(src, dst)
        return False
    with tempfile.TemporaryDirectory() as td:
        wav = pathlib.Path(td) / "src.wav"
        r = subprocess.run(
            [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", str(RATE), str(wav)],
            capture_output=True,
            text=True,
        )
        edges = silence_edges(wav) if r.returncode == 0 else None
        if edges:
            head, tail = edges
            start = max(0.0, head - HEAD_KEEP)
            end = wav_duration(wav) - max(0.0, tail - TAIL_KEEP)
            ok, err = encode(ff, wav, dst, start=start, end=end)
            if ok:
                return True
            print("  trim failed, keeping whole take:", err.strip()[:200])
        ok, err = encode(ff, src, dst)
        if not ok:
            print("  ffmpeg failed:", err.strip()[:300])
            shutil.copyfile(src, dst)
            return False
        return True


async def synth(text, voice, pitch, rate, out):
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        raw = pathlib.Path(td) / "raw.mp3"
        await edge_tts.Communicate(text, voice, pitch=pitch, rate=rate).save(str(raw))
        trim(raw, out)
    size = out.stat().st_size
    print(f"  {out.relative_to(ROOT)}  {size / 1024:.1f} KB")


async def main(argv):
    script = json.loads(SCRIPT.read_text(encoding="utf-8"))
    want_lang = argv[1] if len(argv) > 1 else None
    want_char = argv[2] if len(argv) > 2 else None
    total = 0
    for lang, chars in script["lines"].items():
        if want_lang and lang != want_lang:
            continue
        for char, lines in chars.items():
            if want_char and char != want_char:
                continue
            cfg = script["voices"][lang][char]
            print(f"{lang}/{char}  voice={cfg['voice']} pitch={cfg['pitch']} rate={cfg['rate']}")
            for key, text in lines.items():
                out = ASSETS / lang / f"{char}-{key}.mp3"
                await synth(text, cfg["voice"], cfg["pitch"], cfg["rate"], out)
                total += 1
    print("total", total, "files")


if __name__ == "__main__":
    asyncio.run(main(sys.argv))
