# TrustTag 后端（Dev B）

Node 22.23 + TypeScript ESM + Fastify。数据格式遵循 `../.plans/shared-contracts.md`，三个商品、历史钙片订单和默认设置与 mock 一致；不自动回放 mock 场景。SQLite 使用 Node 内置 `node:sqlite`，无需编译原生依赖。

## 启动

```bash
cd server
cp .env.example .env
npm install                 # 已安装时可跳过
npm run dev                # 默认 http://localhost:8787
# 或 npm start
npm run typecheck
npm test
```

`.env` 自动从 server 目录读取，已导出的环境变量优先；文件不提交。没有任何 API key 也能启动、访问 REST、使用键盘和本地防诈骗规则。Claude 不可用时回答 `Sorry, say that again?`；TTS 不可用时 `audio_url: null`，老人端使用浏览器 speechSynthesis。没有 Deepgram key 时二进制流会被安全忽略，`POST /api/audio` 返回兜底响应。

| 环境变量 | 默认 / 说明 |
| --- | --- |
| `PORT` | `8787`，监听 `0.0.0.0` |
| `ANTHROPIC_API_KEY` | Claude key，仅供后端使用 |
| `ANTHROPIC_MODEL` | `claude-opus-5-5`，可由部署者更改 |
| `OPENAI_API_KEY` | 仅用于 TTS，不用于 LLM |
| `OPENAI_TTS_VOICE` | `sage` |
| `DEEPGRAM_API_KEY` | Nova-3 流式及整段转写 |
| `PUBLIC_BASE_URL` | HTTPS 公网地址；空时使用 `http://localhost:PORT` |
| `DB_PATH` | 相对 server 的 `./trusttag.db`；测试可用 `:memory:` |

Claude 每轮最多一次 `messages.stream()` + `finalMessage()`，结构化输出、effort low，不发送 thinking / temperature / budget_tokens / 强制 tool_choice。模型只能选择货架 ID；拒答、截断、非法 JSON、错误商品 ID、网络错误均降级。无自动重试，Claude 和 TTS 各有 4 秒截止，Deepgram 整段转写 5 秒。正常链路以 2 秒为目标，真实延迟需要有 key 的环境实测；这些截止时间不是 2 秒保证。

TTS 直接 fetch OpenAI `/v1/audio/speech`，使用 `gpt-4o-mini-tts`、speed 0.9、MP3。实现依据 [OpenAI 官方 speech 参数文档](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)。按文本、声音和模型哈希缓存到 `audio/`，通过 `/audio/<hash>.mp3` 提供。

## iPad / HTTPS

```bash
ngrok http 8787
# 把输出的 https://xxxx.ngrok-free.app 写入 .env 的 PUBLIC_BASE_URL，再重启后端。
```

iPad Safari 麦克风需要安全上下文：前端页面本身也必须通过 HTTPS 打开，REST 使用上述 HTTPS 地址，WebSocket 使用 `wss://xxxx.ngrok-free.app/ws?role=elder`。监护人连接 `?role=guardian`。本地演示接口开放 CORS，没有认证；此骨架用于 hackathon 演示。

## 对接规则

`GET /api/products`、`/api/memories`、`/api/alerts` 返回数组。`GET /api/settings` 返回 Settings。`PUT /api/settings` 合并并校验部分字段。

`GET /api/orders` 保留 mock 的 `{share_level, month_total_cents, orders}` 包装。minimum 只显示异常订单，`month_total_cents: null` 表示不分享总额；default 显示异常订单和本月成功订单总额；open 显示全部订单及本月总额。九月历史订单不计入十月。WS 的 order 通知同样遵守分享级别，测试完整下单推送可先设置 open。

`POST /api/orders/:id/received` 返回 Order，同一次签收重复调用不会重复加库存。`GET /api/memories/:id` 取单条，`PUT /api/memories/:id` 更新现有记录，`{paused:true}` 暂停；因合同未指定删除载荷，本实现约定 JSON `null` 删除，随后重新 GET 列表。`POST /api/alerts/:id/archive` 返回 `{ok:true}`；不存在的 ID 返回 404。新增 Memory 由 D 在奶奶确认吃法后写库。

老人端文本可以发送 WS `{"type":"utterance","text":"...","source":"keyboard"}`，或 POST `/api/utterance`；**同一句选择一种传输方式**，避免重复输入。REST 返回 `{reply_text,audio_url,state,card?,order?}`，card 为 `{product,alternative?}`，也同步推合同中的 WS 事件。播放完成必须发送 `{"type":"spoke"}`；只有 elder 的确认有效。REST 不等待播放完成，通常返回 `state:"speaking"`；随后 WS 切换 happy / worried / alert → listening，20 秒无新输入回 idle。8 秒没有 spoke 时自动继续。`wake` 是内部转换，不额外发合同之外的状态。

voice 在 idle 时需要模糊唤醒名；keyboard 视为主动操作，直接打开窗口，支持验收原句。未唤醒的语音只回显 transcript，REST 返回空 reply_text。清空 `wake_name` 后，第一次任意语音唤醒并询问给 AI 起什么名字，下一句存入 `settings.wake_name`，不覆盖奶奶的 `elder_name`。

二进制 WS 帧直接传 MediaRecorder 的容器音频（如 WebM/Opus、MP4），每个 elder 连接独立连接 Deepgram；关闭连接时清理。裸 PCM 需要补充 Deepgram encoding/sample_rate 参数。仅 final 转写拼接成一句进入对话流程；不处理 interim 为购物请求。整段音频可 POST `/api/audio`，Content-Type 使用 `audio/webm`、`audio/mp4` 或 `application/octet-stream`，最大 10 MB，不使用 multipart。

`POST /debug/clock {now}` 设置 UTC ISO 演示基点，之后叠加真实经过时间。每秒及手动跳时钟均调用同一组 tick handler 并广播 clock。`POST /debug/reset` 复原种子、时钟、对话、待确认订单及音频连接；旧异步回答不再写入新一轮演示。

## curl 验收

```bash
PORT=8799 ANTHROPIC_API_KEY= OPENAI_API_KEY= DEEPGRAM_API_KEY= npm start
# 另一个终端：
curl -s localhost:8799/api/products
curl -s -X POST localhost:8799/api/utterance \
  -H 'content-type: application/json' \
  -d '{"text":"the purple bottle is almost empty","source":"keyboard"}'
curl -s -X POST localhost:8799/debug/clock \
  -H 'content-type: application/json' -d '{"now":"2026-10-22T09:00:00Z"}'
curl -s -X POST localhost:8799/debug/reset
BASE_URL=http://localhost:8799 npm run smoke
curl -s -X PUT localhost:8799/api/settings \
  -H 'content-type: application/json' -d '{"share_level":"open"}'
curl -s -X POST localhost:8799/api/utterance \
  -H 'content-type: application/json' \
  -d '{"text":"someone called about a gift card today","source":"keyboard"}'
curl -s localhost:8799/api/alerts
# 有 Deepgram key 时：
curl -s -X POST localhost:8799/api/audio -H 'content-type: audio/webm' --data-binary @sample.webm
```

没有 elder 客户端发送 spoke 时，连续两句之间可能等待最多 8 秒；这不是模型延迟。smoke 脚本会重置演示数据，验证三件商品、回答字段和 debug 接口，并打印耗时。

## C / D 接入点

- `src/contracts.ts`：共享对象的 TS 类型和输入校验；不在响应中增加支付 ref 等字段。
- `src/db.ts`：六张表均为 `(id TEXT PRIMARY KEY, data TEXT JSON)`。`get(table,id)` / `all(table)` / `put(table,id,value)` / `remove(table,id)`；`transaction(fn)` 只用于同步、非嵌套操作。Settings 存在 `settings/default`，自由 KV 存状态或去重标记。`sqlite` 也可直接访问。
- C：`modules/risk.ts` 提供 `check(product_id,text)`、`pay(order)`、`ledger()` 和 `publishOrder()`；`modules/orders.ts` 的 `placeOrder(draft,isCurrent?)` 是成功订单的唯一写入点。当前支付始终 simulated_paid，Order 和私有 `kv/payment:<order id>` 在同一事务写入，随后按分享层级推送；同一 ID 同一支付意图的重试复用结果，不同意图拒绝。check 无副作用，可在确认前后重复执行；规则 7 的创建仍在 pipeline 调 D 的 createAlert，避免双重告警。普通 `today` 不触发，礼品卡、转账、来电及「今天必须」类紧迫话术才触发。付款前校验商品、价格、订单格式和资格。
- D：`modules/memory.ts` 导出 `createAlert(level,rule,title,body)`、`saveGrandmaNote()`、`markReceived()`、`registerMemoryTicks()` 和 `shelfSeed`。红立即推，普通立即推，黄色暂只存库。库存只更新已有 Memory，不擅自建立吃法。`src/seed.ts` 集中放种子，D 可扩展货架。
- D：在已注册的 tick 占位回调中实现到货/提醒；`onTick((prevNow,now)=>...)` 返回注销函数。用 `kv` 持久化已触发日期，处理前跳和回拨，避免重复提醒。交互通过 `bus.toElder({type:'ask',...})`、`state`、`awaitSpoke()`；在 `pipeline.ts` 模型判断前接入待回答的 received/dose/reminder 流程。**当前没有实现自动到货、提醒、八条异常规则和 Visa 沙盒，这些仍归 C/D。**

所有演示业务时间使用 `clock.now()`；20 秒交互窗口、播放超时、API 超时使用真实计时器。此版本为单个奶奶的共享对话，同一进程串行处理输入，不是多租户系统。

## 测试方式

`npm test` 使用 Node test runner（通过 tsx），覆盖唤醒、播放状态、购物确认、防诈骗、分享过滤、库存幂等、时钟、REST 和 WebSocket handler；provider 测试用模拟 HTTP/SSE 验证请求参数与失败降级，不会调用真实付费 API。

如果执行环境禁止 tsx CLI 建立 IPC socket，可使用 `node --import tsx --test test/*.test.ts` 执行相同测试。REST 和 WS 测试使用 Fastify 的 inject / injectWS，不需要监听 TCP；这不能替代实际端口、HTTPS、iPad 麦克风与有 key 的端到端验收。

C 新增的 `role-c-api.test.ts` 还会监听随机 localhost 端口，实际验证 HTTP/WS 的补货、诈骗告警和替代品购买（只替换外部 Claude 响应，TTS 关闭），并用独立进程验证 SQLite 持久化。因此完整测试需要允许本地 TCP。接入约定、验证范围和既有依赖告警见 [C 交接](../.plans/role-c-handoff.md)，演示问答见 [Visa Q&A](../.plans/visa-qa.md)。
