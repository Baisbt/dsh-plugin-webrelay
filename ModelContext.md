# ModelContext.md — dsh-plugin-webrelay

> 项目进度档案：会话开始时读一次；跨会话接续任务时再读一次。

## 项目定位

DSH Web 双面插件：右侧内置浏览器（relay 反向代理同源嵌入外部 AI 站点）+ 输入框闪电按钮（提示词优化 / 对话流上下文中继发送并抓取回复存档）。

## 当前进度（2026-09-13，版本 0.1.0）

**M0–M4 全部完成（5 次提交）+ 二期"站点管理" + 二期"CDP 专用联动浏览器" + 修复轮（见下）。**

### 修复轮：单击直达 + 多浏览器/多账户（本轮新增，Edge 实例已实测）

- **单击直达修复**：用户反馈首次打开联动浏览器是 about:blank、要点两次。根因：启动固定开 about:blank 初始页 + 页签点击只切视图不action。修复：`openSiteTab` 首次启动直接以站点地址为初始页；已启动时复用遗留空白页导航；`CdpLinkageView` 挂载即自动执行"启动→打开/激活"（`started` ref 防重入）。实测一次 `cdp/open` 后无任何 about:blank 残留。
- **多浏览器/多账户**：`sites.yml` 新增 `browsers:` 实例表（id → {label, type: chrome|edge|custom, path?, profile, port?}；端口缺省自动分配 9222+），每实例独立配置子目录 `browser-profile/<id>`；同类型浏览器经 `--profile-directory=<profile>` 承载多账户。站点新增 `browser: <实例id>` 绑定（null=默认实例取 cdp 段）。`resolveBrowser`/`launchBrowser`/`findTab`/`openSiteTab` 全部按实例运作。
- 管理弹窗：新增「联动浏览器实例」区（添加：名称+类型+账户配置目录；删除并自动解绑站点）；联动站点行出现实例绑定下拉。
- 新 manage 动作：`bind-browser` / `browser-add` / `browser-remove`（删除实例自动解绑）。
- **实测**：Edge 实例（9223）+ 自测页——单次 open 直达站点页（无 about:blank）、注入往返成功。
- 教训：测试改 YAML 时对 `cdp:` 段做局部 replace 造出重复键（headless 两次）→ 插件按设计 .bak 回退默认——验证了容错路径。

### 二期：CDP 专用联动浏览器（注入链路已实测）

- 决策（用户确认）：专用实例模式（非附加现有浏览器）+ Chrome 自动探测（找不到时回退 Edge，可 `cdp.browserPath` 手动指定）。
- `src/cdp.ts`：`/json/list` 发现、`/json/new`（PUT）开标签、`/json/activate` 激活、`Runtime.evaluate`（awaitPromise + returnByValue）注入；`ensureBrowser` 端口探测 + 独立配置目录 `$DSH_HOME/webrelay/browser-profile` 启动（登录态长期保存）。
- `src/page-adapter.ts`：把 relay-run 同语义的"填入→发送→等待→抓取"编译为页面内 async IIFE；附自测页夹具路由 `/dsh-webrelay/adapter-test`（textarea+发送按钮+2.5s 假生成+回复节点）。
- 新路由：`GET /api/cdp/status`、`POST /api/cdp/launch|open|relay`；白名单校验：只操作 URL 命中站点 `match` 的标签页。
- client：站点打开方式三档循环（内置→联动→浏览器）；面板 CDP 联动视图（连接状态/启动/打开标签页/刷新）；闪电选项二在联动站点上走 `apiCdpRelay`。
- **端到端实测**：headless Chrome（测试用）+ 自测页夹具——CDP 注入"填入→Enter→等待假生成→抓取回复"全链路返回成功（`回复 #1：这是CDP注入测试消息`），测试现场已清理（联动 Chrome 进程、测试站点条目、headless 标记均已还原）。

### 二期：站点管理（已实测）

- 面板头部「管理」按钮 → 站点管理弹窗：配置路径显性展示；添加（名称+网址自动提取域名白名单）/ 排序（↑↓ 写回 YAML）/ 隐藏（页签隐藏但识别代理仍生效）/ 打开方式（内置 relay / 当前浏览器新标签页）/ 删除（自定义真删、出厂进 `deleted:` 列表）/ 单站重置 / 恢复全部默认（整文件还原出厂模板含注释）。
- host 新路由 `POST /dsh-webrelay/api/sites/manage`（add/remove/hide/openIn/reorder/reset-site/reset-all）；`loadConfig` 语义：用户层条目**合并**到出厂定义之上（stub 不丢 home/match）、`deleted` 同时过滤两层、用户文件顺序优先。
- 踩坑：合并语义第一版让 `{hidden:true}` stub 整体替换出厂定义 → sanitize 因缺 match 丢站点；UI 上表现为"隐藏后再显示行消失"。已修复并回归。

### 已完成并实测验证

- 官方链路：`pnpm install --ignore-workspace` + tsdown 双产物构建 + `dsh plugin --profile web add link:` 安装 + `dsh web --dump-config` 验证加载。
- 闪电按钮与面板开关渲染在模型选择器左侧（`conversation.input.right` 槽）。
- 选项一（优化不发送）端到端：草稿 → `POST /dsh-webrelay/api/optimize` → `ctx.llm.stream` 流式 → 弹窗可编辑 → [撤回][重新生成][插入输入框]（经 `inputActions.setDraft` 写回 DSH 草稿，实测 397 字结构化结果插入成功）。
- 选项二（中继发送）：host 侧 `sessionQuery.readSession` 提取最近 10 条对话流 → 背景前缀 + 流式优化结果合成可编辑预览（实测 4245 字）→ [发送到浏览器] → iframe 内 DOM 适配执行器（填入/发送/等待/抓取）。站点被风控拦截时优雅降级（明确错误 + 可撤回），状态机全程验证一致。
- 右侧面板（`shell.overlay` additive 层）：五站点页签、同源识别徽章（解析代理 URL 域名匹配 `match` 白名单）、宽度拖拽、捕获历史抽屉、「系统浏览器打开」降级。
- relay 反向代理：回环 + Origin 同源信任判据、目标域名白名单（实测 403 拒绝白名单外目标）、剥 XFO/CSP 头、HTML 重写（去 CSP meta、`<base>` 锚定、属性级 URL 改写、fetch/XHR/EventSource shim 注入）、per-rid 内存 Cookie jar、3xx Location 重写。
- 捕获存档：`$DSH_HOME/webrelay/captures/*.md`（JSON 头 + 回复全文），`POST/GET /dsh-webrelay/api/captures`、`GET /api/captures/read` 实测通过。
- 智能体工具 `webrelay_captures`（list/read）已注册（hand-built ToolDefinition，零 @deepseek-ai 依赖）。

### 待办

- [ ] CDP 模式在真实 AI 站点上的账号级实测（注入链路已用自测页验证；DeepSeek/ChatGPT 登录态实测需用户操作）。
- [ ] relay 对 SPA 子资源的兼容度提升（DeepSeek 页面在未登录/风控时自报"资源加载异常"；联动模式可绕过此限制）。
- [ ] WebSocket 代理（v1 只 patch 了 fetch/XHR/EventSource；AI 站点流式回复主要走 SSE，暂够用）。
- [ ] 站点管理弹窗中直接编辑 DOM 适配选择器（当前仍需手改 YAML）。

## 关键决策

| 决策 | 理由 |
|------|------|
| relay 代理 + iframe 同源嵌入（用户选定） | 外部站点拒绝 iframe，必须代理剥头；同源后才能识别/注入/抓取 |
| 提示词优化走宿主 `ctx.get('llm')`（用户选定） | 复用已配置模型与凭据；懒取 + 缺服务降级，不硬依赖 |
| 五站配置化，DeepSeek+ChatGPT 实测（用户选定） | 适配器选择器全部在 `sites.yml`，站点改版用户自修 |
| 捕获 = 文件 + 面板历史 + 智能体工具（用户选定） | 真正落地"减少当前 AI 思考量" |
| 只用 additive 槽位（input.right / shell.overlay） | 不占 `details` single 槽、不改宿主 DOM，兼容性优先 |
| 零 @deepseek-ai 依赖（结构化类型 + 懒取服务） | 规避 developer preview API 变化；peerDep 仅 `cordis: "*"` |
| client 用 `createElement` 而非 JSX | 与 GreaterClarity 范本一致，规避外部插件 JSX 构建差异 |
| 配置用 YAML（`yaml` 包构建期内联） | 用户可读可改，注释友好 |

## 踩过的坑（重要经验）

1. **cordis 服务访问守卫**：未列入 `inject` 的服务属性访问（`ctx.tools`）抛 "cannot get property without inject"，必须用 `ctx.get('name')`（GreaterClarity 的 sessionQuery 同款）。
2. **无分号 + 行首 `(` 的 ASI 陷阱**：`res.end()` 后跟 `(ctx.get(...))` 行被解析为函数调用 → TypeError → catch 分支二次 `res.end()` → `ERR_STREAM_WRITE_AFTER_END` 未捕获 → **整个 dsh 进程崩溃**。
3. **LlmRuntime.stream 不抛异常**：adapter 失败归一化为终止 `finish` 块（`reason.kind === 'error'`）；必须显式检查，否则静默空文本。推理模型默认思考链会耗尽 `maxTokens`（finish `max-tokens`、零文本）——已加 `optimize.reasoningEffort: off` 默认。
4. **插件目录不在 DSH workspace**：`pnpm install` 会落到上层 workspace 根，必须 `pnpm install --ignore-workspace`。
5. **源码 checkout 引导失败**：`pnpm dsh web` 需要全仓构建产物；用全局 npm 版 `dsh`（bundle 已构建）+ `--patch` 临时补丁改端口做测试实例（注意 patch 的 config 是整对象覆盖，`host` 字段要一起写）。
6. **页面开着时热替换 client bundle** 会导致模块状态与 DOM 分叉，出现"状态在但 UI 不动"的假象——整页刷新即恢复，非代码缺陷。

## 开发思路（一句话版）

双面插件模板（参照 `router/dsh-GreaterClarity-plugin`）：host 半 `inject:['webServer']` 注册 `/dsh-webrelay/*` 路由 + `ctx.effect` 清理；client 半 `dsh.client` 声明 + 槽位注册；所有跨端通信走同源 fetch；站点行为全部配置化。
