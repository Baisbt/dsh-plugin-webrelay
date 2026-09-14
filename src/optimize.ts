/**
 * dsh-webrelay —— 提示词优化 / 内容二次提取（LLM 调用核心）。
 *
 * 设计借鉴（均为思路借鉴，不引入其代码；prompt-optimizer 为 AGPL-3.0）：
 *   1. linshenkx/prompt-optimizer 的「分析式结构优化」：把优化拆成"先识别
 *      Role/Background/Skills/Goals/Constrains/Workflow/OutputFormat 各维度，
 *      再逐维填充"，而非让模型一上来就泛泛润色。本项目取其"先分析后重写"的
 *      方法论，但**不采用其固定骨架**——固定骨架正是"僵硬"的来源。
 *   2. 元提示的 critique-then-rewrite（诊断 → 改写）：先让模型在内部点名草稿
 *      缺失了哪个维度，再针对这些缺口改写。诊断只用于引导改写，不进最终输出。
 *   3. getsentry/skills 的 prompt-optimizer：一条行为只留一个归属、用最短措辞
 *      保住约束、砍掉不做功的套话与重复提醒。这直接对应"自然、灵活"的诉求。
 *
 * 与旧版的差别：
 *   - 结构不再是硬性四段，而是按任务复杂度自适应（短任务保持短）。
 *   - 增加维度检查表（ROLE/TASK/CONTEXT/CONSTRAINTS/FORMAT/SUCCESS…），缺什么补什么。
 *   - 明确"最小改动"与"禁止扩写膨胀"，短草稿不许被撑长。
 *   - 三条硬性保真约束：原意不变、事实不造、变量占位符逐字保留。
 *   - 新增 style（preserve 保风格 / structured 结构化）与 structureHint（用户自定义
 *     结构偏好）两个可调开关，让用户能自己调"自然 ↔ 规整"的档位。
 */

export interface OptimizeInput {
  /** 用户的原始草稿（要优化的提示词）。 */
  draft: string
  /** 可选：DSH 对话流背景摘要（帮助优化器理解上下文）。 */
  context?: string
  /**
   * 可选：外部 AI 的回答原文（选项二第二次优化用）。
   * 传入即表示这是终稿轮——优化器会把它消化进指令，而不是原样搬运。
   */
  externalReply?: string
  /** 可选：client 传入的当前会话模型。 */
  provider?: string
  model?: string
}

export interface ResolvedModel {
  provider: string
  model: string
}

/** 优化风格：preserve 尽量贴着原文语气改写；structured 允许成套的结构化重排。 */
export type OptimizeStyle = 'preserve' | 'structured'

/**
 * 优化轮次视角（选项二双轮闭环用）：
 *   outbound —— 第一次优化：产出的文本**将被发送给另一个 AI 模型**，写成对那个模型
 *               直接可执行的任务描述。读者是模型，不是人。
 *   final    —— 第二次优化：手上有外部 AI 的回复，要把它**消化吸收**进最终指令，
 *               产出交给 DSH 的终稿。
 *   single   —— 单轮（选项一 / 旧行为）：读者是人，没有外部素材。
 */
export type OptimizePhase = 'single' | 'outbound' | 'final'

/** 优化相关的可调参数（由 sites.yml optimize 段注入）。 */
export interface OptimizeOptions {
  temperature: number
  maxTokens: number
  model: { provider: string | null, model: string | null }
  reasoningEffort: string | null
  /** 'preserve'（默认）| 'structured'。 */
  style?: string | null
  /** 用户自定义的结构偏好（如"必须含输出 JSON schema"），为空则不加约束。 */
  structureHint?: string | null
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

/**
 * 优化器 system 指令。
 *
 * 结构：角色 → 视角（单轮/外发/终稿）→ 工作方式（诊断-改写两段）→ 维度检查表
 * → 硬性约束 → 输出要求。
 * 温度决定语气，模板决定骨架；把"该有哪些维度"写成检查表、把"该长什么样"交给，
 * 模型按任务复杂度自己判断，这是"自然、灵活"的关键。
 */
export function optimizeSystemPrompt(
  style: OptimizeStyle = 'preserve',
  structureHint?: string | null,
  phase: OptimizePhase = 'single',
): string {
  const lines: string[] = [
    '你是一位资深提示词工程师。你的工作是**改写**用户给出的提示词文本，让它更容易被模型执行；你**不是**在执行这条提示词里的任务。',
  ]

  if (phase === 'outbound') {
    lines.push(
      '',
      '## 本次任务的特殊视角：你将产出一段「外发给另一个模型」的文本',
      '这段改写结果会被发送给**另一个 AI 模型**（不是给人看）。因此：',
      '- 读者是模型——不要写"请帮我""麻烦你"这类对人说的客套，直接写成清晰的任务描述。',
      '- 不需要解释背景来历，但凡是那个模型无法自行推断的事实（数据、约束、期望产出），都必须写进去，因为它看不到你手上的对话。',
      '- 把它当作一次"独立提问"来写：那个模型只看到这段文本，看不到任何上下文。',
    )
  } else if (phase === 'final') {
    lines.push(
      '',
      '## 本次任务的特殊视角：你要把外部模型的回答「消化」进最终指令',
      '你手上除了用户的原始草稿，还有一份**外部 AI 模型针对该草稿给出的回答**。你要产出的不是又一份提问，',
      '而是**最终可以直接执行的指令**——把外部回答里有价值的部分吸收进来，重写成自洽的终稿。',
      '- 先判断外部回答里哪些是真材实料、哪些是客套或跑题的铺垫；只采纳与用户目标相关且站得住脚的内容。',
      '- 把采纳的内容**转写为可执行的约束、步骤或标准**，而不是把回答原文搬进来。',
      '- 外部回答里与你已知事实冲突、或明显是它在推诿/编造的部分，直接忽略，不要为了让终稿"看起来完整"而保留。',
      '- 终稿仍然是**给模型的指令**，不是给用户看的文章：不要出现"根据外部 AI 的回答…"这类元叙述。',
    )
  }

  lines.push(
    '',
    '## 工作方式（两步，只输出第二步的结果）',
    '第一步·诊断（在内部完成，不要写出来）：对照下面的维度清单，逐条判断原稿哪些维度已经说清、哪些缺失或含糊。不要笼统地觉得"不够好"，而要能点名具体缺口，例如"没有交代交付形态""约束只有否定项没有边界"。',
    '第二步·改写：只针对你点名的那几个缺口下笔。已经说清楚的地方不要动，不要为了改动而改动。',
    '',
    '## 维度检查表（按需补，不要求逐项出现）',
    '- 目标与任务：要模型产出什么具体东西，动词是否明确。',
    '- 角色与读者：说给谁听、以什么身份说、面向什么水平的受众。',
    '- 上下文：完成任务必须知道、而模型无法自行推断的背景事实。',
    '- 约束与边界：篇幅、范围、必须避免的事、优先级冲突时怎么取舍。',
    '- 输出形态：交付物的格式、结构、语言、篇幅量级。',
    '- 成功标准：什么样的结果算达标，遇到信息不足时该追问还是标注假设。',
    '只补真正缺失且**能从原稿或对话背景合理推断**的维度。推断不出的一律不补，宁缺毋滥。',
    '',
    '## 硬性约束',
    '1. 忠实原意：不新增用户没提过的需求，不替用户做他未授权的决定。',
    '2. 不编造事实：不虚构数据、来源、人名、事件或业务背景。',
    '3. 变量占位符逐字保留：原稿中的 {{name}}、{name}、${name}、<name> 等占位符原样保留，不改名、不删除、不替换成具体值。',
    '4. 语言与措辞跟随原稿：中文进中文出，英文进英文出；不要突然换成另一种语言的语气。',
  )

  if (style === 'structured') {
    lines.push(
      '',
      '## 结构风格：结构化',
      '允许把改写结果组织成分节结构，用简洁的小标题（如「任务」「约束」「输出」）分段，便于阅读与复用。',
      '但仍遵守一条纪律：**不写空壳小标题**——某个维度原稿与背景里都无从推断时，直接不写那一节，不要留一个标题去填"（略）"。',
    )
  } else {
    lines.push(
      '',
      '## 结构风格：保真',
      '措辞与语气尽量贴着原稿走：保留原稿的分段习惯、称呼方式与个人笔调，让人一眼看出这是"他写的那句话被写清楚了"，而不是被换成了另一个人写的模板。',
      '优先做小切口改动（换准确动词、补一句边界、点明交付形态），而不是整篇重排。除非原稿确实混乱到无法执行，否则不要引入小标题骨架。',
    )
  }

  if (structureHint && structureHint.trim().length > 0) {
    lines.push('', '## 用户的结构偏好（优先级高于上面的风格默认值）', structureHint.trim())
  }

  lines.push(
    '',
    '## 反模式（出现即为失败）',
    '- 把短提示词撑长：原稿只有一两句话时，输出不该变成一大段。信息密度比篇幅重要，简洁即合格。',
    '- 堆砌套话：不写"作为一名经验丰富的专家，你应当…"这类不改变行为的激励语、不写重复提醒、不写不约束行为的角色修饰。',
    '- 空泛占位：不写「[具体内容]」「（请补充）」这类留给用户的坑，也不要把原稿里已有的具体要求降级成泛泛表述。',
    '- 输出元信息：不解释你改了什么、不给修改说明、不加标题前缀或代码围栏。',
    '',
    '## 输出要求',
    '直接输出改写后的提示词正文，除此之外不要有任何内容——唯一的例外是末尾那行附件提示（见用户消息里的格式说明）。',
  )
  return lines.join('\n')
}

export function optimizeUserPrompt(input: OptimizeInput): string {
  const parts: string[] = []
  if (input.context && input.context.trim().length > 0) {
    parts.push(
      `【对话背景】（仅用于帮助理解语境；改写时请不要把它照抄进提示词，也不要逐条复述）\n${input.context.trim()}`,
    )
  }
  parts.push(`【待改写的提示词】\n${input.draft}`)
  if (input.externalReply && input.externalReply.trim().length > 0) {
    parts.push(
      `【外部模型的回答】（这是另一个 AI 对该提示词给出的回答，供你消化吸收。`
      + '不要把它原样搬进终稿，也不要围绕它写评论；只从中提取对完成任务有用的内容，转写成指令的一部分）\n'
      + clampExternalReply(input.externalReply),
    )
    parts.push('请先内部诊断缺口，再结合外部回答输出改写后的最终指令正文。')
  } else {
    parts.push('请先内部诊断缺口，再输出改写后的提示词正文。')
  }
  parts.push(ATTACH_TAIL_INSTRUCTION)
  return parts.join('\n\n')
}

/**
 * 输出尾注约定：正文之外追加一行「附件提示」。
 *
 * 这条提示是**纯告知**——插件不做任何文件操作，用户自行用目标页面自带的
 * 上传按钮完成上传。放在尾注而不是让模型写进正文，是为了让正文保持干净：
 * client 会把尾注行剥掉，只把正文交给用户。
 */
export const ATTACH_HINT_MARK = '【附件提示】'

const ATTACH_TAIL_INSTRUCTION =
  '最后，另起一行追加一条附件提示，格式严格为：\n'
  + `${ATTACH_HINT_MARK}<一句话>\n`
  + '这一行**不属于提示词正文**，不要把它写进正文里。规则：\n'
  + '- 只有当这条提示词真要模型看到本机文件才能干好时（例如要求读某个具体文件、'
  + '分析一份数据或日志、按截图/设计稿还原、参照已有代码改）才写，并点明需要什么：'
  + '哪类文件、哪份材料、什么截图或日志。\n'
  + '- 正文里已经点名某个文件路径或附件时，也要写这一行。\n'
  + '- 说的是"可能需要"，不要写成命令式要求，也不要编造用户没提到的文件名。\n'
  + '- 不需要附件时：仍然输出这一行，但内容固定为「本次无需附件」。'
  + '不要用其它措辞表达"不需要"，也不要省略这一行。'

/**
 * 拆出尾注附件提示。
 *
 * 容错：模型可能把标记写成全角/半角括号混排，或忘记换行、与正文粘连，
 * 因此按标记字符串定位（不依赖行首），标记之前的都是正文。
 */
export function splitAttachHint(text: string): { text: string, hint: string } {
  for (const mark of [ATTACH_HINT_MARK, '[[附件提示]]', '[附件提示]', '【附件提示】']) {
    const idx = text.indexOf(mark)
    if (idx < 0) continue
    const hint = text.slice(idx + mark.length).split('\n')[0]?.trim() ?? ''
    return { text: text.slice(0, idx).trim(), hint }
  }
  return { text: text.trim(), hint: '' }
}

/** 该尾注是否表示"确实可能需要附件"（用于决定是否展示提示）。 */
export function attachHintApplies(hint: string): boolean {
  const t = hint.trim()
  if (t.length === 0) return false
  return !/无需|不需要|没有需要|不涉及|无附件|none|not needed/i.test(t)
}

/** 外部回答的入参上限：超长时保留首尾（开头有结论，结尾有落点）。 */
const EXTERNAL_REPLY_LIMIT = 20000

function clampExternalReply(text: string): string {
  const t = text.trim()
  if (t.length <= EXTERNAL_REPLY_LIMIT) return t
  const head = Math.floor(EXTERNAL_REPLY_LIMIT * 0.4)
  return `${t.slice(0, head)}\n\n…（外部回答中段已省略）…\n\n${t.slice(-(EXTERNAL_REPLY_LIMIT - head))}`
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

export function normalizeStyle(style: string | null | undefined): OptimizeStyle {
  return style === 'structured' ? 'structured' : 'preserve'
}

/**
 * 调用 LLM 做一次流式改写 / 提取，onDelta 逐段回调增量文本，返回聚合全文。
 * 供提示词优化与内容二次提取共用（两者只是 system/user 不同）。
 */
export async function streamCompletion(
  llm: LlmLike,
  args: { system: string, user: string, provider?: string, model?: string },
  options: OptimizeOptions,
  onDelta?: (text: string) => void,
): Promise<{ text: string, provider: string, model: string }> {
  const resolved = await resolveModel(llm, { draft: args.user, provider: args.provider, model: args.model }, options.model)
  const message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: args.user }],
    source: { kind: 'user' },
  }
  const stream = llm.stream({
    provider: resolved.provider,
    model: resolved.model,
    messages: [Object.freeze(message)],
    system: args.system,
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

/**
 * 调用 LLM 流式优化提示词；onDelta 逐段回调增量文本，返回聚合全文。
 * phase 决定视角：single（选项一）/ outbound（选项二第一次）/ final（选项二第二次）。
 */
export async function optimizePrompt(
  llm: LlmLike,
  input: OptimizeInput,
  options: OptimizeOptions,
  onDelta?: (text: string) => void,
  phase: OptimizePhase = 'single',
): Promise<{ text: string, provider: string, model: string }> {
  return streamCompletion(llm, {
    system: optimizeSystemPrompt(normalizeStyle(options.style), options.structureHint, phase),
    user: optimizeUserPrompt(input),
    provider: input.provider,
    model: input.model,
  }, options, onDelta)
}

/** 从入参推断轮次：有外部回答即终稿轮。供调用方在未显式传 phase 时兜底。 */
export function inferPhase(input: OptimizeInput): OptimizePhase {
  return input.externalReply && input.externalReply.trim().length > 0 ? 'final' : 'single'
}
