# 角色 A：老人端和监护人端（所有界面）

端到端目标：评委对着相框里的 iPad 说英文，看到脸动、听到回答、看到字幕和商品卡片；旁边一台真手机在诈骗时 2 秒内跳出红色等级卡片，Memory 建立时出现普通卡片。两端是同一套组件的两面：商品卡片、警报卡片、Memory 记录只写一次。接口按 `shared-contracts.md`，先对着 `tools/mock-server` 开发，20:00 切真后端。

## 交付：老人端 iPad

1. 纯网页，Safari 全屏 + 引导式访问，竖屏或横屏定一个不再改。
2. 麦克风常开：点一次开麦后持续录音 30 分钟不断。AudioWorklet 取流，分块经 `POST /api/audio` 或 WebSocket 送后端；页面循环播放静音音频防止 Safari 挂起音频会话。浏览器内 Silero VAD（@ricky0123/vad-web）只做「有没有人说话」，有声才上传。
3. 待机：全屏轮播 Settings 里的家庭照片。收到 `state: listening` 时照片淡出。
4. 脸：7 种状态，每种一个动画和一个提示音。资产用 Lovart 出图，动画自己接（CSS/SVG 或 Lottie）。唤醒时全屏一个眼睛；收到第一条 `transcript` 后脸缩到左上角，下面是字幕区。
5. 字幕：微信式左右堆叠，奶奶右灰小字，AI 左白大字；价格和送达日期单独放大。
6. 商品卡片：收到 `card` 弹出，带「Verified」标记；有 `alternative` 时并排两张，左边有风险的、右边替代品。
7. 播放：收到 `speak` / `ask` 播 `audio_url`，为 null 时用浏览器 speechSynthesis 兜底；播完发 `spoke`。嘴型跟音量动即可。
8. 演示时钟：收到 `clock` 在角上显示 "Demo clock: Thu 8:00 AM"。
9. 键盘兜底：隐藏快捷方式（比如连点左下角三次）弹出输入框，发 `utterance {source: "keyboard"}`。

## 交付：监护人端（做到最小）

1. 手机宽度网页（PWA），连 `/ws?role=guardian`，通知靠 WebSocket 实时刷新，不依赖系统推送。
2. 首页：卡片列表。红卡置顶、中性色、带「Call」和「Got it」；普通卡（Memory 建立、补货备注、待签收）排在下面；黄卡按后端给的来，前端不算级别。卡片附 `grandma_note`，没有时显示 "Grandma didn't want to explain this one"。
3. 设置页：分享层级三选一、卡尾号和卡属于谁、每月基线、唤醒名字只读。调 `GET/PUT /api/settings`。
4. 账本页：`GET /api/orders` 返回什么就显示什么，后端已按层级过滤；只显示本月总数和列表。
5. Memory 列表：`GET /api/memories`，暂停和删除按钮。这页排最后。

## 验收

- 现在立刻：真机上点一次后连续录 30 分钟不断，后端能收到音频。失败立即告知全队，改成开场点一下屏幕。
- 20:00 门禁：第二幕补货在真机上有脸、字幕、卡片、声音；手机 2 秒内出红卡并能归档。
- 周日 01:00：四幕所有画面都能出现，包括并排替代品卡片和手机上的 Memory 普通卡；设置页改分享层级后账本页立即变。
- 后端挂了页面不白屏，脸回待机。

## 依赖和边界

- 两端都不做判断，只渲染后端事件。唤醒匹配、级别、过滤都在后端。
- 需要 B 的 `/ws` 和 `/api/audio`；需要 C 的 `/api/orders` 和 `/api/settings`；需要 D 的提示音和占位照片。

## 砍法

Memory 列表页 → 账本页 → Lottie 改 CSS → 嘴型不动只变色 → 待机照片去掉 → 7 种表情合成 4 种。首页红卡和 iPad 的脸不能砍。
