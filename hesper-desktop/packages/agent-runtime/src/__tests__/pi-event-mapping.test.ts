import { describe, expect, it } from 'vitest'
import { mapPiEventToHesperEvents } from '../map-pi-event'

describe('pi event mapping', () => {
  it('maps assistant text deltas to message.delta', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
    })

    expect(events).toEqual([{ type: 'message.delta', runId: 'run-1', delta: 'hello' }])
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
          runId: 'run-1',
          type: 'tool_call',
          status: 'running',
          title: 'Tool: read_file'
        })
      })
    ])
  })

  it('maps tool execution end to a completed tool result step update', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'tool_execution_end',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      result: { content: 'done' },
      isError: false
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          runId: 'run-1',
          type: 'tool_result',
          status: 'succeeded',
          title: 'Tool: read_file'
        })
      })
    ])
  })

  it('maps turn start to a model_call step creation', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'turn_start'
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          runId: 'run-1',
          type: 'model_call',
          status: 'running',
          title: 'Model turn'
        })
      })
    ])
  })

  it('maps turn end to a model_call step update', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'turn_end'
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          runId: 'run-1',
          type: 'model_call',
          status: 'succeeded',
          title: 'Model turn'
        })
      })
    ])
  })
})
