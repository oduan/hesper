import { describe, expect, it } from 'vitest'
import { clearPiEventRunState, mapPiEventToHesperEvents } from '../map-pi-event'

describe('pi event mapping', () => {
  it('maps assistant text deltas to message.delta', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
    })

    expect(events).toEqual([{ type: 'message.delta', runId: 'run-1', delta: 'hello' }])
  })

  it('maps assistant message_end to message.completed', () => {
    const events = mapPiEventToHesperEvents(
      { runId: 'run-1', sessionId: 'session-1' },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'final answer' }],
          timestamp: Date.parse('2026-06-10T06:00:00.000Z')
        }
      }
    )

    expect(events).toEqual([
      {
        type: 'message.completed',
        message: {
          id: 'message-run-1-assistant',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'final answer',
          contentType: 'markdown',
          runId: 'run-1',
          createdAt: '2026-06-10T06:00:00.000Z'
        }
      }
    ])
  })

  it('maps tool execution start to a running tool step', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'tool_execution_start',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      args: { path: 'README.md' }
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          id: 'step-run-1-tool-tool-call-1',
          runId: 'run-1',
          type: 'tool_call',
          status: 'running',
          title: 'Tool: read_file'
        })
      })
    ])
  })

  it('maps tool execution end to a tool_call step update without changing step id or type', () => {
    const startEvents = mapPiEventToHesperEvents('run-1', {
      type: 'tool_execution_start',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      args: { path: 'README.md' }
    })
    const endEvents = mapPiEventToHesperEvents('run-1', {
      type: 'tool_execution_end',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      result: { content: 'done' },
      isError: false
    })

    expect(endEvents).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          id: 'step-run-1-tool-tool-call-1',
          runId: 'run-1',
          type: 'tool_call',
          status: 'succeeded',
          title: 'Tool: read_file'
        })
      })
    ])
    expect((startEvents[0] as Extract<(typeof startEvents)[number], { type: 'step.created' }>).step.id).toBe(
      (endEvents[0] as Extract<(typeof endEvents)[number], { type: 'step.updated' }>).step.id
    )
  })

  it('maps turn start to a model_call step creation', () => {
    const events = mapPiEventToHesperEvents('run-turn-start', {
      type: 'turn_start'
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          runId: 'run-turn-start',
          type: 'model_call',
          status: 'running',
          title: 'Model turn'
        })
      })
    ])
  })

  it('maps turn end to a model_call step update', () => {
    const startEvents = mapPiEventToHesperEvents('run-turn-end', {
      type: 'turn_start'
    })
    const endEvents = mapPiEventToHesperEvents('run-turn-end', {
      type: 'turn_end'
    })

    expect(endEvents).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          runId: 'run-turn-end',
          type: 'model_call',
          status: 'succeeded',
          title: 'Model turn'
        })
      })
    ])
    expect((startEvents[0] as Extract<(typeof startEvents)[number], { type: 'step.created' }>).step.id).toBe(
      (endEvents[0] as Extract<(typeof endEvents)[number], { type: 'step.updated' }>).step.id
    )
  })

  it('clears per-run turn state so a later run does not inherit active turns', () => {
    const firstStart = mapPiEventToHesperEvents('run-clear-state', { type: 'turn_start' })
    const firstStartId = (firstStart[0] as Extract<(typeof firstStart)[number], { type: 'step.created' }>).step.id

    clearPiEventRunState('run-clear-state')

    const nextStart = mapPiEventToHesperEvents('run-clear-state', { type: 'turn_start' })
    const nextStartId = (nextStart[0] as Extract<(typeof nextStart)[number], { type: 'step.created' }>).step.id

    expect(firstStartId).toBe('step-run-clear-state-model-call-1')
    expect(nextStartId).toBe('step-run-clear-state-model-call-1')
  })

  it('uses unique step ids for multiple turns in the same run', () => {
    const firstStart = mapPiEventToHesperEvents('run-multi-turn', { type: 'turn_start' })
    const firstEnd = mapPiEventToHesperEvents('run-multi-turn', { type: 'turn_end' })
    const secondStart = mapPiEventToHesperEvents('run-multi-turn', { type: 'turn_start' })
    const secondEnd = mapPiEventToHesperEvents('run-multi-turn', { type: 'turn_end' })

    const firstStartId = (firstStart[0] as Extract<(typeof firstStart)[number], { type: 'step.created' }>).step.id
    const firstEndId = (firstEnd[0] as Extract<(typeof firstEnd)[number], { type: 'step.updated' }>).step.id
    const secondStartId = (secondStart[0] as Extract<(typeof secondStart)[number], { type: 'step.created' }>).step.id
    const secondEndId = (secondEnd[0] as Extract<(typeof secondEnd)[number], { type: 'step.updated' }>).step.id

    expect(firstStartId).toBe(firstEndId)
    expect(secondStartId).toBe(secondEndId)
    expect(firstStartId).not.toBe(secondStartId)
  })
})
