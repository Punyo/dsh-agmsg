/**
 * dsh-agmsg: lets a DeepSeek Harness (dsh / dsh-TUI) session join an agmsg
 * team and exchange messages with Claude Code, Codex and other agents.
 *
 * - model-facing tools `agmsg_status`, `agmsg_join`, `agmsg_send`,
 *   `agmsg_inbox`, `agmsg_members`, `agmsg_history`;
 * - inbound delivery: one agmsg `watch.sh` per joined session, each message
 *   handed to the session's agent (see ./bridge.ts);
 * - the `/agmsg` slash command, a bundled skill, and dsh-TUI toast/status
 *   output when those optional services are present.
 * @module dsh-agmsg
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { formatWithOptions } from 'node:util'
import { AgmsgClient, defaultHome } from './agmsg.js'
import { Bridge } from './bridge.js'
import { createCommand } from './command.js'
import { Config, resolveConfig } from './config.js'
import type { HostContext, Logger } from './host.js'
import { isRootAgent } from './host.js'
import { createTools } from './tools.js'

export { Config }
export type { Delivery } from './config.js'

export const name = 'dsh-agmsg'

export const inject = ['tools', 'agents', 'commands']

const STATUS_KEY = 'agmsg'

const SKILL_PATH = fileURLToPath(new URL('../skills/dsh-agmsg/SKILL.md', import.meta.url))

function registerSkill(ctx: HostContext): void {
  const skills = ctx.get('skills', false)
  if (skills === undefined) return
  try {
    const source = readFileSync(SKILL_PATH, 'utf8')
    const content = source.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
    const description = /^description:\s*(.+)$/m.exec(source)?.[1]?.trim()
      ?? 'Message other agents through an agmsg team with the agmsg_* tools.'
    skills.register({
      name: 'dsh-agmsg',
      description,
      content,
      path: 'skills/dsh-agmsg/SKILL.md',
      source: 'bundled',
      provider: 'dsh-agmsg',
    })
  } catch (error) {
    ctx.logger('agmsg').warn('agmsg: bundled skill not registered: %s', (error as Error).message)
  }
}

/**
 * The plugin's logger. dsh-TUI owns the terminal, so `DSH_AGMSG_DEBUG=<file>`
 * additionally appends every entry to that file for troubleshooting.
 */
function createLogger(ctx: HostContext): Logger {
  const base = ctx.logger('agmsg')
  const file = process.env.DSH_AGMSG_DEBUG
  if (file === undefined || file === '') return base
  const write = (level: string, format: string, args: unknown[]) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level} ${formatWithOptions({ breakLength: Infinity }, format, ...args)}\n`)
    } catch {
      // Debug output must never break the plugin.
    }
  }
  return {
    info: (format, ...args) => { write('info', format, args); base.info(format, ...args) },
    warn: (format, ...args) => { write('warn', format, args); base.warn(format, ...args) },
    error: (format, ...args) => { write('error', format, args); base.error(format, ...args) },
    debug: (format, ...args) => { write('debug', format, args); base.debug(format, ...args) },
  }
}

/**
 * Wire the plugin.
 * @param ctx - cordis context with dsh's tools, agents and commands services.
 * @param config - validated plugin config.
 */
export function apply(ctx: HostContext, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const log = createLogger(ctx)
  const client = new AgmsgClient({
    home: resolved.agmsgHome === '' ? defaultHome() : resolved.agmsgHome,
    storagePath: resolved.storagePath,
  })
  // dsh-TUI admits a status/toast write only from the calling plugin's own
  // activation: it tracks the running activation in AsyncLocalStorage and
  // refuses a write made while another plugin's (or the TUI row's) activation
  // is current, which is the case inside agent events and watcher callbacks.
  // Capture this activation once and make every TUI write from it.
  const inOwnActivation = AsyncLocalStorage.snapshot()
  let statusDispose: (() => void) | undefined
  const bridge = new Bridge(client, resolved, {
    log,
    agent: id => ctx.agents.get(id),
    detached: op => ctx.agents.withoutInitiator(op),
    notify: (text, options) => inOwnActivation(() => {
      ctx.get('tuiToast', false)?.show(text, options)
    }),
    setStatus: text => inOwnActivation(() => {
      const status = ctx.get('tuiStatus', false)
      if (status === undefined) return false
      if (text === undefined) {
        statusDispose?.()
        statusDispose = undefined
        status.set(STATUS_KEY, undefined)
        return true
      }
      statusDispose = status.set(STATUS_KEY, text) ?? statusDispose
      return true
    }),
  })

  // dsh-TUI's status service can come up after this row; publish once it
  // does. A soft inject: without dsh-TUI the callback never runs.
  if (resolved.statusLine) {
    ctx.inject(['tuiStatus'], () => {
      bridge.refreshStatus()
    })
  }

  if (!client.installed()) log.warn('agmsg: no agmsg install at %s; tools will report how to install it', client.home)

  for (const definition of createTools(bridge)) ctx.tools.register(definition)
  ctx.commands.register(createCommand(bridge))
  registerSkill(ctx)

  ctx.on('agent/created', ({ agent }) => {
    void bridge.onAgentCreated(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    bridge.onAgentDisposed(agent)
  })
  // The TUI may have opened its session before this row activated.
  for (const agent of ctx.agents.list()) {
    if (isRootAgent(agent)) void bridge.onAgentCreated(agent)
  }

  ctx.effect(() => () => bridge.dispose(), 'dsh-agmsg bridge')
}
