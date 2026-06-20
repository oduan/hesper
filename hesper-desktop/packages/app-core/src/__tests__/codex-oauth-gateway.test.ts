import { describe, expect, it, vi } from 'vitest'
import { createCodexOAuthGateway } from '../codex-oauth-gateway'

const callbackPort = 14655

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createCodexOAuthGateway', () => {
  it('starts a PKCE authorization flow, handles the localhost callback, and consumes structured OAuth credentials', async () => {
    const tokenFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: 'codex-oauth-access-token',
      refresh_token: 'codex-oauth-refresh-token',
      expires_in: 3600,
      id_token: 'do-not-return-id-token'
    }), { status: 200 }))
    const gateway = createCodexOAuthGateway({ fetch: tokenFetch as unknown as typeof fetch, callbackPort })

    const started = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    const authorizationUrl = new URL(started.authorizationUrl)
    const state = authorizationUrl.searchParams.get('state')

    expect(started.sessionId).toBe(state)
    expect(authorizationUrl.origin).toBe('https://auth.openai.com')
    expect(authorizationUrl.pathname).toBe('/oauth/authorize')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(`http://localhost:${callbackPort}/auth/callback`)
    expect(authorizationUrl.searchParams.get('scope')).toBe('openid profile email offline_access')
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizationUrl.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(authorizationUrl.searchParams.get('id_token_add_organizations')).toBe('true')
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'pending',
      message: '等待浏览器授权'
    })

    const callbackResponse = await fetch(`http://localhost:${callbackPort}/auth/callback?state=${state}&code=codex-code`)
    await expect(callbackResponse.text()).resolves.toContain('Codex authorization complete')
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'authorized',
      message: '授权成功'
    })

    const consumed = await gateway.consumeAuthorization({ sessionId: started.sessionId })

    expect(tokenFetch).toHaveBeenCalledTimes(1)
    expect(tokenFetch.mock.calls[0]?.[0]).toBe('https://auth.openai.com/oauth/token')
    const tokenRequest = tokenFetch.mock.calls[0]?.[1] as RequestInit
    expect(tokenRequest.method).toBe('POST')
    expect(tokenRequest.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' })
    const body = tokenRequest.body as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(body.get('redirect_uri')).toBe(`http://localhost:${callbackPort}/auth/callback`)
    expect(body.get('code')).toBe('codex-code')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(consumed).toMatchObject({
      accessToken: 'codex-oauth-access-token',
      refreshToken: 'codex-oauth-refresh-token',
      defaultModelId: 'pi/gpt-5.5',
      models: [
        expect.objectContaining({ id: 'pi/gpt-5.5', modelName: 'gpt-5.5' }),
        expect.objectContaining({ id: 'pi/gpt-5.4-mini', modelName: 'gpt-5.4-mini' })
      ]
    })
    expect(consumed.expiresAt).toEqual(expect.any(Number))
    expect(consumed.expiresAt!).toBeGreaterThan(Date.now())
    expect(JSON.stringify(consumed)).not.toContain('do-not-return-id-token')
  })

  it('ignores wrong-state callbacks and keeps the matching authorization flow usable', async () => {
    const port = callbackPort + 1
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'codex-oauth-access-token' }), { status: 200 }))
    const gateway = createCodexOAuthGateway({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: port })
    const started = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    const state = new URL(started.authorizationUrl).searchParams.get('state')

    const wrongStateResponse = await fetch(`http://localhost:${port}/auth/callback?state=wrong-state&code=ignored-code`)
    expect(wrongStateResponse.status).toBe(400)
    await expect(wrongStateResponse.text()).resolves.toContain('Codex authorization failed')
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'pending',
      message: '等待浏览器授权'
    })

    const callbackResponse = await fetch(`http://localhost:${port}/auth/callback?state=${state}&code=codex-code`)
    expect(callbackResponse.status).toBe(200)
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'authorized',
      message: '授权成功'
    })
    await expect(gateway.consumeAuthorization({ sessionId: started.sessionId })).resolves.toMatchObject({
      accessToken: 'codex-oauth-access-token'
    })
  })

  it('cancels authorization flows and closes the callback server', async () => {
    const port = callbackPort + 2
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'codex-oauth-access-token' }), { status: 200 }))
    const gateway = createCodexOAuthGateway({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: port })
    const started = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    const state = new URL(started.authorizationUrl).searchParams.get('state')

    try {
      await gateway.cancelAuthorization({ sessionId: started.sessionId })
      await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
        status: 'failed',
        message: '授权会话不存在'
      })
      await expect(fetch(`http://localhost:${port}/auth/callback?state=${state}&code=codex-code`)).rejects.toThrow()
      expect(tokenFetch).not.toHaveBeenCalled()
    } finally {
      await fetch(`http://localhost:${port}/auth/callback?state=${state}&code=cleanup-code`).catch(() => undefined)
    }
  })

  it('times out pending authorization flows and releases the callback port', async () => {
    const port = callbackPort + 3
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'codex-oauth-access-token' }), { status: 200 }))
    const gateway = createCodexOAuthGateway({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: port, flowTtlMs: 20 })
    const started = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    const state = new URL(started.authorizationUrl).searchParams.get('state')

    try {
      await delay(50)
      await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
        status: 'failed',
        message: '授权超时，请重新开始 Codex 授权'
      })
      await expect(fetch(`http://localhost:${port}/auth/callback?state=${state}&code=too-late`)).rejects.toThrow()

      const restarted = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
      await gateway.cancelAuthorization({ sessionId: restarted.sessionId })
    } finally {
      await fetch(`http://localhost:${port}/auth/callback?state=${state}&code=cleanup-code`).catch(() => undefined)
    }
  })


  it('cleans up authorized flows that are never consumed after the terminal TTL', async () => {
    const port = callbackPort + 4
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'codex-oauth-access-token' }), { status: 200 }))
    const gateway = createCodexOAuthGateway({
      fetch: tokenFetch as unknown as typeof fetch,
      callbackPort: port,
      flowTtlMs: 1_000,
      terminalFlowRetentionMs: 20
    })
    const started = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
    const state = new URL(started.authorizationUrl).searchParams.get('state')

    const callbackResponse = await fetch(`http://localhost:${port}/auth/callback?state=${state}&code=codex-code`)
    expect(callbackResponse.status).toBe(200)
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'authorized',
      message: '授权成功'
    })

    await delay(60)
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'failed',
      message: '授权会话不存在'
    })
    await expect(gateway.consumeAuthorization({ sessionId: started.sessionId })).rejects.toThrow('授权会话不存在')
  })

  it('cleans all unconsumed old flows before starting a new authorization request', async () => {
    const port = callbackPort + 5
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'codex-oauth-access-token' }), { status: 200 }))
    const gateway = createCodexOAuthGateway({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: port, flowTtlMs: 1_000 })
    const first = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'First Codex' })
    const firstState = new URL(first.authorizationUrl).searchParams.get('state')
    const firstCallbackResponse = await fetch(`http://localhost:${port}/auth/callback?state=${firstState}&code=first-code`)
    expect(firstCallbackResponse.status).toBe(200)
    await expect(gateway.getAuthorizationStatus({ sessionId: first.sessionId })).resolves.toMatchObject({ status: 'authorized' })

    const second = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'Second Codex' })
    await expect(gateway.getAuthorizationStatus({ sessionId: first.sessionId })).resolves.toEqual({
      status: 'failed',
      message: '授权会话不存在'
    })
    await expect(gateway.consumeAuthorization({ sessionId: first.sessionId })).rejects.toThrow('授权会话不存在')

    await gateway.cancelAuthorization({ sessionId: second.sessionId })
  })

  it('removes timed-out failed flows after the terminal retention TTL', async () => {
    const port = callbackPort + 6
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'codex-oauth-access-token' }), { status: 200 }))
    const gateway = createCodexOAuthGateway({
      fetch: tokenFetch as unknown as typeof fetch,
      callbackPort: port,
      flowTtlMs: 20,
      terminalFlowRetentionMs: 20
    })
    const started = await gateway.startAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })

    await delay(25)
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'failed',
      message: '授权超时，请重新开始 Codex 授权'
    })
    await delay(40)
    await expect(gateway.getAuthorizationStatus({ sessionId: started.sessionId })).resolves.toEqual({
      status: 'failed',
      message: '授权会话不存在'
    })
  })

})
