import { ProtocolError, check } from '../auth/devices.js'
export function reply(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(JSON.stringify(value))
}
export function failure(res, error) {
  if (res.destroyed) return
  if (res.headersSent) return res.destroy()
  reply(res, error instanceof ProtocolError ? error.status : 500, { error: error instanceof ProtocolError ? error.message : 'internal-error' })
}
export async function readBody(req, limit = 96 * 1024) {
  check(Number(req.headers['content-length'] ?? 0) <= limit, 'body-too-large', 413)
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    check(size <= limit, 'body-too-large', 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
export function parseBody(bytes) {
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new ProtocolError('invalid-json') }
  check(value && typeof value === 'object' && !Array.isArray(value), 'invalid-body')
  return value
}
export async function jsonBody(req, limit) {
  check(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 'json-required', 415)
  return parseBody(await readBody(req, limit))
}
export function credentialFrom(req) {
  const cookies = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith('__Host-dsh_remote='))
  check(cookies.length === 1, 'unauthorized', 401)
  const credential = cookies[0].slice('__Host-dsh_remote='.length)
  check(/^[A-Za-z0-9_-]{43}$/.test(credential), 'unauthorized', 401)
  return credential
}
export function sessionCookie(credential, maxAge = 60 * 60 * 24 * 90) {
  return `__Host-dsh_remote=${credential}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
}
