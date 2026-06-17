// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

const now = '2026-06-10T03:00:00.000Z'

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
  listModels,
  saveModel,
  saveProviderApiKey,
  getSettings,
  updateSettings
} = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  onEvent: vi.fn(() => () => undefined),
  listProviders: vi.fn(),
  saveProvider: vi.fn(),
  disableProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testConnection: vi.fn(),
  listModels: vi.fn(),
  saveModel: vi.fn(),
  saveProviderApiKey: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn()
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
    agent: { enqueue: vi.fn(), onEvent },
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
      testConnection
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
  saveModel.mockImplementation(async (input: any) => ({ ...baseModels[1], ...input, createdAt: now, updatedAt: now }))
  saveProviderApiKey.mockResolvedValue({ providerId: 'deepseek', apiKeyRef: 'provider:deepseek:api-key', hasApiKey: true, encryptionAvailable: true })
  getSettings.mockResolvedValue({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark' })
  updateSettings.mockImplementation(async (input: any) => ({ defaultModelId: input.defaultModelId ?? 'mock/hesper-fast', defaultOutputMode: input.defaultOutputMode ?? 'markdown', themeMode: input.themeMode ?? 'dark' }))
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
    expect(screen.getByRole('button', { name: '选择模型来源 DeepSeek' })).toHaveTextContent('未保存 key')
    expect(screen.getByRole('button', { name: '选择模型来源 OpenAI' })).toBeInTheDocument()
  })

  it('renders provider connections as one block with unclipped menus', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))

    const mockButton = await screen.findByRole('button', { name: '选择模型来源 Mock' })
    const deepSeekButton = screen.getByRole('button', { name: '选择模型来源 DeepSeek' })
    const mockItem = mockButton.closest('div')
    const deepSeekItem = deepSeekButton.closest('div')
    const connectionList = mockItem?.parentElement

    expect(connectionList).toHaveStyle({
      gap: '0px',
      background: 'rgba(255, 255, 255, 0.035)'
    })
    expect(mockItem?.style.border).toBe('0px')
    expect(mockItem?.style.boxShadow).toBe('none')
    expect(mockItem).toHaveStyle({ overflow: 'visible' })
    expect(deepSeekItem).toHaveStyle({
      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
      overflow: 'visible'
    })

    await user.click(deepSeekButton)
    expect(deepSeekItem?.style.borderColor).not.toContain('127, 158, 232')

    await user.click(screen.getByRole('button', { name: '打开连接菜单 DeepSeek' }))
    expect(await screen.findByRole('menu', { name: 'DeepSeek 连接菜单' })).toBeInTheDocument()
    expect(deepSeekItem).toHaveStyle({ overflow: 'visible' })
  })

  it('adds a custom AI connection from the API configuration dialog', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))

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
      modelName: 'example-reasoner'
    }))
    expect(saveModel).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'gpt-4o' }))
    expect(screen.queryByDisplayValue('sk-custom-value')).not.toBeInTheDocument()
  })

  it('shows failed connection test results as bounded error feedback', async () => {
    const user = userEvent.setup()
    const longMessage = 'Custom AI 连接失败：API 返回了成功状态，但响应格式中没有 assistant 文本。请检查协议类型、Endpoint 和模型是否匹配。响应预览：' + JSON.stringify({
      id: 'bfbd7b92-de7b-4bb3-b095-4625c817cc19',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: '', reasoning_content: 'We need to reason through a very long response preview without stretching the dialog layout.' } }]
    })
    testConnection.mockResolvedValueOnce({
      providerId: 'custom-api-example-com',
      status: 'failed',
      hasApiKey: true,
      message: longMessage
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
    await user.type(screen.getByLabelText('添加连接 API key'), 'sk-custom-value')
    await user.type(screen.getByLabelText('添加连接 Endpoint'), 'https://api.example.com')
    await user.type(screen.getByLabelText('添加连接默认模型'), 'gpt-4o')
    await user.click(screen.getByRole('button', { name: 'Test' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Custom AI 连接失败')
    expect(alert).toHaveStyle({
      maxWidth: '100%',
      overflowWrap: 'anywhere',
      maxHeight: '120px',
      overflowY: 'auto'
    })
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
