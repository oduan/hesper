import { describe, expect, it } from 'vitest'
import type { Message, RunStep, WorkerAgentInvocation } from '@hesper/shared'
import { appReducer, initialAppState } from '../src/app-store'

const now = '2026-06-10T03:00:00.000Z'

describe('app-store reducer', () => {
  it('prefers the latest active session when restoring loaded sessions', () => {
    const nextState = appReducer(initialAppState, {
      type: 'sessions.loaded',
      sessions: [
        {
          id: 'session-archived',
          title: 'Archived newer',
          status: 'archived',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: '2026-06-10T03:10:00.000Z'
        },
        {
          id: 'session-active',
          title: 'Active current',
          status: 'active',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: '2026-06-10T03:09:00.000Z'
        }
      ]
    })

    expect(nextState.activeSessionId).toBe('session-active')
  })

  it('moves touched sessions to the top and safely reverts failed optimistic touches', () => {
    const loaded = appReducer(initialAppState, {
      type: 'sessions.loaded',
      sessions: [
        {
          id: 'session-old',
          title: 'Old chat',
          status: 'active',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: '2026-06-10T03:00:00.000Z'
        },
        {
          id: 'session-new',
          title: 'New chat',
          status: 'active',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: '2026-06-10T03:10:00.000Z'
        }
      ]
    })

    const optimisticUpdatedAt = '2026-06-10T03:11:00.000Z'
    const touched = appReducer(loaded, {
      type: 'session.touched',
      sessionId: 'session-old',
      updatedAt: optimisticUpdatedAt
    })
    expect(touched.sessions.map((session) => session.id)).toEqual(['session-old', 'session-new'])

    const reverted = appReducer(touched, {
      type: 'session.touch-reverted',
      sessionId: 'session-old',
      optimisticUpdatedAt,
      previousUpdatedAt: '2026-06-10T03:00:00.000Z'
    })
    expect(reverted.sessions.map((session) => session.id)).toEqual(['session-new', 'session-old'])

    const laterTouched = appReducer(touched, {
      type: 'session.touched',
      sessionId: 'session-old',
      updatedAt: '2026-06-10T03:12:00.000Z'
    })
    const ignoredRevert = appReducer(laterTouched, {
      type: 'session.touch-reverted',
      sessionId: 'session-old',
      optimisticUpdatedAt,
      previousUpdatedAt: '2026-06-10T03:00:00.000Z'
    })
    expect(ignoredRevert.sessions[0]).toMatchObject({ id: 'session-old', updatedAt: '2026-06-10T03:12:00.000Z' })
  })

  it('batch deletes sessions once and reassigns the active session when the current one is removed', () => {
    const loaded = appReducer(initialAppState, {
      type: 'sessions.loaded',
      sessions: [
        {
          id: 'session-archived',
          title: 'Archived',
          status: 'archived',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: '2026-06-10T03:05:00.000Z'
        },
        {
          id: 'session-active-next',
          title: 'Next active',
          status: 'active',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: '2026-06-10T03:04:00.000Z'
        },
        {
          id: 'session-active-current',
          title: 'Current active',
          status: 'active',
          outputMode: 'markdown',
          createdAt: now,
          updatedAt: '2026-06-10T03:03:00.000Z'
        }
      ]
    })

    const afterDelete = appReducer({
      ...loaded,
      activeSessionId: 'session-active-current'
    }, {
      type: 'sessions.deleted',
      sessionIds: ['session-active-current', 'session-archived']
    } as any)

    expect(afterDelete.sessions.map((session) => session.id)).toEqual(['session-active-next'])
    expect(afterDelete.activeSessionId).toBe('session-active-next')

    const preservedActive = appReducer(loaded, {
      type: 'sessions.deleted',
      sessionIds: ['session-archived']
    } as any)

    expect(preservedActive.activeSessionId).toBe('session-active-next')
    expect(preservedActive.sessions.map((session) => session.id)).toEqual(['session-active-next', 'session-active-current'])
  })

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



  it('links an optimistic user message to the returned run id', () => {
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

    const withOptimisticMessage = appReducer(sessionLoadedState, {
      type: 'message.optimistic',
      message: {
        id: 'message-user-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'first prompt',
        contentType: 'plain',
        createdAt: now
      }
    })

    const linkedState = appReducer(withOptimisticMessage, {
      type: 'message.run-linked',
      sessionId: 'session-1',
      messageId: 'message-user-1',
      runId: 'run-1'
    } as any)

    expect(linkedState.messagesBySession['session-1']?.[0]).toMatchObject({
      id: 'message-user-1',
      runId: 'run-1'
    })
  })

  it('links the latest optimistic user message as soon as the run is created', () => {
    const withOptimisticMessage = appReducer(initialAppState, {
      type: 'message.optimistic',
      message: {
        id: 'message-user-pending',
        sessionId: 'session-1',
        role: 'user',
        content: 'prompt while enqueue is pending',
        contentType: 'plain',
        createdAt: now
      }
    })

    const runCreatedState = appReducer(withOptimisticMessage, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-created-before-ipc-return',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2
        }
      }
    })

    expect(runCreatedState.messagesBySession['session-1']?.[0]).toMatchObject({
      id: 'message-user-pending',
      runId: 'run-created-before-ipc-return'
    })
  })

  it('keeps child runs out of main session messages and latest run tracking', () => {
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

    const withOptimisticMessage = appReducer(sessionLoadedState, {
      type: 'message.optimistic',
      message: {
        id: 'message-user-root',
        sessionId: 'session-1',
        role: 'user',
        content: '请查看 worker 结果',
        contentType: 'plain',
        createdAt: now
      }
    })

    const rootRunCreated = appReducer(withOptimisticMessage, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-root',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2,
          startedAt: '2026-06-10T03:00:01.000Z'
        }
      }
    })

    expect(rootRunCreated.messagesBySession['session-1']).toEqual([
      {
        id: 'message-user-root',
        sessionId: 'session-1',
        role: 'user',
        content: '请查看 worker 结果',
        contentType: 'plain',
        createdAt: now,
        runId: 'run-root'
      }
    ])
    expect(rootRunCreated.latestRunIdBySession['session-1']).toBe('run-root')

    const childRunCreated = appReducer(rootRunCreated, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-child',
          sessionId: 'session-1',
          parentRunId: 'run-root',
          workerAgentInvocationId: 'worker-invocation-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2,
          startedAt: '2026-06-10T03:00:02.000Z'
        }
      }
    }) as any

    expect(childRunCreated.latestRunIdBySession['session-1']).toBe('run-root')
    expect(childRunCreated.messagesBySession['session-1']).toEqual(rootRunCreated.messagesBySession['session-1'])
    expect(childRunCreated.childMessagesByRun['run-child']).toBeUndefined()

    const childCompleted = appReducer(childRunCreated, {
      type: 'agent.event',
      event: {
        type: 'message.completed',
        message: {
          id: 'message-child-assistant',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'worker answer',
          contentType: 'markdown',
          runId: 'run-child',
          createdAt: '2026-06-10T03:00:03.000Z'
        }
      }
    }) as any

    expect(childCompleted.messagesBySession['session-1']).toEqual(rootRunCreated.messagesBySession['session-1'])
    expect(childCompleted.childMessagesByRun['run-child']).toEqual([
      {
        id: 'message-child-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'worker answer',
        contentType: 'markdown',
        runId: 'run-child',
        createdAt: '2026-06-10T03:00:03.000Z'
      }
    ])
    expect(childCompleted.streamingByRun['run-child']).toBeUndefined()
  })

  it('indexes worker invocations and worker history separately from the main conversation', () => {
    const childAssistantMessage = {
      id: 'message-worker-assistant',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'worker answer',
      contentType: 'markdown',
      runId: 'run-child',
      createdAt: '2026-06-10T03:00:03.000Z'
    } satisfies Message

    const childStep = {
      id: 'step-worker-child',
      runId: 'run-child',
      type: 'tool_call',
      status: 'succeeded',
      title: 'Read File',
      summary: 'Inspect README',
      detail: 'ok',
      createdAt: '2026-06-10T03:00:02.000Z'
    } satisfies RunStep

    const restoredState = appReducer(initialAppState, {
      type: 'history.loaded',
      sessionId: 'session-1',
      messages: [
        {
          id: 'message-root-user',
          sessionId: 'session-1',
          role: 'user',
          content: 'root prompt',
          contentType: 'plain',
          runId: 'run-root',
          createdAt: '2026-06-10T03:00:01.000Z'
        },
        childAssistantMessage
      ],
      runs: [
        { id: 'run-root', sessionId: 'session-1', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2, endedAt: '2026-06-10T03:00:04.000Z' },
        { id: 'run-child', sessionId: 'session-1', parentRunId: 'run-root', workerAgentInvocationId: 'worker-invocation-1', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2, endedAt: '2026-06-10T03:00:04.000Z' }
      ],
      stepsByRun: {
        'run-root': [
          {
            id: 'step-root',
            runId: 'run-root',
            type: 'thought',
            status: 'succeeded',
            title: 'Root step',
            createdAt: '2026-06-10T03:00:01.000Z'
          }
        ],
        'run-child': [childStep]
      }
    }) as any

    expect(restoredState.messagesBySession['session-1']).toEqual([
      {
        id: 'message-root-user',
        sessionId: 'session-1',
        role: 'user',
        content: 'root prompt',
        contentType: 'plain',
        runId: 'run-root',
        createdAt: '2026-06-10T03:00:01.000Z'
      }
    ])
    expect(restoredState.childMessagesByRun['run-child']).toEqual([childAssistantMessage])
    expect(restoredState.latestRunIdBySession['session-1']).toBe('run-root')

    const workerInvocation = {
      id: 'worker-invocation-1',
      parentRunId: 'run-root',
      parentStepId: 'step-worker',
      childRunId: 'run-child',
      task: 'Review the diff and explain the risk.',
      roleId: 'worker-reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      status: 'running',
      createdAt: '2026-06-10T03:00:02.000Z'
    } satisfies WorkerAgentInvocation

    const workerIndexed = appReducer(restoredState, {
      type: 'agent.event',
      event: {
        type: 'worker.invocation.created',
        invocation: workerInvocation
      }
    }) as any

    expect(workerIndexed.workerInvocationsById['worker-invocation-1']).toMatchObject(workerInvocation)
    expect(workerIndexed.workerInvocationIdsByParentRun['run-root']).toEqual(['worker-invocation-1'])
    expect(workerIndexed.workerInvocationIdByParentStepId['step-worker']).toBe('worker-invocation-1')

    const hydrated = appReducer(workerIndexed, {
      type: 'worker.history.loaded',
      invocations: [{ ...workerInvocation, status: 'succeeded', lastEventAt: '2026-06-10T03:00:04.000Z' }],
      stepsByRun: {
        'run-child': [childStep]
      },
      messagesByRun: {
        'run-child': [childAssistantMessage]
      }
    } as any) as any

    expect(hydrated.workerInvocationsById['worker-invocation-1']).toMatchObject({ status: 'succeeded' })
    expect(hydrated.stepsByRun['run-child']).toEqual([childStep])
    expect(hydrated.childMessagesByRun['run-child']).toEqual([childAssistantMessage])
    expect(hydrated.messagesBySession['session-1']).toEqual(restoredState.messagesBySession['session-1'])
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

  it('marks cancelled runs terminal and ignores late started events', () => {
    const runCreatedState = appReducer(initialAppState, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-cancelled',
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
      event: { type: 'message.delta', runId: 'run-cancelled', delta: 'partial' }
    })
    const cancelledState = appReducer(deltaState, {
      type: 'agent.event',
      event: { type: 'run.cancelled', runId: 'run-cancelled', endedAt: '2026-06-10T03:00:05.000Z' }
    })

    expect(cancelledState.runsById['run-cancelled']).toMatchObject({
      status: 'cancelled',
      endedAt: '2026-06-10T03:00:05.000Z'
    })
    expect(cancelledState.streamingByRun['run-cancelled']).toBeUndefined()

    const lateStartedState = appReducer(cancelledState, {
      type: 'agent.event',
      event: { type: 'run.started', runId: 'run-cancelled', startedAt: '2026-06-10T03:00:06.000Z' }
    })

    expect(lateStartedState.runsById['run-cancelled']).toMatchObject({
      status: 'cancelled',
      endedAt: '2026-06-10T03:00:05.000Z'
    })
  })

  it('uses durable run.succeeded endedAt instead of assistant message timestamp for live timers', () => {
    const userCreatedAt = '2026-06-10T03:00:00.000Z'
    const durableEndedAt = '2026-06-10T03:00:05.000Z'

    const withUserMessage = appReducer(initialAppState, {
      type: 'message.optimistic',
      message: {
        id: 'message-user-timer',
        sessionId: 'session-1',
        role: 'user',
        content: 'run timer regression',
        contentType: 'plain',
        createdAt: userCreatedAt
      }
    })

    const runCreatedState = appReducer(withUserMessage, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-timer',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2,
          startedAt: userCreatedAt
        }
      }
    })

    const completedState = appReducer(runCreatedState, {
      type: 'agent.event',
      event: {
        type: 'message.completed',
        message: {
          id: 'message-assistant-timer',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'final answer',
          contentType: 'markdown',
          runId: 'run-timer',
          createdAt: userCreatedAt
        }
      }
    })

    expect(completedState.runsById['run-timer']).toMatchObject({
      status: 'running',
      startedAt: userCreatedAt
    })
    expect(completedState.runsById['run-timer']?.endedAt).toBeUndefined()

    const succeededState = appReducer(completedState, {
      type: 'agent.event',
      event: { type: 'run.succeeded', runId: 'run-timer', endedAt: durableEndedAt }
    })

    expect(succeededState.runsById['run-timer']).toMatchObject({
      status: 'succeeded',
      startedAt: userCreatedAt,
      endedAt: durableEndedAt
    })
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

  it('keeps messages and run steps in chronological order', () => {
    const runCreatedState = appReducer(initialAppState, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-sort',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2
        }
      }
    })

    const assistantState = appReducer(runCreatedState, {
      type: 'agent.event',
      event: {
        type: 'message.completed',
        message: {
          id: 'message-assistant-late',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'late assistant',
          contentType: 'markdown',
          runId: 'run-sort',
          createdAt: '2026-06-10T03:00:02.000Z'
        }
      }
    })

    const userState = appReducer(assistantState, {
      type: 'message.optimistic',
      message: {
        id: 'message-user-early',
        sessionId: 'session-1',
        role: 'user',
        content: 'early user',
        contentType: 'plain',
        createdAt: '2026-06-10T03:00:01.000Z'
      }
    })

    expect(userState.messagesBySession['session-1']?.map((message) => message.id)).toEqual([
      'message-user-early',
      'message-assistant-late'
    ])

    const laterStepState = appReducer(runCreatedState, {
      type: 'agent.event',
      event: {
        type: 'step.created',
        step: {
          id: 'step-late',
          runId: 'run-sort',
          type: 'tool_call',
          status: 'running',
          title: 'Later',
          createdAt: '2026-06-10T03:00:02.000Z'
        }
      }
    })

    const sortedStepState = appReducer(laterStepState, {
      type: 'agent.event',
      event: {
        type: 'step.created',
        step: {
          id: 'step-early',
          runId: 'run-sort',
          type: 'thought',
          status: 'succeeded',
          title: 'Earlier',
          createdAt: '2026-06-10T03:00:01.000Z'
        }
      }
    })

    expect(sortedStepState.stepsByRun['run-sort']?.map((step) => step.id)).toEqual(['step-early', 'step-late'])
  })

  it('hydrates restored conversation history in display order without clearing active streaming output', () => {
    const streamingState = appReducer(initialAppState, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-live',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2
        }
      }
    })
    const withDelta = appReducer(streamingState, {
      type: 'agent.event',
      event: { type: 'message.delta', runId: 'run-live', delta: 'streaming now' }
    })

    const restoredState = appReducer(withDelta, {
      type: 'history.loaded',
      sessionId: 'session-1',
      messages: [
        {
          id: 'message-late',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'late assistant',
          contentType: 'markdown',
          runId: 'run-restored-2',
          createdAt: '2026-06-10T03:00:03.000Z'
        },
        {
          id: 'message-early',
          sessionId: 'session-1',
          role: 'user',
          content: 'early user',
          contentType: 'plain',
          runId: 'run-restored-1',
          createdAt: '2026-06-10T03:00:01.000Z'
        }
      ],
      runs: [
        { id: 'run-restored-1', sessionId: 'session-1', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2 },
        { id: 'run-restored-2', sessionId: 'session-1', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2 }
      ],
      stepsByRun: {
        'run-restored-2': [
          {
            id: 'step-late',
            runId: 'run-restored-2',
            type: 'thought',
            status: 'succeeded',
            title: 'Later step',
            createdAt: '2026-06-10T03:00:04.000Z'
          },
          {
            id: 'step-early',
            runId: 'run-restored-2',
            type: 'tool_call',
            status: 'succeeded',
            title: 'Earlier step',
            createdAt: '2026-06-10T03:00:02.000Z'
          }
        ]
      }
    })

    expect(restoredState.messagesBySession['session-1']?.map((message) => message.id)).toEqual(['message-early', 'message-late'])
    expect(restoredState.stepsByRun['run-restored-2']?.map((step) => step.id)).toEqual(['step-early', 'step-late'])
    expect(restoredState.runSessionIds).toMatchObject({
      'run-restored-1': 'session-1',
      'run-restored-2': 'session-1',
      'run-live': 'session-1'
    })
    expect(restoredState.runsById['run-restored-2']).toMatchObject({ id: 'run-restored-2', sessionId: 'session-1' })
    expect(restoredState.latestRunIdBySession['session-1']).toBe('run-live')
    expect(restoredState.streamingByRun['run-live']).toBe('streaming now')
  })

  it('records a durable turn end time when the run succeeds', () => {
    const runCreatedState = appReducer(initialAppState, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-live-complete',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2,
          startedAt: '2026-06-10T03:00:00.000Z'
        }
      }
    })

    const completedState = appReducer(runCreatedState, {
      type: 'agent.event',
      event: {
        type: 'message.completed',
        message: {
          id: 'message-live-complete',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'done',
          contentType: 'markdown',
          runId: 'run-live-complete',
          createdAt: '2026-06-10T03:00:07.000Z'
        }
      }
    })

    expect(completedState.runsById['run-live-complete']).toMatchObject({
      status: 'running',
      startedAt: '2026-06-10T03:00:00.000Z'
    })
    expect(completedState.runsById['run-live-complete']?.endedAt).toBeUndefined()

    const succeededState = appReducer(completedState, {
      type: 'agent.event',
      event: {
        type: 'run.succeeded',
        runId: 'run-live-complete',
        endedAt: '2026-06-10T03:00:07.000Z'
      }
    })

    expect(succeededState.runsById['run-live-complete']).toMatchObject({
      status: 'succeeded',
      endedAt: '2026-06-10T03:00:07.000Z'
    })
  })

  it('clears the latest run pointer when a new user prompt is added optimistically', () => {
    const runCreatedState = appReducer(initialAppState, {
      type: 'agent.event',
      event: {
        type: 'run.created',
        run: {
          id: 'run-previous',
          sessionId: 'session-1',
          status: 'succeeded',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 2
        }
      }
    })

    const withPreviousSteps = appReducer(runCreatedState, {
      type: 'agent.event',
      event: {
        type: 'step.created',
        step: {
          id: 'step-previous',
          runId: 'run-previous',
          type: 'thought',
          status: 'succeeded',
          title: 'Previous thinking',
          createdAt: now
        }
      }
    })

    expect(withPreviousSteps.latestRunIdBySession['session-1']).toBe('run-previous')

    const nextPromptState = appReducer(withPreviousSteps, {
      type: 'message.optimistic',
      message: {
        id: 'message-new-user',
        sessionId: 'session-1',
        role: 'user',
        content: 'new prompt',
        contentType: 'plain',
        createdAt: '2026-06-10T03:00:10.000Z'
      }
    })

    expect(nextPromptState.latestRunIdBySession['session-1']).toBeUndefined()
    expect(nextPromptState.stepsByRun['run-previous']).toHaveLength(1)
  })
})
