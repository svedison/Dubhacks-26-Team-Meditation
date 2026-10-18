# 三端接口约定（四份角色 spec 共用）

2026-10-17。这是老人端、后端、监护人端之间唯一的数据格式文档。要改就改这里，不在聊天里说。后端负责维护。

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
  "share_level": "minimum|default|open", "wake_name": "Lily", "photos": ["url"] }
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

后端 → 老人端：

| type | 载荷 | 老人端做什么 |
| --- | --- | --- |
| `state` | `{state: "idle|listening|thinking|speaking|happy|worried|alert"}` | 切表情并播对应提示音 |
| `transcript` | `{role: "grandma|ai", text}` | 字幕追加一条，奶奶右、AI 左 |
| `speak` | `{text, audio_url}` | 播放，播完回 `spoke` |
| `card` | `{product, alternative?}` | 弹商品卡片；有 alternative 时并排显示 |
| `clock` | `{now}` | 角上更新演示时钟 |
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

idle → 听到唤醒名 → listening（20 秒窗口）→ 收到完整一句 → thinking → speaking → 按结果 happy / worried / alert → 回 listening；20 秒无声 → idle。
