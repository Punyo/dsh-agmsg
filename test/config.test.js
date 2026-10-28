import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, resolveConfig } from '../lib/config.js'

test('display defaults to relay for existing profiles', () => {
  assert.equal(Config({}).display, 'relay')
  assert.equal(resolveConfig().display, 'relay')
})

test('display schema and resolver accept every supported mode', () => {
  for (const display of ['relay', 'notice', 'user']) {
    assert.equal(Config({ display }).display, display)
    assert.equal(resolveConfig({ display }).display, display)
  }
  assert.throws(() => Config({ display: 'unsupported' }))
})
