import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseJsonl, parseWhoami } from '../lib/agmsg.js'
import { deliveryMessage } from '../lib/bridge.js'
import { oneLine, seatLine } from '../lib/text.js'
import { formatDelivery, preview } from '../lib/format.js'
import { escapeBody, LineSplitter, parseWatchLine, unescapeBody } from '../lib/watch-line.js'

test('parseWhoami reads every whoami.sh answer shape', () => {
  assert.deepEqual(parseWhoami('agent=bob teams=a,b type=dsh project=/p\n'), { kind: 'single', agent: 'bob', teams: ['a', 'b'] })
  assert.deepEqual(parseWhoami('multiple=true agents=x,y teams=t type=dsh project=/p'), { kind: 'multiple', agents: ['x', 'y'], teams: ['t'] })
  assert.deepEqual(parseWhoami('not_joined=true available_teams=none'), { kind: 'not-joined', availableTeams: [] })
  assert.deepEqual(
    parseWhoami('suggest=true agents=x teams=t type=dsh project=/p available_teams=t,u'),
    { kind: 'suggest', agents: ['x'], teams: ['t'], availableTeams: ['t', 'u'] },
  )
  assert.throws(() => parseWhoami('garbage'))
})

test('parseWatchLine splits a message line and keeps pipes in the body', () => {
  const line = parseWatchLine('2026-10-18T09:28:28Z | wtest | alice → bob | a | b\\nc')
  assert.deepEqual(line, { kind: 'message', at: '2026-10-18T09:28:28Z', team: 'wtest', from: 'alice', to: 'bob', escaped: 'a | b\\nc' })
  assert.deepEqual(parseWatchLine('agmsg watch: re-arm - soon'), { kind: 'diagnostic', text: 're-arm - soon' })
  assert.equal(parseWatchLine('   '), undefined)
})

test('escapeBody mirrors watch.sh and unescapeBody inverts the plain case', () => {
  const body = 'one\r\ntwo\tthree'
  assert.equal(escapeBody(body), 'one\\ntwo\\tthree')
  assert.equal(unescapeBody(escapeBody('x\ny\tz')), 'x\ny\tz')
})

test('LineSplitter keeps partial lines until completed', () => {
  const splitter = new LineSplitter()
  assert.deepEqual(splitter.push('a\nb'), ['a'])
  assert.deepEqual(splitter.push('c\nd\n'), ['bc', 'd'])
  assert.deepEqual(splitter.push('tail'), [])
  assert.deepEqual(splitter.flush(), ['tail'])
})

test('parseJsonl skips non-object lines', () => {
  assert.deepEqual(parseJsonl('{"a":1}\nnoise\n{"b":2}\n{broken'), [{ a: 1 }, { b: 2 }])
})

test('formatDelivery names sender, team and how to reply', () => {
  const text = formatDelivery([
    { team: 't', from: 'alice', to: 'bob', at: 'T1', body: 'hello' },
    { team: 't', from: 'alice', to: 'bob', at: 'T2', body: 'again' },
  ])
  assert.match(text, /^\[agmsg\] 2 new messages for bob:/)
  assert.match(text, /From alice \(team t, T1\):\nhello/)
  assert.match(text, /agmsg_send tool \(to "alice", team "t"\)/)
  assert.equal(formatDelivery([]), '')
  assert.equal(preview('a\n  b'), 'a b')
  assert.equal(preview('x'.repeat(100), 10).length, 10)
})

test('deliveryMessage frames a relay the way dsh-TUI labels team messages', () => {
  const messages = [{ team: 't', from: 'alice', to: 'bob', at: 'T1', body: 'hi' }]
  const relay = deliveryMessage(messages, 'relay')
  assert.equal(relay.role, 'user')
  assert.deepEqual(relay.source, { kind: 'agent-message', form: 'relay', senderSessionId: 'agmsg:t/alice' })
  assert.match(relay.content[0].text, /^Team message from ([^\n]+):$/)
  assert.equal(relay.content[0].text, 'Team message from alice (agmsg t):')
  assert.match(relay.content[1].text, /From alice \(team t, T1\):\nhi/)
  assert.ok(Object.isFrozen(relay) && Object.isFrozen(relay.content[0]))

  const notice = deliveryMessage(messages, 'notice')
  assert.deepEqual(notice.source, { kind: 'agmsg', form: 'notice', summary: 'agmsg: message from alice' })
  assert.equal(notice.content.length, 1)
  assert.notEqual(notice.id, relay.id)
})

test('seatLine and oneLine keep command output on one line', () => {
  assert.equal(seatLine(undefined), 'agmsg: not joined · /agmsg join <team> <name>')
  assert.equal(
    seatLine({ sessionId: 's', project: '/p', name: 'bob', teams: ['t'], state: 'watching', delivered: 2 }),
    'agmsg: bob@t · receiving · 2 delivered',
  )
  assert.equal(oneLine('a\n\n  b \nc'), 'a · b · c')
})
