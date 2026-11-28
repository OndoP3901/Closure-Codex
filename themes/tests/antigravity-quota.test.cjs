const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('../../shared/companion/antigravity-quota.js'), 'utf8')
const bucket = (window, value) => ({ window, remaining: { case: 'remainingFraction', value } })
const groups = [
  { displayName: 'Claude and GPT models', description: 'Models within this group: Claude Sonnet 4.6', buckets: [bucket('5h', 0.25)] },
  { displayName: 'Gemini Models', description: 'Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash', buckets: [bucket('weekly', 0)] },
]

async function readQuota(label, effort, pools = groups) {
  const text = { nodeType: 3, textContent: label }
  const span = effort && { childNodes: [text, { nodeType: 1, textContent: effort }] }
  const service = { retrieveUserQuotaSummary: async () => ({ response: { groups: pools } }) }
  const trigger = {
    textContent: effort ? label + ' ' + effort : label,
    querySelector: () => span,
    getClientRects: () => [{}],
    closest: () => null,
    __reactFiber$test: { dependencies: { firstContext: { memoizedValue: service } } },
  }
  const document = { querySelectorAll: () => [trigger] }
  return structuredClone(await vm.runInNewContext(source, { document, Node: { TEXT_NODE: 3 } }))
}

test('Antigravity 2.36 reads the selected model pool when the thinking level has its own label', async () => {
  const expected = { quota: [{ minutes: 10080, remaining: 0 }], accountStatus: 'ready' }
  assert.deepEqual(await readQuota('Gemini 4 Hydrogen', 'Extra High'), expected)
  assert.deepEqual(await readQuota('Gemini 4 Hydrogen', '自定义档位'), expected)
})

test('Antigravity keeps flat model labels and leaves unlisted models unavailable', async () => {
  assert.deepEqual(await readQuota('Claude Sonnet 4.6 (High)'), {
    quota: [{ minutes: 300, remaining: 25 }], accountStatus: 'ready',
  })
  assert.deepEqual(await readQuota('Gemini 4 Hydrogen Mini', 'Extra High'), {
    quota: [], accountStatus: 'unavailable',
  })
})

test('an exact quota model name wins when two pool names differ by a thinking level', async () => {
  const pools = [
    { displayName: 'Model A', buckets: [bucket('weekly', 0.5)] },
    { displayName: 'Model A High', buckets: [bucket('5h', 0.75)] },
  ]
  assert.deepEqual(await readQuota('Model A High', undefined, pools), {
    quota: [{ minutes: 300, remaining: 75 }], accountStatus: 'ready',
  })
  assert.deepEqual(await readQuota('Model A', 'High', pools), {
    quota: [{ minutes: 10080, remaining: 50 }], accountStatus: 'ready',
  })
})
