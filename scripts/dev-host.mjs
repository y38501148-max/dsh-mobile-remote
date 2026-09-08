import { fullHost } from '../tests/helpers/full-host.mjs'
import { companionSetup } from '../tests/helpers/companions.mjs'
const source = process.env.DSH_COMPANION_SOURCE
const host = await fullHost({ clientProbe: true, ...(process.env.DSH_TEST_REASONING ? { mock: { sequence: ['reasoning_success'] } } : {}), ...(source ? { setup: sandbox => companionSetup(sandbox, source) } : {}) })
console.log(JSON.stringify({ origin: host.origin, sandbox: host.sandbox }))
let stopping = false
const stop = async () => { if (stopping) return; stopping = true; await host.stop(); process.exit(0) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
