import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type {
  ModelDto,
  ModelProviderDto,
  ProviderConnectionTestInput,
  ProviderConnectionTestResult,
  SaveModelProviderInput
} from '../../electron/ipc-contract'
import { hesperApi } from './ipc-client'
import { modelNameFromNamespacedId, namespaceModelId } from './model-options'

type ProtocolMode = 'openai-compatible' | 'anthropic-compatible'
type ConnectionDialogMode = 'add' | 'edit'
type AddConnectionFlow = 'picker' | 'custom' | 'codex'

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

type CodexOAuthState = {
  connectionName: string
  sessionId?: string
  status: 'idle' | 'pending' | 'authorized' | 'failed'
  message?: string
}

const initialCodexOAuthState: CodexOAuthState = { connectionName: 'ChatGPT Codex', status: 'idle' }

export type ProviderSettingsPanelProps = {
  onModelRegistryChanged?: () => void | Promise<void>
}

function createConnectionForm(provider?: ModelProviderDto, models: ModelDto[] = []): ConnectionFormState {
  const providerModels = provider ? models.filter((model) => model.providerId === provider.id && model.enabled !== false) : []
  const orderedModelIds = provider
    ? [
        ...(provider.defaultModelId ? [displayModelIdForProvider(provider.id, provider.defaultModelId)] : []),
        ...providerModels.map((model) => displayModelIdForProvider(provider.id, model.id))
      ].filter((modelId, index, modelIds) => modelId && modelIds.indexOf(modelId) === index)
    : []
  return {
    apiKey: '',
    endpoint: provider?.baseUrl ?? '',
    protocol: provider?.kind === 'anthropic' ? 'anthropic-compatible' : 'openai-compatible',
    defaultModelId: orderedModelIds.join(', ')
  }
}

function formatUnknownError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
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

function shouldNamespaceModelIds(providerId: string): boolean {
  return providerId.startsWith('custom-')
}

function modelIdForProvider(providerId: string, modelName: string): string {
  return shouldNamespaceModelIds(providerId) ? namespaceModelId(providerId, modelName) : modelName
}

function displayModelIdForProvider(providerId: string, modelId: string): string {
  return shouldNamespaceModelIds(providerId) ? modelNameFromNamespacedId(providerId, modelId) : modelId
}

function modelIdsFromFormValue(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function capabilitiesForModelName(modelName: string): ModelDto['capabilities'] {
  const capabilities: ModelDto['capabilities'] = ['streaming', 'toolCalls']
  if (/(^|[-_:/])(reasoner|reasoning|r1|thinking|think)([-_:/]|$)/i.test(modelName)) {
    capabilities.push('reasoning')
  }
  return capabilities
}

function connectionTestInputFromDialog(state: ConnectionDialogState, providers: ModelProviderDto[]): ProviderConnectionTestInput {
  const endpoint = state.form.endpoint.trim()
  const apiKey = state.form.apiKey.trim()
  const modelIds = modelIdsFromFormValue(state.form.defaultModelId)
  const existingProvider = state.providerId ? providers.find((provider) => provider.id === state.providerId) : undefined
  const providerSlug = endpoint ? slugFromEndpoint(endpoint) : 'custom-ai'
  const providerId = existingProvider?.id ?? `custom-${providerSlug}`

  return {
    providerId,
    kind: providerKindForProtocol(state.form.protocol),
    baseUrl: endpoint,
    ...(apiKey ? { apiKey } : {}),
    ...(modelIds[0] ? { modelId: modelIds[0] } : {})
  }
}

export function ProviderSettingsPanel({ onModelRegistryChanged }: ProviderSettingsPanelProps) {
  const [providers, setProviders] = useState<ModelProviderDto[]>([])
  const [models, setModels] = useState<ModelDto[]>([])
  const [dialogState, setDialogState] = useState<ConnectionDialogState>()
  const [addConnectionFlow, setAddConnectionFlow] = useState<AddConnectionFlow>()
  const [openMenuProviderId, setOpenMenuProviderId] = useState<string>()
  const [hoveredProviderId, setHoveredProviderId] = useState<string>()
  const [renamingProviderId, setRenamingProviderId] = useState<string>()
  const [renameValue, setRenameValue] = useState('')
  const [connectionResult, setConnectionResult] = useState<ProviderConnectionTestResult>()
  const [codexOAuthState, setCodexOAuthState] = useState<CodexOAuthState>(initialCodexOAuthState)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const mountedRef = useRef(true)
  const loadRequestIdRef = useRef(0)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const visibleProviders = useMemo(() => providers.filter((provider) => provider.enabled !== false), [providers])

  const loadProviderSettings = async () => {
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

  useEffect(() => {
    if (!renamingProviderId) return undefined
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [renamingProviderId])

  const resetCodexOAuthState = () => {
    setCodexOAuthState({ ...initialCodexOAuthState })
  }

  const openAddConnection = () => {
    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    setOpenMenuProviderId(undefined)
    setDialogState(undefined)
    resetCodexOAuthState()
    setAddConnectionFlow('picker')
  }

  const openCustomConnection = () => {
    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    setOpenMenuProviderId(undefined)
    resetCodexOAuthState()
    setAddConnectionFlow('custom')
    setDialogState({ mode: 'add', form: createConnectionForm() })
  }

  const openCodexConnection = () => {
    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    setOpenMenuProviderId(undefined)
    setDialogState(undefined)
    resetCodexOAuthState()
    setAddConnectionFlow('codex')
  }

  const closeCodexConnection = () => {
    resetCodexOAuthState()
    setAddConnectionFlow(undefined)
  }

  const backFromCodexConnection = () => {
    setError(undefined)
    resetCodexOAuthState()
    setAddConnectionFlow('picker')
  }

  const openEditConnection = (provider: ModelProviderDto) => {
    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    setOpenMenuProviderId(undefined)
    setAddConnectionFlow(undefined)
    setDialogState({ mode: 'edit', providerId: provider.id, form: createConnectionForm(provider, models) })
  }

  const updateDialogForm = (updater: ConnectionFormState | ((current: ConnectionFormState) => ConnectionFormState)) => {
    setDialogState((current) => current ? { ...current, form: typeof updater === 'function' ? updater(current.form) : updater } : current)
  }

  const startCodexOAuth = async () => {
    const connectionName = codexOAuthState.connectionName.trim() || initialCodexOAuthState.connectionName
    setError(undefined)
    setMessage(undefined)
    setCodexOAuthState({ connectionName, status: 'idle' })

    try {
      const result = await hesperApi.providers.startOAuthAuthorization({ provider: 'openai-codex', connectionName })
      if (!mountedRef.current) return
      setCodexOAuthState((current) => ({
        ...current,
        connectionName,
        sessionId: result.sessionId,
        status: result.status,
        message: result.message
      }))
    } catch (startError) {
      if (!mountedRef.current) return
      setError(formatUnknownError(startError, 'Codex 授权启动失败'))
    }
  }

  const checkCodexOAuthStatus = async () => {
    const sessionId = codexOAuthState.sessionId
    if (!sessionId) return

    setError(undefined)
    setMessage(undefined)
    try {
      const result = await hesperApi.providers.getOAuthAuthorizationStatus({ sessionId })
      if (!mountedRef.current) return
      setCodexOAuthState((current) => ({
        ...current,
        sessionId: result.sessionId,
        status: result.status,
        message: result.message
      }))
    } catch (statusError) {
      if (!mountedRef.current) return
      setError(formatUnknownError(statusError, 'Codex 授权状态检查失败'))
    }
  }

  const saveCodexOAuthConnection = async () => {
    const sessionId = codexOAuthState.sessionId
    if (!sessionId) return

    const connectionName = codexOAuthState.connectionName.trim() || initialCodexOAuthState.connectionName
    setError(undefined)
    setMessage(undefined)

    try {
      const provider = await hesperApi.providers.saveOAuthConnection({ sessionId, connectionName })
      if (!mountedRef.current) return
      setAddConnectionFlow(undefined)
      resetCodexOAuthState()
      setMessage(`已添加连接：${provider.name}`)
      await loadProviderSettings()
      await onModelRegistryChanged?.()
    } catch (saveError) {
      if (!mountedRef.current) return
      setError(formatUnknownError(saveError, 'Codex 连接保存失败'))
    }
  }

  const saveConnection = async () => {
    if (!dialogState) return

    const endpoint = dialogState.form.endpoint.trim()
    const apiKey = dialogState.form.apiKey.trim()
    const modelIds = modelIdsFromFormValue(dialogState.form.defaultModelId)
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
        ...(primaryModelId ? { defaultModelId: modelIdForProvider(providerId, primaryModelId) } : existingProvider?.defaultModelId ? { defaultModelId: existingProvider.defaultModelId } : {})
      })

      if (apiKey) {
        await hesperApi.credentials.saveProviderApiKey({ providerId: provider.id, apiKey })
      }

      for (const modelId of modelIds) {
        const normalizedModelId = modelIdForProvider(provider.id, modelId)
        const normalizedModelName = displayModelIdForProvider(provider.id, normalizedModelId)
        await hesperApi.models.save({
          id: normalizedModelId,
          providerId: provider.id,
          modelName: normalizedModelName,
          displayName: normalizedModelName,
          capabilities: capabilitiesForModelName(normalizedModelName),
          enabled: true
        })
      }

      if (!mountedRef.current) return
      setDialogState(undefined)
      setAddConnectionFlow(undefined)
      setMessage(dialogState.mode === 'edit' ? `已保存连接：${provider.name}` : `已添加连接：${provider.name}`)
      await loadProviderSettings()
      await onModelRegistryChanged?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '连接保存失败')
    }
  }

  const testDialogConnection = async () => {
    if (!dialogState) return
    const testInput = connectionTestInputFromDialog(dialogState, providers)
    if (!testInput.modelId?.trim()) {
      setConnectionResult(undefined)
      setMessage(undefined)
      setError('请填写至少一个模型后再测试连接')
      return
    }

    setError(undefined)
    setMessage(undefined)
    setConnectionResult(undefined)
    try {
      const result = await hesperApi.providers.testConnection(testInput)
      if (!mountedRef.current) return
      setConnectionResult(result)
      setMessage(undefined)
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '连接测试失败')
    }
  }

  const startRenameConnection = (provider: ModelProviderDto) => {
    setError(undefined)
    setMessage(undefined)
    setOpenMenuProviderId(undefined)
    setRenamingProviderId(provider.id)
    setRenameValue(provider.name)
  }

  const cancelRenameConnection = () => {
    setRenamingProviderId(undefined)
    setRenameValue('')
  }

  const saveRenamedConnection = async (provider: ModelProviderDto) => {
    const nextName = renameValue.trim()
    if (!nextName || nextName === provider.name) {
      cancelRenameConnection()
      return
    }

    setError(undefined)
    setMessage(undefined)
    try {
      await hesperApi.providers.save({
        id: provider.id,
        name: nextName,
        kind: provider.kind,
        enabled: provider.enabled !== false,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        ...(provider.defaultModelId ? { defaultModelId: provider.defaultModelId } : {})
      })
      if (!mountedRef.current) return
      cancelRenameConnection()
      setMessage(`已重命名连接：${nextName}`)
      await loadProviderSettings()
      await onModelRegistryChanged?.()
    } catch (renameError) {
      if (!mountedRef.current) return
      setError(renameError instanceof Error ? renameError.message : '连接重命名失败')
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
        <h2 style={{ margin: 0, fontSize: bodyFontSize, lineHeight: '24px', textAlign: 'center', fontWeight: 700 }}>AI</h2>
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
              <div
                key={provider.id}
                onMouseEnter={() => setHoveredProviderId(provider.id)}
                onMouseLeave={() => setHoveredProviderId((current) => current === provider.id ? undefined : current)}
                style={{
                  ...connectionItemStyle,
                  ...(index > 0 ? connectionItemSeparatorStyle : {})
                }}
              >
                <div style={connectionInfoStyle}>
                  <span style={providerAvatarStyle}>{provider.name.slice(0, 1).toUpperCase()}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={connectionNameRowStyle}>
                      {renamingProviderId === provider.id ? (
                        <input
                          ref={renameInputRef}
                          aria-label={`连接名称 ${provider.name}`}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => void saveRenamedConnection(provider)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                            if (event.key === 'Escape') cancelRenameConnection()
                          }}
                          style={renameInputStyle}
                        />
                      ) : (
                        <>
                          <strong>{provider.name}</strong>
                          <button
                            type="button"
                            aria-label={`重命名连接 ${provider.name}`}
                            aria-hidden={hoveredProviderId === provider.id ? undefined : true}
                            tabIndex={hoveredProviderId === provider.id ? 0 : -1}
                            onPointerDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              startRenameConnection(provider)
                            }}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              startRenameConnection(provider)
                            }}
                            onClick={(event) => event.stopPropagation()}
                            style={{
                              ...renameButtonStyle,
                              opacity: hoveredProviderId === provider.id ? 1 : 0
                            }}
                          >
                            ✎
                          </button>
                        </>
                      )}
                    </span>
                    <span style={providerMetaStyle}>
                      {provider.kind} · {provider.baseUrl ?? '使用默认端点'} · {provider.hasApiKey ? '已保存 key' : '未保存 key'}
                    </span>
                  </span>
                </div>
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
                    <button type="button" role="menuitem" style={{ ...connectionMenuItemStyle, color: dangerTextColor }} onClick={() => void deleteConnection(provider)}>删除</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <button type="button" style={secondaryActionStyle} onClick={openAddConnection}>+ 添加连接</button>
        </section>
      </div>

      {addConnectionFlow === 'picker' ? (
        <ConnectionTypePicker
          onSelectCodex={openCodexConnection}
          onSelectCustom={openCustomConnection}
          onCancel={() => setAddConnectionFlow(undefined)}
        />
      ) : null}

      {addConnectionFlow === 'codex' ? (
        <CodexAuthorizationPage
          state={codexOAuthState}
          onConnectionNameChange={(connectionName) => setCodexOAuthState((current) => ({ ...current, connectionName }))}
          onBack={backFromCodexConnection}
          onCancel={closeCodexConnection}
          onStart={() => void startCodexOAuth()}
          onCheckStatus={() => void checkCodexOAuthStatus()}
          onSave={() => void saveCodexOAuthConnection()}
        />
      ) : null}

      {dialogState ? (
        <ConnectionDialog
          state={dialogState}
          {...(connectionResult ? { connectionResult } : {})}
          updateForm={updateDialogForm}
          onCancel={() => {
            setConnectionResult(undefined)
            setDialogState(undefined)
            setAddConnectionFlow(undefined)
          }}
          onTest={() => void testDialogConnection()}
          onSave={() => void saveConnection()}
        />
      ) : null}
    </section>
  )
}

const dialogFocusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function getFocusableDialogElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(dialogFocusableSelector))
    .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0)
}

function FullWindowDialogShell({
  ariaLabel,
  children,
  onClose,
  initialFocusRef
}: {
  ariaLabel: string
  children: ReactNode
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const focusTarget = initialFocusRef?.current ?? dialogRef.current
    focusTarget?.focus()
  }, [initialFocusRef])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }

    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (!dialog) return

    const focusableElements = getFocusableDialogElements(dialog)
    if (focusableElements.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const firstFocusable = focusableElements[0]!
    const lastFocusable = focusableElements[focusableElements.length - 1]!
    const activeElement = document.activeElement
    const focusIsOutsideDialog = !activeElement || !dialog.contains(activeElement)

    if (event.shiftKey) {
      if (activeElement === firstFocusable || activeElement === dialog || focusIsOutsideDialog) {
        event.preventDefault()
        lastFocusable.focus()
      }
      return
    }

    if (activeElement === lastFocusable || activeElement === dialog || focusIsOutsideDialog) {
      event.preventDefault()
      firstFocusable.focus()
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={fullWindowOverlayStyle}
    >
      <button type="button" aria-label={`关闭 ${ariaLabel}`} onClick={onClose} style={overlayCloseStyle}>×</button>
      {children}
    </div>
  )
}

function ConnectionTypePicker({
  onSelectCodex,
  onSelectCustom,
  onCancel
}: {
  onSelectCodex: () => void
  onSelectCustom: () => void
  onCancel: () => void
}) {
  return (
    <FullWindowDialogShell ariaLabel="Add connection" onClose={onCancel}>
      <div style={connectionTypePickerPanelStyle}>
        <header style={{ textAlign: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: bodyFontSize }}>Add connection</h2>
          <p style={{ margin: '12px 0 0', color: mutedTextColor, lineHeight: 1.5 }}>选择一种连接方式。</p>
        </header>
        <div style={connectionTypeGridStyle}>
          <button type="button" onClick={onSelectCodex} style={connectionTypeCardStyle}>
            <strong style={connectionTypeTitleStyle}>Codex 授权</strong>
            <span style={connectionTypeDescriptionStyle}>使用 Codex OAuth 授权连接。</span>
          </button>
          <button type="button" onClick={onSelectCustom} style={connectionTypeCardStyle}>
            <strong style={connectionTypeTitleStyle}>Custom</strong>
            <span style={connectionTypeDescriptionStyle}>手动填写 API key、Endpoint 和模型。</span>
          </button>
        </div>
        <footer style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
          <button type="button" onClick={onCancel} style={secondaryActionStyle}>Back</button>
        </footer>
      </div>
    </FullWindowDialogShell>
  )
}

function CodexAuthorizationPage({
  state,
  onConnectionNameChange,
  onBack,
  onCancel,
  onStart,
  onCheckStatus,
  onSave
}: {
  state: CodexOAuthState
  onConnectionNameChange: (connectionName: string) => void
  onBack: () => void
  onCancel: () => void
  onStart: () => void
  onCheckStatus: () => void
  onSave: () => void
}) {
  const hasSession = Boolean(state.sessionId)
  const canSave = state.status === 'authorized'
  const feedbackIsError = state.status === 'failed'
  const feedbackText = state.message ? `${state.status}: ${state.message}` : undefined

  return (
    <FullWindowDialogShell ariaLabel="Codex 授权" onClose={onCancel}>
      <div style={overlayFormStyle}>
        <header style={{ textAlign: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: bodyFontSize }}>Codex 授权</h2>
          <p style={{ margin: '12px 0 0', color: mutedTextColor, lineHeight: 1.5 }}>
            使用默认浏览器完成 ChatGPT Codex 授权。
          </p>
        </header>
        <label style={fieldStyle}>
          Connection Name
          <input
            aria-label="Codex 连接名称"
            value={state.connectionName}
            onChange={(event) => onConnectionNameChange(event.target.value)}
            style={inputStyle}
          />
        </label>
        {feedbackText ? (
          <p
            role={feedbackIsError ? 'alert' : 'status'}
            style={{ ...connectionFeedbackTextStyle, ...(feedbackIsError ? errorTextStyle : statusTextStyle) }}
          >
            {feedbackText}
          </p>
        ) : null}
        <footer style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onBack} style={secondaryActionStyle}>Back</button>
          <button type="button" onClick={onStart} style={secondaryActionStyle}>Open Browser</button>
          <button
            type="button"
            onClick={onCheckStatus}
            disabled={!hasSession}
            style={{ ...secondaryActionStyle, ...(!hasSession ? disabledActionStyle : {}) }}
          >
            Check Status
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            style={{ ...primaryActionStyle, ...(!canSave ? disabledActionStyle : {}) }}
          >
            Save
          </button>
        </footer>
      </div>
    </FullWindowDialogShell>
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
    <FullWindowDialogShell ariaLabel="API 配置" onClose={onCancel}>
      <div style={overlayFormStyle}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: bodyFontSize }}>API 配置</h2>
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
        {connectionResult ? (
          <p
            role={connectionResult.status === 'ok' ? 'status' : 'alert'}
            style={{ ...connectionFeedbackTextStyle, ...(connectionResult.status === 'ok' ? statusTextStyle : errorTextStyle) }}
          >
            {connectionResult.message}
          </p>
        ) : null}
        <footer style={{ display: 'grid', gridTemplateColumns: onTest ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onCancel} style={secondaryActionStyle}>Back</button>
          {onTest ? <button type="button" onClick={onTest} style={secondaryActionStyle}>Test</button> : null}
          <button type="button" onClick={onSave} style={primaryActionStyle}>Save</button>
        </footer>
      </div>
    </FullWindowDialogShell>
  )
}

const mutedTextColor = 'var(--hesper-color-text-muted, #737aa2)'
const bodyTextColor = 'var(--hesper-color-text, #c0caf5)'
const surfaceColor = 'var(--hesper-color-surface, #16161e)'
const surfaceMutedColor = 'var(--hesper-color-surface-muted, #24283b)'
const borderColor = 'var(--hesper-color-border, #414868)'
const accentColor = 'var(--hesper-color-accent, #7aa2f7)'
const dangerTextColor = 'var(--hesper-color-danger, #f7768e)'
const successTextColor = 'var(--hesper-color-success, #9ece6a)'
const softControlColor = 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))'
const bodyFontSize = 'var(--hesper-font-size, 14px)'

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
  fontSize: bodyFontSize
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
  fontSize: bodyFontSize,
  lineHeight: 1.2
}

const sectionDescriptionStyle: CSSProperties = {
  margin: '4px 0 0',
  color: mutedTextColor,
  lineHeight: 1.45
}

const connectionListStyle: CSSProperties = {
  display: 'grid',
  gap: 0,
  border: 0,
  borderRadius: 16,
  background: surfaceMutedColor,
  overflow: 'visible'
}

const connectionItemStyle: CSSProperties = {
  position: 'relative',
  minHeight: 68,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'stretch',
  border: 0,
  borderRadius: 12,
  background: 'transparent',
  boxShadow: 'none',
  overflow: 'visible'
}

const connectionItemSeparatorStyle: CSSProperties = {
  borderTopWidth: 1,
  borderTopStyle: 'solid',
  borderTopColor: borderColor
}

const connectionInfoStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  background: 'transparent',
  color: bodyTextColor,
  padding: '12px 14px',
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left'
}

const providerAvatarStyle: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  background: softControlColor,
  color: accentColor,
  display: 'grid',
  placeItems: 'center',
  fontSize: bodyFontSize,
  fontWeight: 700
}

const connectionNameRowStyle: CSSProperties = {
  minWidth: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: '100%'
}

const renameButtonStyle: CSSProperties = {
  width: 18,
  height: 18,
  border: 0,
  outline: 0,
  borderRadius: 0,
  background: 'transparent',
  color: mutedTextColor,
  padding: 0,
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
  fontSize: bodyFontSize,
  lineHeight: 1
}

const renameInputStyle: CSSProperties = {
  width: 'min(160px, 100%)',
  minWidth: 0,
  boxSizing: 'border-box',
  border: 0,
  outline: 0,
  borderRadius: 6,
  background: softControlColor,
  color: bodyTextColor,
  padding: '2px 6px',
  fontSize: bodyFontSize,
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
  background: surfaceMutedColor,
  padding: 6,
  boxShadow: '0 18px 36px rgba(0, 0, 0, 0.28)'
}

const connectionMenuItemStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: 9,
  background: 'transparent',
  color: bodyTextColor,
  padding: '8px 10px',
  textAlign: 'left',
  cursor: 'pointer'
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  color: bodyTextColor,
  fontSize: bodyFontSize
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minWidth: 0,
  borderRadius: 10,
  border: 0,
  outline: 0,
  background: softControlColor,
  color: bodyTextColor,
  padding: '9px 11px'
}

const primaryActionStyle: CSSProperties = {
  border: 0,
  outline: 0,
  borderRadius: 10,
  padding: '10px 18px',
  background: softControlColor,
  color: accentColor,
  fontWeight: 700,
  cursor: 'pointer'
}

const secondaryActionStyle: CSSProperties = {
  borderRadius: 10,
  border: 0,
  outline: 0,
  background: softControlColor,
  color: bodyTextColor,
  padding: '8px 12px',
  cursor: 'pointer'
}

const disabledActionStyle: CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed'
}

const fullWindowOverlayStyle: CSSProperties = {
  position: 'fixed',
  top: 36,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 50,
  background: surfaceColor,
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
  background: softControlColor,
  color: mutedTextColor,
  cursor: 'pointer'
}

const overlayFormStyle: CSSProperties = {
  width: 'min(460px, 100%)',
  boxSizing: 'border-box',
  minWidth: 0,
  maxHeight: 'calc(100vh - 84px)',
  overflowY: 'auto',
  display: 'grid',
  gap: 18,
  borderRadius: 22,
  border: `1px solid ${borderColor}`,
  background: surfaceMutedColor,
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.32)',
  padding: 24
}

const connectionTypePickerPanelStyle: CSSProperties = {
  ...overlayFormStyle,
  width: 'min(600px, 100%)'
}

const connectionTypeGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12
}

const connectionTypeCardStyle: CSSProperties = {
  minHeight: 132,
  border: `1px solid ${borderColor}`,
  outline: 0,
  borderRadius: 16,
  background: surfaceColor,
  color: bodyTextColor,
  padding: 18,
  cursor: 'pointer',
  display: 'grid',
  alignContent: 'start',
  gap: 10,
  textAlign: 'left'
}

const connectionTypeTitleStyle: CSSProperties = {
  color: bodyTextColor,
  fontSize: bodyFontSize,
  lineHeight: 1.2
}

const connectionTypeDescriptionStyle: CSSProperties = {
  color: mutedTextColor,
  lineHeight: 1.5
}

const segmentedControlStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  borderRadius: 10,
  background: surfaceColor,
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
  background: softControlColor,
  color: bodyTextColor,
  fontWeight: 700
}

const connectionFeedbackTextStyle: CSSProperties = {
  maxWidth: '100%',
  maxHeight: 120,
  overflowY: 'auto',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  lineHeight: 1.45,
  margin: 0
}

const statusTextStyle: CSSProperties = {
  margin: 0,
  color: successTextColor
}

const errorTextStyle: CSSProperties = {
  margin: 0,
  color: dangerTextColor
}
