import { check } from '../auth/devices.js'
export function mobileIndex(html) {
  let found = false
  const result = html.replace(/<script>window\.__DSH_BOOT__ = (\{[^]*?\})<\/script>/, (_, json) => {
    const boot = JSON.parse(json)
    check(Array.isArray(boot.entries), 'unsupported-client-bootstrap', 502)
    found = true
    boot.entries = boot.entries.filter(entry => !['@deepseek-ai/dsh-client-ui-directory-picker-native', '@deepseek-ai/dsh-client-ui-directory-picker-browse'].includes(entry.id))
    return `<script>window.__DSH_BOOT__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>`
  })
  check(found, 'unsupported-client-bootstrap', 502)
  return result.replace('<head>', '<head><script src="/remote/bootstrap.js"></script>')
    .replace(/<link\s+rel="manifest"[^>]*>/, '<link rel="manifest" href="/remote/manifest.webmanifest">')
}
