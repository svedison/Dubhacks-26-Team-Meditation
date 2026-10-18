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

- 老人端连 `/ws?role=elder`，收 `state` `transcript` `speak` `card` `clock` `ask`，发 `utterance {text, source}` 和 `spoke {}`。
- 监护人端连 `/ws?role=guardian`，收 `alert` `order` `memory` `clock`（字段和 `type` 平铺在同一层）；调 `GET /api/alerts|settings|orders|memories|products`、`POST /api/alerts/:id/archive`、`PUT /api/settings`、`PUT /api/memories/:id`。
- 音频上传：每说完一句话发一次 `POST /api/audio`，`Content-Type: audio/wav`，请求体是这一整句的 WAV（16 kHz、单声道、16 位，前面带约 0.4 秒预录），正好对上 `server/` 里 `/api/audio` 按整句转写的做法。说话的判断由浏览器里的 Silero VAD 做；设备自己在说话时不发。麦克风常开在 iPad 上连续测过 30 分钟，没有断。
- 播放：`speak` / `ask` 的 `audio_url` 有值就播这个文件（后端配了 MiniMax 时就是 Arrogant_Miss 的声音），为空才用 iPad 自带的朗读；每段播完发一次 `spoke`。
- 开心、担心、警报这三种表情收到后至少保持 3 秒，说话期间也保持；契约外的事件（比如 `connected`）会被忽略。
