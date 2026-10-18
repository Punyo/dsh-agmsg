import z from '@deepseek-ai/schemastery'

export type Delivery = 'wake' | 'inject' | 'off'

/** Plugin configuration; every key has a default so a bare row works. */
export interface Config {
  /** agmsg install directory. Empty means `~/.agents/skills/agmsg`. */
  agmsgHome?: string
  /** `AGMSG_STORAGE_PATH` override for the agmsg scripts. Empty means unset. */
  storagePath?: string
  /** Re-attach a session whose project already has exactly one dsh identity. */
  autoAttach?: boolean
  /** Join this team on session start (together with `name`). */
  team?: string
  /** Agent name to join `team` as on session start. */
  name?: string
  /**
   * How inbound messages reach the agent: `wake` starts a turn when idle and
   * steers a running turn, `inject` waits for the next step without waking,
   * `off` runs no watcher (use agmsg_inbox manually).
   */
  delivery?: Delivery
  /** Collect messages arriving within this window into one delivery. */
  batchMs?: number
  /** Show a TUI toast for each delivery when dsh-TUI is present. */
  notify?: boolean
  /** Show the session identity in the dsh-TUI status line. */
  statusLine?: boolean
}

export type ResolvedConfig = Required<Config>

// Explicit annotation: the inferred schema type is not portable in
// declaration output. `Schemastery` is schemastery's global interface.
export const Config: Schemastery<Config> = z.object({
  agmsgHome: z.string().default('').description('agmsg install directory; empty means ~/.agents/skills/agmsg.'),
  storagePath: z.string().default('').description('AGMSG_STORAGE_PATH override; empty leaves it unset.'),
  autoAttach: z.boolean().default(true).description('Re-attach a session whose project already has one dsh identity.'),
  team: z.string().default('').description('Team to join on session start (requires name).'),
  name: z.string().default('').description('Agent name to join the team as on session start.'),
  delivery: z.union(['wake', 'inject', 'off']).default('wake').description('Inbound delivery: wake, inject, or off.'),
  batchMs: z.natural().default(400).description('Window (ms) for batching messages into one delivery.'),
  notify: z.boolean().default(true).description('Show a dsh-TUI toast when messages arrive.'),
  statusLine: z.boolean().default(true).description('Show the agmsg identity in the dsh-TUI status line.'),
})

export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    agmsgHome: config.agmsgHome ?? '',
    storagePath: config.storagePath ?? '',
    autoAttach: config.autoAttach ?? true,
    team: config.team ?? '',
    name: config.name ?? '',
    delivery: config.delivery ?? 'wake',
    batchMs: config.batchMs ?? 400,
    notify: config.notify ?? true,
    statusLine: config.statusLine ?? true,
  }
}
