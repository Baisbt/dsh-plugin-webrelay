# 插件市场收录条件 —— 逐项验证报告

- **被验证仓库**：`Baisbt/dsh-plugin-webrelay`
- **目标市场**：`awesome-dsh-plugin/awesome-dsh-plugin`（默认分支 `main`）
- **验证时间**：2026-09-14 15:46 (GMT+8) / 2026-09-14T07:46Z
- **依据文档**：市场仓库根目录 `contributing.md`、`README.md`、`.github/pull_request_template.md`
- **总体结论**：**仍差一项（仓库年龄未满 1 天），故不提交 PR。** 其余可修项已全部修完。

> **修订说明**：首轮验证曾把两项判为未达标（官方 `@deepseek-ai/*` 未声明 peer、`cordis: "*"` 匹配不到预发布）。
> 补充取证后**两项均下调**——源码实际不 import 这两个包，判定有误（详见 §二 第 10、11 项）。
> 同时新发现并修掉了一处**真**的 peer 缺口（`react` / `react-dom`）。本报告为修正后的版本。

---

## 一、结论摘要

| # | 检查项 | 首轮判定 | 最终判定 |
|---|--------|----------|----------|
| 1 | `package.json` 声明 `dsh.bundle` | ✅ | ✅ 通过 |
| 2 | 存在真实可用代码 | ✅ | ✅ 通过 |
| 3 | 仓库创建满 1 天（CI 硬门槛） | ❌ | ❌ **仍未通过**（唯一剩余阻塞项） |
| 4 | 已打 `dsh-plugin` topic | ✅ | ✅ 通过 |
| 5 | 活跃维护（未归档 / 未停更） | ✅ | ✅ 通过 |
| 6 | 分类取值合法 | ✅ | ✅ 通过（`browser`） |
| 7 | 描述不含营销词 | ✅ | ✅ 通过 |
| 8 | 描述与代码一致 | ✅ | ✅ 通过 |
| 9 | 未被现有条目覆盖 | ⚠️ | ⚠️ 与 `Nono-neko/dsh-browser` 部分重叠，已在描述与 PR 正文中区分 |
| 10 | 官方 `@deepseek-ai/*` 用 peerDependencies 声明 | ❌ | ✅ **判定下调**（不 import，无需声明） |
| 11 | peer 范围需覆盖预发布 | ❌ | ✅ **判定下调**（`cordis` 是宿主契约标记，同作者已收录条目同款） |
| 12 | `LICENSE` 文件与声明一致 | ❌ | ✅ **已修复**（补 MIT 全文） |
| 13 | `react` / `react-dom` 声明为 peer（新发现） | — | ✅ **已修复**（补 `^18.2.0`） |
| 14 | `package.json#repository` | ⬜ | ✅ **已修复** |
| 15 | 工作树干净 | ⚠️ | ✅ **已修复**（`.gitignore` 一并提交） |
| 16 | 发布 npm 包（推荐） | ⬜ | ⬜ 未做（不影响收录） |
| 17 | GitHub Release tarball（推荐） | ⬜ | ⬜ 未做（可从源码安装，非必需） |
| 18 | `screenshots.json`（推荐） | ⬜ | ⬜ 未做（不影响收录） |

**结论：除第 3 项（纯时间门槛，无法提前满足）外，全部通过。**

---

## 二、逐项验证明细

### ✅ 1. `dsh.bundle` manifest

市场 CI 从仓库取 `package.json` 校验这一项；**只声明 `dsh.client` 会被拒**。

`master` 分支上的实际声明（经 `raw.githubusercontent.com` 取证，与本地一致）：

```jsonc
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // ← 必需项，已具备
  "client": { "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"], "platform": "web" }
}
```

且仓库根目录存在配对的 `cordis.patch.yml`（`insert` 段注入 `id: dsh-webrelay`），形态与贡献指南的完整示例一致。

### ✅ 2. 真实可用代码

`git ls-files` 共 37 个入库文件，`src/` 下 24 个 `.ts`（host 14 + client 10），
`tsdown.config.ts` 产出 host（ESM `lib/index.js`）与 client（CJS `lib/client.js`）双 bundle。
非占位、非纯 README 仓库。

### ❌ 3. 仓库年龄 —— 唯一剩余阻塞项

| 事实 | 值 |
|------|-----|
| GitHub `created_at` | `2026-09-13T13:54:00Z` |
| 验证时刻 | `2026-09-14T07:46Z` |
| 实际年龄 | 约 **17 小时 52 分** |
| 满足「满 1 天」的时点 | **`2026-09-14T13:54:00Z` = 北京时间 2026-09-14 21:54** |

贡献指南原文：*「The repo is at least 1 day old. This is checked automatically.」*
指南同时说明：不达标不是对插件的评价，**重新提交不会有任何影响**。
→ 等到北京时间今晚 21:54 之后再提交 PR 即可。

### ✅ 4–5. topic 与维护状态

- `topics` 实测 `["dsh-plugin", "dsh-plugins"]`，需求项 `dsh-plugin` 已具备。
- `archived: false`、`disabled: false`；`pushed_at = 2026-09-14T06:15:33Z`；默认分支 `master`，HEAD `b8a3bdf`。

> 附注：本地克隆的 remote-tracking ref 缺失（`git branch -r` 为空，`git status -sb` 显示 `[gone]`），
> 上游分支实际存在且与本地 HEAD 一致（API 与网页双向确认）。仅本地未 fetch，不影响收录。

### ✅ 6–8. 分类、描述口径、描述与代码一致性

合法 `category` 枚举：`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `wsl`
`browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security` `remote` `market` `fun`

选定 **`browser`**，并已用同分类存量条目交叉验证写法：`Nono-neko__dsh-browser.yml`、`stuarthu__dsh-chrome.yml`
均为 `category: browser`。指南明确：分类不贴切**不会**被打回，维护者会直接改。

提交稿 `description` 的每一处声明均已回源核对：

| 描述中的声明 | 源码出处 |
|--------------|----------|
| 同源反向代理嵌入外部站点 | `src/relay.ts`、`src/index.ts:81`（`/dsh-webrelay/proxy/<rid>/<target>`） |
| DOM 适配器写在配置里、改版无需改代码 | `sites.*.adapter.*` 候选选择器链 |
| 输入框旁按钮 | `src/client/index.ts:36` 注册于 `conversation.input.right` 槽 |
| 用宿主模型改写草稿 | `src/optimize.ts` → `POST /dsh-webrelay/api/optimize`（`llm` 运行时懒取） |
| 压缩对话 | `src/context-compress.ts` → `POST /dsh-webrelay/api/compress` |
| 发送到嵌入站点 | `src/client/relay-run.ts`、`src/page-adapter.ts`（`POST /dsh-webrelay/api/cdp/send`） |
| 捕获回复 | `POST /dsh-webrelay/api/cdp/capture`、`src/captures.ts` |
| 整理成终稿写回输入框 | `src/extract.ts` → `POST /dsh-webrelay/api/extract` |

描述中无最高级形容词、无数字类声明、未点名不存在的命令或 API。

### ⚠️ 9. 是否已被现有条目覆盖

市场 `Browser & Web` 分体现有 3 条相关条目：

| 条目 | 与本站关系 |
|------|-----------|
| `Nono-neko/dsh-browser` | **重叠度最高**：同样在 DSH 内嵌浏览器，但定位是通用浏览面——多标签浏览、工作区文件预览、`browser_open` / `browser_read` 智能体工具 |
| `stuarthu/dsh-chrome` | 反向：Chrome 侧边栏嵌 dsh 网页界面 |
| `kyo615/dsh-browser-control` | Playwright MCP 驱动真实 Chrome，面向智能体自动化 |

指南原文：*「the rule is not first-come; the rule is whichever is better」*——
分叉在「维护得更好」或「确实做了新东西」时**可以**被收录。

**判断**：本插件的差异化是「面板存在的目的是把提示词交给另一个模型、再把答案收回输入框」
（提示词优化按钮、双轮协作闭环、捕获存档 + `webrelay_captures` 工具），现有条目均无覆盖。
但描述若只写「内嵌浏览器」，极易被判重复。**故提交稿把两条能力并列陈述，并在 PR 正文中主动说明差异与分类理由。**

### ✅ 10.【判定下调】官方 `@deepseek-ai/*` 未声明 peer —— **不构成缺口**

首轮看到 `dsh.client.inject` 引用了两个 `@deepseek-ai/*` 包，就判为未声明。补取证后推翻：

**对 `src/**/*.ts` 全部 24 个文件做外部模块导入扫描，结果只有 9 个裸模块：**

```
node:child_process   ← cdp.ts
node:fs              ← captures.ts, cdp.ts, config.ts, site-manage.ts
node:os / node:path / node:stream / node:url
react                ← cdp-view.ts, lightning.ts, modals.ts, panel.ts, site-manager.ts, state.ts
react-dom            ← modals.ts
yaml                 ← config.ts
```

**从未 import `cordis`，也从未 import 任何 `@deepseek-ai/*`。**（这正是 README 所声明的「零 `@deepseek-ai/*` 运行时强依赖」设计。）

`dsh.client.inject` 才是声明「由宿主 loader 提供的客户端模块」的正确机制，**不需要**再写 peer。
先例佐证：已收录的 `Nono-neko/dsh-browser` 声明了 **4 个** `inject` 条目，peerDependencies 里 **0 个**对应包。
而 `stuarthu/dsh-chrome` 之所以写 `@deepseek-ai/dsh-tools` / `dsh-llm` peer，是因为它**真的在 host 侧 import 了这两个包**。

→ **给不 import 的包补 peer 反而是错的**（会声称一个代码里不存在的依赖，并可能让安装期去解析一个插件根本不会加载的包）。**不改。**

### ✅ 11.【判定下调】`cordis: "*"` —— 维持现状

首轮依据贡献指南的预发布警告判为未达标，并实测确认了机制本身：

```
semver 7.8.5 实测：
  satisfies('0.1.0-rc.6', '*') === false        ← `*` 确实不匹配预发布
  satisfies('4.0.0-rc.10', '*') === false
  satisfies('0.1.0-rc.6', '>=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0') === true
```

**但下调为「可接受」，理由三条：**

1. **生态先例**：同作者**已被收录**的 `Baisbt/dsh-GreaterClarity-plugin`（v0.10.2）用的正是
   `"peerDependencies": {"cordis":"*"}`，且同样没有声明任何 `@deepseek-ai/*` peer。这是被市场接受过的形态。
2. **语义上并不虚假**：源码不 import `cordis`，该条 peer 是**宿主契约标记**而非 API 绑定。
   把 `*` 收窄成 `>=4.0.0-rc.1 <5.0.0-0` 反而会**错误地排除**宿主可能提供的其它 cordis 线，
   而代码里没有任何依赖 cordis 4 特定 API 的地方——收窄是虚伪的精确。
3. **不是 CI 项**：贡献指南与 PR 模板都把它列为 *Recommended (not required)*，市场 CI 不校验 peer 范围。

**若仍希望收紧**（例如确定只支持 cordis 4.x），可改为：
`"cordis": ">=4.0.0-rc.1 <5.0.0-0"`（该形态已实测可匹配 `4.0.0-rc.10`）。
本仓库 `pnpm-lock.yaml` 实际解析到的就是 `cordis@4.0.0-rc.10`，npm `latest` dist-tag 亦指向 `4.0.0-rc.10`。

### ✅ 12.【已修复】`LICENSE`

| 项 | 修复前 | 修复后 |
|----|--------|--------|
| `package.json#license` | `"MIT"` | `"MIT"` |
| `package.json#files` | 含 `"LICENSE"` | 含 `"LICENSE"` |
| 仓库实际文件 | **不存在** | **已提供** `LICENSE`（MIT 全文） |

版权行取自同作者已收录仓库 `Baisbt/dsh-GreaterClarity-plugin` 的 `LICENSE` 原文，逐字一致：
`Copyright (c) 2026 Baisbt`（非臆造）。GitHub 侧的 `license` 字段将在下次扫描后变为 MIT。

### ✅ 13.【已修复·新发现】`react` / `react-dom` 是真缺口

首轮漏掉的一项，由上面的导入扫描暴露：

- client 半 **6 个文件** import `react`、**1 个文件** import `react-dom`（portal 渲染）；
- `tsdown.config.ts` 把它们列为 client 侧 external（必须由宿主提供，不得打进 bundle）；
- 但 `package.json` 里**既不在 dependencies 也不在 peerDependencies**——只有 `@types/react` 在 devDependencies。

已补：

```jsonc
"peerDependencies": {
  "cordis": "*",
  "react": "^18.2.0",
  "react-dom": "^18.2.0"
}
```

版本范围依据：宿主 `@deepseek-ai/dsh-client-runtime` 自身 `dependencies` 即为 `"react": "^18.2.0"`；
已收录的 `Nono-neko/dsh-browser` 同样用 `{"react":"^18.2.0","react-dom":"^18.2.0"}`。**这是本次修正里唯一一处真缺口。**

### ✅ 14.【已修复】`package.json#repository`

贡献指南：*「The published package's `repository` field must point back at the repository listed here, or the two are not linked.」*
（仅在发布 npm 后用于双向关联，当前未发 npm，故不影响收录，但补齐无副作用。）

```jsonc
"repository": { "type": "git", "url": "git+https://github.com/Baisbt/dsh-plugin-webrelay.git" }
```

写法与同作者已收录仓库一致。

---

## 三、修改清单

| 文件 | 改动 |
|------|------|
| `LICENSE` | **新增**（MIT 全文） |
| `package.json` | 新增 `repository` 字段；`peerDependencies` 增加 `react` / `react-dom` |
| `README.md` | 「依赖清单」的 peer 行补上 react/react-dom；第 9 步的「LICENSE 尚未提供」注记改为已提供 |
| `.gitignore` | 提交首轮遗留的未提交改动（分节注释） |

验证：`node scripts/check.cjs` → `TSC OUTPUT: (clean)`；`node scripts/build.cjs` →
`lib/client.js 92.87 kB` / `lib/index.js 334.39 kB`，**与修改前完全一致**，说明改动是纯元数据、未触及打包产物。

---

## 四、提交前的最终待办

1. **等到北京时间 2026-09-14 21:54 之后**再向市场提交 PR（仓库年龄是唯一剩余阻塞项）。
2. 提交时**只加一个文件** `data/plugins/Baisbt__dsh-plugin-webrelay.yml`，不要手工改 README，也不要顺带动别的条目。
3. 描述里的 `: ` 必须保留引号（已用单引号包裹 `en` / `zh`），否则 YAML 会解析失败。
4. **（推荐，非必需）** 加 `screenshots.json`；发 npm 或附 GitHub Release tarball 可改善安装体验
   （预构建安装免 `allowBuilds` 授权）。若用 `latest/download/` 形式，**资产名不要带版本号**。

---

## 五、取证方式与未验证项

所有事实均来自实际取证，未使用推测：

- **市场侧**：`contributing.md`、`README.md`、`.github/pull_request_template.md` 原始文件；
  存量条目实样（`Baisbt__dsh-GreaterClarity-plugin.yml`、`Nono-neko__dsh-browser.yml`、`stuarthu__dsh-chrome.yml`）；
  三个已收录仓库的 `package.json` 与 `LICENSE` 原文；PR 标题惯例取自 `pulls?q=is%3Apr+is%3Amerged` 页面。
- **本站侧**：GitHub REST API `repos/Baisbt/dsh-plugin-webrelay`（`created_at` / `topics` / `license` / `archived` 等）；
  `raw.githubusercontent.com` 上 `master` 分支的 `package.json`；本地 `git ls-files` / `git log` / `git status`；
  自写 Node 脚本对 `src/**/*.ts` 做外部模块导入扫描。
- **npm 侧**：`registry.npmjs.org` 的 `cordis` / `@deepseek-ai/dsh` / `@deepseek-ai/dsh-client-*` dist-tags 与依赖字段。
- **semver 行为**：本机以 semver 7.8.5 实跑 `satisfies()` 取得，非查表。

**未验证项（如实说明）**：

- 本机 `dsh` CLI 处于损坏状态（npm shim 无法解析 `@deepseek-ai/dsh`，报 `MODULE_NOT_FOUND`），
  因此**无法在本机复现一次 `dsh plugin add` 真实安装**，也无法验证新增的 `react` / `react-dom` peer
  在真实 profile 中的解析结果。市场 CI 对「可安装」的校验只读取 `package.json` 的 `dsh.bundle` 声明，
  不做真实安装，故不影响 CI；但**建议在有可用 dsh 的环境跑一次 link 安装确认 peer 解析无碍**。
- 市场 CI 的实际脚本未逐一读取（`contributing.md` 已逐条文字说明：条目数 → `dsh.bundle` → 仓库年龄 → `awesome-lint` 与站点构建）。
