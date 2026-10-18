// End-to-end checks against real agmsg scripts in a throwaway install.
// The scripts are copied from AGMSG_TEST_SOURCE (default ~/.agents/skills/agmsg)
// into a temp directory, so no real team or message store is touched.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { AgmsgClient } from '../lib/agmsg.js'
import { Bridge } from '../lib/bridge.js'
import { resolveConfig } from '../lib/config.js'

const SOURCE = process.env.AGMSG_TEST_SOURCE ?? join(homedir(), '.agents', 'skills', 'agmsg')
const INSTALLER = fileURLToPath(new URL('../scripts/install-agmsg-type.sh', import.meta.url))
const available = existsSync(join(SOURCE, 'scripts', 'send.sh'))
const skip = available ? false : `no agmsg install at ${SOURCE}`

let root
let home
let project

before(() => {
  if (!available) return
  process.env.AGMSG_WATCH_INTERVAL = '1'
  root = mkdtempSync(join(tmpdir(), 'dsh-agmsg-test-'))
  home = join(root, 'agmsg')
  project = join(root, 'project')
  mkdirSync(project, { recursive: true })
  for (const dir of ['db', 'teams', 'run', 'plugins']) mkdirSync(join(home, dir), { recursive: true })
  cpSync(join(SOURCE, 'scripts'), join(home, 'scripts'), { recursive: true })
  for (const file of ['VERSION', '.agmsg', join('db', 'config.yaml')]) {
    if (existsSync(join(SOURCE, file))) cpSync(join(SOURCE, file), join(home, file))
  }
  execFileSync('bash', [INSTALLER, home], { stdio: 'pipe' })
})

after(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

function fakeAgent(sessionId) {
  const received = []
  return {
    received,
    agent: {
      id: sessionId,
      status: 'idle',
      session: { id: sessionId, header: { cwd: project } },
      followup: message => received.push({ via: 'followup', message }),
      steer: message => received.push({ via: 'steer', message }),
      inject: message => received.push({ via: 'inject', message }),
    },
  }
}

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

async function waitFor(predicate, timeoutMs = 20_000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

test('client joins as a dsh agent and round-trips an exact body', { skip }, async () => {
  const client = new AgmsgClient({ home })
  assert.equal(client.installed(), true)
  assert.match(await client.join('itest', 'alice', project), /Joined team itest as alice/)
  await client.join('itest', 'bob', project)
  const who = await client.whoami(project)
  assert.equal(who.kind, 'multiple')
  assert.deepEqual((await client.identities(project)).map(row => row.agent).sort(), ['alice', 'bob'])

  const body = 'line one | pipe\nline\ttwo \\n literal "quotes" $(not run) `nor this`'
  assert.match(await client.send('itest', 'alice', 'bob', body), /Sent to bob/)
  const stored = (await client.messages('itest', 'bob', 5)).at(-1)
  assert.equal(stored.body, body)
  assert.match(await client.inbox('itest', 'bob'), /1 new message/)
  assert.match(await client.inbox('itest', 'bob'), /No new messages/)
  const members = await client.members('itest')
  assert.deepEqual(members.map(member => member.name).sort(), ['alice', 'bob'])
})

test('bridge streams a message into the session agent with its exact body', { skip }, async () => {
  const client = new AgmsgClient({ home })
  const toasts = []
  const { agent, received } = fakeAgent('01SESSIONBRIDGE')
  const bridge = new Bridge(client, resolveConfig({ batchMs: 100 }), {
    log: silentLogger(),
    agent: () => agent,
    detached: op => op(),
    notify: text => toasts.push(text),
    setStatus: () => true,
  })
  try {
    await client.join('btest', 'carol', project)
    await bridge.join(agent, 'btest', 'dave')
    assert.equal(bridge.info(agent.session.id)?.name, 'dave')
    await waitFor(() => bridge.info(agent.session.id)?.state === 'watching')

    const body = 'please run `npm test`\nthen report back \\n done'
    await client.send('btest', 'carol', 'dave', body)
    await waitFor(() => received.length > 0)

    assert.equal(received[0].via, 'followup')
    const message = received[0].message
    assert.equal(message.role, 'user')
    assert.equal(message.source.kind, 'agmsg')
    assert.match(message.content[0].text, /From carol \(team btest,/)
    assert.ok(message.content[0].text.includes(body), 'exact body is delivered')
    assert.equal(toasts.length, 1)
    assert.equal(bridge.info(agent.session.id)?.delivered, 1)

    // A running agent is steered instead of woken with a new turn.
    agent.status = 'running'
    await client.send('btest', 'carol', 'dave', 'second')
    await waitFor(() => received.length > 1)
    assert.equal(received[1].via, 'steer')

    // Sending as the seat goes through the seat's identity.
    const { name, team } = bridge.teamFor(agent.session.id, undefined)
    assert.deepEqual({ name, team }, { name: 'dave', team: 'btest' })
  } finally {
    bridge.dispose()
  }
  assert.equal(bridge.info(agent.session.id), undefined)
})

test('a second session cannot hold the same identity at once', { skip }, async () => {
  const client = new AgmsgClient({ home })
  const first = fakeAgent('01SESSIONFIRST')
  const second = fakeAgent('01SESSIONSECOND')
  const host = agent => ({
    log: silentLogger(),
    agent: () => agent,
    detached: op => op(),
    notify: () => {},
    setStatus: () => false,
  })
  const a = new Bridge(client, resolveConfig({}), host(first.agent))
  const b = new Bridge(client, resolveConfig({}), host(second.agent))
  try {
    await a.join(first.agent, 'ltest', 'erin')
    await waitFor(() => a.info(first.agent.session.id)?.state === 'watching')
    await b.attachExisting(second.agent, 'erin')
    await waitFor(() => ['retrying', 'failed'].includes(b.info(second.agent.session.id)?.state))
    assert.equal(a.info(first.agent.session.id)?.state, 'watching')
  } finally {
    a.dispose()
    b.dispose()
  }
})
