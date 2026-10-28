// Optional compatibility check against an installed dsh-TUI, using disposable logs only.
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { deliveryMessage } from '../lib/bridge.js'

const tuiRoot = process.env.DSH_TUI_TEST_ROOT

test('user display keeps agmsg-only sessions visible in dsh-TUI history', {
  skip: tuiRoot ? false : 'set DSH_TUI_TEST_ROOT to an installed dsh-TUI package directory',
}, async t => {
  const load = path => import(pathToFileURL(join(resolve(tuiRoot), 'lib', 'types', path)).href)
  const { digestSession, previewSession } = await load('dsh-adapter/sessions/digest.js')
  const { buildView, DEFAULT_FILTERS } = await load('sessions/view.js')
  const root = mkdtempSync(join(tmpdir(), 'dsh-agmsg-tui-'))
  t.after(() => {
    const target = realpathSync(root)
    assert.equal(dirname(target), realpathSync(tmpdir()))
    assert.ok(basename(target).startsWith('dsh-agmsg-tui-'))
    rmSync(target, { recursive: true, force: true })
  })
  const cwd = '/diagnostic/project'
  const inbound = [{ team: 't', from: 'alice', to: 'bob', at: 'T1', body: 'Work without any keyboard input' }]
  const summaries = []
  for (const display of ['relay', 'notice', 'user']) {
    const message = deliveryMessage(inbound, display)
    const events = [
      { type: 'approval/policy', data: { policy: 'never' } },
      { type: 'agent/inbox/spliced', data: { inserted: [message] } },
      { type: 'turn/start', data: { turn: 0 } },
      { type: 'user/message', data: message },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Work completed' }] } } },
      { type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } },
    ].map((event, seq) => ({ ...event, seq, time: seq + 2 }))
    const id = `${display}-session`
    const header = { type: 'session', version: 4, id, cwd, createdAt: 1 }
    const path = join(root, `${id}.jsonl.zstd`)
    writeFileSync(path, zstdCompressSync(Buffer.from([header, ...events].map(line => JSON.stringify(line)).join('\n') + '\n')))
    const digest = digestSession(path, cwd)
    assert.equal(digest.hasPrompt, display === 'user', `${display} history eligibility`)
    summaries.push({ ...digest, id, cwd, kind: { kind: 'root' }, createdAt: 1, updatedAt: 8 })
    if (display === 'user') {
      const preview = previewSession(path, 8)
      assert.deepEqual(preview.map(entry => entry.role), ['user', 'assistant'])
      assert.ok(preview[0].text.includes(inbound[0].body))
      assert.equal(preview[1].text, 'Work completed')
    }
  }
  const view = buildView(summaries, DEFAULT_FILTERS, {
    cwd, currentId: 'new-foreground-session', branch: undefined, sameProject: (a, b) => a === b,
  })
  assert.equal(view.shown, 1)
  assert.deepEqual(view.rows.filter(row => row.kind === 'session').map(row => row.session.id), ['user-session'])
  assert.deepEqual(view.emptyIds.sort(), ['notice-session', 'relay-session'])
})
