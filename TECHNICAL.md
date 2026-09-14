# TECHNICAL.md — dsh-webrelay 技术方案

## 1. 技术选型与依据

| 项 | 选择 | 依据 |
|----|------|------|
| 插件形态 | 双面插件（host ESM + client CJS），`dsh.bundle.patch` + `dsh.client` | DSH 官方机制（`apps/cli/src/plugin.ts`、`packages/client/modules`）；范本 `router/dsh-GreaterClarity-plugin` |
| 构建 | tsdown 双 bundle（host: esm/node 自包含；client: cjs/browser + `window.__ModuleLoader__.load` 包装） | 与官方 `packages/client/tsdown.client.ts` 及 GreaterClarity 的产物契约一致 |
| 语言 | TypeScript（strict），client 侧用 `createElement`（不依赖 JSX 编译配置） | 与 GreaterClarity 相同，规避外部插件 JSX 构建差异 |
| 配置 | YAML（`yaml` npm 包，构建期内联进 host bundle） | 站点选择器可读、可注释、用户可自行编辑 |
| UI | React 18（external，经 loader module table require），Modal/面板自绘 + portal | 官方 ui-primitives 依赖 locale 等上下文，自绘避免隐式依赖，兼容性最好 |
| LLM 调用 | host 懒取 `ctx.get('llm')` → `llm.stream({provider, model, messages})` | `packages/llm/llm/src/index.ts:913`；不 inject 'llm' 以便无 LLM 环境降级 |
| 代理 | Node `http.request`/`fetch` 手写反向代理，路径式映射 | 仓库无现成内容代理；`ctx.webServer.register({kind:'prefix'})` 为官方注册口 |

## 2. 模块结构

```
src/
├── index.ts        host 入口：apply(ctx) → 装配 api/relay/captures/tools，ctx.effect 清理
├── config.ts       站点/插件配置：sites.default.yml（出厂）⊕ $DSH_HOME/webrelay/sites.yml（用户）
├── relay.ts        反向代理：/dsh-webrelay/proxy/<rid>/<target-url>
├── optimize.ts     提示词优化：元提示模板（含 single/outbound/final 三视角）+ 附件提示尾注约定
├── context-compress.ts  对话上下文压缩（选项二 S1）：为下一轮服务的信息筛选
├── extract.ts      外部回复的保真清洗（去噪 + 还原结构，不压缩不改写）
├── page-adapter.ts 页面表达式生成：只读抓取 / 外发（填入→提交→等待→取回）
├── cdp.ts          专用联动浏览器管理：实例/端口/标签页/表达式执行
├── captures.ts     捕获存档：$DSH_HOME/webrelay/captures/*.md
├── tools.ts        智能体工具 webrelay_captures（list/read）
├── http-util.ts    readBody / trustedRequest / JSON 响应（与 GreaterClarity 同款信任判据）
└── client/
    ├── index.ts        apply：样式注入 + 槽位注册（闪电按钮、面板开关、shell.overlay 面板）
    ├── state.ts        轻量 store（useSyncExternalStore）+ 与 host API 的 fetch 封装
    ├── lightning.ts    ⚡ 按钮与两项菜单（conversation.input.right）
    ├── flow.ts         选项二六阶段编排（压缩→初优化→外发→收回→终优化→填入）
    ├── panel.ts        右侧停靠浏览器面板（shell.overlay）：站点页签/识别徽章/历史抽屉
    ├── modals.ts       初稿弹窗 / 等待弹窗（含倒计时与续等）/ 终稿弹窗 / 存档弹窗 / 附件提示条
    ├── relay-run.ts    iframe 页面读写器（sendToFrame 外发 + captureFromFrame 只读捕捉）
    └── styles.ts       全部样式（dsh-webrelay-* 前缀）
```

## 3. 关键机制设计

### 3.1 插件清单与装载

- `package.json#dsh.bundle.patch: ./cordis.patch.yml` → `- insert: [{id: dsh-webrelay, name: '@dsh-external/dsh-webrelay'}]`（bundle 层，`dsh plugin add` 时由 `reconcilePlugins` 追加进 `dsh.profile.bundles`）。
- `package.json#dsh.client: {inject: [runtime, ui-slots], platform: "web"}` + `exports["./client"]` → client bundle 由 `GET /plugins/<id>/client.js` 提供，浏览器 loader 按模块表 require react/react-dom。
- host 半 `inject: ['webServer']`；`llm`、`tools`、`sessionQuery` 均**懒获取**（`ctx.get`），缺服务时对应功能报错而非整插件拒载 —— 兼容性优先。

### 3.2 relay 反向代理（同源嵌入的核心）

URL 形态：`/dsh-webrelay/proxy/<rid>/<target-url-encoded>`，`rid` 为面板每次打开生成的会话 id（8 字节 hex）。

请求路径：
1. 信任校验：Host 回环 + Origin 同源（与 GreaterClarity `trustedRequest` 同款）。
2. 目标白名单：target 的 host 必须命中 `sites.*.match` 之一，否则 403（防开放代理）。
3. 转发：方法/路径/查询原样；请求体原样；带 per-rid 内存 Cookie jar（`Set-Cookie` 去掉 Domain/Secure 属性后存入 jar；发请求时按目标 host 取回）。请求头仅保留必要的（content-type、accept、user-agent 补默认、accept-language），去掉 `sec-fetch-*` 矛盾头。
4. 响应处理：剥离 `sites.yml#relay.stripHeaders` 列出的头（X-Frame-Options / CSP / COOP/COEP/CORP）；`content-type` 为 HTML 时执行重写（3.3）；其余流式透传。

### 3.3 HTML 重写与运行时 shim

HTML 响应：
1. 去掉 `<meta http-equiv="Content-Security-Policy">`。
2. 注入 `<base href="/dsh-webrelay/proxy/<rid>/<origin-path-dir>/">`，让相对 URL 自然落回代理。
3. 属性改写：`href/src/action/formaction` 中的同源绝对路径（`/xxx`）→ `/dsh-webrelay/proxy/<rid>/<host>/xxx`；跨源绝对 URL 命中白名单站点 → 同样前缀化；其余保持外跳。
4. 注入 shim 脚本（首个 `<head>` 子元素前），做四件事：
   - patch `window.fetch`：目标为同源绝对路径（`/api/...`）时改写到代理前缀；
   - patch `XMLHttpRequest.open`：同上；
   - patch `EventSource`：同上（SSE 流式回复通道）；
   - patch `history.pushState/replaceState` 与 `document.cookie` 尽力适配 SPA 路由与 Cookie（Cookie 写入转存到 jar）。

已知限制（写进 README）：Service Worker 无法代理（响应头已剥离 SW 注册的站点通常可用）；部分站点 JS 内硬编码跨源请求会被 CORS 拦截 → 该站点标记为不可嵌入，走 F10 降级。

### 3.4 站点识别

client 侧：`iframe.contentWindow.location.href`（同源可读）→ 解析 host → 与 `/dsh-webrelay/api/sites` 返回的 `match` 列表匹配 → 命中即「已识别：name」，并把该站 adapter 选择器拉到内存。未识别时选项二禁用。

### 3.5 页面读写器（relay-run）

本模块承担两个职责，**读写在代码里明确分区**：

**只读：`captureFromFrame()`**（`adapter.replies` 选择器链 → 各节点 `innerText`，多节点用 `\n\n---\n\n` 拼接；全部落空退化为 `body.innerText`）。用于超时后复查回复、单轮整理入口。

**写入：`sendToFrame()`** —— 仅在用户于 S2 弹窗点「发送到浏览器」后调用，算法与 3.8 的 CDP 路径一致（填入 → 提交 → 等待生成结束 → 取回回复）。写入辅助（`fillTextarea` / `fillEditable` / `pressEnter` / `clickSend`）集中在本模块，不再对外暴露为通用的"中继发送"。

> 说明：v0.2 曾把本模块裁成纯只读（选项二当时定义为"抓页面 → 整理 → 优化"）；
> v0.3 起选项二改为双轮闭环，写入路径**按新语义恢复**，但收窄为"用户点击触发的一次性外发"。

选择器全部来自配置 → 站点改版用户可自行维护。CDP 侧的对应实现见 `src/page-adapter.ts`：`buildCaptureExpression()`（只读）/ `buildSendExpression()`（外发）。

### 3.6 提示词优化（自然化改写）

设计目标：改写结果要**自然、灵活**，不能是一刀切的模板填表。为此借鉴了三个开源实践
（仅借鉴思路，不引入其代码；prompt-optimizer 为 AGPL-3.0）：

| 来源 | 借鉴点 | 本项目落地 |
|------|--------|-----------|
| linshenkx/prompt-optimizer「分析式结构优化」 | 先按维度识别 Role/Goals/Constrains/Workflow 等，再逐维填充，而非一上来泛泛润色 | 维度检查表（目标/角色读者/上下文/约束/输出形态/成功标准），**但不采用其固定骨架** |
| 元提示的 critique-then-rewrite | 先诊断具体缺陷，再针对缺陷改写；诊断让改写有据可依 | system 指令里的「第一步·诊断（内部完成，不输出）→ 第二步·改写」 |
| getsentry/skills prompt-optimizer | 一条行为只留一个归属、用最短措辞保住约束、砍掉不做功的套话 | 「反模式」段落：禁止撑长、禁止套话、禁止空泛占位、禁止输出元信息 |

关键设计：

- **不硬性套结构**：`style: preserve`（默认）要求贴着原文语气、分段习惯与个人笔调做小切口改动；
  `style: structured` 才允许分节骨架，且明令「不写空壳小标题」。`structureHint` 可让用户直接指定结构偏好。
- **诊断不进输出**：诊断只用于引导改写，最终只输出改写后的正文。
- **轮次视角**（`OptimizePhase`）：`single`（选项一，读者是人）| `outbound`（选项二第一次，**读者是另一个模型**，须自带全部必要事实）| `final`（选项二第二次，须**消化**外部回答而非搬运）。
- **三条保真约束**：忠实原意（不新增需求）、不编造事实、变量占位符（`{{x}}` 等）逐字保留。
- 模型解析顺序：请求体 `provider/model`（client 传入）→ `optimize.provider/model` 配置 → `llm.listProviders()[0]` + 其 `listModels()[0]`。
- 流式：host 以 `text/plain` chunked 流回传增量文本；client fetch reader 逐段追加到弹窗。

### 3.7 对话上下文压缩（选项二 S1）

`src/context-compress.ts`。选项二要跑双轮闭环，第一步必须把会话压成短背景——既给第一次优化提供语境，也给第二次优化保留"我原本要做什么"的锚点；不压缩则外发文本会被历史撑到不可读。

压缩的目标**不是写摘要**，而是"为下一轮服务的信息筛选"：

- **保留**：已定技术决策、用户明确偏好/禁忌、未解决分歧、已被排除的方案、关键命名与数据口径。
- **丢弃**：寒暄与确认往复、已被推翻的中间过程、工具机械记录、无关闲聊分支。
- **篇幅**：≤1200 字符；某一节无内容时整节省略（不写"无"）。

转写来源：优先 host 侧 `sessionQuery.readSession`（`buildTranscript` → `transcriptToContext`，条数由 `optimize.contextLimit` 控制，默认 40）；送入前经 `truncateMiddle()` 中段截断到 32000 字符。

降级设计：LLM 缺失/失败时退回 `truncateTail()`（保留最近对话尾部，优先在段落边界切开），同样以 `[dsh-webrelay:fallback]` 尾注告知 client。**压缩失败不中断闭环**——退化为"无背景"继续。

### 3.8 外发与等待捕捉（选项二 S3 + S4）

这是整条链路**唯一一次对外写入**，且必须由用户在 S2 弹窗点「发送到浏览器」触发。

- **relay 模式**：`src/client/relay-run.ts` 的 `sendToFrame()`，经 iframe `contentDocument` 直接操作。
- **CDP 联动模式**：`/dsh-webrelay/api/cdp/send`，host 侧用 `buildSendExpression()` 编译成页面内 async IIFE，经 `Runtime.evaluate`（awaitPromise + returnByValue）执行；CDP 侧超时设为页面内等待上限 + 30s。

两条路径的算法一致（改一处须同步另一处）：

1. 按 `adapter.input` 候选链找**可见**输入框；React 受控组件必须走原型 `value` setter，contenteditable 走 `execCommand('insertText')`。
2. 提交：`sendMode` 为 `enter` / `click` / `enter-then-click`。
3. 记录发送前的 `baseline`（最后一条回复文本）与 `replyCount`。
4. 轮询至多 `optimize.relayTimeoutMs`（默认 120s）：`generating` 标记出现即置 `sawGenerating`；标记消失后要求回复**非空、不等于 baseline、连续 3 次稳定**，且（曾见生成中 或 回复数增加）才判定完成——避免慢站点上"还没开始生成就抓到上一条回复"的竞态。
5. **超时不判死**：把已抓到的文本一并返回（`timedOut: true`），由 client 弹窗给出「继续等待 / 采用已抓内容 / 撤回」。

「继续等待」（`continueWaiting`）走**只读**重读而非重发——重发会在外部站点留下重复消息。

### 3.9 外部回复的二次提取整理（单轮路径保留）

`src/extract.ts`。用于对已捕获的外部回复做保真清洗（去噪、还原结构层级，不压缩不改写）：LLM 按「先内部识别正文与噪声 → 再整理输出」两步走；用户草稿仅作为"使用者意图"参与选料，明令不作为任务执行。

降级设计：LLM 服务缺失、调用失败或返回空时，自动退回 `heuristicTidy` 启发式清洗（保守删噪声行 + 压空行，绝不误删正文），并通过响应尾部的 `[dsh-webrelay:fallback]` 标记告知 client。输入超 24000 字符时截断并显式提示。

### 3.10 捕获存档与智能体工具

- 文件：`$DSH_HOME/webrelay/captures/<ISO时间>-<site>.md`，正文含站点、URL、提示词、内容全文（front-matter 风格 JSON 头，便于工具解析）。
- `webrelay_captures` 工具：`action: 'list' | 'read'`，`id` 可选；list 返回最近 N 条（时间/站点/摘要），read 返回全文。hand-built ToolDefinition（parameters/output.schema/render/execute），经 `ctx.tools?.register` 注册，tools 服务缺失时跳过。

### 3.11 client 状态与组件

- store：30 行级 `useSyncExternalStore` 封装（面板开关、当前 rid、识别结果、弹窗状态、捕获列表）。
- 弹窗状态机（选项二六阶段）：`relay-wait`（S1 压缩 / S3-S4 发送等待，带倒计时与超时续等）→ `optimize`（S2 初稿，按钮为「发送到浏览器」）→ `relay-preview`（S5 终稿，按钮为「插入输入框」）。另有 `extract`（单轮整理）| `capture`（存档查看）| `sites`（站点管理）。
- 编排收口在 `src/client/flow.ts`：`startCapture → compressSession → streamOptimizeInto(outbound) → sendToBrowser → startFinalOptimize → insertOptimized`；超时分支 `continueWaiting` / `adoptPartial`。
- 闪电按钮：`ctx.slots.inject('conversation.input.right', () => ctx.slots.register({name, id: 'dsh-webrelay-lightning', order: 40}, Lightning))`——list 槽 additive，不与他插件冲突。
- 浏览器面板：`ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: 'dsh-webrelay-panel', order: 20}, Panel))`；面板自绘为右侧停靠层（`position: absolute; right: 0`），带拖拽宽度与关闭按钮。
- 输入框写入：`inputActions?.setDraft?.(text)`（session 标准件提供），不可用时降级为「复制到剪贴板」提示。

## 4. API 一览（host 自有路由，全部 `/dsh-webrelay/` 前缀）

| 路由 | 方法 | 说明 |
|------|------|------|
| `/dsh-webrelay/proxy/<rid>/<target>` | any | 反向代理（白名单 + 信任校验） |
| `/dsh-webrelay/api/sites` | GET | 站点列表（含 adapter 选择器，供 client 页面读写器使用） |
| `/dsh-webrelay/api/optimize` | POST | `{draft, context?, externalReply?, phase?, provider?, model?}` → text/plain 流式优化结果 |
| `/dsh-webrelay/api/compress` | POST | `{sessionId?, transcript?, draft?, limit?}` → text/plain 流式上下文压缩（降级/无历史时带 `[dsh-webrelay:fallback]` 尾注） |
| `/dsh-webrelay/api/extract` | POST | `{raw, siteName?, url?, intent?, provider?, model?}` → text/plain 流式整理结果 |
| `/dsh-webrelay/api/cdp/capture` | POST | `{siteId}` → 只读读取联动标签页正文 `{raw, url}` |
| `/dsh-webrelay/api/cdp/send` | POST | `{siteId, message, timeoutMs?}` → 外发并等待回复 `{ok, reply, url, timedOut?, error?}`（**写入操作**，用户点击触发） |
| `/dsh-webrelay/api/captures` | GET / POST | 列出 / 新增捕获 |
| `/dsh-webrelay/api/captures/read` | GET | `?file=` 读取单条（路径穿越校验） |

> 插件**没有任何读盘路由**。附件只做提示，不做采集与投递（见 §5）。

## 5. 附件：只提示，不代传

### 5.1 职责边界

插件在附件这件事上**只承担一个职责：提示**。它不检测文件、不读磁盘、不代用户上传——因此：

- 没有 `/api/files/read`、没有 `/api/cdp/attach`、没有 `files.maxBytes` / `files.workspace` 配置；
- 没有 `adapter.fileInput` 选择器（不再需要探测站点是否支持附件）；
- 没有 `DataTransfer` 注入、没有附件浮层、没有附件清单拼接进外发消息。

用户自行用外部浏览器/宿主页面**自带的附件按钮**上传文件。

### 5.2 提示是怎么来的

提示由**优化器顺带产出**，不需要额外的检测逻辑：

1. `optimizeUserPrompt()` 在末尾追加 `ATTACH_TAIL_INSTRUCTION`，约定输出格式：
   正文之后另起一行写 `【附件提示】<一句话>`；
2. 指令明确要求——只有当提示词真要模型看到本机文件才能干好（读某文件 / 分析数据或日志 /
   按截图还原 / 照已有代码改）才写具体材料；不需要时**也必须输出这一行**，内容固定为「本次无需附件」；
3. client 侧 `splitAttachHint()` 从流式结果里剥离这一行：
   - **正文** → 弹窗 textarea（用户看到的是干净的提示词）；
   - **提示** → `modal.attachHint` → 弹窗里渲染成一条极轻的提示条（`.dsh-webrelay-hint`）；
4. `attachHintApplies()` 判定「本次无需附件」等否定措辞 → 整块不渲染，避免每个弹窗都挂一条无信息量的提示。

### 5.3 设计取舍

- **为什么让模型判断、而不是插件检测？** 判定"这条提示词要不要附件"是语义判断，
  固定规则（关键词匹配）误报率高；而优化器本来就要通读提示词，顺带判断零额外成本。
- **为什么放在尾注而不是让模型写进正文？** 提示词正文会被外发给另一个模型，
  混进一句给用户看的元信息会污染提示词。尾注剥离后正文仍然纯净。
- **为什么容忍否定措辞？** 模型不总会严格照格式；`attachHintApplies()` 用「无需 / 不需要 / 不涉及」
  等否定词兜底，宁可少显示一条提示，也不要显示一条错误提示。
- **流式中途怎么处理？** 标记未到达前原样渲染；标记一出现立即截断，用户看不到那行元信息。

## 6. 兼容性与版本策略

- peerDependencies 仅 `cordis: "*"`；不依赖任何 `@deepseek-ai/*` 运行时导出（client 侧仅经 module table require 官方 client 包；host 侧全部懒取服务 + 结构化类型）。
- 槽位/路由/CSS 三重命名空间隔离；`shell.overlay` 为 additive list，不与 ui-conversation 的 `details` single 槽冲突。
- DSH 处于 developer preview：快照/契约字段一律防御式访问；插件加载失败不影响宿主（cordis 隔离）。

## 6. 测试与验证

1. 构建：`pnpm build`（tsdown 双产物）+ `pnpm typecheck`。
2. 安装链路：`dsh plugin --profile web add link:<dir>` → `dsh web --dump-config | grep webrelay`。
3. 运行时：启动 `dsh web`，验证 ⚡ 按钮、面板、`GET /dsh-webrelay/api/sites`、代理回环（curl）。
4. 端到端：DeepSeek（登录态）选项一 / 选项二（捕捉 → 整理 → 优化 → 插入输入框）全流程；ChatGPT 次之；其余站点实验性。
5. 提示词构建逻辑自检：`optimizeSystemPrompt` / `extractSystemPrompt` / `heuristicTidy` 均为纯函数，可直接断言其关键约束（诊断段存在、禁止撑长、占位符保真规则、降级清洗行为）。
6. 附件提示自检：`splitAttachHint()` 为纯函数，覆盖「正文与提示正确切分 / 标记缺失时原样返回 / 全角半角括号混排容错 / 否定措辞判为不适用 / 流式中途标记未到齐」等用例。
