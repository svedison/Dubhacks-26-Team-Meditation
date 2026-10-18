# Milo 前端（A：老人端 + 监护人端）

一份代码两个页面，组件共用：

- `/elder`：iPad 相框（横屏）。点一下开麦并进入全屏。
- `/guardian`：负责人的手机网页（首页卡片、Money、Pills、Settings）。

开发用的页面：`/mic-test`（麦克风长测）、`/face-lab`（7 种表情）。

## 跑起来

```bash
cd tools/mock-server && npm install && AUTOPLAY=0 npm start   # 模拟后端 8787
cd frontend && npm install && npm run dev                     # 前端 5173，/api /ws /debug 代理到 8787
```

对着别的后端：`BACKEND_URL=http://<host>:<port> npm run dev`。

## 部署（给 B）

`npm run build` 输出到 `frontend/dist/`，是纯静态文件。最省事的做法是后端直接托管 `dist/`，并把 `/elder`、`/guardian/*` 都回落到 `dist/index.html`，这样前端和 `/api`、`/ws` 同源，不用设任何地址。
如果前端和后端不同源，构建前设 `VITE_BACKEND_URL=https://后端地址`（后端要允许跨域）。iPad 开麦必须是 HTTPS。

## 收发的数据

全部按 `.plans/shared-contracts.md`，两端都不做判断，只渲染后端事件。

- 老人端连 `/ws?role=elder`，收 `state` `transcript` `speak` `card` `clock` `ask`，发 `utterance {text, source}` 和 `spoke {}`（每段语音播完发一次）。`speak`/`ask` 的 `audio_url` 为空时用 iPad 自带的朗读。
- 监护人端连 `/ws?role=guardian`，收 `alert` `order` `memory` `clock`（字段和 `type` 平铺在同一层）；调 `GET /api/alerts|settings|orders|memories|products`、`POST /api/alerts/:id/archive`、`PUT /api/settings`、`PUT /api/memories/:id`。
- 音频上传 `POST /api/audio?seq=<请求序号>&sr=16000&speech=1[&end=1]`，请求体是 16 kHz、单声道、16 位小端 PCM。只在有人说话时发（前面带约 0.3 秒预录），一句话的最后一块带 `end=1`；设备自己说话时不发。同一时间只有一个请求在路上，网络慢时会把排队的音频合并进下一个请求，所以每个请求的长度不固定，按 `seq` 顺序拼起来就是连续的音频。
