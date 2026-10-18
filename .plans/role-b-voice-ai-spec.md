# 角色 B：语音和 AI

端到端目标：一句英文进来，2 秒内出一句回答、一个状态、一段语音；判断这是补货、新需求、诈骗、有风险商品还是闲聊，然后把「要买什么」交给 C 的交易模块。B 拥有后端骨架和 `shared-contracts.md`。

## 交付

1. **先推骨架（30 分钟内）**：Node（TypeScript，Fastify 或 Express）+ SQLite + WebSocket，部署到带 HTTPS 的地址（或 ngrok 隧道），iPad Safari 才能开麦。表结构、事件总线、`now()` 函数留好，C 和 D 往里挂。
2. 语音转文字：Deepgram Nova 流式接口。转写文字先做唤醒匹配（和 `wake_name` 模糊读音匹配，宁可误唤醒不能唤不醒），命中进入 20 秒窗口；窗口内的完整句子送大模型。
3. 大模型：Claude Opus 5.5（`claude-opus-5-5`），`output_config.effort: "low"`，流式。工具调用：`find_product(aliases, text)` 从货架选商品、`classify(text)` 判断补货 / 新需求 / 诈骗 / 有风险商品 / 闲聊、`reply(text)` 生成一句口语回答。只能返回货架里的 product id。system prompt 写明：是 AI、不给医疗建议、闲聊最多两轮拉回购物、第一次对话问称呼。分类结果为诈骗或要买东西时，调 C 的 `check(product)` 和 `pay(order)`，按返回结果决定回答和状态。
4. 语音合成：MiniMax T2A（`speech-02-turbo`），声音 `Arrogant_Miss`（嚣张小姐，bright / bouncy / playful，队里 10/17 定的），speed 0.9，返回 `audio_url`。备用 OpenAI TTS。
5. 状态机：按 contracts 推 `state` 事件；`spoke` 回来才切下一状态；20 秒无声回 idle。
6. 第一次对话：没有 `wake_name` 时任何声音都唤醒，AI 问称呼，把回答存进 Settings。
7. 维护 `shared-contracts.md`，格式有变只改那一个文件并通知全队。

## 验收

- 开工 30 分钟：骨架推到 HTTPS 地址，`/ws` 能连，C 和 D 能拉代码跑起来。
- 16:30：curl 发 "the purple bottle is almost empty"，拿到 reply 和 audio_url，2 秒内。
- 20:00 门禁：第二幕从 iPad 说话到手机出红卡全链路通。
- 外部接口挂了返回 "Sorry, say that again?"，不抛 500。

## 依赖和边界

- 风险判定、付款、订单在 C；Memory、异常规则、货架数据在 D。B 调它们的函数，不自己实现。
- 需要 D 的货架 JSON（16:00 前至少 10 个商品）。

## 砍法

Deepgram 不通 → OpenAI 转写 → 键盘输入。TTS：MiniMax 不通 → OpenAI TTS → 浏览器 speechSynthesis。大模型延迟超 4 秒 → `claude-haiku-5-5`。
