import { spawn } from 'node:child_process'

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5273'
const expectedRendererTitle = 'hesper desktop'

async function assertRendererDevServer(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Unexpected HTTP ${response.status}`)
    }

    const html = await response.text()
    const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim()
    if (title !== expectedRendererTitle) {
      throw new Error(
        `Renderer dev server mismatch at ${url}: expected title "${expectedRendererTitle}", got "${title ?? 'missing'}". ` +
        'Another local app may be using this port; stop it or set VITE_DEV_SERVER_URL to the active Hesper renderer URL.'
      )
    }
  } finally {
    clearTimeout(timeout)
  }
}

await assertRendererDevServer(devServerUrl)

const command = process.platform === 'win32' ? 'electron.cmd' : 'electron'
const child = spawn(command, ['.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl
  }
})

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
