# Timer Capability Direction

_Last updated: 2026-03-14_

> 状态：方向判断与能力边界说明。
> 当前已落地的是前端 `focus timer` 小部件；这里讨论的是更高一层的 `scheduled trigger` 能力。

---

## 核心判断

你要的本质不是“日记能力”。

你要的是：

**一个可以在固定时间触发某些内容或动作的通用定时能力。**

这件事不应该被建模成某个单独 app 的特性，比如“日记提醒”。

它更应该被建模成 RemoteLab 平台上的基础能力：

- 在什么时间触发
- 触发谁
- 触发后做什么
- 做完后如何反馈

所以正确抽象不是 `Diary`，而是 `Trigger + Action + Review`。

---

## 先把两类 timer 分开

### 1. Focus timer

这是面向当前页面使用者的手动倒计时。

特点：

- 本地前端即可完成
- 服务于专注、番茄钟、短时间块
- 不需要服务端调度
- 不需要跨 session / 跨设备一致性

这个能力已经适合放在 chat header 里。

### 2. Scheduled trigger

这是平台级能力。

特点：

- 需要每天/每周/某个固定时间触发
- 可能在用户不在线时也要运行
- 需要绑定 session、app、workflow 或动作模板
- 需要记录“上次运行”“下次运行”“失败原因”

这才是你现在真正想讨论的东西。

---

## 这个能力真正的价值

它的价值不是“提醒一下用户”。

提醒只是最弱的一层。

真正的价值在于：

1. 把用户的长期意图变成稳定的外部触发
2. 让系统主动在正确时间做事，而不是永远等用户手动点开
3. 把重复性的日常动作平台化

换句话说：

**timer 的意义不是计时，而是让系统获得时间上的主动性。**

---

## 最合理的能力模型

建议把它抽象成下面 4 个概念。

### 1. Trigger

定义什么时候触发。

最小字段：

- `type`: once / daily / weekly / cron-like
- `timezone`
- `time`
- `daysOfWeek`
- `enabled`

### 2. Target

定义触发谁。

最小目标类型：

- 某个 session
- 某个 app
- 某个 user scope

### 3. Action

定义触发后做什么。

第一阶段不要太重，建议只支持：

- 向某个 session 注入一条预定义消息
- 创建一个新 session 并发送 starter prompt
- 只发送提醒/通知，不自动执行

### 4. Outcome

定义运行结果如何被记录。

至少要有：

- last run
- next run
- last status
- last error

---

## 在 RemoteLab 里应该放在哪

### 不是放在单个 message 旁边

因为这不是单条消息行为。

### 也不应该先塞进某个专门 app 里

因为它是跨 app 的平台能力。

### 更合理的位置

#### 1. 数据/能力层

放在 session/app 之上的一层，作为通用 scheduler capability。

也就是：

- session 负责承载上下文
- app 负责承载 policy / workflow
- timer 负责承载时间触发

#### 2. UI 层

建议分两处：

- session header / metadata area：展示这个 session 有没有绑定 schedule，以及下次运行时间
- settings 或 app detail：编辑 schedule 规则

原因：

- 查看状态应该离 session 近
- 编辑规则应该离平台配置近

---

## 第一阶段最值得做的版本

不要一上来做通用 cron 平台。

先做一个非常窄的版本：

**每天固定时间，向指定 session 注入一条预定义 prompt。**

例如：

- 每天 09:00，向“Daily planning” session 发：`请根据昨天记录和今天目标，给我 3 个优先任务`
- 每天 22:30，向“Night review” session 发：`请带我快速复盘今天，并生成明日第一步`

这个版本已经足够验证需求，而且直接连接你最关心的“过去内容 -> 今天行动”闭环。

---

## 为什么这比做单独日记功能更对

因为“日记”只是内容类型，不是能力类型。

而 timer 是横跨很多内容类型的基础设施：

- 日记
- 计划
- 复盘
- 健身
- 学习
- 销售跟进
- 内容发布

如果一开始把它做成“日记提醒”，会过早锁死边界。

如果把它做成“定时触发某个 workflow”，能力会自然更强。

---

## 我建议的迭代顺序

### Phase 0

前端 focus timer。

作用：

- 解决手动专注计时
- 建立 timer 的基本交互位置

### Phase 1

平台级 daily trigger，但只支持：

- daily
- fixed local time
- target session
- predefined prompt injection

### Phase 2

加入：

- weekly / custom recurrence
- target app / create session
- 运行历史与失败重试
- push / notification / external delivery

### Phase 3

再考虑：

- 更强的 workflow graph
- 条件触发
- 依赖其他 session 状态的触发

---

## 一个更准确的产品说法

不要说：

- AI 日记
- 定时提醒
- 每天让我写东西

更准确的说法是：

**RemoteLab 获得了时间触发能力。**

或者：

**让某些工作在固定时间自动开始，而不是等我手动打开。**

这才是平台级能力的表达。

---

## 当前结论

如果只保留一句话：

**你不是要做日记功能，而是要给 RemoteLab 增加“按时间触发工作”的能力。**

如果只保留第一版实现：

**每天固定时间，向指定 session 自动发送一条预定义 prompt。**

---

## 用户最关心的核心体验

这个能力里最重要的一点，不是“能设置时间”。

而是：

**用户必须始终看得见时间状态。**

也就是：

1. 下一个会在什么时候触发
2. 今天已经触发过哪些
3. 哪些触发成功了，哪些失败了
4. 我现在距离下一个自动动作还有多久

如果这些状态不可见，scheduler 很快会变成“后台黑箱”。

而一旦它变成黑箱，用户就不信任它，也不敢把重要工作交给它。

---

## 具体用户使用路径

建议先按 4 条路径设计。

### 路径 1：从 session 内直接创建一个 daily trigger

这是最自然的入口。

用户路径：

1. 用户正在某个 session 里，比如 `Daily planning`
2. 用户点开 session header 上的 `Schedule` 入口
3. 选择：
   - 每天
   - 09:00
   - 当前时区
4. 选择动作：
   - 到时间后自动向当前 session 发送一条预定义 prompt
5. 保存
6. 保存后，header 里立刻显示：
   - Daily at 09:00
   - Next run in 13h 24m

这个路径适合第一版，因为用户不需要先理解一个完整调度中心。

### 路径 2：每天打开 RemoteLab，看今天的时间状态

这条路径解决“我可以看见时间情况”。

用户路径：

1. 用户打开 RemoteLab
2. 在首页或 sidebar 顶部先看到一个 `Today` / `Schedule` 概览块
3. 快速看到：
   - 下一个触发是什么
   - 今天已经跑了几次
   - 哪个失败了需要介入
4. 再决定是否点进具体 session

这里的重点不是编辑，而是总览。

### 路径 3：触发执行后，用户查看结果

用户路径：

1. 到点后，系统自动触发
2. session 列表或 session header 出现一条状态：
   - Ran 2m ago
   - Completed
   - Failed
3. 用户点进去，看自动发出的 prompt 和结果
4. 如果失败，能直接看到失败原因和重试入口

这条路径决定用户是否会信任这个能力。

### 路径 4：用户统一管理多个 trigger

这是第二阶段。

用户路径：

1. 用户打开 `Settings > Schedules`
2. 看到所有 schedule 的列表
3. 按：
   - enabled / paused
   - next run
   - target session / app
   - last result
   排序和筛选
4. 在这里统一编辑、暂停、复制、删除

这个页面不应该是第一入口，但必须存在。

---

## 最合理的 UI 层级

不要把所有能力都挤在一个页面里。

更合理的是三层 UI。

### 第一层：全局时间概览

位置建议：

- sidebar 顶部
- 或主界面顶部一个很轻的 `Today` 区块

显示内容：

- Next trigger
- Today completed
- Needs attention

它解决的是“我现在对系统的时间状态有没有整体感知”。

### 第二层：session 级 schedule 状态

位置建议：

- session header
- session metadata row

显示内容：

- Daily at 09:00
- Next run in 4h
- Last run completed

它解决的是“这个 session 有没有被时间驱动”。

### 第三层：schedule 编辑面板

位置建议：

- drawer 或 modal
- 从 session header 的 `Schedule` 按钮进入

编辑内容：

- recurrence
- time
- timezone
- target
- action type
- prompt template
- enabled / paused

它解决的是“怎么配规则”。

---

## 推荐的 UI 风格

这个能力的 UI 不应该做得像“复杂的日历系统”。

第一版更适合：

### 风格 1：状态优先，而不是配置优先

默认展示：

- next run
- countdown
- last result

把编辑入口收起来。

原因：

用户更常做的是“看状态”，不是“改规则”。

### 风格 2：时间要有明显层级

推荐这样表达：

- 主时间：`09:00`
- 次级语义：`Daily`
- 动态状态：`Next run in 4h 12m`

不要只写一个 cron-like 文本，那会很像后台配置，不像产品界面。

### 风格 3：状态色要极简

只保留三类：

- 正常：中性色 / 轻蓝
- 进行正常：绿色或品牌色
- 异常：红色 / 橙色

不要做成花哨 dashboard。

### 风格 4：时间信息要可扫读

建议使用 chip / pill / compact row：

- `Daily 09:00`
- `Next 3h`
- `Done`
- `Failed`

这种信息在移动端最容易扫。

---

## 一个可直接拿去做原型的页面结构

### A. Sidebar 顶部时间卡片

可以长这样：

- 标题：`Today`
- 一行摘要：`Next: Daily planning in 2h 14m`
- 两个小指标：
  - `3 completed`
  - `1 needs attention`

### B. Session header 上的 schedule chip

可以长这样：

- `Daily 09:00`
- `Next 2h`
- `Last done 21h ago`

点 chip 打开编辑面板。

### C. Schedule 编辑 drawer

内容顺序建议：

1. Recurrence
2. Time
3. Timezone
4. Action type
5. Target session
6. Prompt template
7. Enable / Pause

保存后，不跳大页面，直接回到 session。

---

## 作为产品经理还要多想哪些维度

下面这些维度很关键，比“按钮放哪”更重要。

### 1. 可见性

用户能不能在 3 秒内看懂：

- 下一个什么时候跑
- 今天跑了什么
- 哪个出问题了

### 2. 可控性

用户能不能随时：

- 暂停
- 立即执行一次
- 改时间
- 删除

### 3. 可解释性

trigger 失败时，用户能不能看懂：

- 为什么没跑
- 卡在哪
- 下一步怎么处理

### 4. 可信度

这类能力最怕“偶尔失灵但你不知道”。

所以一定要有：

- last run
- next run
- run history
- failure state

### 5. 颗粒度

第一版到底是：

- 只支持 daily
- 还是支持 weekly
- 还是支持 cron-like

这里不能贪多。

我建议只从 `daily fixed time` 开始。

### 6. 触发后的动作边界

是只提醒？
还是自动发消息？
还是自动开新 session？

动作越强，责任越高。

所以第一版最好只做：

- 自动向指定 session 注入 prompt

### 7. 时区与设备一致性

如果用户在上海设置，去美国后怎么办？

要想清楚：

- schedule 是跟用户时区走
- 还是跟机器时区走

默认建议：

**跟 user-configured timezone 走，而不是机器当前时区。**

### 8. 扰动成本

如果每天触发太多次，用户会烦。

所以你要想：

- 默认提醒频率
- 是否默认静默执行
- 什么情况需要打断用户

### 9. 审计与回放

用户以后很可能会问：

- 昨天为什么没跑？
- 上周 9 点跑的到底是什么内容？

所以 run log 很重要。

### 10. 模板化能力

一旦 timer 做通了，很快就会出现：

- morning planning
- night review
- weekly review
- publish reminder

所以你后面要考虑：

是否把它和 app / workflow template 结合。

---

## 最值得坚持的产品原则

如果只记住三条：

1. 时间状态必须可见
2. schedule 不是黑箱，必须能解释和回看
3. 第一版先做 daily fixed time，不要过早做成复杂调度系统

---

## 当前最建议的第一版组合

如果现在就定版本，我建议：

1. session header 里有 `Schedule` chip
2. sidebar 顶部有 `Today` 概览
3. 只支持 `daily + fixed time + target session + prompt injection`
4. 每个 schedule 都显示：
   - next run
   - last run
   - last status

这是最小、最清晰、也最像一个成熟产品经理会收敛出来的版本。
