#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { RelayServer } from './server.js'
const path = process.argv[2]
if (!path) { process.stderr.write('Usage: dsh-mobile-relay /path/relay.json\n'); process.exit(1) }
const config = JSON.parse(readFileSync(path, 'utf8'))
const server = new RelayServer({ ...config, cert: readFileSync(config.certPath), key: readFileSync(config.keyPath), token: readFileSync(config.tokenPath, 'utf8').trim(), bind: config.bind ?? '0.0.0.0' })
await server.start()
process.stdout.write(`Relay listening: control ${server.controlPort}, business TLS ${server.publicPort}\n`)
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await server.close(); process.exit(0) })
