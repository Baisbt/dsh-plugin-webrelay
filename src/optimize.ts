/**
 * dsh-webrelay —— 提示词优化。
 *
 * 优化思路借鉴 prompt-optimizer（linshenkx/prompt-optimizer）的"先分析、后重写、
 * 结构化输出"方法论：元提示要求模型先澄清目标与缺失信息，再产出结构化提示词。
 * 模板与实现均为本项目原创（该项目为 AGPL-3.0，不引入其任何代码）。
 */

export interface OptimizeInput {
  /** 用户的原始草稿（要优化的提示词）。 */
  draft: string
  /** 可选：DSH 对话流背景摘要（帮助优化器理解上下文）。 */
  context?: string
  /** 可选：client 传入的当前会话模型。 */
  provider?: string
  model?: string
}

export interface ResolvedModel {
  provider: string
  model: string
}

/** LlmRuntime 的最小结构面（运行时经 ctx.get('llm') 懒取，避免硬依赖）。 */
export interface LlmLike {
  listProviders(): Array<{ id: string }>
  listModels(provider: string): Promise<Array<{ id: string }>>
  stream(options: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    temperature?: number
    maxTokens?: number
    reasoningEffort?: string
  }): AsyncIterable<{ type: string, text?: string, reason?: { kind?: string, failure?: { message?: string, code?: string } } }>
}

export function optimizeSystemPrompt(): string {
  return [
    '你是一位专业的提示词工程师。把用户给出的原始提示词改写为一份更清晰、更可执行的版本。',
    '规则：',
    '1. 保持用户的核心意图与全部事实，不新增用户没有的需求，不编造细节。',
    '2. 结构化改写：按「角色 / 任务目标 / 背景信息 / 约束条件 / 期望输出格式」组织（不适用的段落省略）。',
    '3. 把模糊表述具体化：补全可从上下文推断的量化标准、边界条件与验收口径。',
    '4. 语言跟随用户原文（中文输入输出中文，英文输入输出英文）。',
    '5. 只输出改写后的提示词正文，不要解释、不要前后缀、不要 Markdown 代码围栏。',
  ].join('\n')
}

export function optimizeUserPrompt(input: OptimizeInput): string {
  const parts: string[] = []
  if (input.context && input.context.trim().length > 0) {
    parts.push(`【对话背景】（供理解上下文，改写时不要原样复述）\n${input.context.trim()}`)
  }
  parts.push(`【原始提示词】\n${input.draft}`)
  return parts.join('\n\n')
}

/** 模型解析顺序：client 传入 → 配置指定 → 第一个可用 provider 的第一个模型。 */
export async function resolveModel(llm: LlmLike, input: OptimizeInput, configured: { provider: string | null, model: string | null }): Promise<ResolvedModel> {
  const provider = input.provider ?? configured.provider ?? undefined
  const model = input.model ?? configured.model ?? undefined
  if (provider && model) return { provider, model }
  const providers = llm.listProviders().map((p) => p.id)
  const chosenProvider = provider ?? providers[0]
  if (!chosenProvider) throw new Error('no LLM provider is registered; configure optimize.provider in sites.yml')
  if (model) return { provider: chosenProvider, model }
  const models = await llm.listModels(chosenProvider).catch(() => [])
  const firstModel = models[0]?.id
  if (!firstModel) throw new Error(`provider "${chosenProvider}" exposes no models; configure optimize.model in sites.yml`)
  return { provider: chosenProvider, model: firstModel }
}

/** 调用 LLM 流式优化；onDelta 逐段回调增量文本，返回聚合全文。 */
export async function optimizePrompt(
  llm: LlmLike,
  input: OptimizeInput,
  options: { temperature: number, maxTokens: number, model: { provider: string | null, model: string | null }, reasoningEffort: string | null },
  onDelta?: (text: string) => void,
): Promise<{ text: string, provider: string, model: string }> {
  const resolved = await resolveModel(llm, input, options.model)
  const message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: optimizeUserPrompt(input) }],
    source: { kind: 'user' },
  }
  const stream = llm.stream({
    provider: resolved.provider,
    model: resolved.model,
    messages: [Object.freeze(message)],
    system: optimizeSystemPrompt(),
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
  })
  let full = ''
  let finishInfo = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
      full += chunk.text
      onDelta?.(chunk.text)
    } else if (chunk.type === 'finish') {
      finishInfo = JSON.stringify(chunk.reason ?? null)
      if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
        // LlmRuntime 把 adapter 失败归一化为终止 finish 块（不抛异常），在此显式转错误。
        const failure = chunk.reason.failure
        throw new Error(`LLM 调用失败（${chunk.reason.kind}）[${failure?.code ?? 'UNKNOWN'}]：${failure?.message ?? 'no detail'}`)
      }
    }
  }
  if (full.trim().length === 0) {
    throw new Error(`模型没有返回文本（finish: ${finishInfo || 'none'}）`)
  }
  return { text: full.trim(), provider: resolved.provider, model: resolved.model }
}
