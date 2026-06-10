import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from 'playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const builtMainPath = path.join(appRoot, 'dist', 'electron', 'main.js')

function createIsolatedDesktopEnv() {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hesper-desktop-e2e-'))
  return {
    userDataRoot,
    env: {
      ...process.env,
      HESPER_AGENT_MODE: 'mock',
      HESPER_USER_DATA_DIR: userDataRoot
    }
  }
}

test('creates a session and receives a mock agent response', async () => {
  expect(fs.existsSync(builtMainPath), `Missing built Electron entry at ${builtMainPath}. Run pnpm --filter @hesper/desktop build first.`).toBeTruthy()

  const { env, userDataRoot } = createIsolatedDesktopEnv()
  let app

  try {
    app = await electron.launch({
      args: [appRoot],
      env
    })

    const page = await app.firstWindow()

    await expect(page.getByRole('button', { name: '新建会话' })).toBeVisible()
    await page.getByRole('button', { name: '新建会话' }).click()
    await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible()

    await page.getByPlaceholder(/输入消息/).fill('hello from e2e')
    await page.getByRole('button', { name: '发送' }).click()

    await expect(page.getByRole('article', { name: '用户消息' }).getByText('hello from e2e')).toBeVisible()
    await expect(page.getByText(/Mock response for: hello from e2e/)).toBeVisible({ timeout: 10000 })
  } finally {
    await app?.close().catch(() => undefined)
    fs.rmSync(userDataRoot, { recursive: true, force: true })
  }
})
