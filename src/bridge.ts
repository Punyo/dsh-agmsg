/**
 * Seats: the link between one live dsh session and its agmsg identity.
 *
 * A seat owns one `watch.sh` child. Every message line the watcher prints is
 * batched, its exact body recovered through `api.sh`, and the batch handed to
 * the session's agent as one user message: `followup` when the agent is idle
 * (starts a turn), `steer` while it runs (joins the current turn), or
 * `inject` when configured not to wake it. The watcher advances agmsg's read
 * cursor, so a delivered message is not delivered again elsewhere.
 */
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { AgmsgClient, type StoredMessage } from './agmsg.js'
import type { ResolvedConfig } from './config.js'
import { formatDelivery, preview, type InboundMessage } from './format.js'
import { isRootAgent, type Agent, type Logger, type TuiStatus, type TuiToast, type UserMessage } from './host.js'
import { escapeBody, LineSplitter, parseWatchLine, unescapeBody, type WatchMessage } from './watch-line.js'

export type WatchState = 'off' | 'starting' | 'watching' | 'retrying' | 'failed' | 'stopped'

export interface SeatInfo {
  readonly sessionId: string
  readonly project: string
  readonly name: string
  readonly teams: readonly string[]
  readonly state: WatchState
  readonly detail?: string
  readonly delivered: number
}

interface Seat {
  readonly sessionId: string
  readonly project: string
  agent: Agent
  name: string
  teams: string[]
  state: WatchState
  detail?: string
  watcher?: ChildProcess
  pending: WatchMessage[]
  flushTimer?: NodeJS.Timeout
  retryTimer?: NodeJS.Timeout
  healthyTimer?: NodeJS.Timeout
  chain: Promise<void>
  failures: number
  delivered: number
}

export interface BridgeHost {
  readonly log: Logger
  /** The live agent currently bound to a session id, if any. */
  agent(sessionId: string): Agent | undefined
  /** Run outside any tool-call initiator, as dsh's own timers do. */
  detached<T>(op: () => T): T
  toast(): TuiToast | undefined
  status(): TuiStatus | undefined
}

/** Watcher restarts before a seat is marked failed. */
const MAX_FAILURES = 6
/** A watcher alive this long is considered healthy. */
const HEALTHY_AFTER_MS = 2_000
const STATUS_KEY = 'agmsg'

export function projectOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

function userMessage(text: string, summary: string): UserMessage {
  return Object.freeze({
    id: randomUUID(),
    role: 'user' as const,
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
    source: Object.freeze({
      kind: 'agmsg',
      form: 'notice' as const,
      summary: summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`,
    }),
  })
}

export class Bridge {
  private readonly seats = new Map<string, Seat>()
  private statusDispose: (() => void) | undefined
  private disposed = false

  constructor(
    readonly client: AgmsgClient,
    readonly config: ResolvedConfig,
    private readonly host: BridgeHost,
  ) {}

  info(sessionId: string): SeatInfo | undefined {
    const seat = this.seats.get(sessionId)
    if (seat === undefined) return undefined
    return {
      sessionId: seat.sessionId,
      project: seat.project,
      name: seat.name,
      teams: [...seat.teams],
      state: seat.state,
      ...seat.detail === undefined ? {} : { detail: seat.detail },
      delivered: seat.delivered,
    }
  }

  /** Resolve which team a send targets for this seat. */
  teamFor(sessionId: string, team: string | undefined): { name: string, team: string } {
    const seat = this.seats.get(sessionId)
    if (seat === undefined) {
      throw new Error('this session has not joined an agmsg team; call agmsg_join (or run /agmsg join <team> <name>) first')
    }
    if (team !== undefined && team !== '') {
      if (!seat.teams.includes(team)) {
        throw new Error(`${seat.name} is not a member of team "${team}" (teams: ${seat.teams.join(', ') || 'none'})`)
      }
      return { name: seat.name, team }
    }
    if (seat.teams.length === 1) return { name: seat.name, team: seat.teams[0]! }
    throw new Error(`${seat.name} belongs to several teams (${seat.teams.join(', ')}); pass team explicitly`)
  }

  /** A new agent appeared: rebind an existing seat or attach one if configured. */
  async onAgentCreated(agent: Agent): Promise<void> {
    if (this.disposed || !isRootAgent(agent)) return
    const existing = this.seats.get(agent.session.id)
    if (existing !== undefined) {
      existing.agent = agent
      return
    }
    if (!this.client.installed()) return
    const { team, name, autoAttach } = this.config
    try {
      if (team !== '' && name !== '') {
        await this.join(agent, team, name)
        return
      }
      if (autoAttach) await this.attachExisting(agent)
    } catch (error) {
      this.host.log.warn('agmsg: could not attach session %s: %s', agent.session.id, (error as Error).message)
    }
  }

  /**
   * An agent went away. A session that continues under a new agent (compaction,
   * clear) keeps its seat; a session that ended releases it.
   */
  onAgentDisposed(agent: Agent): void {
    const seat = this.seats.get(agent.session.id)
    if (seat === undefined || seat.agent !== agent) return
    setTimeout(() => {
      const live = this.host.agent(seat.sessionId)
      if (live !== undefined && live !== agent) seat.agent = live
      else if (seat.agent === agent) this.detach(seat.sessionId)
    }, 0)
  }

  /**
   * Attach the identity this project already has, when it is unambiguous.
   * @returns the attached name, or a reason nothing was attached.
   */
  async attachExisting(agent: Agent, name?: string): Promise<{ attached?: string, reason?: string }> {
    const project = projectOf(agent)
    const identities = await this.client.identities(project)
    const names = [...new Set(identities.map(row => row.agent))]
    const chosen = name !== undefined && name !== '' ? name : names.length === 1 ? names[0] : undefined
    if (chosen === undefined) {
      return {
        reason: names.length === 0
          ? `no dsh identity is registered for ${project}`
          : `several dsh identities are registered for ${project} (${names.join(', ')}); pick one`,
      }
    }
    const teams = identities.filter(row => row.agent === chosen).map(row => row.team)
    if (teams.length === 0) return { reason: `${chosen} is not registered as a dsh agent for ${project}` }
    this.bind(agent, chosen, teams)
    return { attached: chosen }
  }

  /** Join (or re-join) a team as `name` and attach this session to it. */
  async join(agent: Agent, team: string, name: string): Promise<string> {
    const project = projectOf(agent)
    const output = await this.client.join(team, name, project)
    const identities = await this.client.identities(project)
    const teams = identities.filter(row => row.agent === name).map(row => row.team)
    this.bind(agent, name, teams.length > 0 ? teams : [team])
    return output
  }

  /** Stop delivery for a session and forget its seat (registration stays). */
  detach(sessionId: string): boolean {
    const seat = this.seats.get(sessionId)
    if (seat === undefined) return false
    this.seats.delete(sessionId)
    this.stopWatcher(seat)
    seat.state = 'stopped'
    clearTimeout(seat.flushTimer)
    this.updateStatus()
    return true
  }

  /** Restart a seat's watcher, e.g. after a failure was fixed. */
  restart(sessionId: string): boolean {
    const seat = this.seats.get(sessionId)
    if (seat === undefined) return false
    seat.failures = 0
    this.stopWatcher(seat)
    this.startWatcher(seat)
    return true
  }

  dispose(): void {
    this.disposed = true
    for (const sessionId of [...this.seats.keys()]) this.detach(sessionId)
    this.statusDispose?.()
    this.statusDispose = undefined
  }

  private bind(agent: Agent, name: string, teams: string[]): void {
    const sessionId = agent.session.id
    const existing = this.seats.get(sessionId)
    if (existing !== undefined && existing.name === name) {
      existing.agent = agent
      existing.teams = teams
      // watch.sh resolves its subscriptions at start; pick up a new team.
      this.restart(sessionId)
      this.updateStatus()
      return
    }
    if (existing !== undefined) this.detach(sessionId)
    const seat: Seat = {
      sessionId,
      project: projectOf(agent),
      agent,
      name,
      teams,
      state: 'off',
      pending: [],
      chain: Promise.resolve(),
      failures: 0,
      delivered: 0,
    }
    this.seats.set(sessionId, seat)
    if (this.config.delivery !== 'off') this.startWatcher(seat)
    this.updateStatus()
    this.host.log.info('agmsg: session %s attached as %s (%s)', sessionId, name, teams.join(', '))
  }

  /**
   * Start the seat's watcher outside any tool-call initiator, so the child's
   * callbacks and timers do not inherit the agent that happened to join.
   */
  private startWatcher(seat: Seat): void {
    this.host.detached(() => this.spawnWatcher(seat))
  }

  private spawnWatcher(seat: Seat): void {
    if (this.disposed || this.seats.get(seat.sessionId) !== seat) return
    clearTimeout(seat.retryTimer)
    const key = `dsh-${seat.sessionId.replace(/[^A-Za-z0-9_-]/g, '')}`
    const child = this.client.watch(key, seat.project, seat.name)
    seat.watcher = child
    seat.state = 'starting'
    const stdout = new LineSplitter()
    const stderr = new LineSplitter()
    const startedAt = Date.now()
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      for (const line of stdout.push(chunk)) this.onLine(seat, line)
    })
    child.stderr?.on('data', (chunk: string) => {
      for (const line of stderr.push(chunk)) this.onStderr(seat, line)
    })
    child.on('error', (error) => {
      seat.detail = error.message
      this.host.log.warn('agmsg: watcher for %s failed to start: %s', seat.name, error.message)
    })
    child.on('exit', (code, signal) => {
      for (const line of stdout.flush()) this.onLine(seat, line)
      for (const line of stderr.flush()) this.onStderr(seat, line)
      this.onWatcherExit(seat, child, code, signal, startedAt)
    })
    seat.healthyTimer = setTimeout(() => {
      if (seat.watcher !== child || child.exitCode !== null) return
      seat.state = 'watching'
      this.updateStatus()
    }, HEALTHY_AFTER_MS)
    this.updateStatus()
  }

  private stopWatcher(seat: Seat): void {
    clearTimeout(seat.retryTimer)
    clearTimeout(seat.healthyTimer)
    const child = seat.watcher
    seat.watcher = undefined
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }

  private onLine(seat: Seat, line: string): void {
    const parsed = parseWatchLine(line)
    if (parsed === undefined) return
    if (parsed.kind === 'diagnostic') {
      seat.detail = parsed.text
      this.host.log.info('agmsg watch (%s): %s', seat.name, parsed.text)
      return
    }
    seat.pending.push(parsed)
    if (seat.flushTimer === undefined) {
      seat.flushTimer = setTimeout(() => {
        seat.flushTimer = undefined
        seat.chain = seat.chain.then(() => this.flush(seat)).catch((error: unknown) => {
          this.host.log.error('agmsg: delivery to %s failed: %s', seat.name, (error as Error).message)
        })
      }, this.config.batchMs)
    }
  }

  private onStderr(seat: Seat, line: string): void {
    const text = line.trim()
    if (text === '') return
    if (/held|lock|error|cannot|failed/i.test(text)) seat.detail = text
    this.host.log.debug('agmsg watch stderr (%s): %s', seat.name, text)
  }

  private onWatcherExit(seat: Seat, child: ChildProcess, code: number | null, signal: NodeJS.Signals | null, startedAt: number): void {
    clearTimeout(seat.healthyTimer)
    if (seat.watcher !== child) return
    seat.watcher = undefined
    if (this.disposed || this.seats.get(seat.sessionId) !== seat) return
    if (Date.now() - startedAt > 60_000) seat.failures = 0
    seat.failures += 1
    const why = signal !== null ? `signal ${signal}` : `exit ${code}`
    if (seat.failures > MAX_FAILURES) {
      seat.state = 'failed'
      seat.detail = `watcher stopped (${why})${seat.detail === undefined ? '' : `: ${seat.detail}`}`
      this.host.log.warn('agmsg: giving up on the watcher for %s: %s', seat.name, seat.detail)
      this.host.toast()?.show(`agmsg: delivery for ${seat.name} stopped (${why}); /agmsg attach retries`, { color: 'warning' })
      this.updateStatus()
      return
    }
    const delay = Math.min(30_000, 1_000 * 2 ** (seat.failures - 1))
    seat.state = 'retrying'
    this.host.log.info('agmsg: watcher for %s ended (%s); restarting in %dms', seat.name, why, delay)
    seat.retryTimer = setTimeout(() => this.startWatcher(seat), delay)
    this.updateStatus()
  }

  private async flush(seat: Seat): Promise<void> {
    const batch = seat.pending.splice(0)
    if (batch.length === 0) return
    const messages = await this.resolveBodies(seat, batch)
    const agent = this.host.agent(seat.sessionId) ?? seat.agent
    const first = messages[0]!
    const senders = [...new Set(messages.map(message => message.from))]
    const summary = messages.length === 1
      ? `agmsg: message from ${first.from}`
      : `agmsg: ${messages.length} messages from ${senders.join(', ')}`
    const message = userMessage(formatDelivery(messages), summary)
    this.host.detached(() => {
      if (this.config.delivery === 'inject') agent.inject(message)
      else if (agent.status === 'idle') agent.followup(message)
      else agent.steer(message)
    })
    seat.delivered += messages.length
    this.host.log.info('agmsg: delivered %d message(s) to %s', messages.length, seat.name)
    if (this.config.notify) {
      const text = messages.length === 1
        ? `agmsg ${first.from} → ${first.to}: ${preview(first.body)}`
        : `agmsg: ${messages.length} messages from ${senders.join(', ')}`
      this.host.toast()?.show(text, { timeoutMs: 6_000 })
    }
    this.updateStatus()
  }

  /** Swap each escaped watch body for the stored original when it can be matched. */
  private async resolveBodies(seat: Seat, batch: readonly WatchMessage[]): Promise<InboundMessage[]> {
    const byTeam = new Map<string, StoredMessage[]>()
    for (const team of new Set(batch.map(message => message.team))) {
      const count = batch.filter(message => message.team === team).length
      try {
        byTeam.set(team, await this.client.messages(team, seat.name, Math.max(20, count * 3)))
      } catch (error) {
        this.host.log.warn('agmsg: could not read exact bodies for %s: %s', team, (error as Error).message)
      }
    }
    const used = new Set<string>()
    return batch.map((line) => {
      const stored = byTeam.get(line.team)?.find(row =>
        !used.has(row.id)
        && row.to === line.to
        && row.from === line.from
        && row.at === line.at
        && escapeBody(row.body) === line.escaped)
      if (stored !== undefined) used.add(stored.id)
      return {
        ...stored === undefined ? {} : { id: stored.id },
        team: line.team,
        from: line.from,
        to: line.to,
        at: line.at,
        body: stored?.body ?? unescapeBody(line.escaped),
      }
    })
  }

  private updateStatus(): void {
    if (!this.config.statusLine) return
    const status = this.host.status()
    if (status === undefined) return
    const seat = [...this.seats.values()].at(-1)
    if (seat === undefined) {
      this.statusDispose?.()
      this.statusDispose = undefined
      status.set(STATUS_KEY, undefined)
      return
    }
    const state = seat.state === 'watching' || seat.state === 'off' ? '' : ` (${seat.state})`
    this.statusDispose = status.set(STATUS_KEY, `agmsg ${seat.name}@${seat.teams.join(',')}${state}`) ?? this.statusDispose
  }
}
