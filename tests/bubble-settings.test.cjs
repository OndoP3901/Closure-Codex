const assert = require('node:assert/strict')
const { test } = require('node:test')

const protocol = import('../outputs/closure-companion/upstream/assets/src/shared/protocol.js')

test('existing profiles keep the original bubble appearance', async () => {
  const { normalizeSettings } = await protocol
  const oldProfile = normalizeSettings({ size: 1.4, bubble: false, fps: 45 })
  assert.equal(oldProfile.bubbleFontSize, 24)
  assert.equal(oldProfile.bubbleScale, 1)
  assert.equal(oldProfile.size, 1.4)
  assert.equal(oldProfile.bubble, false)
  assert.equal(oldProfile.fps, 45)
})

test('bubble font and size normalize independently and reject invalid saved values', async () => {
  const { normalizeSettings } = await protocol
  const saved = normalizeSettings({ bubbleFontSize: 30, bubbleScale: 1.25 })
  assert.equal(normalizeSettings({ bubbleFontSize: 18 }, saved).bubbleScale, 1.25)
  assert.equal(normalizeSettings({ bubbleScale: .6 }, saved).bubbleFontSize, 30)
  assert.equal(normalizeSettings({ bubbleFontSize: 100 }).bubbleFontSize, 36)
  assert.equal(normalizeSettings({ bubbleFontSize: -1 }).bubbleFontSize, 12)
  assert.equal(normalizeSettings({ bubbleFontSize: 24.7 }).bubbleFontSize, 25)
  assert.equal(normalizeSettings({ bubbleScale: 10 }).bubbleScale, 1.6)
  assert.equal(normalizeSettings({ bubbleScale: -1 }).bubbleScale, .6)
  for (const value of [null, undefined, '30', NaN, Infinity, {}]) {
    const result = normalizeSettings({ bubbleFontSize: value, bubbleScale: value }, saved)
    assert.equal(result.bubbleFontSize, 30)
    assert.equal(result.bubbleScale, 1.25)
  }
  const reloaded = normalizeSettings(JSON.parse(JSON.stringify(saved)))
  assert.equal(reloaded.bubbleFontSize, 30)
  assert.equal(reloaded.bubbleScale, 1.25)
})
