# 三端接口约定（四份角色 spec 共用）

2026-10-17。这是老人端、后端、监护人端之间唯一的数据格式文档。要改就改这里，不在聊天里说。后端 B 负责维护。C（风险、交易、Visa）和 D（Memory、异常、数据）的模块挂在 B 的骨架里，对外接口仍是下面这一套。

## 对象

```json
// Product（可信货架里的一条）
{ "id": "calcium-120", "name": "Calcium 600mg, 120 tablets", "price_cents": 1800,
  "category": "supplement", "certification": "USP", "aliases": ["the purple bottle"],
  "label_dose": "1 tablet daily with food", "units": 120, "units_per_dose": 1,
  "risk": null }                       // 或 { "kind": "fda_fraud|recall|unverified", "alternative_id": "glucosamine-usp" }

// Order
{ "id": "ord_01", "product_id": "calcium-120", "price_cents": 1800,
  "status": "paid|simulated_paid|blocked", "block_reason": null,
  "created_at": "2026-10-17T18:00:00Z", "deliver_on": "2026-10-22", "received": false }

// Memory（用药提醒）
{ "id": "mem_01", "product_id": "calcium-120", "dose_text": "1 tablet with breakfast",
  "times": ["08:00"], "start_date": "2026-10-22", "end_date": null,
  "stock_units": 120, "units_per_dose": 1, "paused": false,
  "log": [ { "at": "2026-10-23T08:00:00Z", "answer": "taken|skipped|later|unconfirmed" } ] }

// Alert（红 / 黄 / 普通）
{ "id": "al_01", "level": "red|yellow|normal", "rule": 7, "title": "Check on Mom",
  "body": "Someone asked her to buy a gift card today. TrustTag blocked it.",
  "grandma_note": null, "created_at": "...", "archived": false }

// Settings（监护人一开始的设置）
{ "elder_name": "Grandma", "address": "...", "phone": "...",
  "card_last4": "4242", "card_owner": "elder|guardian", "monthly_baseline_cents": 15000,
  "share_level": "minimum|default|open", "wake_name": "Milo", "photos": ["url"] }
```

## REST（后端提供）

| 方法和路径 | 谁调 | 作用 |
| --- | --- | --- |
| `POST /api/utterance` `{text, source: "voice|keyboard"}` | 老人端 | 一句话进来，返回 `{reply_text, audio_url, state, card?, order?}`。老人端也可以只靠 WebSocket 事件渲染 |
| `POST /api/audio` 二进制音频块 | 老人端 | 流式转写；转写结果和唤醒判定通过 WebSocket 回来 |
| `GET /api/products` | 任何端 | 货架列表 |
| `GET /api/orders` | 监护人端 | 账本，已按 share_level 过滤 |
| `POST /api/orders/:id/received` | 后端内部或老人端 | 奶奶确认拿到，库存加新一包 |
| `GET /api/memories` `PUT /api/memories/:id` | 监护人端 | 看、改、暂停、删 |
| `GET /api/alerts` `POST /api/alerts/:id/archive` | 监护人端 | 卡片列表，点「知道了」 |
| `GET /api/settings` `PUT /api/settings` | 监护人端 | 一开始的设置 |
| `POST /debug/clock` `{now}` | 讲解的人 | 演示时钟，所有「现在」从这里读 |
| `POST /debug/reset` | 讲解的人 | 回到演示初始数据 |

## WebSocket 事件（`/ws`，JSON，字段 `type`）

### 订单与设置响应细节（沿用 B 骨架，C 补充验收说明）

- `GET /api/orders` 返回 `{share_level, month_total_cents, orders}`。minimum：只返回异常订单（`status === "blocked"` 或 `block_reason !== null`），总额为 `null`；default：同样只返回异常订单，加本月成功订单总额；open：全部订单，加本月成功订单总额。本月按演示时钟的 UTC 月份计算，`paid` 和 `simulated_paid` 计入，blocked 不计入。
- WS `order` 使用同一过滤规则。default/minimum 不推普通订单详情；查看更新的总额需重新 GET 账本。诈骗尝试通过 `alert` 表达，不凭空建立购买订单。
- `POST /api/orders/:id/received` 返回更新后的 Order；重复请求幂等，未知 ID 为 404，blocked 订单为 409。调用 D 的库存更新接口，每笔订单最多加一包。
- `PUT /api/settings` 接受 Settings 的部分字段并合并保存；非法字段、未知字段、非四位卡尾号或负数月基线返回 400，原设置保持不变。`monthly_baseline_cents` 是异常判断基线，不是已启用的支付额度。
- 支付 ref 仅存后端 `kv/payment:<order id>`，不加入 Order 或 WS 消息。`simulated_paid` 必须由前端显示 **Simulated**。

后端 → 老人端：

| type | 载荷 | 老人端做什么 |
| --- | --- | --- |
| `state` | `{state: "idle|listening|thinking|speaking|happy|worried|alert"}` | 切表情并播对应提示音 |
| `transcript` | `{role: "grandma|ai", text}` | 字幕追加一条，奶奶右、AI 左 |
| `speak` | `{text, audio_url}` | 播放，播完回 `spoke` |
| `card` | `{product, alternative?}` | 弹商品卡片；有 alternative 时并排显示 |
| `order` | Order 对象 | 仅明确确认且下单成功后发给老人端；匹配商品后盖 **Ordered** 章。开心表情不代表下单成功。Order 可带可选的 `payment_check`（见下），有且 `approved` 时老人端加一行 "Card checked with Visa"。老人端不显示 "Simulated"：状态仍是 `simulated_paid`，监护人端 Money 页底部一次性注明 "Demo: Visa sandbox, no real charge"。监护人端仍沿用分享过滤规则 |
| `clock` | `{now}` | 角上更新演示时钟 |

`quantity`（Order 和 `card` 事件的可选字段，2026-10-18）：这一单几包，缺省为 1；Order 的 `price_cents` 是总价。老人端卡片在 quantity > 1 时显示总价和 "n × 单价"，监护人端账本行显示 "× n"。

`payment_check`（Order 的可选字段，2026-10-18）：`{provider: "visa_pav", environment: "sandbox", approved: boolean, action_code: string|null, checked_at: ISO 时间, note: string|null}`。是下单前对 Visa 沙盒 Payment Account Validation 的脱敏结果：只说卡校验通过（action code 00/85）或没能校验（note 是原因码），不含卡号、授权码或原始响应。后端 `VISA_SANDBOX_PREFLIGHT=1` 严格模式校验失败不下单；`soft` 演示模式 3 秒内没结果照常模拟下单并带 `approved: false`；`0` 不调用、字段缺省。
| `ask` | `{text, audio_url, kind: "received|dose_confirm|reminder"}` | Memory 主动开口，等奶奶回答 |

老人端 → 后端：

| type | 载荷 |
| --- | --- |
| `utterance` | `{text, source}`（键盘兜底也走这里） |
| `spoke` | `{}` 播放结束 |

后端 → 监护人端：

| type | 载荷 |
| --- | --- |
| `alert` | Alert 对象 |
| `order` | Order 对象 |
| `memory` | Memory 对象 |
| `clock` | `{now}` |

## 状态机（后端维护，老人端只渲染）

idle → 听到唤醒名 → listening（20 秒窗口）→ 收到完整一句 → thinking → 按结果 happy / worried / alert（**说话时就是这个表情**，`speak` 事件紧随其后）→ 老人端播完发 `spoke` → listening；20 秒无声 → idle。

- 2026-10-18 改：表情在 `speak` 之前发，不再先发 `speaking` 再切表情（A 的要求：奶奶听到「这像诈骗」时脸已经是红的）。`speaking` 仍保留在枚举里，老人端可按音量做嘴型，后端目前不再单独发它。
- Memory 主动开口（`ask`）走同一条路：先 `state`（happy）再 `ask`；`spoke` 回来进 listening，奶奶的回答不需要唤醒名。
- 后端只发上表列出的事件，没有 `connected` 之类的额外事件；要加必须先写进这里。
