# 角色 D：Memory、异常检测和数据

端到端目标：第四幕按演示时钟到点，设备主动开口问「拿到了吗」、定吃法、第二天提醒、报余量；第二幕诈骗命中规则 7 推红卡。另外负责整套演示数据：货架、假货和替代品、初始订单。接口按 `shared-contracts.md`，代码挂在 B 的后端里。

## 交付

1. 演示时钟：`POST /debug/clock` 设置「现在」，后端所有取时间的地方走同一个 `now()`。推 `clock` 事件到两端。调度器每秒检查有没有越过提醒时间，越过就触发。推时钟和真实到点走同一条代码。
2. 到货流程：时钟越过 `deliver_on` 当天 → 发 `ask {kind: "received"}` 问奶奶拿到了吗 → 肯定回答 → `received = true`，Memory 的 `stock_units` 加一包 → 发 `ask {kind: "dose_confirm"}` 念标签吃法并问今天开始每天 8 点可以吗 → 确认 → 建 Memory，`start_date` 今天，`end_date` 标签没写就 null → 推 `memory` 事件给手机（普通卡）。
3. 到点提醒：`times` 到点 → `ask {kind: "reminder"}` → 回答 taken / skipped / later 记 log；没回答记 unconfirmed；库存按规则扣（taken 和 unconfirmed 都扣，skipped 不扣）。回答后 AI 说还能用多久：`stock_units / (units_per_dose × 每天次数)` 天。
4. 余量和补货备注：剩余天数小于 AI 算出的提前天数（按送达周期，演示里定 3 天）→ 生成补货备注（普通卡）并在下一次对话里顺口问要不要再买。
5. 异常规则：实现 8 条，演示冷启动只开 1、4、7、8；规则 7 由 C 的风险检查在对话路径里触发，Alert 对象和等级逻辑在这里。红立即推；黄 7 天内累计 2 条才推；单黄只记录。推之前先让 AI 对奶奶说一句「I'll let your daughter know, okay?」并把她的回答存进 `grandma_note`。
6. 分享层级过滤函数由 C 实现，D 只保证 Alert 带正确等级。
7. 演示数据：货架 JSON 至少 20 个商品（品牌、价格、商家、成分、认证来源），其中 3 个假货配好功效对应的替代品，演示用的「miracle joint pills」必须有 `risk` 和 `alternative_id: glucosamine-usp`。初始订单：一条钙片历史订单带 alias "the purple bottle"。`POST /debug/reset` 回到这套数据。
8. 提示音：7 个免版税短音效给 A；家庭照片占位图 5 张。

## 验收

- 周六 16:00：货架 JSON 给 B，至少 10 个商品 + 2 个假货。
- 周六 18:00：第二幕诈骗命中规则 7，红卡 2 秒内到手机，带 grandma_note。
- 周日 01:00：第四幕用演示时钟从到货当天走到第二天 8 点提醒，手机出两张普通卡；`/debug/reset` 后能从头再来。
- 时钟回拨不触发已触发过的提醒。

## 依赖和边界

- 代码在 B 的骨架里，B 提供表结构和事件总线；骨架上线后和 B 定好 `now()` 和调度器挂在哪里。订单签收由 C 的接口通知 D 加库存。
- 不碰前端。

## 砍法

异常规则只留 7 → 补货备注去掉只报剩余天数 → 到货流程去掉，Memory 在下单时直接建。演示时钟和第二天提醒不能砍。
