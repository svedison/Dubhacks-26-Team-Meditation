# 角色 B：后端和 AI

端到端目标：一句英文进来，2 秒内出一句回答、一个状态、一张卡片和一段语音；该买的买，该拦的拦。接口按 `shared-contracts.md`，这份文档由 B 维护。

## 交付

1. Node（TypeScript，Fastify 或 Express）+ SQLite + WebSocket，部署在带 HTTPS 的地址上，iPad Safari 才能开麦。
2. 语音转文字：Deepgram Nova 流式接口。转写文字先做唤醒匹配（和 `wake_name` 模糊读音匹配，宁可误唤醒不能唤不醒），命中进入 20 秒窗口；窗口内的完整句子送大模型。
3. 大模型：Claude Opus 5.5（`claude-opus-5-5`），`output_config.effort: "low"`，流式。工具调用三件事：`find_product(aliases, text)` 从货架选商品、`classify(text)` 判断补货 / 新需求 / 诈骗 / 有风险商品 / 闲聊、`reply(text)` 生成一句口语回答。只能返回货架里的 product id。system prompt 写明：是 AI、不给医疗建议、闲聊最多两轮拉回购物、第一次对话问称呼。
4. 语音合成：OpenAI TTS，温和偏慢的声音，返回 `audio_url`。
5. 风险检查：商品在货架且无 `risk` → 放行；`risk` 非空 → 拦下并带 `alternative_id`；文字含礼品卡 / 转账 / 有人打电话让我买 → 诈骗，生成红色 Alert（规则 7）。
6. 付款：`pay(order)` 适配器。默认 `simulated_paid`，屏幕标 "Simulated"。Visa 沙盒今晚不再试；周日上午如果有空再接 Token Service 或 Intelligent Commerce，通了只换这一个函数。
7. 订单和账本：Order 写库，推 `order` 事件给监护人端（按 `share_level` 过滤）。
8. 状态机：按 contracts 里的状态流推 `state` 事件；`spoke` 回来才切下一状态。
9. 第一次对话：没有 `wake_name` 时任何声音都唤醒，AI 问称呼，把回答存进 Settings。

## 验收

- 周六 14:00：`shared-contracts.md` 定稿，C 和 A 签字。
- 周六 16:00 门禁：用 curl 发 "the purple bottle is almost empty"，拿到 reply、card、audio_url，总耗时 2 秒内。
- 周六 18:00 门禁：第二幕从 iPad 说话到手机出红卡全链路通。
- 任何一环的外部接口挂了，返回兜底回答 "Sorry, say that again?"，不抛 500。

## 依赖和边界

- Memory 调度、余量计算、异常规则 1 到 8 的计算在 D 的模块里，B 提供数据库表和事件总线，D 往里挂。规则 7（诈骗）因为在对话路径上，由 B 直接触发。
- 需要 D 的货架数据 JSON（周六 16:00 前至少 10 个商品和 2 个带替代品的假货）。

## 砍法

Deepgram 不通 → 改 OpenAI 转写接口 → 再不通用键盘输入。TTS 不通 → 浏览器 speechSynthesis。大模型延迟超 4 秒 → 换 `claude-haiku-5-5`。
