import { describe, expect, it } from 'vitest'
import { clearPiEventRunState, mapPiEventToHesperEvents } from '../map-pi-event'

describe('pi event mapping', () => {
  it('does not stream pi text deltas directly because tool-call commentary must be classified at message_end', () => {
    const events = mapPiEventToHesperEvents('run-1', {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' }
    })

    expect(events).toEqual([])
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

  it('maps assistant message_end failures to a visible assistant error message', () => {
    const events = mapPiEventToHesperEvents(
      { runId: 'run-failed-message', sessionId: 'session-1' },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          errorMessage: 'OpenAI API error (404): unsupported endpoint',
          timestamp: Date.parse('2026-06-10T06:00:00.000Z')
        }
      }
    )

    expect(events).toEqual([
      {
        type: 'message.completed',
        message: expect.objectContaining({
          sessionId: 'session-1',
          role: 'assistant',
          content: '运行失败：OpenAI API error (404): unsupported endpoint',
          runId: 'run-failed-message'
        })
      }
    ])
  })

  it('maps tool-call commentary to a thought step instead of an assistant message', () => {
    const events = mapPiEventToHesperEvents(
      { runId: 'run-tool-commentary', sessionId: 'session-1' },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '我先搜索一下 Hesper 是什么。' },
            { type: 'toolCall', id: 'tool-call-1', name: 'web_fetch-url', arguments: { url: 'https://example.com' } }
          ],
          timestamp: Date.parse('2026-06-10T06:00:00.000Z')
        }
      }
    )

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          runId: 'run-tool-commentary',
          type: 'thought',
          status: 'succeeded',
          title: '执行说明',
          summary: '我先搜索一下 Hesper 是什么。',
          detail: '我先搜索一下 Hesper 是什么。'
        })
      })
    ])
    expect(events.some((event) => event.type === 'message.completed')).toBe(false)
  })

  it('filters OpenAI responses commentary phase out of assistant output', () => {
    const events = mapPiEventToHesperEvents(
      { runId: 'run-phase-commentary', sessionId: 'session-1' },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '我会先检查状态。', textSignature: JSON.stringify({ v: 1, id: 'msg-commentary', phase: 'commentary' }) }
          ],
          timestamp: Date.parse('2026-06-10T06:00:00.000Z')
        }
      }
    )

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          runId: 'run-phase-commentary',
          type: 'thought',
          title: '执行说明',
          summary: '我会先检查状态。'
        })
      })
    ])
  })

  it('maps tool execution start to a running tool step', () => {
    const events = mapPiEventToHesperEvents('run-tool-start', {
      type: 'tool_execution_start',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      args: { path: 'README.md', purpose: '读取 README 了解项目结构' }
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          id: 'step-run-tool-start-tool-tool-call-1',
          runId: 'run-tool-start',
          type: 'tool_call',
          status: 'running',
          title: '调用 read_file',
          summary: '读取 README 了解项目结构'
        })
      })
    ])
    const detail = JSON.parse((events[0] as Extract<(typeof events)[number], { type: 'step.created' }>).step.detail!)
    expect(detail).toEqual({
      kind: 'tool_call',
      input: { path: 'README.md', purpose: '读取 README 了解项目结构' }
    })
  })

  it('keeps separate steps for multiple tool calls that do not provide tool call ids', () => {
    const firstStart = mapPiEventToHesperEvents('run-anonymous-tools', {
      type: 'tool_execution_start',
      toolCallId: '',
      toolName: 'web_fetch-url',
      args: { url: 'https://example.com/a' }
    })
    const secondStart = mapPiEventToHesperEvents('run-anonymous-tools', {
      type: 'tool_execution_start',
      toolCallId: '',
      toolName: 'web_fetch-url',
      args: { url: 'https://example.com/b' }
    })
    const firstEnd = mapPiEventToHesperEvents('run-anonymous-tools', {
      type: 'tool_execution_end',
      toolCallId: '',
      toolName: 'web_fetch-url',
      result: { content: 'a' },
      isError: false
    })
    const secondEnd = mapPiEventToHesperEvents('run-anonymous-tools', {
      type: 'tool_execution_end',
      toolCallId: '',
      toolName: 'web_fetch-url',
      result: { content: 'b' },
      isError: false
    })

    const firstStartId = (firstStart[0] as Extract<(typeof firstStart)[number], { type: 'step.created' }>).step.id
    const secondStartId = (secondStart[0] as Extract<(typeof secondStart)[number], { type: 'step.created' }>).step.id
    const firstEndId = (firstEnd[0] as Extract<(typeof firstEnd)[number], { type: 'step.updated' }>).step.id
    const secondEndId = (secondEnd[0] as Extract<(typeof secondEnd)[number], { type: 'step.updated' }>).step.id

    expect(firstStartId).toBe('step-run-anonymous-tools-tool-anonymous-1')
    expect(secondStartId).toBe('step-run-anonymous-tools-tool-anonymous-2')
    expect(firstEndId).toBe(firstStartId)
    expect(secondEndId).toBe(secondStartId)
  })

  it('keeps separate steps when a provider reuses the same tool call id', () => {
    const firstStart = mapPiEventToHesperEvents('run-duplicate-tools', {
      type: 'tool_execution_start',
      toolCallId: 'call-reused',
      toolName: 'web_fetch-url',
      args: { url: 'https://example.com/a' }
    })
    const secondStart = mapPiEventToHesperEvents('run-duplicate-tools', {
      type: 'tool_execution_start',
      toolCallId: 'call-reused',
      toolName: 'web_fetch-url',
      args: { url: 'https://example.com/b' }
    })
    const firstEnd = mapPiEventToHesperEvents('run-duplicate-tools', {
      type: 'tool_execution_end',
      toolCallId: 'call-reused',
      toolName: 'web_fetch-url',
      result: { content: 'a' },
      isError: false
    })
    const secondEnd = mapPiEventToHesperEvents('run-duplicate-tools', {
      type: 'tool_execution_end',
      toolCallId: 'call-reused',
      toolName: 'web_fetch-url',
      result: { content: 'b' },
      isError: false
    })

    const firstStartId = (firstStart[0] as Extract<(typeof firstStart)[number], { type: 'step.created' }>).step.id
    const secondStartId = (secondStart[0] as Extract<(typeof secondStart)[number], { type: 'step.created' }>).step.id
    const firstEndId = (firstEnd[0] as Extract<(typeof firstEnd)[number], { type: 'step.updated' }>).step.id
    const secondEndId = (secondEnd[0] as Extract<(typeof secondEnd)[number], { type: 'step.updated' }>).step.id

    expect(firstStartId).toBe('step-run-duplicate-tools-tool-call-reused')
    expect(secondStartId).toBe('step-run-duplicate-tools-tool-call-reused-2')
    expect(firstEndId).toBe(firstStartId)
    expect(secondEndId).toBe(secondStartId)
  })

  it('maps tool execution end to a tool_call step update without changing step id or type', () => {
    const startEvents = mapPiEventToHesperEvents('run-tool-end', {
      type: 'tool_execution_start',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      args: { path: 'README.md', purpose: '读取 README 了解项目结构' }
    })
    const endEvents = mapPiEventToHesperEvents('run-tool-end', {
      type: 'tool_execution_end',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      args: { path: 'README.md', purpose: '读取 README 了解项目结构' },
      result: { content: 'done' },
      isError: false
    })

    expect(endEvents).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          id: 'step-run-tool-end-tool-tool-call-1',
          runId: 'run-tool-end',
          type: 'tool_call',
          status: 'succeeded',
          title: '调用 read_file',
          summary: '读取 README 了解项目结构'
        })
      })
    ])
    const endStep = (endEvents[0] as Extract<(typeof endEvents)[number], { type: 'step.updated' }>).step
    expect(JSON.parse(endStep.detail!)).toEqual({
      kind: 'tool_call',
      input: { path: 'README.md', purpose: '读取 README 了解项目结构' },
      output: { content: 'done' },
      isError: false
    })
    expect((startEvents[0] as Extract<(typeof startEvents)[number], { type: 'step.created' }>).step.id).toBe(
      endStep.id
    )
  })

  it('maps assistant thinking deltas to a live thought step', () => {
    const startEvents = mapPiEventToHesperEvents('run-thinking', {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 }
    })
    const firstDeltaEvents = mapPiEventToHesperEvents('run-thinking', {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '先分析问题。' }
    })
    const secondDeltaEvents = mapPiEventToHesperEvents('run-thinking', {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '再给出答案。' }
    })
    const endEvents = mapPiEventToHesperEvents('run-thinking', {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: '最终思考。' }
    })

    expect(startEvents).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          id: 'step-run-thinking-thinking-0',
          runId: 'run-thinking',
          type: 'thought',
          status: 'running',
          title: '思考过程',
          summary: '正在思考…'
        })
      })
    ])
    expect(firstDeltaEvents).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          id: 'step-run-thinking-thinking-0',
          type: 'thought',
          status: 'running',
          summary: '先分析问题。'
        })
      })
    ])
    expect(secondDeltaEvents).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          id: 'step-run-thinking-thinking-0',
          summary: '先分析问题。再给出答案。'
        })
      })
    ])
    expect(endEvents).toEqual([
      expect.objectContaining({
        type: 'step.updated',
        step: expect.objectContaining({
          id: 'step-run-thinking-thinking-0',
          type: 'thought',
          status: 'succeeded',
          summary: '最终思考。'
        })
      })
    ])
  })

  it('does not map normal turn lifecycle events to visible Model turn steps', () => {
    expect(mapPiEventToHesperEvents('run-turn-start', { type: 'turn_start' })).toEqual([])
    expect(mapPiEventToHesperEvents('run-turn-end', { type: 'turn_end' })).toEqual([])
  })

  it('maps turn end failures to a failed warning step with the provider error visible', () => {
    const endEvents = mapPiEventToHesperEvents('run-turn-failed', {
      type: 'turn_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        stopReason: 'error',
        errorMessage: 'No API key for provider: custom-api'
      },
      toolResults: []
    })

    expect(endEvents).toEqual([
      expect.objectContaining({
        type: 'step.created',
        step: expect.objectContaining({
          id: 'step-run-turn-failed-model-failure',
          runId: 'run-turn-failed',
          type: 'warning',
          status: 'failed',
          title: '运行失败',
          summary: 'No API key for provider: custom-api',
          detail: 'No API key for provider: custom-api'
        })
      })
    ])
  })

  it('clears per-run commentary state so a later run starts commentary step ids from one', () => {
    const firstEvents = mapPiEventToHesperEvents({ runId: 'run-clear-state', sessionId: 'session-1' }, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '先检查。', textSignature: JSON.stringify({ v: 1, id: 'msg-1', phase: 'commentary' }) }]
      }
    })
    const firstId = (firstEvents[0] as Extract<(typeof firstEvents)[number], { type: 'step.created' }>).step.id

    clearPiEventRunState('run-clear-state')

    const nextEvents = mapPiEventToHesperEvents({ runId: 'run-clear-state', sessionId: 'session-1' }, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '再检查。', textSignature: JSON.stringify({ v: 1, id: 'msg-2', phase: 'commentary' }) }]
      }
    })
    const nextId = (nextEvents[0] as Extract<(typeof nextEvents)[number], { type: 'step.created' }>).step.id

    expect(firstId).toBe('step-run-clear-state-commentary-1')
    expect(nextId).toBe('step-run-clear-state-commentary-1')
  })

  it('uses unique commentary step ids for multiple commentary messages in the same run', () => {
    const firstEvents = mapPiEventToHesperEvents({ runId: 'run-multi-commentary', sessionId: 'session-1' }, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '第一步。', textSignature: JSON.stringify({ v: 1, id: 'msg-1', phase: 'commentary' }) }]
      }
    })
    const secondEvents = mapPiEventToHesperEvents({ runId: 'run-multi-commentary', sessionId: 'session-1' }, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '第二步。', textSignature: JSON.stringify({ v: 1, id: 'msg-2', phase: 'commentary' }) }]
      }
    })

    const firstId = (firstEvents[0] as Extract<(typeof firstEvents)[number], { type: 'step.created' }>).step.id
    const secondId = (secondEvents[0] as Extract<(typeof secondEvents)[number], { type: 'step.created' }>).step.id

    expect(firstId).toBe('step-run-multi-commentary-commentary-1')
    expect(secondId).toBe('step-run-multi-commentary-commentary-2')
  })
})
