import { createAudio } from '/dsh-closure/assets/src/audio.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function check(value, message) {
  if (!value) throw new Error(message)
}

export async function smoke(pet, parameters, untouchedAtLoad) {
  const invoke = window.__TAURI__.core.invoke
  const saved = await invoke('runtime_settings')
  for (const key of ['codexLinked', 'dshLinked', 'workbuddyLinked', 'showOutsideCodex', 'startAtLogin']) {
    const enabled = !saved[key]
    check((await invoke('set_runtime_setting', { key, enabled })).ok, 'Runtime toggle did not save: ' + key)
    check((await invoke('runtime_settings'))[key] === enabled, 'Runtime toggle did not update: ' + key)
    check((await invoke('set_runtime_setting', { key, enabled: saved[key] })).ok, 'Runtime toggle did not restore: ' + key)
  }
  const state = await invoke('linked_state')
  check(Array.isArray(state.closureCompanion.accounts) && state.turnEnd.seq === 0, 'Missing integration state')
  check(pet.debug.mode === (parameters.has('canvas') ? 'canvas' : 'gl'), 'Incorrect renderer')
  const frames = pet.debug.frames
  await sleep(300)
  check(pet.debug.frames > frames && pet.debug.hitMask.ready, 'Animation or hit mask did not start')
  pet.showBubble('博士，当然能用免单券摇奖！', 1000)
  const glyphs = await document.fonts.load('24px FusionPixel12', '然券摇奖')
  const bubbleText = document.querySelector('#dsh-closure-pet-bubble > div')
  check(glyphs.length === 1 && glyphs[0].status === 'loaded', 'Fusion Pixel did not load')
  check(bubbleText?.textContent.includes('摇奖') && getComputedStyle(bubbleText).fontFamily.includes('FusionPixel12'),
    'Bubble text did not render in Fusion Pixel')
  pet.openPanel()
  const panel = document.getElementById('dsh-closure-pet-settings')
  check(panel && getComputedStyle(panel).display === 'block' && panel.textContent.includes('退出桌宠'), 'Settings panel is unavailable')
  check(panel.querySelector('input[aria-label="WorkBuddy 联动"][type="checkbox"]'), 'WorkBuddy linkage toggle is unavailable')
  check(![...panel.querySelectorAll('button')].some(button => button.textContent.includes('WorkBuddy')),
    'Settings panel still contains a WorkBuddy launch button')
  check([panel, ...panel.querySelectorAll('button')].every(node => getComputedStyle(node).fontFamily.includes('FusionPixel12')),
    'Settings panel text is missing Fusion Pixel')
  pet.closePanel()
  check(untouchedAtLoad, 'Smoke requires an untouched document')
  const audio = createAudio(() => ({ voice: true, voiceVolume: 0, voiceLanguage: 'zh' }))
  let duration
  check(await audio.playVoice('tap', value => { duration = value }, true), 'Native voice could not start')
  check(duration > 500 && audio.getVoiceState()?.volume === 0, 'Native voice duration or mute setting is incorrect')
  audio.stopPreview()
  check(!audio.getVoiceState(), 'Native voice preview did not stop')
}

export async function checkCursor(pet, { start, isPassingThrough, inspect }) {
  const waitFor = async (passingThrough, message) => {
    const deadline = performance.now() + 2000
    while (performance.now() < deadline) {
      if (await isPassingThrough() === passingThrough) return
      await sleep(25)
    }
    throw new Error(message)
  }

  check(await isPassingThrough(), 'Overlay intercepts input before hit testing')
  pet.openPanel()
  const panel = document.getElementById('dsh-closure-pet-settings')
  const bounds = panel.getBoundingClientRect()
  const inside = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  check(panel.contains(document.elementFromPoint(inside.x, inside.y)), 'Panel center is outside the hit-test viewport: ' + JSON.stringify({ inside, innerWidth, innerHeight, bounds }))
  inspect(() => inside)
  await start()
  await waitFor(false, 'Settings panel does not accept input')
  inspect(() => ({ x: -1, y: -1 }))
  await waitFor(true, 'Blank area does not pass input through')
  inspect(() => inside)
  await waitFor(false, 'Settings panel does not regain input')
  inspect(() => undefined)
  await waitFor(true, 'Overlay intercepts input after the renderer stops replying')
}
