import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  ModelDto,
  ModelProviderDto,
  ProviderConnectionTestResult,
  SaveModelProviderInput
} from '../../electron/ipc-contract'
import { hesperApi } from './ipc-client'

type ProtocolMode = 'openai-compatible' | 'anthropic-compatible'
type ConnectionDialogMode = 'add' | 'edit'

type ConnectionFormState = {
  apiKey: string
  endpoint: string
  protocol: ProtocolMode
  defaultModelId: string
}

type ConnectionDialogState = {
  mode: ConnectionDialogMode
  providerId?: string
  form: ConnectionFormState
}

export type ProviderSettingsPanelProps = {
  onModelRegistryChanged?: () => void | Promise<void>
}

function createConnectionForm(provider?: ModelProviderDto, models: ModelDto[] = []): ConnectionFormState {
  const primaryModel = provider ? models.find((model) => model.providerId === provider.id) : undefined
  return {
    apiKey: '',
    endpoint: provider?.baseUrl ?? '',
    protocol: provider?.kind === 'anthropic' ? 'anthropic-compatible' : 'openai-compatible',
    defaultModelId: provider?.defaultModelId ?? primaryModel?.id ?? ''
  }
}

function formatUnknownError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function slugFromEndpoint(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname
    const slug = host.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    return slug || 'custom-ai'
  } catch {
    const slug = endpoint.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    return slug || 'custom-ai'
  }
}

function titleFromSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ') || 'Custom AI'
}

function providerKindForProtocol(protocol: ProtocolMode): SaveModelProviderInput['kind'] {
  return protocol === 'anthropic-compatible' ? 'anthropic' : 'openai-compatible'
}

export function ProviderSettingsPanel({ onModelRegistryChanged }: ProviderSettingsPanelProps) {
  const [providers, setProviders] = useState<ModelProviderDto[]>([])
  const [models, setModels] = useState<ModelDto[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const [dialogState, setDialogState] = useState<ConnectionDialogState>()
  const [openMenuProviderId, setOpenMenuProviderId] = useState<string>()
  const [connectionResult, setConnectionResult] = useState<ProviderConnectionTestResult>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const mountedRef = useRef(true)
  const loadRequestIdRef = useRef(0)

  const visibleProviders = useMemo(() => providers.filter((provider) => provider.enabled !== false), [providers])

  const loadProviderSettings = async (preferredProviderId = selectedProviderId) => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const [nextProviders, nextModels] = await Promise.all([
      hesperApi.providers.list(),
      hesperApi.models.list()
    ])

    if (!mountedRef.current || requestId !== loadRequestIdRef.current) {
      return
    }

    setProviders(nextProviders)
    setModels(nextModels)
    const nextVisibleProviders = nextProviders.filter((provider) => provider.enabled !== false)
    const nextSelectedProvider = nextVisibleProviders.find((provider) => provider.id === preferredProviderId) ?? nextVisibleProviders[0]
    setSelectedProviderId(nextSelectedProvider?.id)
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
    }
  }, [])

  const openAddConnection = () => {
    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    setOpenMenuProviderId(undefined)
    setDialogState({ mode: 'add', form: createConnectionForm() })
  }

  const openEditConnection = (provider: ModelProviderDto) => {
    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    setOpenMenuProviderId(undefined)
    setSelectedProviderId(provider.id)
    setDialogState({ mode: 'edit', providerId: provider.id, form: createConnectionForm(provider, models) })
  }

  const updateDialogForm = (updater: ConnectionFormState | ((current: ConnectionFormState) => ConnectionFormState)) => {
    setDialogState((current) => current ? { ...current, form: typeof updater === 'function' ? updater(current.form) : updater } : current)
  }

  const saveConnection = async () => {
    if (!dialogState) return

    const endpoint = dialogState.form.endpoint.trim()
    const apiKey = dialogState.form.apiKey.trim()
    const modelIds = dialogState.form.defaultModelId.split(',').map((item) => item.trim()).filter(Boolean)
    const primaryModelId = modelIds[0]
    const existingProvider = dialogState.providerId ? providers.find((provider) => provider.id === dialogState.providerId) : undefined
    const providerSlug = endpoint ? slugFromEndpoint(endpoint) : 'custom-ai'
    const providerId = existingProvider?.id ?? `custom-${providerSlug}`
    const providerName = existingProvider?.name ?? titleFromSlug(providerSlug)

    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    updateDialogForm((current) => ({ ...current, apiKey: '' }))

    try {
      const provider = await hesperApi.providers.save({
        id: providerId,
        name: providerName,
        kind: providerKindForProtocol(dialogState.form.protocol),
        enabled: true,
        ...(endpoint ? { baseUrl: endpoint } : existingProvider?.baseUrl ? { baseUrl: existingProvider.baseUrl } : {}),
        ...(primaryModelId ? { defaultModelId: primaryModelId } : existingProvider?.defaultModelId ? { defaultModelId: existingProvider.defaultModelId } : {})
      })

      if (apiKey) {
        await hesperApi.credentials.saveProviderApiKey({ providerId: provider.id, apiKey })
      }

      if (primaryModelId) {
        await hesperApi.models.save({
          id: primaryModelId,
          providerId: provider.id,
          modelName: primaryModelId,
          displayName: primaryModelId,
          capabilities: ['streaming', 'toolCalls'],
          enabled: true
        })
      }

      if (!mountedRef.current) return
      setDialogState(undefined)
      setMessage(dialogState.mode === 'edit' ? `已保存连接：${provider.name}` : `已添加连接：${provider.name}`)
      await loadProviderSettings(provider.id)
      await onModelRegistryChanged?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '连接保存失败')
    }
  }

  const testDialogConnection = async () => {
    if (!dialogState?.providerId) return
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await hesperApi.providers.testConnection({ providerId: dialogState.providerId })
      if (!mountedRef.current) return
      setConnectionResult(result)
      setMessage(result.message)
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '连接测试失败')
    }
  }

  const deleteConnection = async (provider: ModelProviderDto) => {
    setOpenMenuProviderId(undefined)
    setError(undefined)
    setMessage(undefined)
    try {
      await hesperApi.providers.delete({ providerId: provider.id })
      if (!mountedRef.current) return
      setMessage(`已删除连接：${provider.name}`)
      await loadProviderSettings()
      await onModelRegistryChanged?.()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除连接失败')
    }
  }

  return (
    <section aria-label="模型来源设置" style={settingsPanelStyle} onClick={() => setOpenMenuProviderId(undefined)}>
      <header style={settingsHeaderStyle}>
        <h2 style={{ margin: 0, fontSize: 15, lineHeight: '24px', textAlign: 'center', fontWeight: 700 }}>AI</h2>
      </header>

      <div style={feedbackRowStyle}>
        {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}
        {message ? <p role="status" style={statusTextStyle}>{message}</p> : null}
      </div>

      <div className="hesper-scroll-invisible" style={scrollContentStyle}>
        <section aria-label="AI 连接" style={sectionBlockStyle}>
          <div>
            <h3 style={sectionTitleStyle}>连接</h3>
            <p style={sectionDescriptionStyle}>管理 AI 提供商连接。</p>
          </div>
          <div style={connectionListStyle}>
            {visibleProviders.map((provider, index) => (
              <div key={provider.id} style={{ ...connectionItemStyle, ...(index === visibleProviders.length - 1 ? { borderBottom: 0 } : {}) }}>
                <button
                  type="button"
                  aria-label={`选择模型来源 ${provider.name}`}
                  aria-current={provider.id === selectedProviderId ? 'page' : undefined}
                  onClick={() => setSelectedProviderId(provider.id)}
                  style={{ ...connectionInfoButtonStyle, ...(provider.id === selectedProviderId ? { background: 'rgba(255, 255, 255, 0.055)' } : {}) }}
                >
                  <span style={providerAvatarStyle}>{provider.name.slice(0, 1).toUpperCase()}</span>
                  <span style={{ minWidth: 0 }}>
                    <strong>{provider.name}</strong>
                    <span style={providerMetaStyle}>
                      {provider.kind} · {provider.baseUrl ?? '使用默认端点'} · {provider.hasApiKey ? '已保存 key' : '未保存 key'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`打开连接菜单 ${provider.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpenMenuProviderId((current) => current === provider.id ? undefined : provider.id)
                  }}
                  style={menuButtonStyle}
                >
                  •••
                </button>
                {openMenuProviderId === provider.id ? (
                  <div role="menu" aria-label={`${provider.name} 连接菜单`} style={connectionMenuStyle} onClick={(event) => event.stopPropagation()}>
                    <button type="button" role="menuitem" style={connectionMenuItemStyle} onClick={() => openEditConnection(provider)}>编辑</button>
                    <button type="button" role="menuitem" style={{ ...connectionMenuItemStyle, color: '#fca5a5' }} onClick={() => void deleteConnection(provider)}>删除</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <button type="button" style={secondaryActionStyle} onClick={openAddConnection}>+ 添加连接</button>
        </section>
      </div>

      {dialogState ? (
        <ConnectionDialog
          state={dialogState}
          {...(connectionResult ? { connectionResult } : {})}
          updateForm={updateDialogForm}
          onCancel={() => {
            setConnectionResult(undefined)
            setDialogState(undefined)
          }}
          {...(dialogState.mode === 'edit' ? { onTest: () => void testDialogConnection() } : {})}
          onSave={() => void saveConnection()}
        />
      ) : null}
    </section>
  )
}

function ConnectionDialog({
  state,
  connectionResult,
  updateForm,
  onCancel,
  onTest,
  onSave
}: {
  state: ConnectionDialogState
  connectionResult?: ProviderConnectionTestResult
  updateForm: (updater: ConnectionFormState | ((current: ConnectionFormState) => ConnectionFormState)) => void
  onCancel: () => void
  onTest?: () => void
  onSave: () => void
}) {
  const hasSavedKey = state.mode === 'edit'
  return (
    <div role="dialog" aria-modal="true" aria-label="API 配置" style={overlayStyle}>
      <button type="button" aria-label="关闭 API 配置" onClick={onCancel} style={overlayCloseStyle}>×</button>
      <div style={overlayFormStyle}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>API 配置</h2>
          <p style={{ margin: '12px 0 0', color: mutedTextColor, lineHeight: 1.5 }}>
            Select a provider preset and enter the API key. Saved keys are not displayed; leave the key empty to keep it unchanged.
          </p>
        </header>
        <label style={fieldStyle}>
          API Key
          <input
            aria-label="添加连接 API key"
            type="password"
            value={state.form.apiKey}
            onChange={(event) => updateForm((current) => ({ ...current, apiKey: event.target.value }))}
            placeholder={hasSavedKey ? '已保存，留空不更改' : 'Paste your key here...'}
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          Endpoint
          <input
            aria-label="添加连接 Endpoint"
            value={state.form.endpoint}
            onChange={(event) => updateForm((current) => ({ ...current, endpoint: event.target.value }))}
            placeholder="https://your-api-endpoint.com"
            style={inputStyle}
          />
        </label>
        <div style={fieldStyle}>
          Protocol
          <div style={segmentedControlStyle}>
            <button
              type="button"
              aria-pressed={state.form.protocol === 'openai-compatible'}
              onClick={() => updateForm((current) => ({ ...current, protocol: 'openai-compatible' }))}
              style={{ ...segmentButtonStyle, ...(state.form.protocol === 'openai-compatible' ? activeSegmentButtonStyle : {}) }}
            >
              OpenAI Compatible
            </button>
            <button
              type="button"
              aria-pressed={state.form.protocol === 'anthropic-compatible'}
              onClick={() => updateForm((current) => ({ ...current, protocol: 'anthropic-compatible' }))}
              style={{ ...segmentButtonStyle, ...(state.form.protocol === 'anthropic-compatible' ? activeSegmentButtonStyle : {}) }}
            >
              Anthropic Compatible
            </button>
          </div>
          <span style={{ color: mutedTextColor }}>Most third-party APIs use OpenAI Compatible.</span>
        </div>
        <label style={fieldStyle}>
          Default Model · optional
          <input
            aria-label="添加连接默认模型"
            value={state.form.defaultModelId}
            onChange={(event) => updateForm((current) => ({ ...current, defaultModelId: event.target.value }))}
            placeholder="deepseek-chat, gpt-4o-mini"
            style={inputStyle}
          />
          <span style={{ color: mutedTextColor }}>Comma-separated list. The first model is the default.</span>
        </label>
        {connectionResult ? <p role="status" style={statusTextStyle}>{connectionResult.message}</p> : null}
        <footer style={{ display: 'grid', gridTemplateColumns: onTest ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onCancel} style={secondaryActionStyle}>Back</button>
          {onTest ? <button type="button" onClick={onTest} style={secondaryActionStyle}>连接</button> : null}
          <button type="button" onClick={onSave} style={primaryActionStyle}>保存</button>
        </footer>
      </div>
    </div>
  )
}

const mutedTextColor = '#969db8'

const settingsPanelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: 'auto auto minmax(0, 1fr)',
  gap: 14,
  border: 0,
  borderRadius: 0,
  background: 'transparent',
  padding: 0,
  overflow: 'hidden',
  fontSize: 13
}

const settingsHeaderStyle: CSSProperties = {
  position: 'relative',
  minHeight: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const feedbackRowStyle: CSSProperties = {
  minHeight: 20,
  display: 'grid',
  alignContent: 'center'
}

const scrollContentStyle: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: 24,
  paddingRight: 2
}

const sectionBlockStyle: CSSProperties = {
  display: 'grid',
  gap: 12
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 17,
  lineHeight: 1.2
}

const sectionDescriptionStyle: CSSProperties = {
  margin: '4px 0 0',
  color: mutedTextColor,
  lineHeight: 1.45
}

const connectionListStyle: CSSProperties = {
  borderRadius: 16,
  background: 'rgba(255, 255, 255, 0.025)',
  overflow: 'visible'
}

const connectionItemStyle: CSSProperties = {
  position: 'relative',
  minHeight: 68,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'stretch',
  borderBottom: '1px solid rgba(255, 255, 255, 0.045)'
}

const connectionInfoButtonStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  background: 'transparent',
  color: '#e8ecfb',
  padding: '12px 14px',
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left',
  cursor: 'pointer'
}

const providerAvatarStyle: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.055)',
  color: mutedTextColor,
  display: 'grid',
  placeItems: 'center',
  fontSize: 12,
  fontWeight: 700
}

const providerMetaStyle: CSSProperties = {
  display: 'block',
  color: mutedTextColor,
  marginTop: 3,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const menuButtonStyle: CSSProperties = {
  width: 44,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: mutedTextColor,
  cursor: 'pointer',
  letterSpacing: 1
}

const connectionMenuStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 10,
  right: 8,
  top: 46,
  minWidth: 112,
  borderRadius: 12,
  background: '#202434',
  padding: 6,
  boxShadow: '0 18px 36px rgba(0, 0, 0, 0.28)'
}

const connectionMenuItemStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: 9,
  background: 'transparent',
  color: '#e8ecfb',
  padding: '8px 10px',
  textAlign: 'left',
  cursor: 'pointer'
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  color: '#cbd3ee',
  fontSize: 12
}

const inputStyle: CSSProperties = {
  borderRadius: 10,
  border: 0,
  outline: 0,
  background: 'rgba(255, 255, 255, 0.045)',
  color: '#f8fafc',
  padding: '9px 11px'
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

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 20,
  background: '#171a26',
  display: 'grid',
  placeItems: 'center',
  padding: 24
}

const overlayCloseStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 30,
  height: 30,
  border: 0,
  outline: 0,
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.04)',
  color: mutedTextColor,
  cursor: 'pointer'
}

const overlayFormStyle: CSSProperties = {
  width: 'min(440px, 100%)',
  display: 'grid',
  gap: 18
}

const segmentedControlStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.035)',
  overflow: 'hidden'
}

const segmentButtonStyle: CSSProperties = {
  border: 0,
  outline: 0,
  background: 'transparent',
  color: mutedTextColor,
  padding: '10px 12px',
  cursor: 'pointer'
}

const activeSegmentButtonStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.055)',
  color: '#eef2ff',
  fontWeight: 700
}

const statusTextStyle: CSSProperties = {
  margin: 0,
  color: '#86efac'
}

const errorTextStyle: CSSProperties = {
  margin: 0,
  color: '#fca5a5'
}
