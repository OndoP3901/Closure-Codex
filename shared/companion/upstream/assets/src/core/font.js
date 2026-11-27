import { PREFIX } from './env.js'

export const PET_FONT = '"FusionPixel12", monospace'

let ready

export function loadPetFont() {
  if (!ready) {
    const face = new FontFace(
      'FusionPixel12',
      `url("${PREFIX}/assets/fonts/fusion-pixel-12px-zh_hans.woff2") format("woff2")`,
      { display: 'block' },
    )
    document.fonts.add(face)
    ready = face.load().catch(error => {
      console.warn('Closure pet font could not be loaded:', error)
    })
  }
  return ready
}
