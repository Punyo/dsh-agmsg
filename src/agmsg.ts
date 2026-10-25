/**
 * Thin client over agmsg's public bash scripts.
 *
 * agmsg's contract is "read through api.sh, write through send.sh/join.sh/
 * leave.sh"; the database is never opened here. Every script runs through
 * `execFile` with an argv array, and message bodies travel on stdin
 * (`send.sh --body -`), so no text ever crosses a shell.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The agmsg agent type a dsh session registers as. */
export const AGENT_TYPE = 'dsh'

export interface ClientOptions {
  /** agmsg install directory (the one holding `scripts/`). */
  readonly home: string
  /** Optional `AGMSG_STORAGE_PATH` override. */
  readonly storagePath?: string
  /** Per-call timeout for one-shot scripts. */
  readonly timeoutMs?: number
}

export interface ScriptResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export class AgmsgError extends Error {
  constructor(message: string, readonly result?: ScriptResult) {
    super(message)
    this.name = 'AgmsgError'
  }
}

/** Parsed `whoami.sh` answer. */
export type Whoami =
  | { readonly kind: 'single', readonly agent: string, readonly teams: string[] }
  | { readonly kind: 'multiple', readonly agents: string[], readonly teams: string[] }
  | { readonly kind: 'suggest', readonly agents: string[], readonly teams: string[], readonly availableTeams: string[] }
  | { readonly kind: 'not-joined', readonly availableTeams: string[] }

export interface StoredMessage {
  readonly id: string
  readonly team: string
  readonly from: string
  readonly to: string
  readonly body: string
  readonly at: string
}

export interface Member {
  readonly name: string
  readonly types: string[]
  readonly project?: string
}

export function defaultHome(): string {
  return join(homedir(), '.agents', 'skills', 'agmsg')
}

/** Expand a leading `~/` the way a person writes it in YAML. */
export function expandHome(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

function splitList(value: string | undefined): string[] {
  if (value === undefined || value === '' || value === 'none') return []
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

/** Parse the single `key=value ...` line `whoami.sh` prints. */
export function parseWhoami(output: string): Whoami {
  const line = output.trim().split('\n').pop() ?? ''
  const fields = new Map<string, string>()
  for (const match of line.matchAll(/(\w+)=(\S*)/g)) fields.set(match[1]!, match[2]!)
  if (fields.get('not_joined') === 'true') {
    return { kind: 'not-joined', availableTeams: splitList(fields.get('available_teams')) }
  }
  if (fields.get('multiple') === 'true') {
    return { kind: 'multiple', agents: splitList(fields.get('agents')), teams: splitList(fields.get('teams')) }
  }
  if (fields.get('suggest') === 'true') {
    return {
      kind: 'suggest',
      agents: splitList(fields.get('agents')),
      teams: splitList(fields.get('teams')),
      availableTeams: splitList(fields.get('available_teams')),
    }
  }
  const agent = fields.get('agent')
  if (agent === undefined || agent === '') throw new AgmsgError(`unexpected whoami output: ${line}`)
  return { kind: 'single', agent, teams: splitList(fields.get('teams')) }
}

/** Parse `api.sh` JSONL output, skipping anything that is not a JSON object. */
export function parseJsonl<T>(output: string): T[] {
  const rows: T[] = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      rows.push(JSON.parse(trimmed) as T)
    } catch {
      // A partial or diagnostic line; api.sh rows are one object per line.
    }
  }
  return rows
}

export class AgmsgClient {
  readonly home: string
  readonly scripts: string
  private readonly storagePath: string | undefined
  private readonly timeoutMs: number

  constructor(options: ClientOptions) {
    this.home = expandHome(options.home)
    this.scripts = join(this.home, 'scripts')
    this.storagePath = options.storagePath === undefined || options.storagePath === ''
      ? undefined
      : expandHome(options.storagePath)
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /** Whether the configured directory looks like an agmsg install. */
  installed(): boolean {
    return existsSync(join(this.scripts, 'send.sh'))
  }

  /**
   * Environment for every script call. `AGMSG_SELF_NAME=off` keeps agmsg from
   * naming or typing into the terminal pane the TUI is drawing in;
   * `AGMSG_AGENT_PID` ties instance ids and actas locks to this dsh process
   * instead of whatever agent CLI happens to be an ancestor; the project path
   * is the session's cwd, used verbatim.
   */
  env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGMSG_SELF_NAME: 'off',
      AGMSG_AGENT_PID: String(process.pid),
      AGMSG_RESOLVE_PROJECT: '0',
    }
    if (this.storagePath !== undefined) env.AGMSG_STORAGE_PATH = this.storagePath
    return env
  }

  /** Run one script to completion. Never rejects; inspect `code`. */
  run(script: string, args: readonly string[], options: { input?: string, signal?: AbortSignal } = {}): Promise<ScriptResult> {
    return this.exec([join(this.scripts, script), ...args], options)
  }

  /** Run a bash snippet with `$1..` bound to `args`. */
  private bash(code: string, args: readonly string[]): Promise<ScriptResult> {
    return this.exec(['-c', code, 'agmsg', ...args])
  }

  private exec(argv: readonly string[], options: { input?: string, signal?: AbortSignal } = {}): Promise<ScriptResult> {
    return new Promise((resolve) => {
      const child = execFile('bash', [...argv], {
        env: this.env(),
        timeout: this.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        signal: options.signal,
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout, stderr: stderr || (error !== null && typeof error.code !== 'number' ? error.message : '') })
      })
      if (options.input !== undefined) child.stdin?.end(options.input)
      else child.stdin?.end()
    })
  }

  private async ok(script: string, args: readonly string[], options: { input?: string, signal?: AbortSignal } = {}): Promise<string> {
    const result = await this.run(script, args, options)
    if (result.code !== 0) {
      const detail = (result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`).split('\n').slice(-3).join(' ')
      throw new AgmsgError(`${script} failed: ${detail}`, result)
    }
    return result.stdout
  }

  async whoami(project: string): Promise<Whoami> {
    return parseWhoami(await this.ok('whoami.sh', [project, AGENT_TYPE]))
  }

  /** Every (team, agent) registered for this project as a dsh agent. */
  async identities(project: string): Promise<Array<{ team: string, agent: string }>> {
    const output = await this.ok('identities.sh', [project, AGENT_TYPE])
    return output.split('\n')
      .map(line => line.split('\t'))
      .filter((cells): cells is [string, string] => cells.length >= 2 && cells[0]!.trim() !== '' && cells[1]!.trim() !== '')
      .map(([team, agent]) => ({ team: team.trim(), agent: agent.trim() }))
  }

  async join(team: string, name: string, project: string): Promise<string> {
    return (await this.ok('join.sh', [team, name, AGENT_TYPE, project])).trim()
  }

  async leave(team: string, name: string): Promise<string> {
    return (await this.ok('leave.sh', [team, name])).trim()
  }

  /** Remove only this (project, dsh) registration of `name`. */
  async reset(project: string, name: string, sessionId: string): Promise<string> {
    return (await this.ok('reset.sh', [project, AGENT_TYPE, name, sessionId])).trim()
  }

  /**
   * Hand this instance's actas claims on the given roles back to the pool.
   *
   * `watch.sh` claims a per-(team, agent) lock when it starts and does not
   * release one when it exits. The claim names `<sid>.<pid>`, and the pid is
   * this dsh process, which outlives every watcher: without an explicit
   * release the role reads as "held by another session" for as long as dsh
   * runs, and no peer can claim it. Release is owner-checked inside agmsg, so
   * a pair this instance does not own is left exactly as found.
   */
  async releaseRoles(token: string, pairs: ReadonlyArray<{ team: string, agent: string }>): Promise<void> {
    if (pairs.length === 0) return
    const code = 'SKILL_DIR="$1"; token="$2"; shift 2; . "$SKILL_DIR/scripts/lib/actas-lock.sh"; '
      + 'while [ "$#" -ge 2 ]; do actas_lock_release "$1" "$2" "$token" || true; shift 2; done'
    const result = await this.bash(code, [this.home, token, ...pairs.flatMap(pair => [pair.team, pair.agent])])
    if (result.code !== 0) {
      const detail = (result.stderr.trim() || `exit ${result.code}`).split('\n').slice(-3).join(' ')
      throw new AgmsgError(`actas lock release failed: ${detail}`, result)
    }
  }

  async send(team: string, from: string, to: string, body: string): Promise<string> {
    if (body.trim() === '') throw new AgmsgError('message body is empty')
    return (await this.ok('send.sh', [team, from, to, '--body', '-'], { input: body })).trim()
  }

  /** `inbox.sh` output; it marks the shown messages read. */
  async inbox(team: string, name: string): Promise<string> {
    return (await this.ok('inbox.sh', [team, name])).trim()
  }

  async history(team: string, name: string, limit: number): Promise<string> {
    return (await this.ok('history.sh', [team, name, String(limit)])).trim()
  }

  async members(team: string): Promise<Member[]> {
    return parseJsonl<Member>(await this.ok('api.sh', ['get', 'teams', team, 'members']))
  }

  async teams(): Promise<string[]> {
    return parseJsonl<{ name: string }>(await this.ok('api.sh', ['get', 'teams'])).map(row => row.name)
  }

  /** Most recent messages to or from `name`, oldest first, with exact bodies. */
  async messages(team: string, name: string, limit: number): Promise<StoredMessage[]> {
    return parseJsonl<StoredMessage & { type?: string }>(
      await this.ok('api.sh', ['get', 'teams', team, 'messages', '--agent', name, '--limit', String(limit)]),
    ).filter(row => row.type === undefined || row.type === 'message_sent')
  }

  /**
   * Start `watch.sh` for one seat. `token` is the instance id `<sid>.<pid>`
   * that the watcher claims its roles under, and that `releaseRoles` later
   * matches; the bridge computes it once so both sides agree.
   */
  watch(token: string, project: string, name: string): ChildProcess {
    return spawn('bash', [join(this.scripts, 'watch.sh'), token, project, AGENT_TYPE, name], {
      env: this.env(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
}
