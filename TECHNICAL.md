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
├── optimize.ts     提示词优化：元提示模板 + llm.stream 聚合
├── captures.ts     捕获存档：$DSH_HOME/webrelay/captures/*.md
├── tools.ts        智能体工具 webrelay_captures（list/read）
├── http-util.ts    readBody / trustedRequest / JSON 响应（与 GreaterClarity 同款信任判据）
└── client/
    ├── index.ts        apply：样式注入 + 槽位注册（闪电按钮、面板开关、shell.overlay 面板）
    ├── state.ts        轻量 store（useSyncExternalStore）+ 与 host API 的 fetch 封装
    ├── lightning.ts    ⚡ 按钮与两项菜单（conversation.input.right）
    ├── panel.ts        右侧停靠浏览器面板（shell.overlay）：站点页签/识别徽章/历史抽屉
    ├── modals.ts       中继预览弹窗 / 捕获结果弹窗（portal + 可编辑 textarea）
    ├── relay-run.ts    iframe DOM 适配执行器（识别/填入/发送/等待/抓取）
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

### 3.5 DOM 适配执行器（relay-run）

全部操作在 iframe 的 `contentDocument` 上执行（同源直接访问）：

1. **填入**：候选选择器链找输入框；textarea 用原生 `value` setter + `input` 事件（兼容 React 受控组件）；contenteditable 用 `textContent` + `input` 事件（ChatGPT 的 `#prompt-textarea` 属此类，必要时再派发 `paste` 事件）。
2. **发送**：按 `sendMode`：`enter`（向输入框派发 Enter keydown/keyup，`bubbles: true`）；`click`（点击发送按钮）；`enter-then-click`（先 Enter，按钮出现/可用再点击）。
3. **等待完成**：记录发送前回复节点数 → 轮询（500ms）：`generating` 选择器命中 → 仍在生成；全部消失且 (a) 回复数 > 发送前 且 (b) 最后回复文本长度连续 3 次稳定 → 完成。硬超时 120s。
4. **抓取**：取最后一个（或新增的）回复节点的 `innerText`。

选择器全部来自配置 → 站点改版用户可自行维护。

### 3.6 提示词优化

- 元提示模板（自写，借鉴 prompt-optimizer 的「先分析、后重写、可迭代」思路）：system 指令要求输出「角色 + 目标 + 约束 + 输出格式」结构化提示词，保留用户原意，不添加虚构需求；用户消息为原始草稿 + 可选对话流背景摘要。
- 模型解析顺序：请求体 `provider/model`（client 传入）→ `optimize.provider/model` 配置 → `llm.listProviders()[0]` + 其 `listModels()[0]`。
- 流式：host 以 `text/plain` chunked 流回传增量文本；client fetch reader 逐段追加到弹窗。

### 3.7 对话流背景整理

选项二触发时，client 从槽组件 props 拿 `session`（ConversationSnapshot）与 `input`（InputState.draft），把最近 N 轮（默认 10 条用户/助手消息，可配置）压成「背景摘要」文本（角色前缀 + 截断），与草稿一起 POST `/dsh-webrelay/api/optimize`。快照字段以防御式读取（`session?.chat?.nodes` 可能因版本变化），失败时退化为仅草稿。

### 3.8 捕获存档与智能体工具

- 文件：`$DSH_HOME/webrelay/captures/<ISO时间>-<site>.md`，正文含站点、URL、发送的提示词、回复全文（front-matter 风格 JSON 头，便于工具解析）。
- `webrelay_captures` 工具：`action: 'list' | 'read'`，`id` 可选；list 返回最近 N 条（时间/站点/摘要），read 返回全文。hand-built ToolDefinition（parameters/output.schema/render/execute），经 `ctx.tools?.register` 注册，tools 服务缺失时跳过。

### 3.9 client 状态与组件

- store：30 行级 `useSyncExternalStore` 封装（面板开关、当前 rid、识别结果、弹窗状态、捕获列表）。
- 闪电按钮：`ctx.slots.inject('conversation.input.right', () => ctx.slots.register({name, id: 'dsh-webrelay-lightning', order: 40}, Lightning))`——list 槽 additive，不与他插件冲突。
- 浏览器面板：`ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: 'dsh-webrelay-panel', order: 20}, Panel))`；面板自绘为右侧停靠层（`position: absolute; right: 0` + 遮罩可选），带拖拽宽度与关闭按钮；`overlayLayer` 为 additive 层，点击穿透由面板根节点 `pointer-events: auto` 收敛。
- 输入框写入：`inputActions?.setDraft?.(text)`（session 标准件提供），不可用时降级为「复制到剪贴板」提示。

## 4. API 一览（host 自有路由，全部 `/dsh-webrelay/` 前缀）

| 路由 | 方法 | 说明 |
|------|------|------|
| `/dsh-webrelay/proxy/<rid>/<target>` | any | 反向代理（白名单 + 信任校验） |
| `/dsh-webrelay/api/sites` | GET | 站点列表（含 adapter 选择器，供 client 执行器使用） |
| `/dsh-webrelay/api/optimize` | POST | `{draft, context?, provider?, model?}` → text/plain 流式优化结果 |
| `/dsh-webrelay/api/captures` | GET / POST | 列出 / 新增捕获 |
| `/dsh-webrelay/api/captures/read` | GET | `?file=` 读取单条（路径穿越校验） |

## 5. 兼容性与版本策略

- peerDependencies 仅 `cordis: "*"`；不依赖任何 `@deepseek-ai/*` 运行时导出（client 侧仅经 module table require 官方 client 包；host 侧全部懒取服务 + 结构化类型）。
- 槽位/路由/CSS 三重命名空间隔离；`shell.overlay` 为 additive list，不与 ui-conversation 的 `details` single 槽冲突。
- DSH 处于 developer preview：快照/契约字段一律防御式访问；插件加载失败不影响宿主（cordis 隔离）。

## 6. 测试与验证

1. 构建：`pnpm build`（tsdown 双产物）+ `pnpm typecheck`。
2. 安装链路：`dsh plugin --profile web add link:<dir>` → `dsh web --dump-config | grep webrelay`。
3. 运行时：启动 `dsh web`，验证 ⚡ 按钮、面板、`GET /dsh-webrelay/api/sites`、代理回环（curl）。
4. 端到端：DeepSeek（登录态）选项一/选项二全流程；ChatGPT 次之；其余站点实验性。
