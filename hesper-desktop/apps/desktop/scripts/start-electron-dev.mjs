import { spawn } from 'node:child_process'

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
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
