import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ProviderOAuthGateway, PiAuthProvider, ProviderOAuthStatus } from './model-provider-service'

const codexOAuthClientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
const defaultCallbackPort = 1455
const defaultFlowTtlMs = 10 * 60 * 1000
const timeoutMessage = '授权超时，请重新开始 Codex 授权'
const callbackPath = '/auth/callback'
const authorizationEndpoint = 'https://auth.openai.com/oauth/authorize'
const tokenEndpoint = 'https://auth.openai.com/oauth/token'
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
  code?: string
  server?: Server | undefined
  timeout?: ReturnType<typeof setTimeout> | undefined
}

export type CodexOAuthGatewayOptions = {
  fetch?: typeof fetch
  callbackPort?: number
  flowTtlMs?: number
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

function closeFlowServer(flow: CodexOAuthFlow): Promise<void> {
  const server = flow.server
  if (!server) return Promise.resolve()
  flow.server = undefined
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

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function tokenFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const accessToken = (payload as { access_token?: unknown }).access_token
  return typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : undefined
}

export function createCodexOAuthGateway(options: CodexOAuthGatewayOptions = {}): ProviderOAuthGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const callbackPort = options.callbackPort ?? defaultCallbackPort
  const flowTtlMs = options.flowTtlMs ?? defaultFlowTtlMs
  const redirectUri = `http://localhost:${callbackPort}${callbackPath}`
  const flows = new Map<string, CodexOAuthFlow>()

  const failFlow = (flow: CodexOAuthFlow, message: string): void => {
    flow.status = 'failed'
    flow.message = message
    clearFlowTimeout(flow)
    void closeFlowServer(flow)
  }

  const deleteFlow = async (sessionId: string): Promise<void> => {
    const flow = flows.get(sessionId)
    if (!flow) return
    flows.delete(sessionId)
    clearFlowTimeout(flow)
    await closeFlowServer(flow)
  }

  const cancelPendingFlows = async (): Promise<void> => {
    await Promise.all([...flows.values()]
      .filter((flow) => flow.status === 'pending')
      .map(async (flow) => {
        flows.delete(flow.sessionId)
        flow.status = 'failed'
        flow.message = '授权已被新的授权请求替换'
        clearFlowTimeout(flow)
        await closeFlowServer(flow)
      }))
  }

  const handleCallback = (flow: CodexOAuthFlow, request: IncomingMessage, response: ServerResponse): void => {
    const requestUrl = new URL(request.url ?? '/', redirectUri)
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
      flow.status = 'failed'
      flow.message = requestUrl.searchParams.get('error_description') ?? error
      clearFlowTimeout(flow)
      finish(400, 'Codex authorization failed', flow.message)
      return
    }

    const code = requestUrl.searchParams.get('code')
    if (!code) {
      flow.status = 'failed'
      flow.message = 'OAuth callback did not include an authorization code'
      clearFlowTimeout(flow)
      finish(400, 'Codex authorization failed', flow.message)
      return
    }

    flow.status = 'authorized'
    flow.message = '授权成功'
    flow.code = code
    clearFlowTimeout(flow)
    finish(200, 'Codex authorization complete', 'Authorization succeeded. You can close this window and return to hesper.')
  }

  return {
    async startAuthorization(input) {
      if ((input.provider as string) !== 'openai-codex') throw new Error(`Unsupported OAuth provider: ${input.provider}`)
      await cancelPendingFlows()
      const sessionId = randomUrlSafeString(24)
      const codeVerifier = randomUrlSafeString(32)
      const flow: CodexOAuthFlow = {
        provider: input.provider,
        connectionName: input.connectionName,
        sessionId,
        state: sessionId,
        codeVerifier,
        redirectUri,
        status: 'pending',
        message: '等待浏览器授权'
      }
      const server = createServer((request, response) => handleCallback(flow, request, response))
      flow.server = server
      flows.set(sessionId, flow)

      try {
        await listen(server, callbackPort)
      } catch (error) {
        flows.delete(sessionId)
        clearFlowTimeout(flow)
        await closeFlowServer(flow)
        throw error
      }

      flow.timeout = setTimeout(() => {
        if (flow.status === 'pending') {
          failFlow(flow, timeoutMessage)
        }
      }, Math.max(0, flowTtlMs))

      const authorizationUrl = new URL(authorizationEndpoint)
      authorizationUrl.searchParams.set('client_id', codexOAuthClientId)
      authorizationUrl.searchParams.set('response_type', 'code')
      authorizationUrl.searchParams.set('redirect_uri', redirectUri)
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
      const accessToken = tokenFromPayload(payload)
      if (!accessToken) {
        throw new Error('Codex OAuth token response did not include an access token')
      }

      await deleteFlow(input.sessionId)
      return {
        accessToken,
        defaultModelId: 'pi/gpt-5.5',
        models: defaultModels.map((model) => ({ ...model, capabilities: [...model.capabilities] }))
      }
    }
  }
}
