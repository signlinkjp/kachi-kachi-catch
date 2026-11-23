#!/bin/sh
set -e
cd /workspace/work/kachi-kachi-catch
export PATH=/workspace/work/node22/node-v22.20.0-linux-x64/bin:$PATH
export LD_LIBRARY_PATH=/workspace/work/kachi-kachi-catch/tmp/libs/usr/lib/x86_64-linux-gnu
python3 -m http.server 8123 >/tmp/kachi-serve.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1.2
node tools/video.mjs "$@"
