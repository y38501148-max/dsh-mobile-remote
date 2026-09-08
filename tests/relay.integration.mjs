import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import { RelayServer } from '../src/relay/server.js'
import { RelayHost } from '../src/relay/host.js'
async function until(fn) { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)) } throw Error('relay readiness timed out') }
test('outbound relay preserves gateway TLS identity and binary bytes; control loss closes clients', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-relay-'))
  let relay, host, target
  try {
    const certPath = join(directory, 'cert'), keyPath = join(directory, 'key')
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'])
    const cert = await readFile(certPath), key = await readFile(keyPath), token = randomBytes(32).toString('hex'), payload = randomBytes(1024 * 1024)
    target = createServer({ cert, key }, (req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(payload) })
    await new Promise(r => target.listen(0, '127.0.0.1', r))
    relay = new RelayServer({ cert, key, token }); await relay.start()
    const bad = new WebSocket(`wss://127.0.0.1:${relay.controlPort}/relay/control`, { ca: cert, headers: { authorization: 'Bearer wrong' } })
    await assert.rejects(new Promise((resolve, reject) => { bad.once('open', resolve); bad.once('error', reject) }), /403/)
    host = new RelayHost({ url: `wss://127.0.0.1:${relay.controlPort}/relay/control`, token, gatewayPort: target.address().port, ca: cert }).start()
    await until(() => host.state === 'connected')
    const received = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: relay.publicPort, ca: cert, agent: false }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)))
      }); req.on('error', reject); req.end()
    })
    assert.deepEqual(received, payload)
    host.close(); await until(() => relay.control === null && relay.channels.size === 0)
  } finally { host?.close(); await relay?.close(); if (target) await new Promise(r => target.close(r)); await rm(directory, { recursive: true, force: true }) }
})
