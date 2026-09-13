# dsh-plugin-webrelay

DSH（DeepSeek Harness）Web 中继插件：

- **右侧内置浏览器**：通过插件自带的 relay 反向代理同源嵌入外部 AI 对话网页（DeepSeek / ChatGPT / 豆包 / 通义千问 / Gemini），带站点识别徽章、捕获历史与"系统浏览器打开"降级通道。
- **闪电按钮**：聊天输入框模型选择器左侧的 ⚡ 按钮，提供两个动作——
  1. **优化提示词（不发送）**：调用 DSH 宿主 LLM 把草稿改写成结构化提示词，弹窗展示（可编辑），支持 撤回 / 重新生成 / 插入输入框；
  2. **整理上下文并发送到浏览器**：把当前 DSH 会话的对话流背景与优化后的提示词合并为一条可编辑消息，确认后自动填入浏览器中识别到的外部 AI 对话框并发送，等待生成结束后抓取回复，弹窗展示（可编辑），可保存 / 插入 DSH 输入框 / 复制。
- **捕获存档**：抓取的回复保存为 `$DSH_HOME/webrelay/captures/*.md`，并注册 `webrelay_captures` 智能体工具——会话中的智能体可直接检索引用，减少重复思考。

## 安装 / 卸载 / 验证（官方机制）

```sh
# 安装（本地开发，link 模式；构建在 pnpm install 的 prepare 钩子自动执行）
dsh plugin --profile web add link:D:/path/to/dsh-plugin-webrelay

# 验证配置层
dsh web --dump-config | grep webrelay

# 卸载
dsh plugin --profile web remove @dsh-external/dsh-webrelay
```

> 卸载后 `$DSH_HOME/webrelay/`（用户配置与捕获存档）会保留；彻底清除请手动删除该目录。

## 构建

```sh
pnpm install --ignore-workspace   # 插件目录独立于 DSH 仓库 workspace
pnpm build                        # tsdown：lib/index.js（host）+ lib/client.js（浏览器）
pnpm typecheck
```

## 配置

首次运行会把出厂默认复制到 `$DSH_HOME/webrelay/sites.yml`，用户应编辑该文件：

- `sites.*.home`：内置浏览器打开的入口地址；
- `sites.*.match`：站点识别与代理白名单域名（同时也是安全边界，代理只转发白名单内站点）；
- `sites.*.adapter.*`：DOM 适配选择器（候选链）。**站点改版时改这里即可，无需改代码**；
- `optimize.provider / model`：优化用模型（null = 自动：client 传入 → 配置 → 第一个可用 provider）；
- `optimize.reasoningEffort`：`off`（默认，关闭思考链）/ `low` / `high` / `max`；
- `relay.stripHeaders / injectShim / upstreamTimeoutMs`：代理行为。

## 站点支持矩阵（首版）

| 站点 | 状态 | 说明 |
|------|------|------|
| DeepSeek | 端到端实测（UI/代理/识别/优化全链路） | 未登录或站点风控时页面资源可能被其自身拦截，属站点侧行为 |
| ChatGPT | 适配器已配置，未做账号级实测 | Cloudflare/登录墙可能阻止嵌入，用"系统浏览器打开"降级 |
| 豆包 / 通义千问 / Gemini | 实验性 | 选择器为社区公开结构，需按实际页面微调 `sites.yml` |

嵌入失败的通用降级：面板底部「系统浏览器打开」按钮。

## 安全与合规

- relay 代理仅接受**回环请求**且要求 **Origin 同源**；目标域名必须在 `match` 白名单内——不构成开放代理。
- Cookie 仅保存在进程内存中的 per-rid jar，重启即清空，不落盘。
- 向外部 AI 网站自动发送内容由用户点击确认触发；请自行遵守目标网站的服务条款，风险自担。

## 架构速览

详见 [TECHNICAL.md](./TECHNICAL.md) 与 [DESIGN.md](./DESIGN.md)。host 半（relay 代理 / 优化 / 捕获 / 智能体工具）与 client 半（闪电按钮 / 面板 / 弹窗 / DOM 适配执行器）通过 `/dsh-webrelay/*` 同源路由通信；前端仅使用 additive 槽位（`conversation.input.right`、`shell.overlay`），不与宿主或其他插件冲突。

## 已知限制

- Service Worker 无法经代理注入；部分站点 JS 内硬编码的跨源请求会被 CORS 拦截。
- DSH 处于 developer preview，客户端快照/契约字段均做了防御式访问，但 API 变化仍可能影响功能。
- 调试探针：控制台 `window.__DSH_WEBRELAY_DEBUG__.getState()/setState()` 可读写插件状态机。
