/** dsh-webrelay —— 跨模块共享的最小结构面（运行时经 ctx.get 懒取，仅类型，不打进 bundle）。 */

/** sessionQuery 的最小接口（与 GreaterClarity 同款结构化依赖）。 */
export interface SessionQueryLike {
  readSession(id: string): Promise<{ session: { id: string, createdAt: number, cwd?: string }, events: unknown[] }>
  readTitle?(id: string): Promise<{ title: string } | undefined>
}
