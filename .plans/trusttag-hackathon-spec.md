# TrustTag 比赛版 Spec（DubHacks 2026，Visa 赛道）

2026-10-17 访谈整理。本文件回答两个问题：产品方案还有什么问题，以及按官方评分标准应该怎么取舍。产品为什么这样设计见 `产品方案.md`（PRD.md 已删除，产品方案是唯一的 spec）。

## 1. 官方规则和评分（已核实）

来源：dubhacks-2026.devpost.com 和 dh26.dubhacks.co，2026-10-17 抓取。

| 项目 | 内容 |
| --- | --- |
| 赛道 | Visa: Reimagine Shopping，title track，5000 美元，1 个名额，评委 Lisa Kapil（Visa） |
| 评分 | Functionality 30%（代码能跑、执行质量）；Track Applicability 30%（和 Visa 赛道的相关度）；Design 20%（界面和美观）；Creativity 20%（新颖、弱点少） |
| 评审形式 | 周日 11:30 到 14:00，评委走到桌前看现场演示加问答 |
| 提交 | 周六 10/17 22:30 前交草稿（加全部队员和 Discord、声明赛道），否则周日不能参评；周日 10/18 10:00 前交终稿 |
| 演示语言 | 全英文 |

**方案里原来那张「创新 25%、技术 20%、用户体验 20%、商业影响 15%、信任 15%」的表来源不明，已废弃。**Visa 赛道自己的细则在 Hacker Guide 里，团队手上没有；周六上午第一件事去问 Visa 现场导师，重点问两件事：有没有「必须用某个 Visa API」的要求，沙盒里哪个接口能表达「代老人付款」。

按四项评分重新看产品：

| 评分项 | 权重 | 我们靠什么拿分 | 最大风险 |
| --- | --- | --- | --- |
| Functionality | 30% | 语音进、语音出，真大模型、真 Memory 调度、真异常规则；评委可以换着说 | iPad Safari 麦克风常开没验证；会场噪音 |
| Track Applicability | 30% | 整个产品就是「购物」：一句话下单、可信货架、Visa 付款、Visa 层面的防诈骗 | 评委觉得这是「照护产品」不是「购物产品」。演示里每一幕都要落到一次交易或一次被拦下的交易 |
| Design | 20% | 全屏会动的脸、7 种表情配声音、微信式字幕、电子相框外壳 | 表情动画没做完就只是一个圆 |
| Creativity | 20% | 老人自己起名字、假货给同功效替代品、账单所有权在老人、Memory 自动算余量 | 「弱点少」这一半：评委问误听付款、问隐私，要有准备好的答案 |

## 2. 访谈定下的决策

| 议题 | 决定 |
| --- | --- |
| 全部真做还是模拟 | Visa 沙盒扣款、语音转文字 + 真大模型、Memory 到点触发、异常规则跑真数据，四项都真做。周六 22:30 的草稿不要求完善 |
| Visa 沙盒 | 先做模拟付款界面，后端留 `pay(order)` 一个接口，默认模拟并在屏幕上标「Simulated」。问完导师后一个人花最多 2 小时试沙盒，通了就换实现，不通不换。演示绝不依赖沙盒 |
| 评委说方案外的话 | AI 能闲聊两句再拉回购物。prompt 里写清楚：不谈医疗、不谈天气以外的闲聊超过两轮就引导回购物 |
| 误听 yes 付款 | 演示版不防。评委问到时口头答：生产版要带商品名确认，这是已知弱点 |
| 第三幕替代品 | 按宣称功效对应，不说「成分一样」。话术：这个神奇药丸本身不存在，推荐一个功效差不多、真实存在、有认证的产品 |
| 诈骗一幕 | 并入补货一幕：奶奶买完钙片接着说要买礼品卡，AI 说这是骗局。Visa 层面的保护（卡上关掉礼品卡类别）由讲解的人对评委说，不是 AI 对老人说 |
| 监护人端 | 用真手机呈现，网页版放在 iPad 旁边 |
| 脸的设计 | Design 用 Lovart 出图，动画自己接 |
| 3D 外壳 | 已经快打印完 |
| 演示视频 | 要，2 分钟以内，iPad 录屏 + 手机拍脸 |
| 分工 | 分成四份活，队里自己认领 |

## 3. 技术选型

| 环节 | 选择 | 理由 |
| --- | --- | --- |
| 大模型 | Claude Opus 5.5（`claude-opus-5-5`），`output_config.effort` 设 `low`，用工具调用选货架商品和判断请求类型 | 演示里出错代价最高，用最强的 Opus 系。全场几百次调用在 10 美元以内。effort 调低是为了把回复压到 2 秒内。队友原先写的是 claude-sonnet-5-5，已统一改成 Opus 5.5，要改回去只改一个模型名 |
| 大模型备选 | Claude Haiku 5.5（`claude-haiku-5-5`） | 更快更便宜。现场延迟不满意就换模型名 |
| 语音转文字 | Deepgram Nova 系列；备选 OpenAI 转写接口 | 流式、延迟低、有试用额度。唤醒词靠转写文字模糊匹配，不用单独的唤醒词模型 |
| 语音合成 | OpenAI TTS；备选 ElevenLabs | 比浏览器自带声音自然很多，直接影响 Design 分 |
| 后端 | TypeScript / Node（Express 或 Fastify）+ SQLite + WebSocket | 前后端同一语言，共享数据类型。四人里谁写后端由队里定 |
| 老人端 | 纯网页，Safari 全屏 + 引导式访问 | 方案已定 |
| 监护人端 | 手机宽度网页（PWA） | 方案已定 |
| 付款 | `pay(order)` 适配器：默认 Simulated，可切 Visa 沙盒 | 见第 2 节 |

Typeless 不采用：它是桌面听写软件，没有可供后端调用的接口。

## 4. 方案里还存在的问题

按严重程度排序。前三条不解决，演示会当场失败。

1. **iPad Safari 麦克风常开没有验证。** Safari 要用户点一次才开麦，屏幕休眠或切后台会停止录音。周六 13:00 前必须在真机上验证：引导式访问 + 自动锁定关闭 + 网页里一次点击开麦后能持续 30 分钟录音。失败时的备选：开场由队员点一下屏幕「唤醒」，演示时解释生产版不需要。
2. **会场噪音下的唤醒和转写。** 评委桌前至少有十几个人说话。应对：说话人离 iPad 30 厘米内；大屏幕上实时显示转写文字；唤醒名字选两个音节、辅音清楚的词（演示里奶奶起名「Lily」一类）；转写置信度低时 AI 说「Sorry, say that again?」而不是乱猜。
3. **Memory 到点提醒要在 3 分钟内演示，需要演示时钟。** 后端提供 `POST /debug/clock` 把系统时间推到任意时刻，iPad 和手机同步跳转。屏幕上要标明「Demo clock: Thu 8:00 AM」，否则评委会以为是预录。
4. **Track Applicability：评委可能把它看成照护产品。** 四个场景每一个都必须以交易结束：买到、被拦下、改买替代品。Memory 和异常规则在问答里讲，不占演示主线。
5. **误听 yes 付款。** 已决定演示版不防，但问答要有答案（见第 2 节）。
6. **替代品匹配。** 骗子卖的东西没有真实成分。货架表里给演示用的三个假货预先配好「功效对应」的替代品，后端不做实时匹配。
7. **异常规则在演示数据上没有基线。** 冷启动只开规则 1、4、7、8。演示里礼品卡诈骗命中规则 7（红），当场推到手机，这是异常规则唯一的现场出镜机会。
8. **数据格式没有定稿。** PRD.md 已删，接口、数据表和 WebSocket 消息现在没有任何文档。周六 14:00 前由后端和两个前端一起写一页数据格式，放在仓库里。

## 5. 演示剧本（英文，约 3 分钟）

舞台：iPad 装在相框里放桌上，画面镜像到大屏；一台手机开着监护人网页放 iPad 旁边；一人扮 Grandma，一人讲解。

**Scene 1 · First meeting（15 秒）**
Grandma: "Hello?"
AI: "Hi! I'm your personal assistant. What would you like to call me?"
Grandma: "Let's call you Lily."
AI: "Lily it is. Just say my name whenever you need something."
讲解：老人自己起名字，不用负责人设置。

**Scene 2 · Refill, then a scam（75 秒）**
Grandma: "Lily, the purple bottle is almost empty."
AI（在想 → 在说，商品卡片弹出）: "That's your calcium, 120 tablets, $18. It'll arrive Thursday. Want me to order it?"
Grandma: "Yes."
AI（开心，叮咚）: "Done. I'll remind you every morning at eight, and I'll let you know before it runs out."
讲解：补货；Memory 按产品说明定吃法，余量 AI 自己算；付款走 Visa（沙盒或 Simulated）。
Grandma: "Oh, and someone called. They said I need to buy a $500 gift card today."
AI（警报，脸变红）: "That sounds like a scam. Nobody official asks for gift cards. Please hang up. I'll let your daughter know, okay?"
手机上出现红色等级卡片（中性色，带打电话按钮）。
讲解：这是老人被骗金额最大的场景。TrustTag 拦下了；就算骗子绕过我们让奶奶打电话报卡号，Visa Transaction Controls 已经在卡上关掉了礼品卡类别，这张卡也刷不出去。

**Scene 3 · Fake supplement, real alternative（45 秒）**
Grandma: "Lily, buy me two boxes of those miracle joint pills from TV. They cure arthritis in seven days."
AI（警报）: "I can't find that product anywhere I trust, and nothing cures arthritis in seven days. If you want something for your joints, here's a USP-verified glucosamine. Want to try one bottle?"
Grandma: "Okay."
AI（开心）: "Ordered. Thursday as well."
讲解：不是只拦下，而是给一个真实存在、有认证、功效对应的替代品，老人当场买到东西。

**Scene 4 · Memory reminder with demo clock（30 秒）**
讲解按下演示时钟到周四到货当天，大屏标明 Demo clock。
AI: "Your calcium arrived today. Did you get it?"
Grandma: "Yes, got it."
AI: "The label says one tablet daily with food. Start today, and I'll remind you every morning at eight. Okay?"
Grandma: "Okay."
手机上出现同一条 Memory 的普通卡片。讲解再推到第二天 8:00。
AI: "Good morning. Time for your calcium, one tablet with breakfast."
Grandma: "Took it."
AI: "Great. That bottle should last about four months. I'll order more before it runs out."
讲解：吃法只按标签，标签没写疗程就不定结束日期；余量 AI 自己算；负责人只看到普通卡片不被打扰。

**问答准备**（评委最可能问的五个）：
- 怎么防误听付款 → 已知弱点，生产版带商品名确认。
- 老人不想让子女看账单 → 账单所有权在老人，三个层级老人选，AI 不偷偷汇报。
- 为什么用 iPad → 老人家里最容易有的屏幕，评分里没有硬件项。
- AI 怎么知道还剩多少药 → 从订单数量起算，按服用规则扣，只会算少不会算多。
- 用了哪些 Visa 能力 → Transaction Controls、Merchant Search、Token Service，沙盒接了哪个如实说。

## 6. 周六验证门禁

| 时间 | 门禁 | 不通过怎么办 |
| --- | --- | --- |
| 12:30 | 问 Visa 导师：赛道细则、沙盒哪个接口可用 | 没问到就按 Simulated 做 |
| 13:00 | iPad Safari 麦克风常开 30 分钟验证 | 改成开场点一下 |
| 14:00 | 三端数据格式定稿（订单、Memory、警报、WebSocket 消息） | 不定稿不写业务代码 |
| 16:00 | 语音进 → 转写 → 大模型 → 语音出，一句话闭环 | 砍 TTS 换浏览器声音 |
| 18:00 | Scene 2 补货从头到尾跑通 | 其余全停，所有人上这条 |
| 20:00 | Visa 沙盒要么通要么放弃 | 放弃 |
| 22:30 | Devpost 草稿交掉（队员、Discord、赛道） | 没有退路 |
| 周日 01:00 | 四幕全部跑通，演示时钟可用 | 砍 Scene 4，Memory 只在问答里说 |
| 03:00 | 视频录完 | 用录屏代替 |
| 10:00 | 终稿 | 没有退路 |

## 7. 四份活（队里自己认领）

| 活 | 内容 | 交付 |
| --- | --- | --- |
| A 老人端 | iPad 网页：麦克风常开 + VAD、唤醒名字匹配、7 种表情动画和提示音（Lovart 出图）、全屏眼睛 → 左上角脸 + 微信式字幕、商品卡片、TTS 播放、演示时钟显示；引导式访问设置 | 真机上四幕的画面和声音 |
| B 后端和 AI | Node 后端：Deepgram 转写、Claude Opus 5.5 工具调用（选商品、判断类型、生成回答）、OpenAI TTS、风险检查（货架、风险名单、Safe Browsing）、`pay(order)` 适配器和 Visa 沙盒尝试（最多 2 小时）、Memory 定日期 / 调度 / 到货确认加库存 / 余量计算、8 条异常规则（冷启动开 4 条）和分享层级过滤、WebSocket、`/debug/clock` 和数据重置脚本 | 只用键盘输入和接口就能跑完四幕 |
| C 监护人端 | 手机宽度网页：设置页（隐私信息、支付方式和每月基线、产品信息、照片）、账本按层级显示和「待签收」、红 / 黄 / 普通三级卡片（附奶奶的解释或「奶奶不想解释这一条」）、Memory 列表；和后端一起写数据格式文档 | 手机上实时出现 Scene 2 的红卡和 Scene 4 的普通卡 |
| D 数据、演示和 Devpost | 可信货架数据（约 50 个商品的品牌、价格、商家、成分、认证来源，风险名单，演示用的假货配好功效对应的替代品）；周六 12:30 问 Visa 导师；英文剧本和讲解词、问答卡、Devpost 草稿和终稿文字、数据来源核对补链接、2 分钟视频、现场排练两遍、大屏镜像和热点 | 22:30 草稿、10:00 终稿、视频、货架数据 |

## 8. 待办和未决

- [ ] Visa 赛道细则（Hacker Guide）和沙盒接口，周六 12:30 问导师
- [ ] 唤醒名字在演示里用哪个词，A 和 D 一起选一个转写最稳的
- [ ] 产品方案.md 的评分表换成官方四项（本次一起改）
- [ ] 数据格式一页文档，周六 14:00 前（B 和 C）
- [ ] 异常规则里 100 美元和 50% 的阈值，演示数据按它们配
