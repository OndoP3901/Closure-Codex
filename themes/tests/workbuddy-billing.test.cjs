const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { randomUUID } = require('node:crypto')
const { setImmediate: settle } = require('node:timers/promises')

const bridge = fs.readFileSync(require.resolve('../../shared/companion/workbuddy-renderer.js'), 'utf8')

function openBridge(t, account) {
  const events = new Map()
  const conversations = { on() {}, onConversationChanged() {}, async listScope() { return { items: [] } } }
  const wb = { account, conversations, on(name, listener) { events.set(name, listener) } }
  const window = { wb }
  vm.runInNewContext(bridge, { window, crypto: { randomUUID }, setTimeout, clearTimeout, setInterval, clearInterval })
  const pet = window.__closureCompanionBridge
  t.after(() => pet.dispose())
  return { snapshot: () => pet.snapshot().billing, changeAccount: () => events.get('wb.account.changed')() }
}

test('WorkBuddy billing preserves zero, unlimited and signed-out as distinct states', async t => {
  let response = { creditsLeft: 0, creditsTotal: 200, resources: [{ private: true }] }
  const pet = openBridge(t, { billing: async () => response, status: async () => 'unauthenticated' })
  assert.equal(pet.snapshot().status, 'checking')
  await settle()
  assert.equal(JSON.stringify(pet.snapshot()), '{"status":"ready","balance":"0"}')
  for (const [value, expected] of [
    [{ creditsLeft: -1, unlimited: true }, { status: 'ready', unlimited: true }],
    [undefined, { status: 'signed-out' }],
  ]) {
    response = value
    pet.changeAccount()
    assert.equal(pet.snapshot().status, 'checking')
    await settle()
    assert.deepEqual(JSON.parse(JSON.stringify(pet.snapshot())), expected)
  }
})

test('a billing response from the previous WorkBuddy account is discarded', async t => {
  let complete, calls = 0
  const pet = openBridge(t, {
    billing: () => ++calls === 1 ? new Promise(resolve => { complete = resolve }) : Promise.resolve({ creditsLeft: '2.75' }),
    status: async () => 'authenticated',
  })
  pet.snapshot()
  pet.changeAccount()
  complete({ creditsLeft: 99 })
  await settle()
  assert.equal(pet.snapshot().status, 'checking')
  await settle()
  assert.equal(pet.snapshot().balance, '2.75')
})
