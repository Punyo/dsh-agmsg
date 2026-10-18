/** The `/agmsg` slash command: the person's direct control surface. */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Bridge } from './bridge.js'
import { projectOf } from './bridge.js'
import type { CommandDefinition, CommandResult } from './host.js'
import { describeSeat, notInstalled, unknownTypeHint } from './text.js'

const INSTALLER = fileURLToPath(new URL('../scripts/install-agmsg-type.sh', import.meta.url))

const USAGE = [
  '/agmsg                       show this session\'s identity and delivery state',
  '/agmsg setup                 register the dsh agent type with agmsg (once per agmsg install)',
  '/agmsg join <team> <name>    join or create a team as <name> and start receiving',
  '/agmsg attach [name]         re-attach this project\'s dsh identity / restart delivery',
  '/agmsg detach                stop receiving in this session (membership stays)',
  '/agmsg send <to> <message>   send a message (use <team>:<to> to pick a team)',
  '/agmsg inbox                 read and mark unread messages',
  '/agmsg members [team]        list team members',
  '/agmsg history [limit]       recent history',
  '/agmsg leave [team]          leave a team (removes this agent name from it)',
].join('\n')

function ok(text: string): CommandResult {
  return { kind: 'success', text }
}

function fail(text: string): CommandResult {
  return { kind: 'error', text }
}

function runInstaller(home: string): Promise<{ code: number, output: string }> {
  return new Promise((resolve) => {
    execFile('bash', [INSTALLER, home], { encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ code, output: `${stdout}${stderr}`.trim() })
    })
  })
}

export function createCommand(bridge: Bridge): CommandDefinition {
  return {
    name: 'agmsg',
    description: 'agmsg team messaging: status, setup, join, send, inbox, members, history',
    input: { hint: '[status|setup|join <team> <name>|attach|detach|send <to> <message>|inbox|members|history|leave|help]' },
    async handler({ agent, rawInput }) {
      const input = rawInput.trim()
      const space = input.search(/\s/)
      const sub = (space < 0 ? input : input.slice(0, space)).toLowerCase()
      const rest = space < 0 ? '' : input.slice(space).trim()
      const words = rest === '' ? [] : rest.split(/\s+/)
      const sessionId = agent.session.id
      const client = bridge.client

      if (sub === 'help') return ok(USAGE)
      if (sub === 'setup') {
        if (!client.installed()) return fail(notInstalled(client.home))
        const result = await runInstaller(client.home)
        return result.code === 0 ? ok(result.output) : fail(result.output)
      }
      if (!client.installed()) return fail(notInstalled(client.home))

      try {
        switch (sub) {
          case '':
          case 'status':
            return ok(describeSeat(bridge.info(sessionId), projectOf(agent)))
          case 'join': {
            if (words.length !== 2) return fail('usage: /agmsg join <team> <name>')
            const output = await bridge.join(agent, words[0]!, words[1]!)
            return ok(`${output}\n${describeSeat(bridge.info(sessionId), projectOf(agent))}`)
          }
          case 'attach': {
            const seat = bridge.info(sessionId)
            if (seat !== undefined && (words[0] === undefined || words[0] === seat.name)) {
              bridge.restart(sessionId)
              return ok(`Restarted delivery for ${seat.name}.`)
            }
            const result = await bridge.attachExisting(agent, words[0])
            return result.attached === undefined
              ? fail(`${result.reason}. Use /agmsg join <team> <name>.`)
              : ok(describeSeat(bridge.info(sessionId), projectOf(agent)))
          }
          case 'detach':
            return bridge.detach(sessionId) ? ok('Stopped agmsg delivery for this session.') : fail('This session is not attached.')
          case 'send': {
            if (words.length < 2) return fail('usage: /agmsg send <to> <message>')
            const target = words[0]!
            const body = rest.slice(rest.indexOf(target) + target.length).trim()
            const colon = target.indexOf(':')
            const to = colon < 0 ? target : target.slice(colon + 1)
            const { name, team } = bridge.teamFor(sessionId, colon < 0 ? undefined : target.slice(0, colon))
            return ok(await client.send(team, name, to, body))
          }
          case 'inbox': {
            const seat = bridge.info(sessionId)
            if (seat === undefined) return fail('This session has not joined a team. Use /agmsg join <team> <name>.')
            const parts: string[] = []
            for (const team of seat.teams) parts.push(`[${team}] ${await client.inbox(team, seat.name)}`)
            return ok(parts.join('\n\n'))
          }
          case 'members': {
            const { team } = bridge.teamFor(sessionId, words[0])
            const members = await client.members(team)
            return ok([`Team ${team}:`, ...members.map(member => `- ${member.name} (${member.types.join(', ')})`)].join('\n'))
          }
          case 'history': {
            const seat = bridge.info(sessionId)
            if (seat === undefined) return fail('This session has not joined a team.')
            const limit = Number.parseInt(words[0] ?? '20', 10)
            const parts: string[] = []
            for (const team of seat.teams) parts.push(await client.history(team, seat.name, Number.isFinite(limit) && limit > 0 ? limit : 20))
            return ok(parts.join('\n\n'))
          }
          case 'leave': {
            const { name, team } = bridge.teamFor(sessionId, words[0])
            const output = await client.leave(team, name)
            const seat = bridge.info(sessionId)
            if (seat !== undefined && seat.teams.length <= 1) bridge.detach(sessionId)
            else if (seat !== undefined) await bridge.attachExisting(agent, name)
            return ok(output)
          }
          default:
            return fail(`unknown subcommand "${sub}"\n${USAGE}`)
        }
      } catch (error) {
        const message = (error as Error).message
        return fail(/Unknown agent type/.test(message) ? `${message}\n${unknownTypeHint()}` : message)
      }
    },
  }
}
