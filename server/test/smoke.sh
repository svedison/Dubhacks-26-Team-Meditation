#!/usr/bin/env bash
set -euo pipefail
# 先启动后端：PORT=8799 npm start；脚本会重置演示数据。
base="${BASE_URL:-http://localhost:8799}"
curl --fail --silent --show-error -X POST "$base/debug/reset"
products=$(curl --fail --silent --show-error "$base/api/products")
node -e 'const p=JSON.parse(process.argv[1]); if(p.length!==3) throw Error("expected 3 products"); console.log("Products:", p.length)' "$products"
started=$(node -e 'console.log(Date.now())')
utterance=$(curl --fail --silent --show-error -X POST "$base/api/utterance" \
  -H 'content-type: application/json' \
  -d '{"text":"the purple bottle is almost empty","source":"keyboard"}')
node -e 'const r=JSON.parse(process.argv[1]); if(typeof r.reply_text!=="string" || !(r.audio_url===null || typeof r.audio_url==="string")) throw Error("invalid reply shape"); console.log(r); console.log("Utterance latency (ms):", Date.now()-Number(process.argv[2]))' "$utterance" "$started"
curl --fail --silent --show-error -X POST "$base/debug/clock" \
  -H 'content-type: application/json' -d '{"now":"2026-10-22T09:00:00Z"}'
curl --fail --silent --show-error -X POST "$base/debug/reset"
