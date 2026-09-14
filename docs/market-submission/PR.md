# PR 提交文案 — awesome-dsh-plugin/awesome-dsh-plugin

> 目标仓库：`awesome-dsh-plugin/awesome-dsh-plugin`（默认分支 `main`）
> 提交内容：**仅新增一个文件** `data/plugins/Baisbt__dsh-plugin-webrelay.yml`
> 该文件内容见同目录 `Baisbt__dsh-plugin-webrelay.yml`（可直接复制使用）

---

## 标题（推荐）

```
Add Baisbt/dsh-plugin-webrelay — embedded external AI chat panel plus a composer prompt-optimizer button (browser)
```

**备选（与市场现有标题风格更贴近的短版）：**

```
Add Baisbt/dsh-plugin-webrelay (browser)
```

> 说明：贡献指南与本仓库 `pull_request_template.md` **均未规定 PR 标题格式**。
> 上面的写法取自该市场已合并 PR 的实际惯例（`Add <owner>/<repo>`，可选追加一句概述与 `(分类)`），
> 例如 `Add zhengjy01/dsh-zhihu — Zhihu CLI tools plus web panel`、`add Jumqyc/dsh-wsl-gpufix (wsl)`。

---

## 描述（PR 正文）

> 下面是按仓库自带的 `.github/pull_request_template.md` 逐项填写后的正文。
> 提交时该模板会被自动预填，直接逐条勾选 / 保留本节内容即可。

```markdown
<!-- Thanks for contributing! Quick checklist / 提交前快速自查 -->

- [x] I added **one file** at `data/plugins/Baisbt__dsh-plugin-webrelay.yml` — that single file is the whole submission. The READMEs are regenerated on `main` after merge: don't edit them by hand, and you don't need to commit them either / 我新增了一个 `data/plugins/Baisbt__dsh-plugin-webrelay.yml` 文件——**这一个文件就是全部投稿**。README 会在合并后由 `main` 自动重新生成：不要手工编辑，也不需要提交
- [x] My repo's `package.json` declares **`dsh.bundle`** (not just `dsh.client`) / 仓库 `package.json` 已声明 `dsh.bundle`
- [x] My repo is at least **1 day old** / 仓库创建满 1 天
- [x] `category` is one of `agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`, and themes/skins go under `theme` / `category` 取值正确
- [x] Description states what the plugin does, no superlatives / 描述只说功能，不带营销词
- [x] My repo has the `dsh-plugin` topic / 仓库已打 `dsh-plugin` topic

**Recommended (not required) / 推荐但不强制：**

- [ ] 📦 Publish to npm — npm installs are prebuilt and skip the `allowBuilds` approval, so users get a one-command install / 发布 npm 包（尚未发布；源码安装需 `allowBuilds` 授权一次）
- [x] 🔗 Declare official `@deepseek-ai/*` packages as `peerDependencies` / 官方 `@deepseek-ai/*` 包用 `peerDependencies` 声明 —— 本插件 host 与 client 源码**不 import 任何 `@deepseek-ai/*` 包**（仅经 `dsh.client.inject` 由宿主 loader 提供），故无此类 peer 需声明；实际 import 的 `react` / `react-dom` 已声明为 `peerDependencies: ^18.2.0`
- [ ] 🖼️ Screenshots go in **your own repository** now: a `screenshots.json` beside your `package.json`, listing image paths / 截图放在自己仓库的 `screenshots.json`（**尚未提供**）
```

### 建议在正文中额外补充的说明（可选，但有助于人工评审）

```markdown
Notes for the reviewer / 供评审参考：

- **Scope claimed by the description is the scope shipped.** The relay reverse proxy and the
  composer button are separate paths in one plugin: the proxy is `/dsh-webrelay/proxy/<rid>/<target>`
  (loopback-only, same-origin checked, target domain must be on the per-site `match` allowlist),
  and the button registers on the additive `conversation.input.right` slot.
- **Only one write path to a third-party site.** Of the whole two-round flow, exactly one step
  ("send to browser") writes to the embedded site, and it requires an explicit click in the modal;
  waiting, capturing the reply and re-checking are read-only.
- **Category.** `browser` — the plugin's first capability is the embedded panel. It does overlap with
  `Nono-neko/dsh-browser` on "embeds a browser in DSH", but that plugin is a general-purpose
  Puppeteer browsing surface (`browser_open` / `browser_read` agent tools, workspace file preview),
  while this one is a writing surface: the panel exists to hand a prompt to another model and take
  the answer back into the composer. Happy to be re-filed if you read it differently.
- This PR adds one entry and touches no existing entry.
```

---

## 提交时不可省略的三条硬性提醒

1. **仓库年龄。** `Baisbt/dsh-plugin-webrelay` 的 GitHub 创建时间为 `2026-09-13T13:54:00Z`，
   满足「满 1 天」的时点是 **`2026-09-14T13:54:00Z`（北京时间 2026-09-14 21:54）**。
   在此之前提交，CI 会在第 3 项直接判红。
2. **一个 PR 只加这一个文件。** 不要手工改 README.md / README.zh.md，也不要顺带动别的条目。
3. **描述里的 `: ` 已加引号。** YAML 会把未加引号的 `loop: compress` 解析成嵌套键，当前文件已用单引号包裹 `en` / `zh`，抄写时别丢引号。
