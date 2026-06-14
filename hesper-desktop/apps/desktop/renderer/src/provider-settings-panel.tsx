import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type {
  AppSettings,
  ModelDto,
  ModelProviderDto,
  ProviderConnectionTestResult,
  SaveModelInput,
  SaveModelProviderInput
} from '../../electron/ipc-contract'
import { hesperApi } from './ipc-client'
import {
  defaultFallbackModelId,
  fallbackSessionModelOptions,
  mergeModelOptions,
  parseModelCapabilities,
  validModelCapabilities
} from './model-options'

type ProviderKind = SaveModelProviderInput['kind']

const providerKindOptions: ProviderKind[] = ['mock', 'deepseek', 'openai', 'openai-compatible', 'anthropic', 'custom']

function isProviderKind(value: string): value is ProviderKind {
  return providerKindOptions.includes(value as ProviderKind)
}

type ProviderFormState = {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  defaultModelId: string
  enabled: boolean
}

type ModelFormState = {
  id: string
  providerId: string
  modelName: string
  displayName: string
  capabilities: string
  contextWindow: string
  enabled: boolean
}

export type ProviderSettingsPanelProps = {
  onModelRegistryChanged?: () => void | Promise<void>
}

function createProviderForm(provider?: ModelProviderDto): ProviderFormState {
  return {
    id: provider?.id ?? 'custom-openai-compatible',
    name: provider?.name ?? 'Custom OpenAI Compatible',
    kind: provider?.kind ?? 'openai-compatible',
    baseUrl: provider?.baseUrl ?? '',
    defaultModelId: provider?.defaultModelId ?? '',
    enabled: provider?.enabled ?? true
  }
}

function createModelForm(providerId: string, model?: ModelDto): ModelFormState {
  return {
    id: model?.id ?? `${providerId}/model`,
    providerId: model?.providerId ?? providerId,
    modelName: model?.modelName ?? 'model-name',
    displayName: model?.displayName ?? 'Model name',
    capabilities: model?.capabilities.join(', ') ?? 'streaming, toolCalls',
    contextWindow: model?.contextWindow ? String(model.contextWindow) : '',
    enabled: model?.enabled ?? true
  }
}

function formatUnknownError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function ProviderSettingsPanel({ onModelRegistryChanged }: ProviderSettingsPanelProps) {
  const [providers, setProviders] = useState<ModelProviderDto[]>([])
  const [models, setModels] = useState<ModelDto[]>([])
  const [appSettings, setAppSettings] = useState<AppSettings>()
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const [providerForm, setProviderForm] = useState<ProviderFormState>(() => createProviderForm())
  const [modelForm, setModelForm] = useState<ModelFormState>(() => createModelForm('mock'))
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [connectionResult, setConnectionResult] = useState<ProviderConnectionTestResult>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const mountedRef = useRef(true)
  const loadRequestIdRef = useRef(0)
  const defaultModelRequestIdRef = useRef(0)
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const providerModels = selectedProviderId ? models.filter((model) => model.providerId === selectedProviderId) : []
  const defaultModelOptions = mergeModelOptions(
    fallbackSessionModelOptions,
    models.filter((model) => model.enabled !== false).map((model) => model.id),
    [appSettings?.defaultModelId]
  )

  const loadProviderSettings = async (preferredProviderId = selectedProviderId) => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const [nextProviders, nextModels, nextSettings] = await Promise.all([
      hesperApi.providers.list(),
      hesperApi.models.list(),
      hesperApi.settings.get()
    ])

    if (!mountedRef.current || requestId !== loadRequestIdRef.current) {
      return
    }

    setProviders(nextProviders)
    setModels(nextModels)
    setAppSettings(nextSettings)
    const nextSelectedProvider = nextProviders.find((provider) => provider.id === preferredProviderId) ?? nextProviders[0]
    if (nextSelectedProvider) {
      setSelectedProviderId(nextSelectedProvider.id)
      setProviderForm(createProviderForm(nextSelectedProvider))
      setModelForm(createModelForm(nextSelectedProvider.id, nextModels.find((model) => model.providerId === nextSelectedProvider.id)))
    }
  }

  const refreshProviderSettings = async (preferredProviderId = selectedProviderId) => {
    setError(undefined)
    try {
      await loadProviderSettings(preferredProviderId)
    } catch (refreshError) {
      setError(`刷新失败：${formatUnknownError(refreshError, '未知错误')}`)
    }
  }

  useEffect(() => {
    void loadProviderSettings().catch((loadError) => {
      if (mountedRef.current) {
        setError(`模型来源加载失败：${formatUnknownError(loadError, '未知错误')}`)
      }
    })
    return () => {
      mountedRef.current = false
      loadRequestIdRef.current += 1
      defaultModelRequestIdRef.current += 1
    }
  }, [])

  const selectProvider = (provider: ModelProviderDto) => {
    loadRequestIdRef.current += 1
    setSelectedProviderId(provider.id)
    setProviderForm(createProviderForm(provider))
    setModelForm(createModelForm(provider.id, models.find((model) => model.providerId === provider.id)))
    setConnectionResult(undefined)
    setMessage(undefined)
    setError(undefined)
    setApiKeyInput('')
  }

  const saveProvider = async () => {
    setError(undefined)
    setMessage(undefined)
    try {
      const input: SaveModelProviderInput = {
        id: providerForm.id.trim(),
        name: providerForm.name.trim(),
        kind: providerForm.kind,
        enabled: providerForm.enabled,
        ...(providerForm.baseUrl.trim() ? { baseUrl: providerForm.baseUrl.trim() } : {}),
        ...(providerForm.defaultModelId.trim() ? { defaultModelId: providerForm.defaultModelId.trim() } : {})
      }
      const provider = await hesperApi.providers.save(input)
      if (!mountedRef.current) return
      setSelectedProviderId(provider.id)
      setProviderForm(createProviderForm(provider))
      setMessage(`已保存模型来源：${provider.name}`)
      try {
        await loadProviderSettings(provider.id)
      } catch (refreshError) {
        setError(`模型来源已保存，但刷新失败：${formatUnknownError(refreshError, '未知错误')}`)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '模型来源保存失败')
    }
  }

  const saveApiKey = async () => {
    const providerId = selectedProviderId
    const apiKey = apiKeyInput.trim()
    if (!providerId || !apiKey) return

    setError(undefined)
    setMessage(undefined)
    setApiKeyInput('')
    try {
      const status = await hesperApi.credentials.saveProviderApiKey({ providerId, apiKey })
      if (!mountedRef.current) return
      setMessage(status.hasApiKey ? 'API key 已安全保存。' : 'API key 未保存。')
      try {
        await loadProviderSettings(providerId)
      } catch (refreshError) {
        setError(`API key 已处理，但刷新失败：${formatUnknownError(refreshError, '未知错误')}`)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'API key 保存失败')
    }
  }

  const testConnection = async () => {
    if (!selectedProviderId) return
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await hesperApi.providers.testConnection({ providerId: selectedProviderId })
      if (!mountedRef.current) return
      setConnectionResult(result)
      setMessage(result.message)
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '连接测试失败')
    }
  }

  const disableProvider = async () => {
    if (!selectedProviderId) return
    setError(undefined)
    setMessage(undefined)
    try {
      const provider = await hesperApi.providers.disable({ providerId: selectedProviderId })
      if (!mountedRef.current) return
      setProviderForm(createProviderForm(provider))
      setMessage(`已停用：${provider.name}`)
      try {
        await loadProviderSettings(provider.id)
      } catch (refreshError) {
        setError(`模型来源已停用，但刷新失败：${formatUnknownError(refreshError, '未知错误')}`)
      }
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : '停用失败')
    }
  }

  const saveModel = async () => {
    setError(undefined)
    setMessage(undefined)

    const { capabilities, invalidCapabilities } = parseModelCapabilities(modelForm.capabilities)
    if (invalidCapabilities.length > 0) {
      setError(`未知模型能力：${invalidCapabilities.join(', ')}。可用值：${validModelCapabilities.join(', ')}`)
      return
    }

    const contextWindowInput = modelForm.contextWindow.trim()
    const contextWindow = contextWindowInput ? Number(contextWindowInput) : undefined
    if (contextWindow !== undefined && (!Number.isInteger(contextWindow) || contextWindow <= 0)) {
      setError('上下文窗口必须是正整数。')
      return
    }

    let model: ModelDto
    try {
      const input: SaveModelInput = {
        id: modelForm.id.trim(),
        providerId: modelForm.providerId.trim(),
        modelName: modelForm.modelName.trim(),
        displayName: modelForm.displayName.trim(),
        enabled: modelForm.enabled,
        ...(capabilities?.length ? { capabilities } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {})
      }
      model = await hesperApi.models.save(input)
      if (!mountedRef.current) return
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '模型保存失败')
      return
    }

    setModelForm(createModelForm(model.providerId, model))
    setMessage(`已保存模型：${model.displayName}`)

    try {
      await onModelRegistryChanged?.()
    } catch (refreshError) {
      setError(`模型已保存，但会话模型选项刷新失败：${formatUnknownError(refreshError, '未知错误')}`)
    }

    try {
      await loadProviderSettings(model.providerId)
    } catch (refreshError) {
      setError(`模型已保存，但刷新失败：${formatUnknownError(refreshError, '未知错误')}`)
    }
  }

  const updateDefaultModel = async (defaultModelId: string) => {
    const requestId = defaultModelRequestIdRef.current + 1
    const previousSettings = appSettings
    defaultModelRequestIdRef.current = requestId
    setError(undefined)
    setMessage(undefined)
    setAppSettings((current) => (current ? { ...current, defaultModelId } : current))

    try {
      const settings = await hesperApi.settings.update({ defaultModelId })
      if (!mountedRef.current || requestId !== defaultModelRequestIdRef.current) return
      setAppSettings(settings)
      setMessage(`默认模型已更新：${settings.defaultModelId}`)
    } catch (settingsError) {
      if (!mountedRef.current || requestId !== defaultModelRequestIdRef.current) return
      setAppSettings(previousSettings)
      setError(settingsError instanceof Error ? settingsError.message : '默认模型保存失败')
    }
  }

  return (
    <section aria-label="模型来源设置" style={settingsPanelStyle}>
      <header style={settingsHeaderStyle}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>模型来源</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>
            配置 DeepSeek、OpenAI 或自定义 OpenAI-compatible endpoint。API key 保存后不会回显。
          </p>
        </div>
        <button type="button" style={secondaryActionStyle} onClick={() => void refreshProviderSettings()}>
          刷新
        </button>
      </header>

      <div style={feedbackRowStyle}>
        {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}
        {message ? <p role="status" style={statusTextStyle}>{message}</p> : null}
      </div>

      <section aria-label="默认模型设置" style={settingsInlineCardStyle}>
        <label style={{ ...fieldStyle, minWidth: 280 }}>
          应用默认模型
          <select
            aria-label="应用默认模型"
            value={appSettings?.defaultModelId ?? defaultFallbackModelId}
            onChange={(event) => void updateDefaultModel(event.target.value)}
            style={inputStyle}
          >
            {defaultModelOptions.map((modelId) => (
              <option key={modelId} value={modelId}>{modelId}</option>
            ))}
          </select>
        </label>
        <span style={{ color: '#94a3b8' }}>新建会话默认使用此模型；已有会话仍可单独覆盖。</span>
      </section>

      <div style={settingsGridStyle}>
        <aside aria-label="模型来源列表" style={providerListStyle}>
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              aria-label={`选择模型来源 ${provider.name}`}
              aria-current={provider.id === selectedProviderId ? 'page' : undefined}
              onClick={() => selectProvider(provider)}
              style={{
                ...providerItemStyle,
                background: provider.id === selectedProviderId ? 'rgba(255, 255, 255, 0.07)' : providerItemStyle.background
              }}
            >
              <strong>{provider.name}</strong>
              <span style={{ color: '#94a3b8' }}>
                {provider.kind} · {provider.enabled ? '启用' : '停用'} · {provider.hasApiKey ? '已保存 key' : '未保存 key'}
              </span>
            </button>
          ))}
        </aside>

        <div style={settingsDetailStyle}>
          <section aria-label="编辑模型来源" style={settingsCardStyle}>
            <h3 style={cardTitleStyle}>Provider</h3>
            <div style={formGridStyle}>
              <label style={fieldStyle}>
                ID
                <input aria-label="Provider ID" value={providerForm.id} onChange={(event) => setProviderForm((current) => ({ ...current, id: event.target.value }))} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                名称
                <input aria-label="Provider 名称" value={providerForm.name} onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                类型
                <select
                  aria-label="Provider 类型"
                  value={providerForm.kind}
                  onChange={(event) => {
                    const kind = event.target.value
                    if (!isProviderKind(kind)) {
                      setError(`未知 provider 类型：${kind}`)
                      return
                    }
                    setProviderForm((current) => ({ ...current, kind }))
                  }}
                  style={inputStyle}
                >
                  {providerKindOptions.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                Base URL
                <input aria-label="Provider Base URL" value={providerForm.baseUrl} onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.deepseek.com" style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                默认模型
                <input aria-label="Provider 默认模型" value={providerForm.defaultModelId} onChange={(event) => setProviderForm((current) => ({ ...current, defaultModelId: event.target.value }))} style={inputStyle} />
              </label>
              <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input aria-label="Provider 启用" type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm((current) => ({ ...current, enabled: event.target.checked }))} /> 启用
              </label>
            </div>
            <div style={actionRowStyle}>
              <button type="button" style={primaryActionStyle} onClick={() => void saveProvider()}>保存来源</button>
              <button type="button" style={secondaryActionStyle} onClick={() => void disableProvider()} disabled={!selectedProvider}>停用来源</button>
            </div>
          </section>

          <section aria-label="API key 存储" style={settingsCardStyle}>
            <h3 style={cardTitleStyle}>API Key</h3>
            <p style={{ margin: '0 0 10px', color: '#94a3b8' }}>
              状态：{selectedProvider?.hasApiKey ? '已保存' : '未保存'}；引用：{selectedProvider?.apiKeyRef ?? '未选择'}
            </p>
            <label style={fieldStyle}>
              API key
              <input aria-label="Provider API key" type="password" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} placeholder="保存后会立即清空" style={inputStyle} />
            </label>
            <div style={actionRowStyle}>
              <button type="button" style={primaryActionStyle} onClick={() => void saveApiKey()} disabled={!selectedProviderId || !apiKeyInput.trim()}>
                安全保存 API key
              </button>
              <button type="button" style={secondaryActionStyle} onClick={() => void testConnection()} disabled={!selectedProviderId}>测试连接</button>
              {connectionResult ? <span style={{ color: connectionResult.status === 'ok' ? '#86efac' : '#fbbf24' }}>{connectionResult.status}</span> : null}
            </div>
          </section>

          <section aria-label="模型配置" style={settingsCardStyle}>
            <h3 style={cardTitleStyle}>Models</h3>
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              {providerModels.map((model) => (
                <button key={model.id} type="button" aria-label={`编辑模型 ${model.displayName}`} onClick={() => setModelForm(createModelForm(model.providerId, model))} style={modelItemStyle}>
                  <strong>{model.displayName}</strong>
                  <span style={{ color: '#94a3b8' }}>{model.id} · {model.enabled === false ? '停用' : '启用'} · {model.capabilities.join(', ')}</span>
                </button>
              ))}
            </div>
            <div style={formGridStyle}>
              <label style={fieldStyle}>
                模型 ID
                <input aria-label="模型 ID" value={modelForm.id} onChange={(event) => setModelForm((current) => ({ ...current, id: event.target.value }))} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Provider ID
                <input aria-label="模型 Provider ID" value={modelForm.providerId} onChange={(event) => setModelForm((current) => ({ ...current, providerId: event.target.value }))} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                模型名称
                <input aria-label="模型名称" value={modelForm.modelName} onChange={(event) => setModelForm((current) => ({ ...current, modelName: event.target.value }))} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                展示名
                <input aria-label="模型展示名" value={modelForm.displayName} onChange={(event) => setModelForm((current) => ({ ...current, displayName: event.target.value }))} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                能力
                <input aria-label="模型能力" value={modelForm.capabilities} onChange={(event) => setModelForm((current) => ({ ...current, capabilities: event.target.value }))} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                上下文窗口
                <input aria-label="模型上下文窗口" value={modelForm.contextWindow} onChange={(event) => setModelForm((current) => ({ ...current, contextWindow: event.target.value }))} style={inputStyle} />
              </label>
            </div>
            <div style={actionRowStyle}>
              <button type="button" style={primaryActionStyle} onClick={() => void saveModel()}>保存模型</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

const settingsPanelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: 'auto auto auto minmax(0, 1fr)',
  gap: 12,
  border: 0,
  borderRadius: 0,
  background: 'transparent',
  padding: 0,
  overflow: 'hidden',
  fontSize: 13
}

const settingsHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12
}

const feedbackRowStyle: CSSProperties = {
  minHeight: 20,
  display: 'grid',
  alignContent: 'center'
}

const settingsInlineCardStyle: CSSProperties = {
  borderRadius: 14,
  border: 0,
  background: 'rgba(255, 255, 255, 0.04)',
  padding: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap'
}

const settingsGridStyle: CSSProperties = {
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: 12,
  overflow: 'hidden'
}

const providerListStyle: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: 8
}

const providerItemStyle: CSSProperties = {
  borderRadius: 12,
  border: 0,
  outline: 0,
  background: 'rgba(255, 255, 255, 0.04)',
  color: '#e8ecfb',
  padding: 10,
  cursor: 'pointer',
  textAlign: 'left',
  display: 'grid',
  gap: 4
}

const settingsDetailStyle: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: 12
}

const settingsCardStyle: CSSProperties = {
  borderRadius: 14,
  border: 0,
  background: 'rgba(255, 255, 255, 0.04)',
  padding: 14
}

const cardTitleStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 15
}

const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  color: '#cbd5e1',
  fontSize: 12
}

const inputStyle: CSSProperties = {
  borderRadius: 10,
  border: 0,
  outline: 0,
  background: 'rgba(255, 255, 255, 0.045)',
  color: '#f8fafc',
  padding: '8px 10px'
}

const actionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginTop: 12,
  flexWrap: 'wrap'
}

const primaryActionStyle: CSSProperties = {
  border: 0,
  outline: 0,
  borderRadius: 10,
  padding: '10px 18px',
  background: 'rgba(127, 158, 232, 0.24)',
  color: '#eef2ff',
  fontWeight: 700,
  cursor: 'pointer'
}

const secondaryActionStyle: CSSProperties = {
  borderRadius: 10,
  border: 0,
  outline: 0,
  background: 'rgba(255, 255, 255, 0.045)',
  color: '#e5e7eb',
  padding: '8px 12px',
  cursor: 'pointer'
}

const modelItemStyle: CSSProperties = {
  borderRadius: 10,
  border: 0,
  outline: 0,
  background: 'rgba(255, 255, 255, 0.04)',
  color: '#e5e7eb',
  padding: 10,
  textAlign: 'left',
  display: 'grid',
  gap: 4,
  cursor: 'pointer'
}

const statusTextStyle: CSSProperties = {
  margin: 0,
  color: '#86efac'
}

const errorTextStyle: CSSProperties = {
  margin: 0,
  color: '#fca5a5'
}
