import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const appRoot = path.resolve(import.meta.dirname, '..')
const builtMainPath = path.join(appRoot, 'dist', 'electron', 'main.js')

if (!fs.existsSync(builtMainPath)) {
  throw new Error(`Missing built Electron entry at ${builtMainPath}. Run pnpm --filter @hesper/desktop build first.`)
}

const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hesper-desktop-smoke-'))
let app

try {
  app = await electron.launch({
    args: [appRoot],
    env: {
      ...process.env,
      HESPER_AGENT_MODE: 'mock',
      HESPER_USER_DATA_DIR: userDataRoot
    }
  })

  const page = await app.firstWindow()
  const title = await page.title()
  console.log(`window title: ${title}`)

  await page.getByLabel('空会话状态').getByRole('button', { name: '新建会话' }).click()
  await page.getByPlaceholder(/输入消息/).fill('hello from smoke')
  await page.getByRole('button', { name: '发送' }).click()
  await page.getByText(/Mock response for: hello from smoke/).waitFor({ timeout: 10000 })

  console.log('desktop smoke passed')
} finally {
  await app?.close().catch(() => undefined)
  fs.rmSync(userDataRoot, { recursive: true, force: true })
}
