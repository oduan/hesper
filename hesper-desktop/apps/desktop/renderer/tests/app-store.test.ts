import { describe, expect, it } from 'vitest'
import { appReducer, initialAppState } from '../src/app-store'

const now = '2026-06-10T03:00:00.000Z'

describe('app-store reducer', () => {
  it('stores optimistic user messages locally', () => {
    const sessionLoadedState = appReducer(initialAppState, {
      type: 'sessions.loaded',
      sessions: [
        {
          id: 'session-1',
          title: 'Chat',
          status: 'active',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: now
        }
      ]
    })

    const nextState = appReducer(sessionLoadedState, {
      type: 'message.optimistic',
      message: {
        id: 'message-user-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'hello from user',
        contentType: 'plain',
        createdAt: now
      }
    })

    expect(nextState.messagesBySession['session-1']).toEqual([
      {
        id: 'message-user-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'hello from user',
        contentType: 'plain',
        createdAt: now
      }
    ])
  })

  it('aggregates message deltas and removes streaming state when message completes', () => {
    const runCreatedState = appReducer(initialAppState, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-1',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2
        }
      }
    })

    const deltaState = appReducer(runCreatedState, {
      type: 'agent.event',
      event: { type: 'message.delta', runId: 'run-1', delta: 'hello ' }
    })
    const deltaState2 = appReducer(deltaState, {
      type: 'agent.event',
      event: { type: 'message.delta', runId: 'run-1', delta: 'world' }
    })

    expect(deltaState2.streamingByRun['run-1']).toBe('hello world')

    const completedState = appReducer(deltaState2, {
      type: 'agent.event',
      event: {
        type: 'message.completed',
        message: {
          id: 'message-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'hello world',
          contentType: 'markdown',
          runId: 'run-1',
          createdAt: now
        }
      }
    })

    expect(completedState.streamingByRun['run-1']).toBeUndefined()
    expect(completedState.messagesBySession['session-1']).toEqual([
      {
        id: 'message-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'hello world',
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: now
      }
    ])
  })

  it('clears streaming text when a run retries or fails', () => {
    const runCreatedState = appReducer(initialAppState, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-2',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2
        }
      }
    })

    const deltaState = appReducer(runCreatedState, {
      type: 'agent.event',
      event: { type: 'message.delta', runId: 'run-2', delta: 'partial output' }
    })

    const retryingState = appReducer(deltaState, {
      type: 'agent.event',
      event: {
        type: 'run.retrying',
        runId: 'run-2',
        retryCount: 2,
        nextRetryAt: now
      }
    })

    expect(retryingState.streamingByRun['run-2']).toBeUndefined()
    expect(retryingState.stepsByRun['run-2']).toEqual([
      {
        id: 'retry-run-2-2',
        runId: 'run-2',
        type: 'retry',
        status: 'running',
        title: '准备重试 #2',
        summary: `下一次重试时间：${now}`,
        createdAt: now
      }
    ])

    const failedDeltaState = appReducer(runCreatedState, {
      type: 'agent.event',
      event: { type: 'message.delta', runId: 'run-2', delta: 'still here' }
    })

    const failedState = appReducer(failedDeltaState, {
      type: 'agent.event',
      event: {
        type: 'run.failed',
        runId: 'run-2',
        error: {
          code: 'network_error',
          message: 'Network lost',
          retryable: true
        }
      }
    })

    expect(failedState.streamingByRun['run-2']).toBeUndefined()
    expect(failedState.stepsByRun['run-2']).toHaveLength(1)
    expect(failedState.stepsByRun['run-2']?.[0]).toMatchObject({
      id: 'failed-run-2',
      runId: 'run-2',
      type: 'warning',
      status: 'failed',
      title: '运行失败：network_error',
      detail: 'Network lost'
    })
  })
})
