// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  testConnection.mockResolvedValue({ providerId: 'deepseek', status: 'warning', message: 'API key missing', checkedAt: now })
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
    expect(screen.getByRole('button', { name: '选择模型来源 DeepSeek' })).toHaveTextContent('未保存 key')
    expect(screen.getByRole('button', { name: '选择模型来源 OpenAI' })).toBeInTheDocument()
  })

  it('saves an API key through secure IPC and clears the raw value immediately after save', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '选择模型来源 DeepSeek' }))
    const keyInput = screen.getByLabelText('Provider API key') as HTMLInputElement
    await user.type(keyInput, 'sk-secret-value')
    await user.click(screen.getByRole('button', { name: '安全保存 API key' }))

    await waitFor(() => {
      expect(saveProviderApiKey).toHaveBeenCalledWith({ providerId: 'deepseek', apiKey: 'sk-secret-value' })
    })
    expect(keyInput).toHaveValue('')
    expect(screen.queryByDisplayValue('sk-secret-value')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('API key 已安全保存')
  })

  it('surfaces refresh errors instead of leaving an unhandled rejection', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await screen.findByRole('button', { name: '选择模型来源 DeepSeek' })
    listProviders.mockRejectedValueOnce(new Error('refresh failed'))

    await user.click(screen.getByRole('button', { name: '刷新' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败：refresh failed')
  })

  it('ignores stale refreshes after the user selects another provider', async () => {
    const user = userEvent.setup()
    const deferredProviders = createDeferred<any[]>()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '选择模型来源 DeepSeek' }))
    listProviders.mockImplementationOnce(() => deferredProviders.promise)

    await user.click(screen.getByRole('button', { name: '刷新' }))
    await user.click(screen.getByRole('button', { name: '选择模型来源 OpenAI' }))
    deferredProviders.resolve(baseProviders)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择模型来源 OpenAI' })).toHaveAttribute('aria-current', 'page')
    })
  })

  it('updates the application default model from enabled persisted models', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    const defaultModelSelect = await screen.findByRole('combobox', { name: '应用默认模型' })

    await user.selectOptions(defaultModelSelect, 'deepseek-chat')

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ defaultModelId: 'deepseek-chat' })
    })
    expect(await screen.findByRole('status')).toHaveTextContent('默认模型已更新：deepseek-chat')
  })

  it('rolls back optimistic default-model changes when save fails', async () => {
    const user = userEvent.setup()
    updateSettings.mockRejectedValueOnce(new Error('settings save failed'))
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    const defaultModelSelect = await screen.findByRole('combobox', { name: '应用默认模型' })

    await user.selectOptions(defaultModelSelect, 'deepseek-chat')

    expect(await screen.findByRole('alert')).toHaveTextContent('settings save failed')
    expect(defaultModelSelect).toHaveValue('mock/hesper-fast')
  })

  it('ignores stale default-model update responses', async () => {
    const user = userEvent.setup()
    const firstUpdate = createDeferred<any>()
    const secondUpdate = createDeferred<any>()
    updateSettings.mockImplementationOnce(() => firstUpdate.promise)
    updateSettings.mockImplementationOnce(() => secondUpdate.promise)
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    const defaultModelSelect = await screen.findByRole('combobox', { name: '应用默认模型' })

    await user.selectOptions(defaultModelSelect, 'deepseek-chat')
    await user.selectOptions(defaultModelSelect, 'gpt-4o')

    secondUpdate.resolve({ defaultModelId: 'gpt-4o', defaultOutputMode: 'markdown', themeMode: 'dark' })
    await waitFor(() => {
      expect(defaultModelSelect).toHaveValue('gpt-4o')
    })

    firstUpdate.resolve({ defaultModelId: 'deepseek-chat', defaultOutputMode: 'markdown', themeMode: 'dark' })
    await waitFor(() => {
      expect(defaultModelSelect).toHaveValue('gpt-4o')
    })
  })

  it('rejects invalid model capabilities before calling save IPC', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '选择模型来源 DeepSeek' }))

    await user.clear(screen.getByLabelText('模型能力'))
    await user.type(screen.getByLabelText('模型能力'), 'streaming, json')
    await user.click(screen.getByRole('button', { name: '保存模型' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('未知模型能力：json')
    expect(saveModel).not.toHaveBeenCalled()
  })

  it('rejects invalid context window before calling save IPC', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '选择模型来源 DeepSeek' }))

    await user.clear(screen.getByLabelText('模型上下文窗口'))
    await user.type(screen.getByLabelText('模型上下文窗口'), 'NaN')
    await user.click(screen.getByRole('button', { name: '保存模型' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('上下文窗口必须是正整数')
    expect(saveModel).not.toHaveBeenCalled()
  })

  it('does not report a model save failure when only post-save refresh fails', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '选择模型来源 DeepSeek' }))
    listProviders.mockRejectedValueOnce(new Error('reload failed'))

    await user.clear(screen.getByLabelText('模型展示名'))
    await user.type(screen.getByLabelText('模型展示名'), 'DeepSeek Chat Updated')
    await user.click(screen.getByRole('button', { name: '保存模型' }))

    await waitFor(() => {
      expect(saveModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-chat', displayName: 'DeepSeek Chat Updated' }))
    })
    expect(await screen.findByRole('status')).toHaveTextContent('已保存模型：DeepSeek Chat Updated')
    expect(await screen.findByRole('alert')).toHaveTextContent('模型已保存，但刷新失败：reload failed')
    expect(screen.queryByText('模型保存失败')).not.toBeInTheDocument()
  })

  it('saves provider edits, tests connection, disables provider, and saves a model', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: '选择模型来源 DeepSeek' }))

    await user.clear(screen.getByLabelText('Provider Base URL'))
    await user.type(screen.getByLabelText('Provider Base URL'), 'https://api.deepseek.com/v1')
    await user.click(screen.getByRole('button', { name: '保存来源' }))
    await waitFor(() => {
      expect(saveProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }))
    })

    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() => {
      expect(testConnection).toHaveBeenCalledWith({ providerId: 'deepseek' })
    })

    await user.click(screen.getByRole('button', { name: '停用来源' }))
    await waitFor(() => {
      expect(disableProvider).toHaveBeenCalledWith({ providerId: 'deepseek' })
    })

    await user.clear(screen.getByLabelText('模型展示名'))
    await user.type(screen.getByLabelText('模型展示名'), 'DeepSeek Chat Updated')
    await user.click(screen.getByRole('button', { name: '保存模型' }))
    await waitFor(() => {
      expect(saveModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-chat', displayName: 'DeepSeek Chat Updated' }))
    })
  })
})
