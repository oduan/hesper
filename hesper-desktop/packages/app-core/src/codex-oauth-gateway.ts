import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ProviderOAuthGateway, PiAuthProvider, ProviderOAuthStatus } from './model-provider-service'

const codexOAuthClientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
const defaultCallbackPort = 1455
const defaultFlowTtlMs = 10 * 60 * 1000
const defaultTerminalFlowRetentionMs = 5 * 60 * 1000
const timeoutMessage = '授权超时，请重新开始 Codex 授权'
const callbackPath = '/auth/callback'
const authorizationEndpoint = 'https://auth.openai.com/oauth/authorize'
const tokenEndpoint = 'https://auth.openai.com/oauth/token'
const deviceUserCodeEndpoint = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
const deviceTokenEndpoint = 'https://auth.openai.com/api/accounts/deviceauth/token'
const deviceVerificationEndpoint = 'https://auth.openai.com/codex/device'
const deviceRedirectUri = 'https://auth.openai.com/deviceauth/callback'
const defaultModels: Awaited<ReturnType<ProviderOAuthGateway['consumeAuthorization']>>['models'] = [
  { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'], contextWindow: 272000 },
  { id: 'pi/gpt-5.4-mini', modelName: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', capabilities: ['streaming', 'toolCalls', 'reasoning'], contextWindow: 272000 }
]

type CodexOAuthFlow = {
  provider: PiAuthProvider
  connectionName: string
  sessionId: string
  state: string
  codeVerifier: string
  redirectUri: string
  status: ProviderOAuthStatus
  message: string
  mode: 'browser' | 'device'
  code?: string
  server?: Server | undefined
  timeout?: ReturnType<typeof setTimeout> | undefined
  cleanupTimeout?: ReturnType<typeof setTimeout> | undefined
  deviceAuthId?: string | undefined
  userCode?: string | undefined
  devicePollIntervalMs?: number | undefined
  nextDevicePollAt?: number | undefined
}

export type CodexOAuthGatewayOptions = {
  fetch?: typeof fetch
  callbackPort?: number
  flowTtlMs?: number
  terminalFlowRetentionMs?: number
}

function randomUrlSafeString(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url')
}

function codeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>You can close this window and return to hesper.</p></body></html>`
}

function writeHtml(response: ServerResponse, statusCode: number, title: string, message: string, onDone: () => void): void {
  response.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' })
  response.end(htmlPage(title, message), onDone)
}

function clearFlowTimeout(flow: CodexOAuthFlow): void {
  if (!flow.timeout) return
  clearTimeout(flow.timeout)
  flow.timeout = undefined
}

function clearFlowCleanupTimeout(flow: CodexOAuthFlow): void {
  if (!flow.cleanupTimeout) return
  clearTimeout(flow.cleanupTimeout)
  flow.cleanupTimeout = undefined
}

function clearFailedFlowSensitiveState(flow: CodexOAuthFlow): void {
  delete flow.code
  flow.codeVerifier = ''
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!server.listening) {
        resolve()
        return
      }
      server.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

function closeFlowServer(flow: CodexOAuthFlow): Promise<void> {
  const server = flow.server
  if (!server) return Promise.resolve()
  flow.server = undefined
  return closeServer(server)
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, 'localhost')
  })
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE'
}

function callbackPortInUseError(port: number): Error {
  return new Error(`Codex 授权回调端口 ${port} 已被占用。请关闭其他 Codex 授权会话或释放该端口后重试。`)
}

function deviceAuthorizationMessage(userCode: string): string {
  return `本机 Codex 回调端口被占用，已切换到设备码授权。请在打开的 OpenAI 页面输入代码：${userCode}`
}

function redirectUriForPort(port: number): string {
  return `http://localhost:${port}${callbackPath}`
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

async function readText(response: Response): Promise<string> {
  return response.text().catch(() => '')
}

function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  return typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : undefined
}

function stringField(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberField(payload: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = payload?.[key]
  const normalized = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined
  return normalized !== undefined && Number.isFinite(normalized) ? normalized : undefined
}

function tokenDetailsFromPayload(payload: unknown): { accessToken?: string; refreshToken?: string; expiresAt?: number } {
  const record = payloadRecord(payload)
  const accessToken = stringField(record, 'access_token')
  const refreshToken = stringField(record, 'refresh_token')
  const expiresIn = numberField(record, 'expires_in')
  return {
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn !== undefined && expiresIn > 0 ? { expiresAt: Date.now() + Math.floor(expiresIn * 1000) } : {})
  }
}

type DeviceAuthorization = {
  deviceAuthId: string
  userCode: string
  pollIntervalMs: number
}

async function startDeviceAuthorization(fetchImpl: typeof fetch | undefined): Promise<DeviceAuthorization> {
  if (!fetchImpl) throw callbackPortInUseError(defaultCallbackPort)
  const response = await fetchImpl(deviceUserCodeEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: codexOAuthClientId })
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(`Codex 设备码授权启动失败（HTTP ${response.status}）：${await readText(response) || response.statusText}`)
  }
  const record = payloadRecord(payload)
  const deviceAuthId = stringField(record, 'device_auth_id')
  const userCode = stringField(record, 'user_code')
  const intervalSeconds = numberField(record, 'interval') ?? 5
  if (!deviceAuthId || !userCode || intervalSeconds < 0) {
    throw new Error(`Codex 设备码授权返回无效响应：${JSON.stringify(payload)}`)
  }
  return { deviceAuthId, userCode, pollIntervalMs: Math.floor(intervalSeconds * 1000) }
}

async function pollDeviceAuthorization(fetchImpl: typeof fetch | undefined, flow: CodexOAuthFlow): Promise<void> {
  if (!fetchImpl) throw new Error('Codex 设备码授权需要 fetch')
  if (!flow.deviceAuthId || !flow.userCode) {
    markDeviceFlowFailed(flow, 'Codex 设备码授权会话缺少设备码')
    return
  }
  const nowMs = Date.now()
  if (flow.nextDevicePollAt !== undefined && flow.nextDevicePollAt > nowMs) return

  const response = await fetchImpl(deviceTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_auth_id: flow.deviceAuthId, user_code: flow.userCode })
  })
  const responseText = await response.text().catch(() => '')
  let payload: unknown
  try {
    payload = responseText.trim() ? JSON.parse(responseText) as unknown : undefined
  } catch {
    payload = undefined
  }
  const record = payloadRecord(payload)

  if (response.ok) {
    const authorizationCode = stringField(record, 'authorization_code')
    const codeVerifier = stringField(record, 'code_verifier')
    if (!authorizationCode || !codeVerifier) {
      markDeviceFlowFailed(flow, `Codex 设备码授权返回无效响应：${responseText || response.statusText}`)
      return
    }
    flow.status = 'authorized'
    flow.message = '授权成功'
    flow.code = authorizationCode
    flow.codeVerifier = codeVerifier
    flow.redirectUri = deviceRedirectUri
    clearFlowTimeout(flow)
    clearFlowCleanupTimeout(flow)
    return
  }

  const error = record?.error
  const errorCode = typeof error === 'object' && error !== null
    ? stringField(error as Record<string, unknown>, 'code')
    : typeof error === 'string'
      ? error
      : stringField(record, 'error')
  if (response.status === 403 || response.status === 404 || errorCode === 'deviceauth_authorization_pending') {
    flow.nextDevicePollAt = nowMs + (flow.devicePollIntervalMs ?? 5_000)
    return
  }
  if (errorCode === 'slow_down') {
    flow.devicePollIntervalMs = (flow.devicePollIntervalMs ?? 5_000) + 5_000
    flow.nextDevicePollAt = nowMs + flow.devicePollIntervalMs
    return
  }
  markDeviceFlowFailed(flow, `Codex 设备码授权失败（HTTP ${response.status}）：${responseText || response.statusText}`)
}

function markDeviceFlowFailed(flow: CodexOAuthFlow, message: string): void {
  flow.status = 'failed'
  flow.message = message
  clearFailedFlowSensitiveState(flow)
}

export function createCodexOAuthGateway(options: CodexOAuthGatewayOptions = {}): ProviderOAuthGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const callbackPort = options.callbackPort ?? defaultCallbackPort
  const flowTtlMs = options.flowTtlMs ?? defaultFlowTtlMs
  const terminalFlowRetentionMs = options.terminalFlowRetentionMs ?? defaultTerminalFlowRetentionMs
  const flows = new Map<string, CodexOAuthFlow>()

  const deleteFlow = async (sessionId: string): Promise<void> => {
    const flow = flows.get(sessionId)
    if (!flow) return
    flows.delete(sessionId)
    clearFlowTimeout(flow)
    clearFlowCleanupTimeout(flow)
    await closeFlowServer(flow)
  }

  const scheduleFlowDeletion = (flow: CodexOAuthFlow): void => {
    clearFlowCleanupTimeout(flow)
    flow.cleanupTimeout = setTimeout(() => {
      void deleteFlow(flow.sessionId)
    }, Math.max(0, terminalFlowRetentionMs))
    flow.cleanupTimeout.unref?.()
  }

  const markFlowFailed = (flow: CodexOAuthFlow, message: string): void => {
    flow.status = 'failed'
    flow.message = message
    clearFlowTimeout(flow)
    clearFailedFlowSensitiveState(flow)
    scheduleFlowDeletion(flow)
  }

  const cleanupUnconsumedFlows = async (): Promise<void> => {
    await Promise.all([...flows.values()].map(async (flow) => {
      flows.delete(flow.sessionId)
      flow.status = 'failed'
      flow.message = '授权已被新的授权请求替换'
      clearFlowTimeout(flow)
      clearFlowCleanupTimeout(flow)
      clearFailedFlowSensitiveState(flow)
      await closeFlowServer(flow)
    }))
  }

  const handleCallback = (flow: CodexOAuthFlow, request: IncomingMessage, response: ServerResponse): void => {
    const requestUrl = new URL(request.url ?? '/', flow.redirectUri)
    if (requestUrl.pathname !== callbackPath) {
      writeHtml(response, 404, 'Codex authorization failed', 'Unknown OAuth callback path.', () => undefined)
      return
    }

    const finish = (statusCode: number, title: string, message: string) => {
      writeHtml(response, statusCode, title, message, () => {
        void closeFlowServer(flow)
      })
    }

    const receivedState = requestUrl.searchParams.get('state')
    if (receivedState !== flow.state) {
      writeHtml(response, 400, 'Codex authorization failed', 'OAuth state mismatch', () => undefined)
      return
    }

    const error = requestUrl.searchParams.get('error')
    if (error) {
      markFlowFailed(flow, requestUrl.searchParams.get('error_description') ?? error)
      finish(400, 'Codex authorization failed', flow.message)
      return
    }

    const code = requestUrl.searchParams.get('code')
    if (!code) {
      markFlowFailed(flow, 'OAuth callback did not include an authorization code')
      finish(400, 'Codex authorization failed', flow.message)
      return
    }

    flow.status = 'authorized'
    flow.message = '授权成功'
    flow.code = code
    clearFlowTimeout(flow)
    scheduleFlowDeletion(flow)
    finish(200, 'Codex authorization complete', 'Authorization succeeded. You can close this window and return to hesper.')
  }

  return {
    async startAuthorization(input) {
      if ((input.provider as string) !== 'openai-codex') throw new Error(`Unsupported OAuth provider: ${input.provider}`)
      await cleanupUnconsumedFlows()
      const sessionId = randomUrlSafeString(24)
      const codeVerifier = randomUrlSafeString(32)
      const flow: CodexOAuthFlow = {
        provider: input.provider,
        connectionName: input.connectionName,
        sessionId,
        state: sessionId,
        codeVerifier,
        redirectUri: redirectUriForPort(callbackPort),
        status: 'pending',
        message: '等待浏览器授权',
        mode: 'browser'
      }
      const server = createServer((request, response) => handleCallback(flow, request, response))
      flow.server = server
      flows.set(sessionId, flow)

      try {
        await listen(server, callbackPort)
      } catch (error) {
        clearFlowTimeout(flow)
        await closeFlowServer(flow)
        if (isAddressInUse(error)) {
          const deviceAuthorization = await startDeviceAuthorization(fetchImpl)
          flow.mode = 'device'
          flow.redirectUri = deviceRedirectUri
          flow.codeVerifier = ''
          flow.deviceAuthId = deviceAuthorization.deviceAuthId
          flow.userCode = deviceAuthorization.userCode
          flow.devicePollIntervalMs = deviceAuthorization.pollIntervalMs
          flow.nextDevicePollAt = 0
          flow.message = deviceAuthorizationMessage(deviceAuthorization.userCode)
        } else {
          flows.delete(sessionId)
          throw error
        }
      }

      flow.timeout = setTimeout(() => {
        if (flow.status === 'pending') {
          markFlowFailed(flow, timeoutMessage)
          void closeFlowServer(flow)
        }
      }, Math.max(0, flowTtlMs))
      flow.timeout.unref?.()

      if (flow.mode === 'device') {
        return { sessionId, authorizationUrl: deviceVerificationEndpoint, message: flow.message }
      }

      const authorizationUrl = new URL(authorizationEndpoint)
      authorizationUrl.searchParams.set('client_id', codexOAuthClientId)
      authorizationUrl.searchParams.set('response_type', 'code')
      authorizationUrl.searchParams.set('redirect_uri', flow.redirectUri)
      authorizationUrl.searchParams.set('scope', 'openid profile email offline_access')
      authorizationUrl.searchParams.set('code_challenge', codeChallenge(codeVerifier))
      authorizationUrl.searchParams.set('code_challenge_method', 'S256')
      authorizationUrl.searchParams.set('state', flow.state)
      authorizationUrl.searchParams.set('codex_cli_simplified_flow', 'true')
      authorizationUrl.searchParams.set('id_token_add_organizations', 'true')

      return { sessionId, authorizationUrl: authorizationUrl.toString() }
    },
    async getAuthorizationStatus(input) {
      const flow = flows.get(input.sessionId)
      if (!flow) return { status: 'failed', message: '授权会话不存在' }
      if (flow.mode === 'device' && flow.status === 'pending') {
        await pollDeviceAuthorization(fetchImpl, flow)
        if (flow.status !== 'pending') {
          clearFlowTimeout(flow)
          scheduleFlowDeletion(flow)
        }
      }
      return { status: flow.status, message: flow.message }
    },
    async cancelAuthorization(input) {
      await deleteFlow(input.sessionId)
    },
    async consumeAuthorization(input) {
      if (!fetchImpl) throw new Error('OAuth token exchange requires fetch')
      const flow = flows.get(input.sessionId)
      if (!flow) throw new Error('授权会话不存在')
      if (flow.status !== 'authorized' || !flow.code) throw new Error(flow.message || '授权尚未完成')

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: codexOAuthClientId,
        code: flow.code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.codeVerifier
      })
      const response = await fetchImpl(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
      })
      const payload = await readJson(response)
      if (!response.ok) {
        throw new Error(`Codex OAuth token exchange failed with HTTP ${response.status}`)
      }
      const tokenDetails = tokenDetailsFromPayload(payload)
      if (!tokenDetails.accessToken) {
        throw new Error('Codex OAuth token response did not include an access token')
      }

      await deleteFlow(input.sessionId)
      return {
        accessToken: tokenDetails.accessToken,
        ...(tokenDetails.refreshToken ? { refreshToken: tokenDetails.refreshToken } : {}),
        ...(tokenDetails.expiresAt !== undefined ? { expiresAt: tokenDetails.expiresAt } : {}),
        defaultModelId: 'pi/gpt-5.5',
        models: defaultModels.map((model) => ({ ...model, capabilities: [...model.capabilities] }))
      }
    }
  }
}
