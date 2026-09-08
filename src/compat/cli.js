#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
const [source, output] = process.argv.slice(2)
if (!source || !output) { process.stderr.write('Usage: dsh-mobile-compat /path/original/plugins /new/path/prepared-plugins\n'); process.exit(1) }
let prepareCompanions
try { ({ prepareCompanions } = await import('./prepare.js')) }
catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  process.stderr.write('Companion preparation requires a repository checkout with development dependencies. Run npm ci in that checkout, then node lib/compat/cli.js <source> <new-output>.\n')
  process.exit(1)
}
const plugins = await prepareCompanions(source, output, { nodeModules: fileURLToPath(new URL('../../node_modules', import.meta.url)) })
process.stdout.write(`Prepared ${plugins.length} companion plugins in ${output}. Original sources were not changed.\n`)
