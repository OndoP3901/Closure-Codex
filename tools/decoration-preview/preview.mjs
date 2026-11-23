import { mountDecoration } from '../../outputs/closure-decoration/decoration.mjs'

const decoration = mountDecoration({
  titlebar: document.querySelector('#titlebar'),
  workspace: document.querySelector('#workspace'),
  sidebar: document.querySelector('#sidebar'),
})
document.querySelector('#enabled').addEventListener('change', (event) => decoration.setEnabled(event.target.checked))
window.closureDecorationPreview = decoration
