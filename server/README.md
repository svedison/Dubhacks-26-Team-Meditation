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
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5`，可由部署者更改。周六夜用真 key 实测：Opus 5.5 每句约 2.2 到 2.5 秒，10 次里 4 次撞到 4 秒截止；Sonnet 5.5 约 1.4 到 2.0 秒，10 次里 1 次。剧本关键句（报价、下单、防诈骗、替代品）是后端模板，模型只做分类，所以换模型不改台词 |
| `MINIMAX_API_KEY` | TTS 首选。声音 `MINIMAX_VOICE_ID` 默认 `Arrogant_Miss`（嚣张小姐），模型 `MINIMAX_TTS_MODEL` 默认 `speech-02-turbo`，`MINIMAX_TTS_SPEED` 默认 0.9，`MINIMAX_LANGUAGE_BOOST` 默认 English；`MINIMAX_GROUP_ID` 仅旧账号需要 |
| `OPENAI_API_KEY` | 备用 TTS（没有 MiniMax key 时用），不用于 LLM |
| `OPENAI_TTS_VOICE` | `sage` |
| `DEEPGRAM_API_KEY` | Nova-3 流式及整段转写 |
| `PUBLIC_BASE_URL` | HTTPS 公网地址；空时使用 `http://localhost:PORT` |
| `DB_PATH` | 相对 server 的 `./trusttag.db`；测试可用 `:memory:` |

Claude 每轮最多一次 `messages.stream()` + `finalMessage()`，结构化输出、effort low，不发送 thinking / temperature / budget_tokens / 强制 tool_choice。模型只能选择货架 ID；拒答、截断、非法 JSON、错误商品 ID、网络错误均降级。无自动重试，Claude 和 TTS 各有 4 秒截止，Deepgram 整段转写 5 秒。正常链路以 2 秒为目标，真实延迟需要有 key 的环境实测；这些截止时间不是 2 秒保证。

TTS 首选 MiniMax：fetch `https://api.minimax.io/v1/t2a_v2`，`speech-02-turbo`、声音 `Arrogant_Miss`、speed 0.9、`language_boost: English`、非流式 hex 返回后解码成 MP3。没有 MiniMax key 时退到 OpenAI `gpt-4o-mini-tts`（voice `sage`）。按提供商、模型、声音、速度和文本哈希缓存到 `audio/`，通过 `/audio/<hash>.mp3` 提供。注意：MiniMax 把 Arrogant_Miss 列在普通话声音下，英文由 `language_boost` 带动，演示前请用一句英文实测听感。


## 部署（Render 免费 Web Service，一个 https 网址托管前端、接口、WebSocket 和语音文件）

仓库根目录的 `render.yaml` 是 Render Blueprint，`.node-version` 锁定 Node 22.23.3（本地实测版本）。构建命令先打包前端再装后端依赖，启动命令 `cd server && npm start`，健康检查 `/api/products`，main 有新提交自动重新部署。

首次部署：登录 dashboard.render.com（用 GitHub 账号），New → Blueprint → 选这个仓库 → Apply。它会要四个值：`ANTHROPIC_API_KEY`、`MINIMAX_API_KEY`、`DEEPGRAM_API_KEY`、`DEBUG_TOKEN`（自己定一个口令）。部署完的网址形如 `https://trusttag.onrender.com`，iPad 打开 `网址/elder`，手机打开 `网址/guardian`。

- `PUBLIC_BASE_URL` 在 Render 上不用填：后端自动用 Render 注入的 `RENDER_EXTERNAL_URL` 拼语音地址。其他平台或 ngrok 仍要填。
- 设了 `DEBUG_TOKEN` 后，`/debug/clock` 和 `/debug/reset` 要带口令，否则 401。优先用请求头，口令里有 `+`、`&`、`#`、空格时放在 `?token=` 里会被 URL 解析改掉：

```sh
curl -X POST https://trusttag.onrender.com/debug/reset -H 'x-debug-token: 口令'
curl -X POST https://trusttag.onrender.com/debug/clock -H 'x-debug-token: 口令' -H 'Content-Type: application/json' -d '{"now":"2026-10-22T17:00:00.000Z"}'
# 也接受 -H 'Authorization: Bearer 口令' 或 ?token=口令
```

  两边都会去掉首尾空白（往 Render 环境变量里粘口令时常带上换行）。一直 401 时看 Render 的 Logs：每次不匹配都会打一行 `Debug token mismatch: got N characters via ..., DEBUG_TOKEN has M`，对一下 M 是不是你记的口令长度；不是就在 Dashboard → milo → Environment 里重设 `DEBUG_TOKEN`（改环境变量会自动重启服务）。
- `GET /api/health` 不要口令，任何人都能看后端此刻在干什么：`{state, turn:{id,stage,stage_ms,text}|null, elder_connected, stt_sessions, mic_session, commit}`。`turn` 不为 null 且 `stage_ms` 很大，就是有一轮卡住了（现在最多 10 秒就会被看门狗放掉）；`commit` 是 Render 当前跑的提交，用来确认新代码已上线。

- 免费档 15 分钟没人访问会休眠，再打开要等约一分钟：演示前先开一次 `/elder`。每次重新部署或重启 SQLite 清零，相当于自动 `/debug/reset`。
- 密钥只放在 Render 的环境变量里，不进仓库；`server/.env` 只在本机用。

## 和 D 的 Memory 模块对接（已接好）

`src/modules/memory.ts` 直接 `import` `modules/role-d/src`（tsx 能跑 D 的 `.ts` 源码），D 负责到货询问、吃法确认、每日提醒、余量和补货备注，B 只做三件事：把演示时钟同步给 D（每秒 tick，`/debug/clock` 跳表）、把 D 的 `ask`/`speak` 接到 TTS 和状态机上（和普通回答排同一条队，先发表情再发事件）、把 D 推出的 memory / alert / order 镜像进 B 的表，REST 照旧。D 的状态快照存在 `trusttag.role-d.db`，`/debug/reset` 一起清。货架也改成读 D 的 `data/products.json`（20 个商品，字段裁成契约里的那几个）。

第四幕在真后端上的跑法（和 D README 一致）：

```bash
curl -X POST localhost:8787/debug/reset
# 先用第二幕下一单（或直接 PUT 一条 deliver_on 为明天的订单），然后：
curl -X POST localhost:8787/debug/clock -H 'content-type: application/json' -d '{"now":"2026-10-22T09:00:00Z"}'
#   -> 设备问 ask/received "Did you get it?"
curl -X POST localhost:8787/api/utterance -H 'content-type: application/json' -d '{"text":"Yes, got it.","source":"keyboard"}'
#   -> ask/dose_confirm
curl -X POST localhost:8787/api/utterance -H 'content-type: application/json' -d '{"text":"Okay.","source":"keyboard"}'
#   -> 手机收到 memory 普通卡
curl -X POST localhost:8787/debug/clock -H 'content-type: application/json' -d '{"now":"2026-10-23T08:00:00Z"}'
#   -> ask/reminder
curl -X POST localhost:8787/api/utterance -H 'content-type: application/json' -d '{"text":"Took it.","source":"keyboard"}'
#   -> "Recorded. Your supply is estimated to last 119 days."
```

## 和 A 的前端对接（已接好）

- **托管前端**：`cd frontend && npm install && npm run build` 生成 `frontend/dist/`，后端启动时发现它就直接托管：`/elder`、`/guardian/*` 回落到 `index.html`，`/api`、`/ws`、`/debug`、`/audio` 不受影响。这样 iPad 只需要一个 HTTPS 地址（ngrok 指向 8787），不用设 `VITE_BACKEND_URL`。
- **麦克风上传**：A 的 iPad 把 16 kHz 单声道 16 位 PCM 按块 `POST /api/audio?seq=N&sr=16000&speech=1[&end=1]`，一句话结束的块带 `end=1`。后端把这些块喂给同一条 Deepgram live 连接（`encoding=linear16`），`end=1` 时发 `Finalize` 让 Deepgram 立刻出最终文本，文本再进对话流水线；每个请求立刻返回 `202 {ok, seq, stt}`，不等 Claude。`stt: false` 表示没有 Deepgram key。90 秒没有新块自动断开 Deepgram；Deepgram 自己挂断的连接下一块到达时立刻重开（以前会一直往死连接里灌、字幕全没，直到 90 秒没人说话）。`speech=1` 的块同时告诉流水线「奶奶正在说话」，见下一节。
- **Deepgram 断句**：`endpointing` 从 1000 ms 提到 1500 ms（`utterance_end_ms` 2000）。iPad 现在停顿 1.2 秒才算一句说完并发 `end=1`，后端不能比它更急，否则 1.1 秒的喘气就会在设备决定之前被 Deepgram 切成两句。正常情况仍由 `end=1` → `Finalize` 立刻出结果，延迟不变。
- 不带 `seq` 的整段音频仍走原来的整段转写路径。
- **唤醒名**默认改成 `Milo`（A 的界面文案叫 Milo），mock、contracts、seed 一致。
- **表情顺序**（A 10/18 的要求）：现在是 thinking → happy/worried/alert → `speak`/`ask` → 老人端 `spoke` → listening。说话期间脸就是那个表情，不再先发 `speaking`。
- 后端不发 `connected` 事件；A 看到的那个来自别的后端（D 的独立 harness 或代理），契约里已写明只发表里列的事件。

## 对话流水线：一轮永远会结束，半句话不单独回答（2026-10-18 线上卡死之后）

线上曾经一句「I want to buy something to eat, I feeling a little bit of headache」被切成两段，第二段进来后状态停在 `thinking` 五分钟以上，后面所有话都排在它后面没人处理。现在的规则：

- **每一步有上限**：Claude 和 TTS 调用除了自带的 4 秒截止，流水线上再包一层 5 秒；到点拿不到结果就当没有（Claude → 兜底回答，TTS → `audio_url: null` 让浏览器自己念）。
- **看门狗**：一轮在任一阶段（waiting / holding / thinking / responding）超过 10 秒没有进展，就被放掉：发一次「Sorry, say that again?」（worried 脸）→ `speak` → 老人端回 `spoke` → listening，队列继续处理后面的话。日志里是 `[pipeline] turn #N made no progress ... releasing the conversation`。连兜底都发不出去时直接强制回 listening。
- **断句合并**：一句被切成两段时，第二段到达而第一段还没决定怎么回（排队中 / 等设备播完 / 等奶奶说完 / Claude 还在想），第一段这一轮作废（Claude 调用被 abort），用「第一段 第二段」拼起来重新走一轮，只回答一次。字幕上第二段单独显示一行，不重复第一段。Claude 已经给出结果、开始生成语音以后到的话算新的一句，不再合并（避免「yes」「please」合并时把已下的单重复或丢掉确认）。
- **等她说完**：`/api/audio` 的 `speech=1` 块每 0.25 秒一来就说明奶奶还在说话。第一段文本到了但麦克风还在送 `speech=1`，先不问 Claude（状态留在 listening），等 `end=1` 和 Deepgram 的下一段文本到了再合并；Claude 已经答了但她在这期间又开口，同样等她说完让后半句接管。最多等 6 秒。她没在说话时这一步零延迟。
- 单元测试在 `test/recovery.test.ts`；本地用 `ANTHROPIC_API_KEY=` 置空也能跑。

## 数量：按她说的买，超过平常先问原因（2026-10-18）

- "I want three boxes of tissues" 就买三盒：Claude 的结构化输出多了 `quantity`，本地 `src/quantity.ts` 再兜底解析（"three boxes"、"2 packs"、"a couple of"；"2% milk"、"600 mg"、"100 tablets"、"a dozen eggs" 这类规格不算数量）。报价 *"Three packs of X come to $26.97; would you like me to order them?"*，卡片显示总价和 "3 × 单价"，订单带 `quantity`，`price_cents` 是总价，账本行显示 "× 3"，到货时 D 按包数加库存。
- **超过平常的量**先问原因：保健品和非处方药超过 2 包、日用食品超过 6 包，Milo 用 worried 脸说 *"Six packs of X is more than usual. Is there a reason you need that many?"*，这时不下单。她的下一句按这样分流：
  - 说了原因 → 收下原因，按上限封顶（保健品和药最多 3 包，日用最多 12 包）：*"Thank you. I can order up to three at a time, so let's make it three: $54.00. Shall I order them?"*；她说 yes 才下单，下单后女儿收一张普通卡 "A bigger order than usual"，正文带数量、金额和她的原话（是知会，不是审批）。
  - 说 "no / no reason / I'm not sure" → 从一包开始：*"Then let's start with one… I'll remind you when it runs low. Shall I order it?"*
  - 换了个数字（"make it two"）→ 按新数量重新报价（仍超平常会再问一次）。
  - "never mind / cancel" → 不买。
  - 只说 "yes" → 追问 *"Could you tell me why you need that many?"*
  - 原因里有诈骗特征（"someone called and said I must buy them today"）→ 走防诈骗流程，红脸红卡，不下单。
- 测试在 `test/quantity.test.ts`。

## 货架之外的东西：Milo 去找，不让她去问女儿（2026-10-18）

- 以前货架上没有的东西一律红脸说 "I can only order from our trusted shelf"。现在是 happy 脸说 *"I don't have that on my shelf yet. Let me find a trusted one for you; I'll have it ready by tomorrow."*，女儿手机上多一张普通卡（标题 "A new wish"，正文带她的原话），是心愿记录不是审批。原则：自由是默认，家人只在风险（诈骗、召回、异常花费）时介入，"没见过"不是风险。
- **货架可以扩到几百个商品**：`src/shelf.ts` 先按别名、品名、类目词把这句话可能指的商品挑出来（最多 12 个，待确认的商品一定在内；什么都没对上就每类给一个常见品），只把这些给 Claude，提示词不随货架变大。货架不超过 24 个时原样全给，所以 20 个的演示数据行为不变。扩货架只要改 `modules/role-d/data/products.json`，给每个商品配三到五个奶奶会怎么说的 `aliases`。

## 货架数据：一百个真实日用品，从哪来、怎么更新（2026-10-18）

`modules/role-d/data/products.json` 现在是 100 个商品：97 个按独居老人一周的生活挑的日用消耗品（早餐杂货、饮品营养、零食、个护、日用、非处方药、保健品、宠物）加 3 个演示用的风险样本。清单在 `tools/shelf/catalogue.json`，每个商品带门店搜索词和三到五个奶奶会怎么说的 `aliases`；生成脚本是 `tools/shelf/build-shelf.mts`：

```bash
cd server
# 只用不需要 key 的来源：NIH 补剂标签库（规格、成分，按品牌匹配）、openFDA（非处方药标签用法）；价格是典型价并在 price_source 里标明
npx tsx ../tools/shelf/build-shelf.mts --write
# 有 Kroger 开发者账号时：按一家 QFC 的实时门店价和真实品名生成（默认西雅图 98105 附近，可用 KROGER_ZIP / KROGER_CHAIN 改）
KROGER_CLIENT_ID=... KROGER_CLIENT_SECRET=... npx tsx ../tools/shelf/build-shelf.mts --write
# 可选：加两条 FDA 正在进行的保健品召回作为风险样本（会让 D 的"正好三个风险品"测试需要同步改）
npx tsx ../tools/shelf/build-shelf.mts --write --recalls
```

- 2026-10-18 03:30 起数据来自 **QFC University Village（2746 NE 45th St，UW 旁边）** 的实时门店价和品名，97 个日用品里 90 个拿到了门店数据，其余 7 个（鸡蛋、狗粮、小夜灯、邮票、填字书等）用典型价并在 `price_source` 标明。
- 演示脚本依赖的五条记录钉在 `tools/shelf/demo-records.json`，脚本永远以它为准：calcium-120 仍是 120 片 18 美元、别名 "the purple bottle"（门店实价 23.99 写在 `certification_source.note` 里），glucosamine-usp 24 美元，三个风险品不变，所以第二幕和第四幕（"estimated to last 119 days"）不受影响。
- 新商品的图片：老人端按 id 找本地图，找不到显示首字母，A 有空可以给常用的几个补图。
- 服务端进 Claude 的只是 `src/shelf.ts` 挑出的最多 12 个候选，货架再扩也不拖慢。

## 唤醒更灵、后半句不掉队（2026-10-18 第二次 iPad 实测后）

- **唤醒**：Deepgram 连接带上 nova-3 的 `keyterm=<唤醒名>`，专门提高这个词的识别率；后端匹配兼容 "my low"、"me low"、"mellow"、"Milow" 这些常见误听（`wake.ts`）；一个字的唤醒常在连接握手完成前就说完，Finalize 以前会被丢掉，现在排队到连上再发；麦克风会话 90 秒空闲断开改成 10 分钟（KeepAlive 维持），演示里每次开口不用再付重连延迟。iPad 端 VAD 阈值 0.5/250 ms 放到 0.4/150 ms（`micStream.ts`），轻声一个 "Milo" 也会上传。
- **查实际听到了什么**：`GET /debug/heard`（带口令）列出最近 30 句 Deepgram 交出的文字、来源、有没有唤醒、判成什么意图。唤醒不稳先看这里，再决定是调匹配还是换名字。
- **只喊一声 "Milo" 也要醒（2026-10-18 第三次实测："单说 Milo 不醒，带 Milo 的整句才醒"）**：Deepgram 文档写明，Finalize 之后的最终结果*不保证*——缓冲区里音频太少时（一个词 0.4 s 加 iPad 送来的 1.2 s 静音）可能什么都不回，这个词就留在 Deepgram 里，直到下一句话把它一起顶出来，所以看起来是下一句才唤醒。现在三处一起改（`stt.ts`、`pipeline.ts`）：① 每个 `end=1` 在 Finalize 之前先补 1.5 s 静音（只对裸 PCM），静音总长超过 Deepgram 自己的 1.5 s endpointing，这个词当场被收尾送回；② 待机时 Deepgram 的 interim（中间结果）只要匹配唤醒名就直接开窗（`pipeline.heardInterim`），不等 final——开窗无害，脸也早一秒反应；interim 永远不进购物流程，final 到了照常走原来的路（只有名字就静默保持在听）；③ `GET /debug/heard` 多了 `deepgram` 字段：最近 40 条 Deepgram 原始消息（interim / final / 我们发的 finalize，带文字和时间）。再有"喊了没醒"，先看这里：没有 interim 和 final 是 iPad 没传或 Deepgram 没认出；有 interim 没 final 是 Finalize 没回；文字歪了是匹配要调。
- **后半句**：以前只有 Claude 还在想的时候，后半句才会并进同一轮；现在直到语音真正发出去之前都可以并（多了 TTS 那一秒多）。已经下单、报警、答过 Memory 问题的轮次例外，不会被替换。
- 名字换不换：改拼写（Millo）没用，发音一样；要换就换 Hazel 或 Daisy 这种辅音清楚、没有常见词同音的名字，需要同时改 A 的文案和后端警报正文。

## 说话的口气、"我今天买了什么"、商品图（2026-10-18 第一次 iPad 实测后）

- **不再每句 "I'm Milo, an AI"**：起名那一次已经说明过自己是 AI，之后直接说事；她不舒服、累、孤单时按朋友的口吻说 *"I'm your friend and I'm right here with you"*；只有她问"你是真人吗"才老实回答是 AI。提示词改了，另外 `tidyReply` 会把模型偶尔还带的 "I'm Milo, an AI helper, and" 开头剥掉（单独一句 "I'm an AI." 回答"你是人吗"时保留）。
- **"What did I buy today?"**：Claude 的上下文里现在带演示时钟的今天和最近 6 笔订单（商品、价格、下单日、到货日、是否签收），它照事实回答；没有就说今天没买并问要不要帮忙。
- **"I want some food" 不再被顶回 "What would you like to find on our shopping shelf?"**：话里有购物词或点到货架上的东西（别名、品名；单独一个 "night"、"dog" 这种常见词不算）就不算闲聊、不计轮数。纯闲聊两轮后的提醒改成 *"Is there anything you'd like me to get for you today?"*。
- **商品图**：QFC 的 90 个真货带门店正面图（`image_url`，Kroger 公开图片地址），老人端商品卡优先用它，没有的（五条演示记录、7 个典型价商品）仍按 id 用本地图或首字母。契约里 `image_url` 是可选字段。

## 奶奶说身体不舒服：紧急就打 911，一般不舒服就陪着（2026-10-18）

以前 "I'm not feeling well" 得到的是 "As an AI I can't give medical advice, please contact your doctor"，第三轮还会被转去购物。现在分两种：

- **紧急**（本地关键词即时触发，不等 Claude：chest pain / hurts、can't breathe、fell down / had a fall、bleeding heavily、stroke、passed out、911、ambulance、救命、摔倒 等；Claude 另外能把 "I can hardly breathe" 这类说法归成 `emergency` 意图；"my chest hurt last week" 这种过去式不触发规则，交给模型判断）：
  1. Milo 红脸说 *"That sounds serious. I'm calling 911 in five seconds. Say 'stop' if you don't want me to."*，同时女儿手机立刻收到红卡：标题 Emergency，"Her words" 是她的原话，正文 "Milo is calling 911 unless she stops it in the next few seconds. Call her now."
  2. 这句话播完（老人端回 `spoke`，或 8 秒超时）后开始数 5 秒。期间只听 "stop / no / don't / wait / cancel / never mind / I'm fine"，别的话一律忽略、保持 listening。
  3. 5 秒内没叫停就"拨号"：红脸说 *"Calling 911 now. Help is on the way; stay with me."*，红卡正文改成 "911 was called. Call her now."。演示里不真打电话，老人端看到这句字幕就是拨号画面。之后 90 秒内再说症状，只回 *"Help is on the way. Stay with me."*，不会再数一次。
  4. 叫停了就说 *"Okay, I won't call 911. I'm letting your daughter know right now."*（worried 脸），红卡正文改成 "She stopped the 911 call herself. Call her now."
  5. `/debug/reset` 会取消正在数的倒计时。倒计时长度是流水线参数 `countdown`，默认 5000 ms。`/api/health` 的 `emergency` 字段显示 warning / countdown / called / stopped。
- **一般不舒服**（headache、tired、not feeling well、lonely）：Claude 归为 `unwell`，worried 脸，一句温和的话陪着她，不说"我帮不了你"，不提医疗建议，也不再在两轮后转去购物；模型万一还是写了 "can't give medical advice"，后端换成 *"I'm sorry you're not feeling well. I'm right here with you; tell me if anything feels worse."* 这一档不通知女儿，也不推荐货架上的药。
- 测试在 `test/emergency.test.ts`。

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

`POST /debug/clock {now}` 设置 ISO 演示基点，之后叠加真实经过时间。**时钟默认是西雅图当前的墙上时间**（启动和 `/debug/reset` 时取 America/Los_Angeles 的当前时刻，自动分 PDT/PST）：字符串末尾虽然写 Z，数字就是西雅图的钟面，两端照字面显示，D 的 "08:00" 提醒就是早上 8 点，到货日、账本月份都按这个日期算，没有任何地方拿它和真实时刻比。测试用 `DEMO_CLOCK_START=2026-10-17T18:00:00Z` 钉死（`npm test` 里已带）；线上想钉死也可以在 Render 加同名环境变量。**跳表目标按屏幕上的日期算**：到货日 = 下单日 + 5 天，比如周日 10-18 下的单，第四幕要跳到 `2026-10-23T09:00:00Z`（到货）和 `2026-10-24T08:00:00Z`（提醒），不是写死的 10-22 / 10-23。每秒及手动跳时钟均调用同一组 tick handler 并广播 clock。`POST /debug/reset` 复原种子、时钟、对话、待确认订单及音频连接；旧异步回答不再写入新一轮演示。

## curl 验收

```bash
PORT=8799 ANTHROPIC_API_KEY= MINIMAX_API_KEY= OPENAI_API_KEY= DEEPGRAM_API_KEY= npm start
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

## Visa Sandbox（已接入测试账户验证）

`pay()` 可先调用 **Payment Account Validation**，通过后继续模拟下单。验证的是 Visa 门户提供的固定测试卡，不是 Settings 的卡尾号，也不是老人真实的卡；**不是购买授权或扣款**。Order 仍为 `simulated_paid`。没有接入 Intelligent Commerce 或 Token Service。

**怎么在演示里看到它（2026-10-18）**：校验的脱敏结果作为 Order 的可选字段 `payment_check`（provider、approved、action_code、checked_at、note）随 `order` 事件发给两端。通过时 Milo 说 *"Your order is placed; Visa confirmed your card. I'll let you know when it arrives."*，老人端商品卡的章是 "Ordered" 加一行 "Card checked with Visa"，监护人端 Money 页每笔订单带 "Visa ✓ card checked"。语音和卡片都不再出现 "simulated"：状态仍存 `simulated_paid`，Money 页底部注明一次 "Demo build: orders are placed in the Visa sandbox, no real charge"。

`VISA_SANDBOX_PREFLIGHT` 三个值：`0`（默认）不调用、订单没有 `payment_check`；`1` 严格，校验失败不下单（luyichen 的原设计）；`soft` 演示用，3 秒内没结果照常模拟下单并带 `approved: false, note: 原因码`，Milo 只说 "Your order is placed"。

**部署到 Render**：最省事的办法是只传一个文件：本机 `npx tsx tools/visa/make-bundle.mts <凭据目录> ~/Downloads/visa-bundle.json` 把 8 个文件打成一个 JSON，然后 Dashboard → milo → Environment → Secret Files → Add Secret File，文件名填 `visa-bundle.json`，把那个文件的内容整段粘进去。后端启动时发现 `/etc/secrets/visa-bundle.json` 会解包到进程私有的临时目录（0700/0600）。也可以把 8 个文件按原名各加一个 Secret File（Render 挂在 `/etc/secrets/`）。后端启动时发现 `/etc/secrets/auth.json` 就自动把它当 `VISA_SANDBOX_DIR`，并在没有显式设置 `VISA_SANDBOX_PREFLIGHT` 时用 `soft`，所以不加环境变量也能生效；要严格模式再设 `VISA_SANDBOX_PREFLIGHT=1`。验证：`GET /debug/visa`（带口令）列出 8 个文件哪些在、当前模式、Hello World 是否通；再下一单，`GET /api/orders` 里应能看到 `payment_check.approved: true`。

把以下文件保存在 Git 仓库外的私有目录（目录权限 700，文件 600）：

- `auth.json`：`{"username":"沙盒 API 用户名","password":"沙盒 API Password"}`，不是网页登录密码。
- `client-cert.pem` / `client-key.pem`：Two-Way SSL 证书及匹配私钥。
- `mle-key-id.txt`、`mle-server-cert.pem`、`mle-client-cert.pem`、`mle-key.pem`：同一个 MLE Key ID 的证书及客户端私钥。
- `pav-fixture.json`：仅使用该项目 Test Data 的成功用例。字段为 `primaryAccountNumber`、`cardExpiryDate`（YYYY-MM）、`cardCvv2Value`、`acquiringBin`、`acquirerCountryCode`、`addressVerificationResults`（street/postalCode）、`cardAcceptor`（idCode/terminalId/name/address，address 包含 state/city/zipCode/country）。不要填真实银行卡。选择预期 actionCode 00 或 85、AVS Y、CVV M 的用例。

先运行独立诊断（输出已脱敏）：

```bash
export VISA_SANDBOX_DIR="$HOME/.config/milo/visa-sandbox"
npm run visa:check
```

诊断依次检查 Hello World 和加密 PAV 响应；任一失败返回非零退出码。它不会写订单或扣款。要让本机后端每次确认购买时先运行测试账户验证，在 `server/.env` 设置 `VISA_SANDBOX_PREFLIGHT=1` 和 `VISA_SANDBOX_DIR` 的绝对路径，然后重启后端。默认 0 不调用 Visa。配置错误、超时、HTTP 错误、明文/损坏响应、拒绝或 AVS/CVV 不匹配均中止下单，不写成功订单；失败后需重新发起购买并确认。

请求固定发往 `sandbox.api.visa.com`，使用 mTLS、Basic Auth 和 RSA-OAEP-256/A128GCM MLE。单次网络请求最多 10 秒、响应最多 1 MiB，无自动重试；MLE 时间戳使用真实时间。凭据和测试卡不进入 Order、WS 消息、日志或 Git。`npm test` 强制关闭外部 Visa 调用，失败/重复/重置场景用可控的外部边界替身验证。

凭据只存在这台电脑；部署或队友电脑需要各自安全配置。此改动不会自动启用线上服务。公开演示后端没有用户认证，勿接入真实卡或真实资金。

官方依据：[PAV](https://developer.visa.com/docs/pav)、[MLE](https://developer.visa.com/docs/message-level-encryption)。

## C / D 接入点

- `src/contracts.ts`：共享对象的 TS 类型和输入校验；不在响应中增加支付 ref 等字段。
- `src/db.ts`：六张表均为 `(id TEXT PRIMARY KEY, data TEXT JSON)`。`get(table,id)` / `all(table)` / `put(table,id,value)` / `remove(table,id)`；`transaction(fn)` 只用于同步、非嵌套操作。Settings 存在 `settings/default`，自由 KV 存状态或去重标记。`sqlite` 也可直接访问。
- C：`modules/risk.ts` 提供 `check(product_id,text)`、`pay(order)`、`ledger()` 和 `publishOrder()`；`modules/orders.ts` 的 `placeOrder(draft,isCurrent?)` 是成功订单的唯一写入点。当前支付始终 simulated_paid，Order 和私有 `kv/payment:<order id>` 在同一事务写入，随后按分享层级推送；同一 ID 同一支付意图的重试复用结果，不同意图拒绝。check 无副作用，可在确认前后重复执行；规则 7 的创建仍在 pipeline 调 D 的 createAlert，避免双重告警。普通 `today` 不触发，礼品卡、转账、来电及「今天必须」类紧迫话术才触发。付款前校验商品、价格、订单格式和资格。
- D：`modules/memory.ts` 导出 `createAlert(level,rule,title,body)`、`saveGrandmaNote()`、`markReceived()`、`registerMemoryTicks()` 和 `shelfSeed`。红立即推，普通立即推，黄色暂只存库。库存只更新已有 Memory，不擅自建立吃法。`src/seed.ts` 集中放种子，D 可扩展货架。
- D：在已注册的 tick 占位回调中实现到货/提醒；`onTick((prevNow,now)=>...)` 返回注销函数。用 `kv` 持久化已触发日期，处理前跳和回拨，避免重复提醒。交互通过 `bus.toElder({type:'ask',...})`、`state`、`awaitSpoke()`；在 `pipeline.ts` 模型判断前接入待回答的 received/dose/reminder 流程。Visa 沙盒账户验证见上节；D 的能力以当前 Memory 模块实现为准。

所有演示业务时间使用 `clock.now()`；20 秒交互窗口、播放超时、API 超时使用真实计时器。此版本为单个奶奶的共享对话，同一进程串行处理输入，不是多租户系统。

## 测试方式

`npm test` 使用 Node test runner（通过 tsx），覆盖唤醒、播放状态、购物确认、防诈骗、分享过滤、库存幂等、时钟、REST 和 WebSocket handler；provider 测试用模拟 HTTP/SSE 验证请求参数与失败降级，不会调用真实付费 API。

如果执行环境禁止 tsx CLI 建立 IPC socket，可使用 `node --import tsx --test test/*.test.ts` 执行相同测试。REST 和 WS 测试使用 Fastify 的 inject / injectWS，不需要监听 TCP；这不能替代实际端口、HTTPS、iPad 麦克风与有 key 的端到端验收。

C 新增的 `role-c-api.test.ts` 还会监听随机 localhost 端口，实际验证 HTTP/WS 的补货、诈骗告警和替代品购买（只替换外部 Claude 响应，TTS 关闭），并用独立进程验证 SQLite 持久化。因此完整测试需要允许本地 TCP。接入约定、验证范围和既有依赖告警见 [C 交接](../.plans/role-c-handoff.md)，演示问答见 [Visa Q&A](../.plans/visa-qa.md)。
