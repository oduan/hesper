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

    expect(events[0]?.type).toBe('step.created')
  })
})
