import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-closure-codex-theme'
export const inject = ['webServer']

export function apply(ctx) {
  const local = process.platform === 'win32' && process.env.DSH_CLIENT_VERSION && process.env.LOCALAPPDATA
  const setting = local && path.join(local, 'ClosureCompanionTauri', 'dsh-theme.json')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/closure-dsh-theme',
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' }).end()
        return
      }
      let enabled = true
      if (setting) {
        try {
          enabled = JSON.parse(await readFile(setting, 'utf8')).enabled !== false
        } catch (error) {
          if (error.code !== 'ENOENT') {
            res.writeHead(503).end()
            return
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ enabled }))
    },
  }))
}
