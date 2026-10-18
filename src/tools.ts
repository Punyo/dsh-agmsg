/**
 * Model-facing agmsg tools. Each call acts for the calling session: its
 * project is the session's cwd and its identity is the session's seat.
 */
import type { Bridge } from './bridge.js'
import { projectOf } from './bridge.js'
import type { Agent, ToolDefinition, ToolRunContext } from './host.js'
import { describeSeat, notInstalled, unknownTypeHint } from './text.js'

type Args = Record<string, unknown>

interface Property {
  readonly type: 'string' | 'integer'
  readonly description: string
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

function objectSchema(properties: Record<string, Property>, required: readonly string[]): Record<string, unknown> {
  return { type: 'object', properties, required: [...required], additionalProperties: false }
}

/** Minimal argument check; the registry passes model arguments through as-is. */
function readArgs(raw: unknown, properties: Record<string, Property>, required: readonly string[]): Args {
  const args = (raw ?? {}) as Args
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object')
  for (const key of required) {
    const value = args[key]
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      throw new Error(`missing required argument "${key}"`)
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key]
    if (spec === undefined) throw new Error(`unknown argument "${key}"`)
    if (value === undefined || value === null) continue
    if (spec.type === 'string' && typeof value !== 'string') throw new Error(`"${key}" must be a string`)
    if (spec.type === 'integer' && !Number.isInteger(value)) throw new Error(`"${key}" must be an integer`)
  }
  return args
}

function callerOf(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error('agmsg tools need a calling session')
  return exec.agent
}

function str(args: Args, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function tool(
  bridge: Bridge,
  name: string,
  description: string,
  properties: Record<string, Property>,
  required: readonly string[],
  run: (args: Args, agent: Agent, exec: ToolRunContext) => Promise<string>,
): ToolDefinition {
  return {
    name,
    description,
    parameters: objectSchema(properties, required),
    output: TEXT_OUTPUT,
    timeoutMs: 60_000,
    async execute(raw, exec) {
      if (!bridge.client.installed()) throw new Error(notInstalled(bridge.client.home))
      const args = readArgs(raw, properties, required)
      try {
        return await run(args, callerOf(exec), exec)
      } catch (error) {
        const message = (error as Error).message
        throw new Error(/Unknown agent type/.test(message) ? `${message}\n${unknownTypeHint()}` : message)
      }
    },
  }
}

const TEAM: Property = { type: 'string', description: 'Team name. Optional when this session belongs to exactly one team.' }

export function createTools(bridge: Bridge): ToolDefinition[] {
  return [
    tool(
      bridge,
      'agmsg_status',
      'Show this session\'s agmsg identity (agent name and teams), whether inbound delivery is running, and which teams exist. Call this first when you are unsure whether you have joined a team.',
      {},
      [],
      async (_args, agent) => {
        const seat = bridge.info(agent.session.id)
        const lines = [describeSeat(seat, projectOf(agent))]
        if (seat === undefined) {
          const who = await bridge.client.whoami(projectOf(agent))
          if (who.kind === 'single') lines.push(`This project has a dsh identity "${who.agent}" (${who.teams.join(', ')}); agmsg_join with that name re-attaches it.`)
          if (who.kind === 'multiple' || who.kind === 'suggest') lines.push(`Known dsh identities: ${who.agents.join(', ')}.`)
          const teams = await bridge.client.teams()
          lines.push(`Existing teams: ${teams.length > 0 ? teams.join(', ') : 'none'}.`)
        }
        return lines.join('\n')
      },
    ),
    tool(
      bridge,
      'agmsg_join',
      'Join an agmsg team (created if it does not exist) under an agent name, and start receiving that name\'s messages in this session. Messages from teammates then arrive automatically as user messages prefixed with [agmsg]. Joining again with the same name re-attaches.',
      {
        team: { type: 'string', description: 'Team to join or create.' },
        name: { type: 'string', description: 'This session\'s agent name in the team. Must not collide with another member.' },
      },
      ['team', 'name'],
      async (args, agent) => {
        const output = await bridge.join(agent, str(args, 'team')!, str(args, 'name')!)
        return `${output}\n${describeSeat(bridge.info(agent.session.id), projectOf(agent))}`
      },
    ),
    tool(
      bridge,
      'agmsg_send',
      'Send a message to one teammate over agmsg (Claude Code, Codex, other dsh sessions, ...). Use agmsg_members to see who is in the team. The message is delivered as plain text; keep it self-contained.',
      {
        to: { type: 'string', description: 'Recipient agent name.' },
        message: { type: 'string', description: 'Message body. Multi-line text is fine.' },
        team: TEAM,
      },
      ['to', 'message'],
      async (args, agent) => {
        const { name, team } = bridge.teamFor(agent.session.id, str(args, 'team'))
        return bridge.client.send(team, name, str(args, 'to')!, String(args.message))
      },
    ),
    tool(
      bridge,
      'agmsg_inbox',
      'Read unread agmsg messages for this session\'s identity and mark them read. Inbound messages normally arrive on their own; use this only to check manually.',
      { team: TEAM },
      [],
      async (args, agent) => {
        const seat = bridge.info(agent.session.id)
        if (seat === undefined) throw new Error('this session has not joined an agmsg team; call agmsg_join first')
        const team = str(args, 'team')
        const teams = team === undefined ? seat.teams : [bridge.teamFor(agent.session.id, team).team]
        const parts: string[] = []
        for (const each of teams) parts.push(`[${each}] ${await bridge.client.inbox(each, seat.name)}`)
        return parts.join('\n\n')
      },
    ),
    tool(
      bridge,
      'agmsg_members',
      'List the members of an agmsg team with their agent types and projects.',
      { team: TEAM },
      [],
      async (args, agent) => {
        const { team } = bridge.teamFor(agent.session.id, str(args, 'team'))
        const members = await bridge.client.members(team)
        if (members.length === 0) return `Team ${team} has no members.`
        return [`Team ${team}:`, ...members.map(member =>
          `- ${member.name} (${member.types.join(', ')})${member.project === undefined ? '' : ` — ${member.project}`}`)].join('\n')
      },
    ),
    tool(
      bridge,
      'agmsg_history',
      'Show recent agmsg message history for this session\'s identity in a team (read-only; does not mark anything read).',
      {
        team: TEAM,
        limit: { type: 'integer', description: 'How many recent messages to show (default 20).' },
      },
      [],
      async (args, agent) => {
        const { name, team } = bridge.teamFor(agent.session.id, str(args, 'team'))
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 200) : 20
        return bridge.client.history(team, name, limit)
      },
    ),
  ]
}
