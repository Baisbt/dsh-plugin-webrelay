# dsh-plugin-webrelay

> DSH（DeepSeek Harness）Web 中继插件：把外部 AI 网页搬进 DSH 右侧，并用一个按钮完成「提示词优化 / 与外部 AI 协作优化」。

---

## 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [环境依赖](#环境依赖)
- [快速开始](#快速开始)
- [具体操作流程](#具体操作流程)
  - [第 0 步：准备](#第-0-步准备前置条件)
  - [第 1 步：安装依赖](#第-1-步安装依赖)
  - [第 2 步：类型检查与构建](#第-2-步类型检查与构建)
  - [第 3 步：把插件装进 DSH](#第-3-步把插件装进-dsh)
  - [第 4 步：初始化配置](#第-4-步初始化配置)
  - [第 5 步：启动 DSH 并验证](#第-5-步启动-dsh-并验证插件已生效)
  - [第 6 步：站点登录与联动浏览器](#第-6-步站点登录与联动浏览器可选但推荐)
  - [第 7 步：跑通两条主流程](#第-7-步跑通两条主流程)
  - [第 8 步：卸载 / 升级](#第-8-步卸载与升级)
  - [第 9 步：发布与部署（可选）](#第-9-步发布与部署可选)
- [配置说明](#配置说明)
- [附件提示（只提示，不代传）](#附件提示只提示不代传)
- [站点支持矩阵](#站点支持矩阵)
- [安全与合规](#安全与合规)
- [架构速览](#架构速览)
- [已知限制](#已知限制)

---

## 项目简介

`dsh-plugin-webrelay` 是 DeepSeek Harness (DSH) 的一个双面插件（host 半 ESM/Node + client 半 CJS/Browser），发布名为 `@dsh-external/dsh-webrelay`。

它解决一个日常痛点：**你同时在 DSH 和多个外部 AI 网页（DeepSeek / ChatGPT / 豆包 / 通义千问 / Gemini）之间来回复制粘贴、切换窗口**。本插件把外部 AI 网页嵌进 DSH 右侧面板，并在输入框旁给出一个闪电按钮，把「写提示词 → 找外部 AI 审阅 → 把结果整理成终稿」这条链路收进一个按钮里。

- **同源嵌入**：面板里的外部页面不是普通 iframe，而是经插件自带的 relay 反向代理加载的**同源**页面——因此可以直接读写页面 DOM，实现自动投放提示词与抓取回复。
- **只读为默认，写入需点击**：整条链路中**只有「发送到浏览器」这一步会向外部站点写入**，且必须由你在弹窗里明确点击；等待、抓取、复查全部只读。
- **零 `@deepseek-ai/*` 运行时强依赖**：host 侧只用 `inject: ['webServer']`，`llm` / `tools` / `sessionQuery` 全部运行时懒取，缺服务时对应功能降级而非插件拒载。

## 核心功能

### ① 右侧内置浏览器

通过插件自带的 relay 反向代理同源嵌入外部 AI 对话网页，带站点识别徽章、捕获存档与「系统浏览器打开」降级通道。面板可开合、可拖拽调宽，站点页签来自配置文件。

### ② 闪电按钮（`⚡`，位于模型选择器左侧）

提供两个动作：

1. **优化提示词（不发送）**：调用 DSH 宿主 LLM，把草稿改写得更清晰可执行。弹窗展示（可编辑），支持 **撤回 / 重新生成 / 插入输入框**，**绝不自动发送**。
2. **与外部 AI 协作优化**：一条双轮闭环——
   压缩对话上下文 → 第一次优化（初稿）→ **发送到浏览器** → 等待并捕捉外部回复 → 第二次优化（终稿）→ **写入 DSH 输入框**（不自动发送）。
   全程分步弹窗、可编辑、可撤回。
   未连接外部浏览器时该项显示为 **🔗 连接外部浏览器**（**不是禁用态**）：点击即自动尝试接入——联动站点会启动联动浏览器并打开标签页，其余站点会打开右侧面板加载页面；连接完成后即变为 **⚡ 与外部 AI 协作优化**。

另有独立的 **🖥 面板开关按钮**，用于打开 / 关闭右侧浏览器面板。

### ③ 捕获存档 + 智能体工具

外部回复可保存为 Markdown 文件（`$DSH_HOME/webrelay/captures/*.md`），面板「捕获历史」可查看，并注册 `webrelay_captures` 智能体工具——DSH 会话中的智能体可直接检索引用，减少重复思考。

### ④ 站点管理界面

面板头部「管理」按钮打开站点管理弹窗，支持添加 / 排序 / 隐藏 / 删除 / 恢复默认，以及**多浏览器实例与账户绑定**（详见 [配置说明](#配置说明)）。

## 环境依赖

| 依赖 | 版本 / 说明 |
|------|------|
| **Node.js** | 插件为 ESM 包（`"type": "module"`），需 Node 20+；本机开发用 `node` / `pnpm` |
| **pnpm** | 唯一包管理器（仓库含 `pnpm-lock.yaml`） |
| **DSH** | 需可用的 `dsh` CLI。DSH 处于 developer preview，客户端快照/契约字段可能变化 |
| **浏览器** | 内置模式用你当前浏览器即可；**联动模式（CDP）**需本机安装 Chrome 或 Edge（未指定路径时自动探测，Windows/macOS/Linux 均已覆盖） |

**依赖清单**（来自 `package.json`）：

- 运行时依赖：`yaml ^2.6.1`
- 开发依赖：`typescript ^5.9.3`、`tsdown ^0.22.14`、`@types/node ^24.13.3`、`@types/react ~18.3.1`、`@types/react-dom ~18.3.0`
- peerDependency：`cordis: *`

**关键路径**（下文频繁出现，先集中说明）：

| 路径 | 含义 |
|------|------|
| `$DSH_HOME` | DSH 主目录。默认 `~/.dsh`，可由环境变量 `DSH_HOME` 覆盖（Windows 默认 `%USERPROFILE%\.dsh`） |
| `$DSH_HOME/webrelay/sites.yml` | **用户配置文件**（首次运行自动从出厂默认复制） |
| `$DSH_HOME/webrelay/captures/` | 捕获存档目录（`capture.dir` 为 null 时） |
| `$DSH_HOME/webrelay/browser-profile/<id>` | 各联动浏览器实例的独立配置子目录 |
| `sites.default.yml` | 出厂默认配置（仓库存放于包根，随插件分发，**勿手改**） |

## 快速开始

```sh
# 1. 安装依赖（插件目录独立于 DSH 仓库 workspace，必须加 --ignore-workspace）
pnpm install --ignore-workspace

# 2. 构建：产出 lib/index.js（host）+ lib/client.js（浏览器）
pnpm build

# 3. 类型检查
pnpm typecheck

# 4. 以 link 模式注册进 DSH（构建会在 pnpm install 的 prepare 钩子自动执行）
dsh plugin --profile web add link:D:/path/to/dsh-plugin-webrelay

# 5. 验证插件已进入配置层
dsh web --dump-config | grep webrelay

# 6. 启动
dsh web
```

启动后打开 DSH Web UI，输入框右侧（模型选择器左侧）应出现 `⚡` 与 `🖥` 两个按钮。

> 卸载：`dsh plugin --profile web remove @dsh-external/dsh-webrelay`。
> 卸载后 `$DSH_HOME/webrelay/`（用户配置与捕获存档）会保留；彻底清除请手动删除该目录。

---

## 具体操作流程

以下按**从零开始**的顺序展开。每一步都给出：**操作目的** → **具体命令 / 操作** → **成功判断依据**。

### 第 0 步：准备（前置条件）

**目的**：确认开发与运行环境就绪，避免后续步骤半途失败。

**操作**：

1. 确认 Node 与 pnpm 可用：

   ```sh
   node -v
   pnpm -v
   ```

2. 确认 `dsh` CLI 可用：

   ```sh
   dsh --version
   ```

**成功判断依据**：三条命令均正常输出版本号，无 `command not found`。

---

### 第 1 步：安装依赖

**目的**：拉取构建与类型检查所需的依赖。

**操作**：

```sh
cd D:/path/to/dsh-plugin-webrelay
pnpm install --ignore-workspace
```

**成功判断依据**：

- 命令以 `Done`（或类似成功提示）结束，退出码 0；
- 目录下出现 `node_modules/`；
- **`lib/` 目录已生成**——因为 `package.json` 里配置了 `"prepare": "tsdown"`，`pnpm install` 后会自动执行一次构建。

> `--ignore-workspace` 不可省略：插件目录独立于 DSH 仓库的 workspace，否则 pnpm 可能把它当作 workspace 成员处理。

---

### 第 2 步：类型检查与构建

**目的**：确认代码类型正确，并产出 host / client 两个 bundle。

**操作**：

```sh
pnpm typecheck    # 等价于 tsc -p tsconfig.json --noEmit
pnpm build        # 等价于 tsdown
```

**成功判断依据**：

- `pnpm typecheck` 无任何输出（无错误即成功），退出码 0；
- `pnpm build` 输出两个产物且均标记构建完成：

  | 产物 | 格式 | 说明 |
  |------|------|------|
  | `lib/index.js` | ESM | host 半（含 `yaml`，`node:` 内置模块保持 external） |
  | `lib/client.js` | CJS | client 半，外包一层 `window.__ModuleLoader__.load({...})`，由浏览器 loader 加载 |

  同时会生成对应的 `.js.map` 文件（`sourcemap: true`）。

> 构建配置见 `tsdown.config.ts`。client 半的 `react` / `react-dom` / `cordis` / `@deepseek-ai/dsh-client-*` 必须保持 external——打进 bundle 会产生第二份实例，破坏 cordis DI。

**本机辅助脚本**（可选）：如果所在终端对子进程 stdout 捕获不可靠（长输出被截断），可用仓库自带的脚本把结果落盘再查看：

```sh
node scripts/check.cjs --file ./tsc-out.txt   # 类型检查结果写入文件
node scripts/build.cjs --file ./build-out.txt # 构建输出写入文件
```

---

### 第 3 步：把插件装进 DSH

**目的**：让 DSH 在启动时加载本插件。

**操作**：

```sh
dsh plugin --profile web add link:<插件绝对路径>
```

例如：

```sh
dsh plugin --profile web add link:D:/dsharness/deepseek-harness/router/dsh-plugin-webrelay
```

**成功判断依据**：

```sh
dsh web --dump-config | grep webrelay
```

输出中应能看到 `dsh-webrelay` 插件条目（由包内 `cordis.patch.yml` 的 `insert` 段注入）。

**原理**：`package.json` 的 `dsh.bundle.patch` 指向 `./cordis.patch.yml`，其中定义了：

```yaml
- insert:
    - id: dsh-webrelay
      name: '@dsh-external/dsh-webrelay'
      config: {}
```

`dsh plugin add` 时它会被追加进 `dsh.profile.bundles`。

---

### 第 4 步：初始化配置

**目的**：生成本地站点配置文件，供你按需调整。

**操作**：**无需手动操作**——首次运行时插件会自动把出厂默认 `sites.default.yml` 复制为 `$DSH_HOME/webrelay/sites.yml`。之后编辑用户文件即可：

```sh
# 路径参考
#   Windows: %USERPROFILE%\.dsh\webrelay\sites.yml
#   macOS / Linux: ~/.dsh/webrelay/sites.yml
```

**成功判断依据**：

- `$DSH_HOME/webrelay/sites.yml` 文件已存在，且内容与仓库根目录的 `sites.default.yml` 一致。

**要点**：

- 该文件**每次读取都重新解析**（文件极小），因此**改完无需重启 DSH**；
- 解析失败时会回退出厂默认，并把损坏文件重命名为 `sites.yml.bak`；
- 除「站点管理 → 恢复全部默认」外，管理界面的操作会以结构化方式写回 YAML，**手写注释会被覆盖**。

**本步可跳过**：默认配置开箱可用（DeepSeek 已端到端实测）。需要调选择器或多账户时再看第 6 步与[配置说明](#配置说明)。

---

### 第 5 步：启动 DSH 并验证插件已生效

**目的**：确认插件在真实运行环境中正常加载。

**操作**：

```sh
dsh web
```

然后打开 DSH Web UI。

**成功判断依据**（按顺序核对）：

| # | 检查项 | 预期结果 |
|---|--------|----------|
| 1 | 输入框工具行 | 模型选择器**左侧**出现 `⚡` 与 `🖥` 两个按钮 |
| 2 | 点击 `🖥` | 右侧滑出浏览器面板，顶部有站点页签（DeepSeek / ChatGPT / 豆包 / 通义千问 / Gemini）与「管理」按钮 |
| 3 | 面板加载页面 | 选一个页签，iframe 经 `/dsh-webrelay/proxy/<rid>/<target>` 加载出站点页面 |
| 4 | 识别徽章 | 页面加载完成后，面板右上角徽章从「未识别」变为「已识别」 |
| 5 | 代理回环 | 命令行执行下方 curl，应返回站点列表 JSON |

```sh
curl -s http://127.0.0.1:3080/dsh-webrelay/api/sites
```

返回含 `sites` 数组的 JSON 即代表 host 侧路由已注册、信任校验通过。

**排障提示**：

- 面板提示「站点配置加载失败或为空」→ 检查 `$DSH_HOME/webrelay/sites.yml` 是否存在且为合法 YAML；
- 面板提示「所有站点均已隐藏」→ 在「管理」里恢复显示；
- 页面嵌入失败（盾 / 登录墙 / 站点改版）→ 用面板底部「系统浏览器打开」降级通道。
- 调试探针：浏览器控制台执行 `window.__DSH_WEBRELAY_DEBUG__.getState()` / `setState(...)` 可读写插件状态机。

---

### 第 6 步：站点登录与联动浏览器（可选但推荐）

**目的**：让插件能真正往外部站点自动投放提示词、并抓回回复。内置（relay）模式下你先在面板里登录一次即可；若希望登录态长期保存、且不受你日常浏览器窗口干扰，建议用**联动模式**。

**操作**：

1. 打开面板 →「管理」→ 找到目标站点 → 把「打开方式」切到 **联动**。
2. 单击该站点页签。插件会自动**启动 / 复用绑定的联动浏览器实例**，并以站点地址为初始页打开标签页（不会遗留 `about:blank`）。
3. 在弹出的联动浏览器窗口中**登录一次**——登录态长期保存在 `$DSH_HOME/webrelay/browser-profile/<id>`，不影响你正在使用的浏览器。

**成功判断依据**：

- 联动浏览器窗口弹出并停留在站点登录页 / 对话页；
- 面板中的联动视图显示「已就绪」状态，并能列出该站点的标签页；
- 该站点页签对应面板区域显示匹配到的 target，`🖥` 与 `⚡` 的识别状态为「已识别」。

**多浏览器 / 多账户**（可选）：在「管理」弹窗中「＋添加联动浏览器」，每个实例 = 独立进程 + 独立调试端口 + 独立配置子目录；同类型浏览器的多个账户可经 `profile`（Chrome 账户配置目录名，如 `Default` / `Profile 1`，`chrome://version` 可查）承载。站点经 `browser: <实例id>` 绑定——例如 DeepSeek 绑 Edge 工作号、ChatGPT 绑 Chrome 主号。

> 相关配置项：`cdp.port`（默认实例端口 9222，**仅回环**）、`cdp.browserPath`、`cdp.headless`（无窗口模式，自测用）；`browsers:` 段定义实例表。

---

### 第 7 步：跑通两条主流程

#### 流程 A：优化提示词（不发送）

| 步骤 | 操作 | 成功判断依据 |
|------|------|--------------|
| A1 | 在 DSH 输入框写下草稿 | — |
| A2 | 点 `⚡` →「✨ 优化提示词（不发送）」 | 弹窗打开，标题「第 1 次优化」，正文流式输出 |
| A3 | 流式结束 | 弹窗进入可编辑态，出现三个按钮：**撤回 / 重新生成 / 插入输入框** |
| A4 | 点「插入输入框」 | 优化后的文本写入 DSH 输入框，弹窗关闭，**消息未被发送** |

> 全过程**不发送任何内容**给外部站点。

#### 流程 B：与外部 AI 协作优化（双轮闭环）

前置：右侧面板已打开目标站点并处于「已识别」状态（流程 A 的 A2 之后，若未连接，菜单项会显示「🔗 连接外部浏览器」，点击即可自动接入）。

| 阶段 | 操作 | 成功判断依据 |
|------|------|--------------|
| B1 | 输入框写草稿 → 点 `⚡` →「⚡ 与外部 AI 协作优化」 | 弹窗显示「正在压缩对话上下文…」（S1，静默内部步骤） |
| B2 | 等待第一次优化完成 | 弹窗标题「⚡ 第 1 次优化（待外发）」，右上角显示 `目标：<站点名>`，正文流式输出，可编辑 |
| B3 | 核对无误后点 **「发送到浏览器 →」** | 弹窗切换为「⚡ 正在处理」，显示倒计时（默认上限 120s）。**这是整条链路唯一一次对外写入** |
| B4 | 等待外部 AI 回复完成 | 自动进入「✨ 第 2 次优化（终稿）」，标题栏提示已吸收外部回复的字符数 |
| B5 | 需要时点「查看外部回复」 | 打开原始回复弹窗，可查看 / 复制 / 保存存档 |
| B6 | 点「插入输入框」 | 终稿（去掉引导语前缀后的正文）写入 DSH 输入框，**不自动发送** |

**超时分支**（B3/B4 等待超过 `optimize.relayTimeoutMs`）：

- 弹窗转为「⏱ 等待超时」，提供三个动作：**撤回** / **继续等待**（只读重读页面，不重发）/ **采用已抓内容 →**（用已捕获的部分内容直接走终稿优化）。
- 超时**不判失败**，不会在外部站点留下重复消息。

**任一步都可撤回**：点「撤回」即丢弃，不写不存。

---

### 第 8 步：卸载与升级

**卸载**：

```sh
dsh plugin --profile web remove @dsh-external/dsh-webrelay
```

**成功判断依据**：`dsh web --dump-config | grep webrelay` 不再输出插件条目。

> `$DSH_HOME/webrelay/`（用户配置 + 捕获存档 + 浏览器配置目录）会保留，便于重装后延续。彻底清除请手动删除该目录。

**升级**（link 模式）：拉取新代码后在插件目录重新构建，重启 `dsh web` 即可：

```sh
pnpm install --ignore-workspace
pnpm build
```

---

### 第 9 步：发布与部署（可选）

本插件是**本地插件**，通过 `link:` 方式安装，不需要发布到 npm 即可使用。「部署」在本项目语境下即上面的 link 安装流程。

如需分发，`package.json#files` 已声明打包白名单：

```
lib / sites.default.yml / cordis.patch.yml / README.md / LICENSE
```

即 `pnpm pack` 产出的 tarball 只含构建产物与配置模板，不含源码。

> 注：白名单中包含 `LICENSE`，但仓库当前尚未提供该文件；正式发布前请补一份（`package.json` 已声明 `"license": "MIT"`）。

---

## 配置说明

用户配置文件为 `$DSH_HOME/webrelay/sites.yml`（首次运行自动从 `sites.default.yml` 复制）。主要配置项：

### `sites.*`：站点定义

| 键 | 说明 |
|----|------|
| `name` | 展示名 |
| `home` | 内置浏览器打开的入口地址 |
| `match` | 站点识别与代理白名单域名（**同时是安全边界**，代理只转发白名单内站点） |
| `experimental` | `true` = 实验性适配（未端到端实测） |
| `hidden` | 从页签隐藏，但识别与代理仍生效 |
| `openIn` | 打开方式：`relay`（内置 iframe）/ `cdp`（专用联动浏览器）/ `system`（当前浏览器新标签页） |
| `browser` | 联动模式绑定的浏览器实例 id（`browsers` 表的键；`null` = 默认实例） |
| `adapter.*` | DOM 适配选择器，全部为**候选选择器链**，按序取第一个命中的元素 |

`adapter` 子项：`input`（对话输入框）、`inputContentEditable`（是否 contenteditable）、`send`（发送按钮候选，可空数组 → 用 Enter 发送）、`sendMode`（`enter` / `click` / `enter-then-click`）、`replies`（助手回复节点候选）、`generating`（生成中标记候选）。

> **站点改版时改这里即可，无需改代码。**

### `relay.*`：反向代理

- `stripHeaders`：从上游响应剥离的响应头（解除 iframe 嵌入与脚本限制）；
- `injectShim`：是否注入运行时 shim（改写 fetch/XHR/EventSource/WebSocket，使 SPA 的同源请求继续走代理）；
- `upstreamTimeoutMs`：单请求上游超时（默认 60000）。

### `optimize.*`：提示词优化与协作

| 键 | 默认 | 说明 |
|----|------|------|
| `provider` / `model` | `null` | 优化用模型；`null` = 自动（client 传入 → 配置 → 第一个可用 provider） |
| `temperature` / `maxTokens` | `0.4` / `4096` | 采样参数 |
| `reasoningEffort` | `off` | 思考链档位（`off` / `low` / `high` / `max`）；`off` 可避免推理 token 耗尽 `maxTokens` |
| `style` | `preserve` | `preserve` 贴着原文语气做小切口改写（结果自然）；`structured` 允许分节结构化重排 |
| `structureHint` | `null` | 追加给优化器的结构偏好（如「输出必须是 JSON schema」），**优先级高于 `style`** |
| `extractProvider` / `extractModel` | `null` | 外部回复二次提取（整理）专用模型；`null` = 沿用上面的设置 |
| `extractTemperature` | `0.2` | 整理温度（低于优化温度，倾向忠实还原） |
| `extractMaxTokens` | `8192` | 整理输出的 token 上限 |
| `relayTimeoutMs` | `120000` | 等待外部 AI 回复的上限（毫秒）；超时不判失败，弹窗可「继续等待」或「采用已抓内容」 |
| `contextLimit` | `40` | 上下文压缩读取的对话条数（越大背景越完整、token 消耗越高） |

### `capture.*`：捕获存档

- `dir`：存档目录；`null` = `$DSH_HOME/webrelay/captures`；
- `recentLimit`：面板历史默认展示条数（默认 30）。

### `cdp.*` / `browsers.*`：专用联动浏览器

- `cdp.port`（默认 9222，仅回环）/ `cdp.browserPath`（`null` = 自动探测 Chrome、Edge）/ `cdp.startupTimeoutMs` / `cdp.headless`（默认 `false`，日常使用建议关闭无头以便正常过站点风控）；
- `browsers`：联动浏览器实例表，每个实例 = 独立进程 + 独立调试端口 + 独立配置子目录。示例：

  ```yaml
  browsers:
    chrome-main: { label: Chrome 主号, type: chrome, profile: Default, port: 9222 }
    edge-work:   { label: Edge 工作号, type: edge, profile: "Profile 1", port: 9223 }
  ```

### 站点管理界面

面板头部「管理」按钮打开站点管理弹窗，配置文件路径显性展示，支持：

- **添加站点**：填名称 + 网址即可（域名白名单与 id 自动提取，DOM 适配先用通用候选链，可后续改 YAML 收窄）；
- **排序**：↑/↓ 调整页签顺序（写回 YAML，用户层条目优先展示）；
- **隐藏**：从页签隐藏但识别与代理仍生效（可随时恢复显示）；
- **打开方式**：三档循环切换 `内置` / `联动` / `浏览器`；
- **删除**：自定义站点直接删除；出厂站点写入 `deleted:` 列表（可「重置」恢复）；
- **恢复全部默认**：整份配置还原为出厂模板（含注释）。

> 注意：除「恢复全部默认」外，管理操作以结构化方式写回 YAML，文件中的手写注释会被覆盖。

## 附件提示（只提示，不代传）

有些需求本身依赖某个文件的**内容**（「按这份配置改一下」「照这个 JSON 写代码」）。优化提示词时，优化器会顺带判断这次是否属于这种情况，若是则在弹窗里显示一条轻量提示：

> 📎 本次提示词可能需要附件——需要一份 `docker-compose.yml` 与相关 env 示例
> 请在外部浏览器里用页面自带的附件按钮上传；本插件不会读取或代传任何文件。

要点：

- **这只是提示**。插件不检测你的磁盘、不扫描目录、不读取任何文件，也不代你上传——**零文件操作**；
- 上传请自行使用外部浏览器/宿主页面**自带的附件按钮**（回形针 📎），传完后照常点「发送到浏览器」；
- 提示内容由优化器按需判断：不需要附件时整块不渲染，不会每个弹窗都挂一条无用的提示；
- 插件因此不承担「文件采集与处理」职责——复杂度与维护面都最小化。

> 附件上传不由本插件承担：站点是否支持附件、附件按钮长什么样，都取决于站点自身。因此 `sites.yml` 中**没有**附件控件相关配置。

## 站点支持矩阵

| 站点 | 状态 | 说明 |
|------|------|------|
| DeepSeek | 端到端实测（UI / 代理 / 识别 / 优化全链路） | 未登录或站点风控时页面资源可能被其自身拦截，属站点侧行为 |
| ChatGPT | 适配器已配置，未做账号级实测 | Cloudflare / 登录墙可能阻止嵌入，用「系统浏览器打开」降级 |
| 豆包 / 通义千问 / Gemini | 实验性 | 选择器为社区公开结构，需按实际页面微调 `sites.yml` |

各站点的对话 / 回复选择器改版后请复核 `sites.*.adapter.*`。嵌入失败的通用降级：面板底部「系统浏览器打开」按钮。

## 安全与合规

- relay 代理仅接受**回环请求**且要求 **Origin 同源**；目标域名必须在 `match` 白名单内——**不构成开放代理**。
- Cookie 仅保存在进程内存中的 per-`rid` jar（8 小时无活动自动回收），重启即清空，**不落盘**。
- 向外部 AI 网站的内容操作以**用户点击触发**为前提。双轮闭环中，**「发送到浏览器」是唯一一次对外写入**（须你在弹窗里明确点击）；此后对页面的全部操作（等待、捕捉回复、续等复查）均为**只读**。闪电按钮选项一与「优化提示词」全程不发送。
- **插件不读取你的任何文件**：本插件没有读盘逻辑，不存在扫描、枚举或后台读取目录的行为。提示词可能依赖某个文件时，它只会**提示你一句**（需要哪类材料），实际上传由你在外部浏览器里手动完成。
- 调试端口仅回环；插件只对 URL 命中站点 `match` 白名单的标签页执行注入。
- 用户需自行遵守目标网站的服务条款，风险自担。

## 架构速览

host 半（relay 反向代理 / 上下文压缩 / 外发与捕捉 / 提示词优化 / 智能体工具）与 client 半（闪电按钮 / 面板 / 弹窗 / 编排与页面读写器）通过 `/dsh-webrelay/*` 同源路由通信。前端仅使用 **additive 槽位**（`conversation.input.right`、`shell.overlay`），不与宿主或其他插件冲突；卸载后宿主无残留。

| 侧 | 入口 | 关键模块 |
|----|------|----------|
| host | `src/index.ts` | `relay.ts`（代理）/ `optimize.ts`（优化）/ `context-compress.ts`（压缩）/ `extract.ts`（整理）/ `page-adapter.ts`（CDP 表达式）/ `cdp.ts`（联动浏览器）/ `captures.ts`（存档）/ `tools.ts`（智能体工具） |
| client | `src/client/index.ts` | `lightning.ts`（闪电按钮）/ `flow.ts`（六阶段编排）/ `panel.ts`（面板）/ `modals.ts`（弹窗）/ `relay-run.ts`（iframe 读写器）/ `state.ts`（store） |

**host 自有路由**（全部 `/dsh-webrelay/` 前缀，经信任校验）：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/dsh-webrelay/proxy/<rid>/<target>` | any | 反向代理（白名单 + 信任校验） |
| `/dsh-webrelay/api/sites` | GET | 站点列表（含 adapter 选择器） |
| `/dsh-webrelay/api/sites/manage` | POST | 站点管理（添加 / 删除 / 隐藏 / 排序 / 重置 / 绑定实例） |
| `/dsh-webrelay/api/optimize` | POST | 提示词优化（流式） |
| `/dsh-webrelay/api/compress` | POST | 对话上下文压缩（流式） |
| `/dsh-webrelay/api/extract` | POST | 抓取内容二次提取整理（流式） |
| `/dsh-webrelay/api/cdp/status` | GET | 联动浏览器与标签页状态 |
| `/dsh-webrelay/api/cdp/launch` | POST | 启动 / 复用联动浏览器实例 |
| `/dsh-webrelay/api/cdp/open` | POST | 打开 / 激活站点标签页 |
| `/dsh-webrelay/api/cdp/capture` | POST | 只读读取联动标签页正文 |
| `/dsh-webrelay/api/cdp/close` | POST | 关闭联动标签页 |
| `/dsh-webrelay/api/cdp/send` | POST | 外发并等待回复（**唯一写入路由**，用户点击触发） |
| `/dsh-webrelay/api/captures` | GET / POST | 列出 / 新增捕获 |
| `/dsh-webrelay/api/captures/read` | GET | `?file=` 读取单条（含路径穿越校验） |
| `/dsh-webrelay/api/context` | POST | 读取会话全量事件并压成转写 |

> 插件**没有任何读盘路由**：附件只做提示，不做采集与投递。

详细设计见 [TECHNICAL.md](./TECHNICAL.md)（技术方案）与 [DESIGN.md](./DESIGN.md)（产品设计与需求清单）。

## 已知限制

- Service Worker 无法经代理注入；部分站点 JS 内硬编码的跨源请求会被 CORS 拦截。
- DSH 处于 developer preview，客户端快照 / 契约字段均做了防御式访问，但 API 变化仍可能影响功能。
- `system` 打开方式（当前浏览器新标签页）下，自动注入与抓取不可用——该模式只适合手动使用。
- 调试探针：控制台 `window.__DSH_WEBRELAY_DEBUG__.getState()` / `setState()` 可读写插件状态机。

## 许可证

MIT（见 `package.json` 的 `"license"` 字段）。
