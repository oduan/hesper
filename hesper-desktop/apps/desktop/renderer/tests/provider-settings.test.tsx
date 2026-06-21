// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

const now = '2026-06-10T03:00:00.000Z'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const baseProviders = [
  {
    id: 'mock',
    name: 'Mock',
    kind: 'mock',
    enabled: true,
    defaultModelId: 'mock/hesper-fast',
    apiKeyRef: 'provider:mock:api-key',
    hasApiKey: false,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    enabled: true,
    defaultModelId: 'deepseek-chat',
    apiKeyRef: 'provider:deepseek:api-key',
    hasApiKey: false,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    defaultModelId: 'gpt-4o',
    apiKeyRef: 'provider:openai:api-key',
    hasApiKey: false,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'chatgpt-codex',
    name: 'ChatGPT Codex',
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
    enabled: true,
    defaultModelId: 'pi/gpt-5.5',
    apiKeyRef: 'provider:chatgpt-codex:api-key',
    hasApiKey: true,
    createdAt: now,
    updatedAt: now
  }
] as any[]

const baseModels = [
  {
    id: 'mock/hesper-fast',
    providerId: 'mock',
    modelName: 'mock/hesper-fast',
    displayName: 'Hesper Mock Fast',
    capabilities: ['streaming', 'toolCalls'],
    enabled: true,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'deepseek-chat',
    providerId: 'deepseek',
    modelName: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    capabilities: ['streaming', 'toolCalls'],
    enabled: true,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'gpt-4o',
    providerId: 'openai',
    modelName: 'gpt-4o',
    displayName: 'GPT-4o',
    capabilities: ['streaming', 'toolCalls', 'jsonOutput'],
    enabled: true,
    createdAt: now,
    updatedAt: now
  }
] as any[]

const {
  listSessions,
  onEvent,
  listProviders,
  saveProvider,
  disableProvider,
  deleteProvider,
  testConnection,
  startOAuthAuthorization,
  getOAuthAuthorizationStatus,
  saveOAuthConnection,
  cancelOAuthAuthorization,
  listModels,
  saveModel,
  saveProviderApiKey,
  getSettings,
  updateSettings,
  listTools,
  setToolEnabled,
  listRoles,
  listSkills,
  refreshSkills
} = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  onEvent: vi.fn(() => () => undefined),
  listProviders: vi.fn(),
  saveProvider: vi.fn(),
  disableProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testConnection: vi.fn(),
  startOAuthAuthorization: vi.fn(),
  getOAuthAuthorizationStatus: vi.fn(),
  saveOAuthConnection: vi.fn(),
  cancelOAuthAuthorization: vi.fn(),
  listModels: vi.fn(),
  saveModel: vi.fn(),
  saveProviderApiKey: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listTools: vi.fn(),
  setToolEnabled: vi.fn(),
  listRoles: vi.fn(),
  listSkills: vi.fn(),
  refreshSkills: vi.fn()
}))

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: listSessions,
      create: vi.fn(),
      updateTitle: vi.fn(),
      archive: vi.fn(),
      delete: vi.fn(),
      setWorkspace: vi.fn(),
      setModel: vi.fn(),
      setOutputMode: vi.fn()
    },
    agent: { enqueue: vi.fn(), stop: vi.fn(), onEvent },
    dialog: { selectDirectory: vi.fn() },
    settings: {
      get: getSettings,
      update: updateSettings
    },
    providers: {
      list: listProviders,
      save: saveProvider,
      disable: disableProvider,
      delete: deleteProvider,
      testConnection,
      startOAuthAuthorization,
      getOAuthAuthorizationStatus,
      saveOAuthConnection,
      cancelOAuthAuthorization
    },
    models: {
      list: listModels,
      save: saveModel
    },
    credentials: {
      providerStatus: vi.fn(),
      saveProviderApiKey,
      deleteProviderApiKey: vi.fn()
    },
    tools: {
      list: listTools,
      setEnabled: setToolEnabled
    },
    roles: {
      list: listRoles,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    skills: {
      list: listSkills,
      refresh: refreshSkills
    },
    window: {
      platform: 'win32',
      minimize: vi.fn(async () => ({ minimized: true })),
      toggleMaximize: vi.fn(async () => ({ isMaximized: true })),
      close: vi.fn(async () => ({ closed: true }))
    }
  }
}))

function resetProviderMocks() {
  listSessions.mockResolvedValue([])
  onEvent.mockImplementation(() => () => undefined)
  listProviders.mockResolvedValue(baseProviders)
  listModels.mockResolvedValue(baseModels)
  saveProvider.mockImplementation(async (input: any) => ({ ...baseProviders[1], ...input, createdAt: now, updatedAt: now, apiKeyRef: `provider:${input.id}:api-key`, hasApiKey: false }))
  disableProvider.mockImplementation(async ({ providerId }: { providerId: string }) => ({ ...baseProviders.find((provider) => provider.id === providerId), enabled: false }))
  deleteProvider.mockResolvedValue({ deleted: true, providerId: 'deepseek' })
  testConnection.mockResolvedValue({ providerId: 'deepseek', status: 'needs_api_key', hasApiKey: false, message: 'API key missing' })
  startOAuthAuthorization.mockResolvedValue({
    provider: 'openai-codex',
    sessionId: 'oauth-session-default',
    authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-default',
    status: 'pending',
    message: '等待浏览器授权'
  })
  getOAuthAuthorizationStatus.mockResolvedValue({
    provider: 'openai-codex',
    sessionId: 'oauth-session-default',
    status: 'pending',
    message: '等待浏览器授权'
  })
  saveOAuthConnection.mockImplementation(async (input: any) => ({
    id: 'chatgpt-codex',
    name: input.connectionName,
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
    enabled: true,
    defaultModelId: 'pi/gpt-5.5',
    apiKeyRef: 'provider:chatgpt-codex:api-key',
    hasApiKey: true,
    createdAt: now,
    updatedAt: now
  }))
  cancelOAuthAuthorization.mockResolvedValue({ cancelled: true, sessionId: 'oauth-session-default' })
  saveModel.mockImplementation(async (input: any) => ({ ...baseModels[1], ...input, createdAt: now, updatedAt: now }))
  saveProviderApiKey.mockResolvedValue({ providerId: 'deepseek', apiKeyRef: 'provider:deepseek:api-key', hasApiKey: true, encryptionAvailable: true })
  listTools.mockResolvedValue([])
  listRoles.mockResolvedValue([])
  listSkills.mockResolvedValue([])
  refreshSkills.mockResolvedValue([])
  setToolEnabled.mockImplementation(async (input: any) => ({ id: input.id, name: input.id, description: input.id, category: 'system', inputSchema: {}, enabled: input.enabled }))
  getSettings.mockResolvedValue({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', fontSize: 14 })
  updateSettings.mockImplementation(async (input: any) => ({
    defaultModelId: input.defaultModelId ?? 'mock/hesper-fast',
    defaultOutputMode: input.defaultOutputMode ?? 'markdown',
    themeMode: input.themeMode ?? 'dark',
    fontSize: input.fontSize ?? 14
  }))
}

describe('provider settings panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetProviderMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('surfaces initial provider settings load failures', async () => {
    const user = userEvent.setup()
    listProviders.mockResolvedValueOnce(baseProviders)
    listProviders.mockRejectedValueOnce(new Error('initial load failed'))
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('模型来源加载失败：initial load failed')
  })

  it('lists built-in providers from settings', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))

    expect(await screen.findByRole('region', { name: '模型来源设置' })).toBeInTheDocument()
    expect(screen.queryByText('应用默认模型')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /选择模型来源/ })).not.toBeInTheDocument()
    expect(screen.getByText('DeepSeek')).toBeInTheDocument()
    expect(screen.getAllByText(/未保存 key/).length).toBeGreaterThan(0)
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
  })

  it('renders provider connections as one block with unclipped menus', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))

    const mockMenuButton = await screen.findByRole('button', { name: '打开连接菜单 Mock' })
    const deepSeekMenuButton = screen.getByRole('button', { name: '打开连接菜单 DeepSeek' })
    const mockItem = mockMenuButton.closest('div')
    const deepSeekItem = deepSeekMenuButton.closest('div')
    const connectionList = mockItem?.parentElement

    expect(connectionList).toHaveStyle({
      gap: '0px',
      background: 'var(--hesper-color-surface-muted, #24283b)'
    })
    expect(mockItem?.style.border).toBe('0px')
    expect(mockItem?.style.boxShadow).toBe('none')
    expect(mockItem).toHaveStyle({ overflow: 'visible' })
    const separators = connectionList?.querySelectorAll('[data-hesper-connection-separator="true"]')
    expect(separators).toHaveLength(baseProviders.length - 1)
    expect(separators?.[0]).toHaveStyle({
      height: '1px',
      margin: '0px 14px',
      background: 'var(--hesper-color-border-subtle, rgba(65, 72, 104, 0.45))'
    })
    expect(deepSeekItem?.style.borderTopWidth).toBe('0px')
    expect(deepSeekItem?.style.borderTopStyle).toBe('none')
    expect(deepSeekItem).toHaveStyle({ overflow: 'visible' })

    expect(screen.queryByRole('button', { name: /选择模型来源/ })).not.toBeInTheDocument()
    expect(mockItem).toHaveStyle({ background: 'transparent' })
    expect(deepSeekItem).toHaveStyle({ background: 'transparent' })

    await user.click(deepSeekMenuButton)
    const menu = await screen.findByRole('menu', { name: 'DeepSeek 连接菜单' })
    expect(menu).toBeInTheDocument()
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveStyle({ position: 'fixed' })
    expect(connectionList?.querySelector('[role="menu"]')).not.toBeInTheDocument()
    expect(deepSeekItem).toHaveStyle({ overflow: 'visible' })
  })

  it('renames a connection inline from the hover edit icon on blur', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))

    const deepSeekName = await screen.findByText('DeepSeek')
    expect(screen.queryByRole('button', { name: '重命名连接 DeepSeek' })).not.toBeInTheDocument()

    await user.hover(deepSeekName)
    const renameButton = await screen.findByRole('button', { name: '重命名连接 DeepSeek' })
    expect(renameButton).toHaveStyle({ background: 'transparent' })
    expect(renameButton.style.border).toBe('0px')

    await user.click(renameButton)
    const renameInput = await screen.findByRole('textbox', { name: '连接名称 DeepSeek' })
    expect(renameInput).toHaveValue('DeepSeek')

    await user.clear(renameInput)
    await user.type(renameInput, 'DeepSeek Official')
    await user.click(screen.getByText('管理 AI 提供商连接。'))

    await waitFor(() => {
      expect(saveProvider).toHaveBeenCalledWith(expect.objectContaining({
        id: 'deepseek',
        name: 'DeepSeek Official',
        kind: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        enabled: true,
        defaultModelId: 'deepseek-chat'
      }))
    })
  })

  it('opens the full-window add connection picker before custom API configuration', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))

    const picker = await screen.findByRole('dialog', { name: '添加连接' })
    expect(picker).toHaveStyle({
      position: 'fixed',
      top: '36px',
      left: '0px',
      right: '0px',
      bottom: '0px'
    })
    expect(within(picker).getByRole('heading', { name: '欢迎使用 Hesper' })).toBeInTheDocument()
    expect(within(picker).getByText('选择连接方式')).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: /ChatGPT\/Codex 连接/ })).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: /自定义连接/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'API 配置' })).not.toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: /自定义连接/ }))

    const apiDialog = await screen.findByRole('dialog', { name: 'API 配置' })
    expect(apiDialog).toHaveStyle({
      position: 'fixed',
      top: '36px'
    })
  })

  it('shows Codex OAuth connection actions without opening the custom API editor', async () => {
    const user = userEvent.setup()
    testConnection.mockResolvedValueOnce({
      providerId: 'chatgpt-codex',
      status: 'ok',
      hasApiKey: true,
      message: 'Codex 授权可用'
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))

    expect(screen.getByText('ChatGPT Codex')).toBeInTheDocument()
    expect(screen.getByText(/pi · 使用默认端点 · 已授权/)).toBeInTheDocument()
    expect(screen.queryByText(/chatgpt-codex.*已保存 key/)).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: '打开连接菜单 ChatGPT Codex' }))
    const menu = await screen.findByRole('menu', { name: 'ChatGPT Codex 连接菜单' })
    expect(within(menu).queryByRole('menuitem', { name: '编辑' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '重新授权' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '验证连接' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '删除' })).toBeInTheDocument()

    await user.click(within(menu).getByRole('menuitem', { name: '验证连接' }))
    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith({ providerId: 'chatgpt-codex' })
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Codex 授权可用')
    expect(screen.queryByRole('dialog', { name: 'API 配置' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开连接菜单 ChatGPT Codex' }))
    await user.click(await screen.findByRole('menuitem', { name: '重新授权' }))
    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    expect(within(codexDialog).getByRole('heading', { name: '连接 ChatGPT' })).toBeInTheDocument()
    expect(within(codexDialog).getByRole('button', { name: /连接中/ })).toBeDisabled()
    await waitFor(() => expect(startOAuthAuthorization).toHaveBeenCalledWith({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' }))
    expect(screen.queryByRole('dialog', { name: 'API 配置' })).not.toBeInTheDocument()
  })

  it('cancels an active Codex OAuth session from Back and Escape', async () => {
    const user = userEvent.setup()
    startOAuthAuthorization
      .mockResolvedValueOnce({
        provider: 'openai-codex',
        sessionId: 'oauth-session-back',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-back',
        status: 'pending',
        message: '等待浏览器授权'
      })
      .mockResolvedValueOnce({
        provider: 'openai-codex',
        sessionId: 'oauth-session-escape',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-escape',
        status: 'pending',
        message: '等待浏览器授权'
      })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))
    let codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    await waitFor(() => expect(startOAuthAuthorization).toHaveBeenCalledTimes(1))
    await user.click(within(codexDialog).getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(cancelOAuthAuthorization).toHaveBeenCalledWith({ sessionId: 'oauth-session-back' }))

    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))
    codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    await waitFor(() => expect(startOAuthAuthorization).toHaveBeenCalledTimes(2))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(cancelOAuthAuthorization).toHaveBeenCalledWith({ sessionId: 'oauth-session-escape' }))
  })

  it('navigates the Codex authorization route and returns to the picker', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))

    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))
    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    expect(codexDialog).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'API 配置' })).not.toBeInTheDocument()

    await user.click(within(codexDialog).getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('dialog', { name: '添加连接' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /ChatGPT\/Codex 连接/ }))
    const escapeDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    await waitFor(() => expect(escapeDialog).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Codex 授权' })).not.toBeInTheDocument()
  })

  it('authorizes and auto-saves a Codex OAuth connection from the full-window flow', async () => {
    const user = userEvent.setup()
    startOAuthAuthorization.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-1',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1',
      status: 'pending',
      message: '等待浏览器授权'
    })
    getOAuthAuthorizationStatus.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-1',
      status: 'authorized',
      message: '授权成功'
    })
    saveOAuthConnection.mockResolvedValueOnce({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      defaultModelId: 'pi/gpt-5.5',
      hasApiKey: true,
      enabled: true,
      apiKeyRef: 'provider:chatgpt-codex:api-key',
      createdAt: now,
      updatedAt: now
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    const providerReloadCallsBeforeSave = listProviders.mock.calls.length
    const modelReloadCallsBeforeSave = listModels.mock.calls.length
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    expect(within(codexDialog).getByRole('heading', { name: '连接 ChatGPT' })).toBeInTheDocument()
    expect(within(codexDialog).getByRole('button', { name: /连接中/ })).toBeDisabled()

    await waitFor(() => {
      expect(startOAuthAuthorization).toHaveBeenCalledWith({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    })
    expect(await within(codexDialog).findByRole('status')).toHaveTextContent('等待浏览器授权')

    await waitFor(() => {
      expect(getOAuthAuthorizationStatus).toHaveBeenCalledWith({ sessionId: 'oauth-session-1' })
    })
    await waitFor(() => {
      expect(saveOAuthConnection).toHaveBeenCalledWith({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })
    })
    expect(await screen.findByRole('status')).toHaveTextContent('已添加连接：ChatGPT Codex')
    expect(listProviders.mock.calls.length).toBeGreaterThan(providerReloadCallsBeforeSave)
    expect(listModels.mock.calls.length).toBeGreaterThan(modelReloadCallsBeforeSave)
  })

  it('keeps the Codex authorization page waiting until authorization succeeds', async () => {
    const user = userEvent.setup()
    startOAuthAuthorization.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-pending',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-pending',
      status: 'pending',
      message: '等待浏览器授权'
    })
    getOAuthAuthorizationStatus.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-pending',
      status: 'pending',
      message: '仍在等待授权'
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    expect(within(codexDialog).getByRole('button', { name: /连接中/ })).toBeDisabled()
    await waitFor(() => expect(getOAuthAuthorizationStatus).toHaveBeenCalledWith({ sessionId: 'oauth-session-pending' }))
    expect(await within(codexDialog).findByRole('status')).toHaveTextContent('仍在等待授权')
    expect(saveOAuthConnection).not.toHaveBeenCalled()
  })

  it('continues polling Codex OAuth status when pending messages do not change', async () => {
    const user = userEvent.setup()
    startOAuthAuthorization.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-repeat-pending',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-repeat-pending',
      status: 'pending',
      message: '等待浏览器授权'
    })
    getOAuthAuthorizationStatus
      .mockResolvedValueOnce({
        provider: 'openai-codex',
        sessionId: 'oauth-session-repeat-pending',
        status: 'pending',
        message: '仍在等待授权'
      })
      .mockResolvedValueOnce({
        provider: 'openai-codex',
        sessionId: 'oauth-session-repeat-pending',
        status: 'pending',
        message: '仍在等待授权'
      })
      .mockResolvedValueOnce({
        provider: 'openai-codex',
        sessionId: 'oauth-session-repeat-pending',
        status: 'authorized',
        message: '授权成功'
      })
    saveOAuthConnection.mockResolvedValueOnce({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      defaultModelId: 'pi/gpt-5.5',
      hasApiKey: true,
      enabled: true,
      apiKeyRef: 'provider:chatgpt-codex:api-key',
      createdAt: now,
      updatedAt: now
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    await waitFor(() => expect(getOAuthAuthorizationStatus).toHaveBeenCalledTimes(2), { timeout: 2200 })
    await waitFor(() => expect(getOAuthAuthorizationStatus).toHaveBeenCalledTimes(3), { timeout: 2200 })
    await waitFor(() => expect(saveOAuthConnection).toHaveBeenCalledWith({ sessionId: 'oauth-session-repeat-pending', connectionName: 'ChatGPT Codex' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已添加连接：ChatGPT Codex')
  })

  it('shows a Codex OAuth start error without closing the authorization page', async () => {
    const user = userEvent.setup()
    startOAuthAuthorization.mockRejectedValueOnce(new Error('browser unavailable'))
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    expect(await within(codexDialog).findByRole('alert')).toHaveTextContent('browser unavailable')
    expect(screen.getByRole('dialog', { name: 'Codex 授权' })).toBeInTheDocument()
    expect(within(codexDialog).getByRole('button', { name: '重新连接' })).toBeEnabled()
  })

  it('prevents duplicate Codex OAuth starts while the browser launch is pending', async () => {
    const user = userEvent.setup()
    const startDeferred = createDeferred<any>()
    startOAuthAuthorization.mockImplementationOnce(() => startDeferred.promise)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    await waitFor(() => expect(startOAuthAuthorization).toHaveBeenCalledTimes(1))
    expect(within(codexDialog).getByRole('button', { name: /正在打开/ })).toBeDisabled()

    await act(async () => {
      startDeferred.resolve({
        provider: 'openai-codex',
        sessionId: 'oauth-session-starting',
        authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-starting',
        status: 'pending',
        message: '等待浏览器授权'
      })
      await startDeferred.promise
    })

    expect(await within(codexDialog).findByRole('status')).toHaveTextContent('等待浏览器授权')
    expect(startOAuthAuthorization).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate Codex OAuth saves while auto-saving is pending', async () => {
    const user = userEvent.setup()
    const saveDeferred = createDeferred<any>()
    startOAuthAuthorization.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-saving',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-saving',
      status: 'pending',
      message: '等待浏览器授权'
    })
    getOAuthAuthorizationStatus.mockResolvedValue({
      provider: 'openai-codex',
      sessionId: 'oauth-session-saving',
      status: 'authorized',
      message: '授权成功'
    })
    saveOAuthConnection.mockImplementationOnce(() => saveDeferred.promise)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    await waitFor(() => expect(saveOAuthConnection).toHaveBeenCalledTimes(1))
    expect(within(codexDialog).getByRole('button', { name: /正在保存/ })).toBeDisabled()
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(saveOAuthConnection).toHaveBeenCalledTimes(1)

    await act(async () => {
      saveDeferred.resolve({
        id: 'chatgpt-codex',
        name: 'ChatGPT Codex',
        kind: 'pi',
        authType: 'oauth',
        piAuthProvider: 'openai-codex',
        defaultModelId: 'pi/gpt-5.5',
        hasApiKey: true,
        enabled: true,
        apiKeyRef: 'provider:chatgpt-codex:api-key',
        createdAt: now,
        updatedAt: now
      })
      await saveDeferred.promise
    })

    expect(await screen.findByRole('status')).toHaveTextContent('已添加连接：ChatGPT Codex')
  })

  it('keeps the Codex dialog open with reconnect enabled when auto-saving fails', async () => {
    const user = userEvent.setup()
    startOAuthAuthorization.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-save-failure',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-save-failure',
      status: 'pending',
      message: '等待浏览器授权'
    })
    getOAuthAuthorizationStatus.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-save-failure',
      status: 'authorized',
      message: '授权成功'
    })
    saveOAuthConnection.mockRejectedValueOnce(new Error('vault unavailable'))
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    const codexDialog = await screen.findByRole('dialog', { name: 'Codex 授权' })
    expect(await within(codexDialog).findByRole('alert')).toHaveTextContent('vault unavailable')
    expect(screen.getByRole('dialog', { name: 'Codex 授权' })).toBeInTheDocument()
    expect(within(codexDialog).getByRole('button', { name: '重新连接' })).toBeEnabled()
  })

  it('shows a visible warning when a saved Codex OAuth connection cannot refresh providers', async () => {
    const user = userEvent.setup()
    startOAuthAuthorization.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-reload-failure',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-reload-failure',
      status: 'pending',
      message: '等待浏览器授权'
    })
    getOAuthAuthorizationStatus.mockResolvedValueOnce({
      provider: 'openai-codex',
      sessionId: 'oauth-session-reload-failure',
      status: 'authorized',
      message: '授权成功'
    })
    saveOAuthConnection.mockResolvedValueOnce({
      id: 'chatgpt-codex',
      name: 'ChatGPT Codex',
      kind: 'pi',
      authType: 'oauth',
      piAuthProvider: 'openai-codex',
      defaultModelId: 'pi/gpt-5.5',
      hasApiKey: true,
      enabled: true,
      apiKeyRef: 'provider:chatgpt-codex:api-key',
      createdAt: now,
      updatedAt: now
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /ChatGPT\/Codex 连接/ }))

    await screen.findByRole('dialog', { name: 'Codex 授权' })
    listProviders.mockRejectedValueOnce(new Error('reload failed'))

    expect(await screen.findByRole('alert')).toHaveTextContent('连接已保存，但刷新模型列表失败：reload failed')
    expect(screen.queryByRole('dialog', { name: 'Codex 授权' })).not.toBeInTheDocument()
    expect(screen.queryByText('已添加连接：ChatGPT Codex')).not.toBeInTheDocument()
  })

  it('closes and reopens the picker from Back and Escape', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    let picker = await screen.findByRole('dialog', { name: '添加连接' })

    await user.click(within(picker).getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('dialog', { name: '添加连接' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ 添加连接' }))
    picker = await screen.findByRole('dialog', { name: '添加连接' })
    await waitFor(() => expect(picker).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '添加连接' })).not.toBeInTheDocument()
  })

  it('clears custom dialog state when canceled before reopening the picker', async () => {
    const user = userEvent.setup()
    testConnection.mockResolvedValueOnce({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true, message: '连接成功' })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /自定义连接/ }))

    await user.type(await screen.findByLabelText('添加连接 API key'), 'sk-custom-value')
    await user.type(screen.getByLabelText('添加连接 Endpoint'), 'https://api.example.com')
    await user.type(screen.getByLabelText('添加连接默认模型'), 'gpt-4o')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByRole('status')).toHaveTextContent('连接成功')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: '+ 添加连接' }))

    const picker = await screen.findByRole('dialog', { name: '添加连接' })
    expect(screen.queryByRole('dialog', { name: 'API 配置' })).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('sk-custom-value')).not.toBeInTheDocument()
    expect(screen.queryByText('连接成功')).not.toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: /自定义连接/ }))
    const apiDialog = await screen.findByRole('dialog', { name: 'API 配置' })
    expect(screen.getByLabelText('添加连接 API key')).toHaveValue('')
    expect(screen.queryByText('连接成功')).not.toBeInTheDocument()

    await user.click(within(apiDialog).getByRole('button', { name: '关闭 API 配置' }))
    await user.click(screen.getByRole('button', { name: '+ 添加连接' }))
    expect(await screen.findByRole('dialog', { name: '添加连接' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'API 配置' })).not.toBeInTheDocument()
  })

  it('keeps keyboard focus inside the full-window picker while tabbing', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))

    const picker = await screen.findByRole('dialog', { name: '添加连接' })
    await waitFor(() => expect(picker).toHaveFocus())

    const codexButton = within(picker).getByRole('button', { name: /ChatGPT\/Codex 连接/ })
    const customButton = within(picker).getByRole('button', { name: /自定义连接/ })
    const backButton = within(picker).getByRole('button', { name: 'Back' })
    backButton.focus()
    await user.keyboard('{Tab}')
    expect(codexButton).toHaveFocus()

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(backButton).toHaveFocus()

    codexButton.focus()
    await user.keyboard('{Tab}')
    expect(customButton).toHaveFocus()
  })

  it('adds a custom AI connection from the API configuration dialog', async () => {
    const user = userEvent.setup()
    testConnection.mockResolvedValueOnce({ providerId: 'custom-api-example-com', status: 'ok', hasApiKey: true, message: '连接成功' })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /自定义连接/ }))

    expect(await screen.findByRole('dialog', { name: 'API 配置' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('添加连接 API key'), 'sk-custom-value')
    await user.type(screen.getByLabelText('添加连接 Endpoint'), 'https://api.example.com')
    await user.type(screen.getByLabelText('添加连接默认模型'), 'gpt-4o, example-reasoner')
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith({
        providerId: 'custom-api-example-com',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-custom-value',
        modelId: 'gpt-4o'
      })
    })
    expect(await screen.findByRole('status')).toHaveTextContent('连接成功')
    expect(saveProvider).not.toHaveBeenCalled()
    expect(saveProviderApiKey).not.toHaveBeenCalled()
    expect(saveModel).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveProvider).toHaveBeenCalledWith(expect.objectContaining({
        id: 'custom-api-example-com',
        name: 'Api Example Com',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com',
        defaultModelId: 'custom-api-example-com/gpt-4o'
      }))
    })
    expect(saveProviderApiKey).toHaveBeenCalledWith({ providerId: 'custom-api-example-com', apiKey: 'sk-custom-value' })
    expect(saveModel).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'custom-api-example-com/gpt-4o',
      providerId: 'custom-api-example-com',
      modelName: 'gpt-4o'
    }))
    expect(saveModel).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'custom-api-example-com/example-reasoner',
      providerId: 'custom-api-example-com',
      modelName: 'example-reasoner',
      capabilities: ['streaming', 'toolCalls', 'reasoning']
    }))
    expect(saveModel).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'gpt-4o' }))
    expect(screen.queryByDisplayValue('sk-custom-value')).not.toBeInTheDocument()
  })

  it('shows failed connection test results as bounded error feedback', async () => {
    const user = userEvent.setup()
    const longMessage = '连接失败：API 返回 HTTP 400。模型不支持当前 Endpoint，请检查协议类型、Endpoint 和模型是否匹配。'.repeat(6)
    testConnection.mockResolvedValueOnce({
      providerId: 'custom-api-example-com',
      status: 'failed',
      hasApiKey: true,
      message: longMessage
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.click(await screen.findByRole('button', { name: /自定义连接/ }))
    await user.type(screen.getByLabelText('添加连接 API key'), 'sk-custom-value')
    await user.type(screen.getByLabelText('添加连接 Endpoint'), 'https://api.example.com')
    await user.type(screen.getByLabelText('添加连接默认模型'), 'gpt-4o')
    await user.click(screen.getByRole('button', { name: 'Test' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('连接失败：API 返回 HTTP 400')
    expect(alert).toHaveStyle({
      maxWidth: '100%',
      overflowWrap: 'anywhere',
      maxHeight: '120px',
      overflowY: 'auto'
    })
    expect(alert).not.toHaveTextContent('响应预览')
  })

  it('edits a connection from the menu without pre-filling the saved API key', async () => {
    const user = userEvent.setup()
    listModels.mockResolvedValue([
      ...baseModels,
      {
        id: 'deepseek-reasoner',
        providerId: 'deepseek',
        modelName: 'deepseek-reasoner',
        displayName: 'DeepSeek Reasoner',
        capabilities: ['streaming', 'toolCalls'],
        enabled: true,
        createdAt: now,
        updatedAt: now
      }
    ])
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '打开连接菜单 DeepSeek' }))
    expect(screen.queryByRole('menuitem', { name: '重命名' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '编辑' }))

    expect(await screen.findByRole('dialog', { name: 'API 配置' })).toBeInTheDocument()
    expect(screen.getByLabelText('添加连接 Endpoint')).toHaveValue('https://api.deepseek.com')
    expect(screen.getByLabelText('添加连接默认模型')).toHaveValue('deepseek-chat, deepseek-reasoner')
    expect(screen.getByLabelText('添加连接 API key')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith({
        providerId: 'deepseek',
        kind: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat'
      })
    })

    await user.clear(screen.getByLabelText('添加连接 Endpoint'))
    await user.type(screen.getByLabelText('添加连接 Endpoint'), 'https://api.deepseek.com/v1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }))
    })
    expect(saveModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat' }))
    expect(saveModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-reasoner', providerId: 'deepseek', modelName: 'deepseek-reasoner' }))
    expect(saveProviderApiKey).not.toHaveBeenCalled()
  })

  it('deletes a connection from the menu', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '打开连接菜单 DeepSeek' }))
    await user.click(screen.getByRole('menuitem', { name: '删除' }))

    await waitFor(() => {
      expect(deleteProvider).toHaveBeenCalledWith({ providerId: 'deepseek' })
    })
  })
})
