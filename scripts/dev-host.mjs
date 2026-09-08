import { fullHost } from '../tests/helpers/full-host.mjs'
const host = await fullHost()
console.log(JSON.stringify({ origin: host.origin, sandbox: host.sandbox }))
let stopping = false
const stop = async () => { if (stopping) return; stopping = true; await host.stop(); process.exit(0) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
