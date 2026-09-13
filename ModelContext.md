# ModelContext.md — dsh-plugin-webrelay

> 项目进度档案：会话开始时读一次；跨会话接续任务时再读一次。

## 项目定位

DSH Web 双面插件：右侧内置浏览器（relay 反向代理同源嵌入外部 AI 站点）+ 输入框闪电按钮（提示词优化 / 对话流上下文中继发送并抓取回复存档）。

## 当前进度（2026-09-13，版本 0.1.0）

**M0–M4 全部完成（5 次提交）+ 二期"站点管理"已完成（见下）。**

### 二期：站点管理（本轮新增，已实测）

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

- [ ] **二期 CDP 系统浏览器联动**（用户已确认）：接管用户当前浏览器的真实标签页完成注入/抓取，解决嵌入/风控/登录态三大限制；站点管理的 openIn=system 模式已为其铺路。
- [ ] ChatGPT 账号级端到端实测；豆包/千问/Gemini 选择器按真实页面微调（现为实验性）。
- [ ] `webrelay_captures` 工具在真实会话中的调用验证（注册链路已验证，未做会话内调用）。
- [ ] relay 对 SPA 子资源的兼容度提升（DeepSeek 页面在未登录/风控时自报"资源加载异常"；登录态下待用户实测）。
- [ ] WebSocket 代理（v1 只 patch 了 fetch/XHR/EventSource；AI 站点流式回复主要走 SSE，暂够用）。

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
