/**
 * Structural views of the dsh and dsh-TUI services this plugin touches.
 *
 * The plugin imports nothing from dsh at runtime: a profile may resolve the
 * plugin from a linked checkout whose node_modules has no dsh packages, and
 * every optional seam is probed with `ctx.get(name, false)`. These shapes
 * mirror the installed 0.2.0-rc API (dsh-agent, dsh-tools, dsh-commands,
 * dsh-skill, dsh-tui toast/status) closely enough for the calls made here.
 */

export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

export interface MessageSource {
  readonly kind: string
  readonly form?: 'notice' | 'snapshot' | 'relay'
  readonly summary?: string
  readonly [key: string]: unknown
}

export interface UserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly TextBlock[]
  readonly source: MessageSource
}

export interface SessionHeader {
  readonly cwd?: string
  readonly parentSession?: string
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
}

export interface Session {
  readonly id: string
  readonly header: SessionHeader
}

export interface Agent {
  readonly id: string
  readonly session: Session
  readonly status: 'idle' | 'running'
  followup(message: UserMessage): void
  steer(message: UserMessage): void
  inject(message: UserMessage): void
}

export interface AgentRuntime {
  get(id: string): Agent | undefined
  list(): Iterable<Agent>
  withoutInitiator<T>(op: () => T): T
}

export interface ToolRunContext {
  readonly callId: string
  readonly agent?: Agent
  readonly signal: AbortSignal
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): TextBlock[]
  }
  readonly timeoutMs?: number
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}

export interface ToolRuntime {
  register(definition: ToolDefinition): () => void
}

export interface CommandInvocation {
  readonly agent: Agent
  readonly rawInput: string
  readonly signal: AbortSignal
}

export type CommandResult =
  | { readonly kind: 'success', readonly text?: string }
  | { readonly kind: 'error', readonly text: string }

export interface CommandDefinition {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
  handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult>
}

export interface CommandRuntime {
  register(definition: CommandDefinition): () => void
}

export interface SkillRegistry {
  register(skill: {
    readonly name: string
    readonly description: string
    readonly content: string
    readonly path?: string
    readonly source: string
    readonly provider?: string
    readonly whenToUse?: string
  }): () => void
}

export interface TuiToast {
  show(text: string, options?: { color?: 'success' | 'warning' | 'error', timeoutMs?: number }): boolean
}

export interface TuiStatus {
  set(key: string, text: string | undefined): (() => void) | undefined
}

export interface Logger {
  info(format: string, ...args: unknown[]): void
  warn(format: string, ...args: unknown[]): void
  error(format: string, ...args: unknown[]): void
  debug(format: string, ...args: unknown[]): void
}

export interface AgentCreatedEvent {
  readonly agent: Agent
}

export interface AgentDisposedEvent {
  readonly agent: Agent
}

/** The subset of a cordis Context used by this plugin. */
export interface HostContext {
  readonly tools: ToolRuntime
  readonly agents: AgentRuntime
  readonly commands: CommandRuntime
  logger(name: string): Logger
  get(name: 'skills', strict: false): SkillRegistry | undefined
  get(name: 'tuiToast', strict: false): TuiToast | undefined
  get(name: 'tuiStatus', strict: false): TuiStatus | undefined
  on(event: 'agent/created', listener: (event: AgentCreatedEvent) => unknown): () => void
  on(event: 'agent/disposed', listener: (event: AgentDisposedEvent) => unknown): () => void
  effect(factory: () => () => void, label?: string): void
}

/** True for a top-level session; subagent children never hold a seat. */
export function isRootAgent(agent: Agent): boolean {
  const header = agent.session.header
  return header.origin !== 'subagent'
    && header.parentSession === undefined
    && (header.delegationDepth ?? 0) === 0
}
