import { createAudio } from '/dsh-closure/assets/src/audio.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function check(value, message) {
  if (!value) throw new Error(message)
}

export async function smoke(pet, parameters, untouchedAtLoad) {
  const invoke = window.__TAURI__.core.invoke
  const saved = await invoke('runtime_settings')
  for (const key of ['themeEnabled', 'codexLinked', 'dshLinked', 'workbuddyLinked', 'antigravityLinked', 'showOutsideCodex', 'startAtLogin']) {
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
  check(panel.firstElementChild?.querySelector('input[aria-label="启用主题"][type="checkbox"]'), 'Missing theme switch at the top of the menu')
  check(![...panel.querySelectorAll('summary')].some(element => element.textContent === '恢复原外观'), 'Old appearance restore menu is still present')
  check(panel.querySelector('input[aria-label="WorkBuddy 联动"][type="checkbox"]'), 'WorkBuddy linkage toggle is unavailable')
  check(panel.querySelector('input[aria-label="Antigravity 联动"][type="checkbox"]'), 'Antigravity linkage toggle is unavailable')
  const done = [...panel.querySelectorAll('button')].find(button => button.textContent === '完成')
  check(done, 'The settings Done button is unavailable')
  for (const [agent, name] of [['codex', 'Codex'], ['dsh', 'DSH'], ['workbuddy', 'WorkBuddy'], ['antigravity', 'Antigravity']]) {
    const status = panel.querySelector(`[data-agent-status="${agent}"]`)
    const launch = status?.nextElementSibling
    check(status?.textContent === name + '：等待连接' && launch?.getAttribute('aria-label') === '启动 ' + name,
      'Missing adjacent launch button for ' + name)
    check(getComputedStyle(launch).backgroundColor === getComputedStyle(done).backgroundColor
      && getComputedStyle(launch).borderRadius === getComputedStyle(done).borderRadius
      && getComputedStyle(launch).padding === getComputedStyle(done).padding,
    'Launch button styling differs from Done for ' + name)
    const key = agent + 'Linked'
    for (let attempt = 0; launch.disabled && attempt < 40; attempt++) await sleep(25)
    launch.click()
    let updated
    for (let attempt = 0; attempt < 40; attempt++) {
      updated = await invoke('runtime_settings')
      if (updated[key] && !launch.disabled) break
      await sleep(25)
    }
    check(updated[key], 'Launch did not enable linkage for ' + name)
    check((await invoke('set_runtime_setting', { key, enabled: saved[key] })).ok, 'Could not restore ' + name)
  }
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

  pet.hideBubble()
  pet.applyState({
    ...state,
    closureCompanion: {
      ...state.closureCompanion,
      accounts: [{
        host: 'codex', name: 'Codex', connected: true, source: 'thirdParty',
        balance: { remaining: 12.34, unit: 'CNY' },
        quota: [{ minutes: 300, remaining: 76.5 }],
        credits: { balance: '42' },
      }, {
        host: 'antigravity', name: 'Antigravity', connected: true, accountStatus: 'ready',
        quota: [{ minutes: 10080, remaining: 60 }],
      }],
    },
  })
  const canvas = document.querySelector('#dsh-closure-pet canvas')
  const bounds = canvas.getBoundingClientRect()
  let hit
  for (let y = Math.max(bounds.top, 0); y < Math.min(bounds.bottom, innerHeight) && !hit; y += 4) {
    for (let x = Math.max(bounds.left, 0); x < Math.min(bounds.right, innerWidth); x += 4) {
      if (pet.hitTest(x, y)) {
        hit = { clientX: x, clientY: y }
        break
      }
    }
  }
  check(hit, 'Could not find a desktop pet hit point for the quota test')
  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 1, ...hit }))
  const displayed = bubbleText.textContent.replace(/\s+/g, '')
  check(['5小时额度还剩76.5%', 'ChatGPT积分还剩42', '账户余额12.34', 'Antigravity7天额度还剩60%'].every(line => displayed.includes(line)),
    'Middle click did not show Codex and Antigravity account data together: ' + displayed)
  pet.hideBubble()
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
