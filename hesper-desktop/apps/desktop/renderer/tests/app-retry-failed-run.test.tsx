// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

const { listSessions, listMessages, listRuns, listSteps, listWorkerInvocationsByParentRun, listMessagesByRun, enqueue, onEvent, markViewed } = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  listMessages: vi.fn(async (_sessionId?: string) => []),
  listRuns: vi.fn(async (_sessionId?: string) => []),
  listSteps: vi.fn(async (_runId?: string) => []),
  listWorkerInvocationsByParentRun: vi.fn(async (_input?: { sessionId: string; parentRunId: string }) => []),
  listMessagesByRun: vi.fn(async (_input?: { sessionId: string; runId: string }) => []),
  enqueue: vi.fn(async (_input?: unknown) => ({ runId: 'run-retry-new' })),
  onEvent: vi.fn(() => () => undefined),
  markViewed: vi.fn(async (id: string) => ({
    id,
    title: 'Retry session',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  }))
}))

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: listSessions,
      create: vi.fn(),
      updateTitle: vi.fn(),
      delete: vi.fn(),
      generateTitle: vi.fn(),
      markViewed
    },
    conversation: { listMessages, listMessagesByRun, listRuns, listSteps },
    workerAgents: { listByParentRun: listWorkerInvocationsByParentRun },
    files: { preview: vi.fn() },
    agent: { enqueue, stop: vi.fn(), onEvent },
    dialog: { selectDirectory: vi.fn() },
    settings: { get: vi.fn(async () => ({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', themeId: 'catppuccin', fontSize: 14, soul: '' })), update: vi.fn() },
    providers: { list: vi.fn(async () => []) },
    models: { list: vi.fn(async () => []) },
    tools: { list: vi.fn(async () => []), setEnabled: vi.fn(), credentialStatus: vi.fn(), saveApiKey: vi.fn(), deleteApiKey: vi.fn() },
    sshKeys: { list: vi.fn(async () => []), create: vi.fn(), delete: vi.fn() },
    sshServers: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    roles: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    skills: { list: vi.fn(async () => []), refresh: vi.fn(async () => []) },
    window: { platform: 'win32', minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }
  }
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

beforeEach(() => {
  listSessions.mockReset().mockResolvedValue([])
  listMessages.mockReset().mockResolvedValue([])
  listRuns.mockReset().mockResolvedValue([])
  listSteps.mockReset().mockResolvedValue([])
  listWorkerInvocationsByParentRun.mockReset().mockResolvedValue([])
  listMessagesByRun.mockReset().mockResolvedValue([])
  enqueue.mockReset().mockResolvedValue({ runId: 'run-retry-new' })
  onEvent.mockReset().mockReturnValue(() => undefined)
  markViewed.mockReset().mockImplementation(async (id: string) => ({
    id,
    title: 'Retry session',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  }))
})

describe('App failed run retry', () => {
  it('retries a failed App run by appending a new user message and run while preserving old history', async () => {
    const user = userEvent.setup()
    const retrySession = {
      id: 'session-retry',
      title: 'Retry session',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:00.000Z',
      updatedAt: '2026-06-10T03:00:10.000Z'
    }
    listSessions.mockResolvedValueOnce([retrySession] as any)
    listMessages.mockResolvedValueOnce([
      {
        id: 'old-user',
        sessionId: 'session-retry',
        role: 'user',
        content: 'retry this prompt',
        contentType: 'plain',
        runId: 'run-failed',
        createdAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)
    listRuns.mockResolvedValueOnce([
      {
        id: 'run-failed',
        sessionId: 'session-retry',
        status: 'failed',
        modelId: 'mock/hesper-fast',
        retryCount: 2,
        maxRetries: 2,
        startedAt: '2026-06-10T03:00:00.000Z',
        endedAt: '2026-06-10T03:00:05.000Z',
        error: { code: 'stream_interrupted', message: 'stream disconnected', retryable: true }
      }
    ] as any)
    listSteps.mockResolvedValueOnce([
      {
        id: 'failed-step',
        runId: 'run-failed',
        type: 'warning',
        status: 'failed',
        title: '运行失败：stream_interrupted',
        detail: 'stream disconnected',
        createdAt: '2026-06-10T03:00:05.000Z',
        completedAt: '2026-06-10T03:00:05.000Z'
      }
    ] as any)
    enqueue.mockResolvedValueOnce({ runId: 'run-retry-new' })

    render(<App />)

    expect(await screen.findByText('retry this prompt')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('运行失败：stream_interrupted').length).toBeGreaterThan(0))

    await user.click(screen.getByRole('button', { name: '重试失败运行' }))

    await waitFor(() => expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-retry',
      prompt: 'retry this prompt',
      modelId: 'mock/hesper-fast'
    })))
    expect(screen.getAllByText('retry this prompt')).toHaveLength(2)
    expect(screen.getAllByText('运行失败：stream_interrupted').length).toBeGreaterThan(0)
    expect(enqueue.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      messageId: expect.any(String),
      messageCreatedAt: expect.any(String)
    }))
  })
})
