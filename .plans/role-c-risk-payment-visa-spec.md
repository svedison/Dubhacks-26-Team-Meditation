# 角色 C：风险检查、交易和 Visa

端到端目标：B 问「这个能买吗」，C 回答能、不能、或改买哪个替代品；能买就付款、写订单、按老人选的分享层级推给手机。整条交易链路一个人负责，Visa 沙盒也在这里试。代码挂在 B 的骨架里。

## 交付

1. **风险检查 `check(product_id, text) → {ok, reason, alternative?}`**：商品在货架且 `risk` 为空 → ok；`risk` 非空（fda_fraud / recall / unverified）→ 不 ok，带 `alternative_id` 对应的商品；商品不在货架 → 不 ok，`reason: "off_shelf"`。文字含礼品卡、转账、「有人打电话让我买」、「今天必须」→ `reason: "scam"`，并调 D 的异常模块生成规则 7 的红色 Alert。
2. **付款适配器 `pay(order) → {status, ref}`**：默认 `simulated_paid`，前端标 "Simulated"。接口形状定死，换实现只改这一个函数。
3. **订单和账本**：Order 写库；`GET /api/orders` 按 `share_level` 过滤（minimum 只返回异常相关、default 多本月总数、open 全部）；下单后推 `order` 事件给手机；`POST /api/orders/:id/received` 标记签收并通知 D 加库存。
4. **Settings**：`GET/PUT /api/settings`，包括分享层级、卡尾号、卡属于谁、每月基线、唤醒名字。
5. **Visa 沙盒**（20:00 第二幕通了之后再碰，最多 2 小时）：Visa Developer Platform 建项目、下证书、先试 Token Service 或 Intelligent Commerce 里沙盒开放的任何一个能表达「代老人付款」的接口；通了换 `pay()` 实现并在屏幕上去掉 Simulated。不通就保持模拟，演示时如实说。Merchant Search、Transaction Controls 只在讲解词里说，不接。
6. 问答卡里 Visa 相关的三个答案由 C 写：用了哪些 Visa 能力、误付怎么防（Intelligent Commerce 的代理凭证带上限）、为什么卡上能关礼品卡类别。

## 验收

- 16:30：`check()` 和 `pay()` 有单元测试，三个演示商品（钙片、氨糖、神奇药丸）和一句礼品卡文字返回正确。
- 20:00 门禁：第二幕里下单写库、手机收到 order 事件；诈骗句触发红色 Alert。
- 周日 01:00：设置页改分享层级后 `GET /api/orders` 返回随之变；第三幕替代品下单成功。
- Visa 沙盒要么周日 03:00 前通，要么放弃，不拖到上午。

## 依赖和边界

- 挂在 B 的骨架里，B 推骨架前先写纯函数和测试。
- 货架数据和替代品配对来自 D；Alert 的等级逻辑在 D，C 只调用。
- 不碰前端、不碰语音。

## 砍法

Visa 沙盒 → Settings 页接口只留分享层级 → 账本过滤只做 open 和 default 两级。`check()` 和 `pay()` 不能砍。
