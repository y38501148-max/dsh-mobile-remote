import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const root = fileURLToPath(new URL('../../', import.meta.url))
export async function fullHost(options = {}) {
  const sandbox = options.sandbox ?? await mkdtemp(join(tmpdir(), 'dsh-remote-test-'))
  const scope = join(sandbox, 'node_modules', '@muzermat')
  await mkdir(scope, { recursive: true })
  if (!options.sandbox) await symlink(root, join(scope, 'dsh-mobile-remote'), 'dir')
  const mock = await startMockLlmServer({ sequence: ['slow_success'], repeatLast: true, successText: '手机与电脑共享同一个 Host。'.repeat(10), chunkSize: 5, chunkDelayMs: 10, ...options.mock })
  const preset = join(sandbox, '.agent-presets', 'remote-test')
  await mkdir(preset, { recursive: true })
  await writeFile(join(preset, 'preset.yml'), 'name: Remote test\ndescription: Synthetic local test only\n')
  await writeFile(join(preset, 'agent.cordis.yml'), `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: Synthetic protocol test.\n    complete: true\n    includeRuntimeContext: false\n`)
  const patch = join(sandbox, 'overlay.yml')
  await writeFile(patch, JSON.stringify([
    { id: 'llm-deepseek', config: { baseURL: mock.baseURL, apiKeyEnv: 'REMOTE_TEST_KEY', thinking: 'disabled', streamIdleTimeoutMs: 5000 } },
    { id: 'session-title-llm', disabled: true },
    { id: 'agent-presets', config: { default: 'remote-test' } },
    { insert: [{ id: 'mobile-remote', name: '@muzermat/dsh-mobile-remote', config: { statePath: join(sandbox, 'mobile-remote.json'), ...options.plugin } }] },
  ]))
  const child = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--patch', patch, '--port', '0'], {
    cwd: sandbox, env: { PATH: process.env.PATH, DSH_HOME: sandbox, REMOTE_TEST_KEY: 'synthetic-no-real-credential', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', data => { output = (output + data).slice(-24000) })
  child.stderr.on('data', data => { output = (output + data).slice(-24000) })
  const stop = async ({ preserve = false, signal = 'SIGTERM' } = {}) => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill(signal)
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited; clearTimeout(timer)
    }
    await mock.close(); if (!preserve) await rm(sandbox, { recursive: true, force: true })
  }
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error(`test Host startup timed out\n${output}`)) }, 45000)
      const data = () => { const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { cleanup(); resolve(match[1]) } }
      const exit = () => { cleanup(); reject(Error(`test Host exited\n${output}`)) }
      const cleanup = () => { clearTimeout(timer); child.stdout.off('data', data); child.off('exit', exit) }
      child.stdout.on('data', data); child.once('exit', exit); child.once('error', reject)
    })
    return { origin, sandbox, mock, child, stop, output: () => output }
  } catch (error) { await stop(); throw error }
}
