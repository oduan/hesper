import type { Message, RunStep } from '@hesper/shared'
import { describe, expect, it } from 'vitest'
import { buildRunContextSummary } from '../context-summary'

const run = { id: 'run-ctx-1' }

function createMessage(input: { id: string, role: Message['role'], content: string, createdAt: string }): Message {
  return {
    id: input.id,
    sessionId: 'session-1',
    role: input.role,
    content: input.content,
    contentType: 'plain',
    runId: run.id,
    createdAt: input.createdAt
  }
}

function createStep(input: {
  id: string
  type: RunStep['type']
  status: RunStep['status']
  title: string
  createdAt: string
  detail?: string
}): RunStep {
  return {
    id: input.id,
    runId: run.id,
    type: input.type,
    status: input.status,
    title: input.title,
    createdAt: input.createdAt,
    ...(input.detail !== undefined ? { detail: input.detail } : {})
  }
}

function extractToolActivity(summary: string): Array<Record<string, unknown>> {
  const lines = summary.split('\n')
  const toolActivityIndex = lines.indexOf('tool_activity:')
  if (toolActivityIndex === -1) return []

  const entries: Array<Record<string, unknown>> = []
  for (let index = toolActivityIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || !line.startsWith('{')) break
    entries.push(JSON.parse(line) as Record<string, unknown>)
  }
  return entries
}

describe('buildRunContextSummary', () => {
  it('returns undefined when there is no meaningful context', () => {
    expect(buildRunContextSummary({ run, messages: [], steps: [], maxChars: 500 })).toBeUndefined()
  })

  it('builds a v2 wrapper with reduced tool activity and no raw detail metadata', () => {
    const summary = buildRunContextSummary({
      run,
      maxChars: 4000,
      messages: [
        createMessage({
          id: 'msg-latest-assistant',
          role: 'assistant',
          content: '最新结果：已经整理完成，保密令牌为 xoxb-1234567890-secret-secret',
          createdAt: '2026-06-25T03:03:00.000Z'
        }),
        createMessage({
          id: 'msg-old-user',
          role: 'user',
          content: '旧请求：请忽略这些内容',
          createdAt: '2026-06-25T03:01:00.000Z'
        }),
        createMessage({
          id: 'msg-latest-user',
          role: 'user',
          content: '最新请求：请整理敏感值 Bearer abcdefghijklmnop',
          createdAt: '2026-06-25T03:02:00.000Z'
        })
      ],
      steps: [
        createStep({
          id: 'step-error',
          type: 'tool_result',
          status: 'failed',
          title: 'Run failing test',
          createdAt: '2026-06-25T03:05:00.000Z',
          detail: JSON.stringify({
            kind: 'tool_call',
            output: {
              content: [{
                type: 'text',
                text: [
                  'Command: pnpm test -- packages/agent-runtime/src/__tests__/context-summary.test.ts',
                  'Exit code: 1',
                  '',
                  'stderr:',
                  'FAIL packages/agent-runtime/src/__tests__/context-summary.test.ts > buildRunContextSummary > preserves failures',
                  'AssertionError: expected 1 to be 2',
                  '- Expected',
                  '+ Received',
                  '- 2',
                  '+ 1',
                  '    at packages/agent-runtime/src/__tests__/context-summary.test.ts:18:11',
                  'xoxb-1234567890-secret-secret'
                ].join('\n')
              }],
              details: {
                toolCallId: 'tool-call-error',
                toolId: 'shell.run',
                result: {
                  toolId: 'shell.run',
                  command: 'pnpm test -- packages/agent-runtime/src/__tests__/context-summary.test.ts',
                  exitCode: 1,
                  stdout: '',
                  stderr: [
                    'FAIL packages/agent-runtime/src/__tests__/context-summary.test.ts > buildRunContextSummary > preserves failures',
                    'AssertionError: expected 1 to be 2',
                    '- Expected',
                    '+ Received',
                    '- 2',
                    '+ 1',
                    '    at packages/agent-runtime/src/__tests__/context-summary.test.ts:18:11',
                    'xoxb-1234567890-secret-secret'
                  ].join('\n')
                }
              }
            },
            isError: true
          })
        }),
        createStep({
          id: 'step-diagnostic',
          type: 'tool_call',
          status: 'succeeded',
          title: 'Search repo',
          createdAt: '2026-06-25T03:04:00.000Z',
          detail: JSON.stringify({
            kind: 'tool_call',
            input: {
              path: 'packages/agent-runtime/src',
              condition: { contentContains: 'token' }
            },
            output: {
              content: [{ type: 'text', text: '{"results":2}' }],
              details: {
                toolCallId: 'tool-call-search',
                toolId: 'filesystem.search-files',
                result: {
                  path: 'packages/agent-runtime/src',
                  results: [
                    {
                      path: 'src/z-last.ts',
                      name: 'z-last.ts',
                      type: 'file',
                      matches: [{ lineNumber: 9, line: 'const apiKey = "sk-live-12345678"', before: [], after: [] }]
                    },
                    {
                      path: 'src/a-first.ts',
                      name: 'a-first.ts',
                      type: 'file',
                      matches: [{ lineNumber: 4, line: 'const token = "ghp_abcdefghijklmnopqrstuvwxyz"', before: [], after: [] }]
                    }
                  ],
                  truncated: true,
                  totalLineMatches: 2
                }
              }
            },
            isError: false
          })
        })
      ]
    })

    expect(summary).toBeDefined()
    expect(summary).toMatch(/^<hesper_run_context run_id="run-ctx-1" version="2">/)
    expect(summary).toContain('latest_user_request:')
    expect(summary).toContain('最新请求：请整理敏感值 [redacted-sensitive-value]')
    expect(summary).toContain('latest_assistant_result:')
    expect(summary).toContain('最新结果：已经整理完成，保密令牌为 [redacted-sensitive-value]')
    expect(summary).toContain('tool_activity:')
    expect(extractToolActivity(summary ?? '')).toEqual([
      {
        category: 'diagnostic',
        files: ['src/a-first.ts', 'src/z-last.ts'],
        outputSummary: [
          'src/a-first.ts:4 const token = "[redacted-sensitive-value]"',
          'src/z-last.ts:9 const apiKey = "[redacted-sensitive-value]"',
          '[additional search results omitted]'
        ].join('\n'),
        status: 'succeeded',
        title: 'Search repo'
      },
      {
        category: 'error',
        command: 'pnpm test -- packages/agent-runtime/src/__tests__/context-summary.test.ts',
        errorExcerpt: [
          'FAIL packages/agent-runtime/src/__tests__/context-summary.test.ts > buildRunContextSummary > preserves failures',
          'AssertionError: expected 1 to be 2',
          '- Expected',
          '+ Received',
          '- 2',
          '+ 1',
          'at packages/agent-runtime/src/__tests__/context-summary.test.ts:18:11'
        ].join('\n'),
        exitCode: 1,
        files: ['packages/agent-runtime/src/__tests__/context-summary.test.ts'],
        outputSummary: [
          'FAIL packages/agent-runtime/src/__tests__/context-summary.test.ts > buildRunContextSummary > preserves failures',
          'AssertionError: expected 1 to be 2',
          '- Expected',
          '+ Received',
          '- 2',
          '+ 1',
          'at packages/agent-runtime/src/__tests__/context-summary.test.ts:18:11'
        ].join('\n'),
        status: 'failed',
        title: 'Run failing test'
      }
    ])
    expect(summary).not.toContain('旧请求')
    expect(summary).not.toContain('msg-old-user')
    expect(summary).not.toContain('msg-latest-user')
    expect(summary).not.toContain('msg-latest-assistant')
    expect(summary).not.toContain('step-diagnostic')
    expect(summary).not.toContain('step-error')
    expect(summary).not.toContain('tool-call-search')
    expect(summary).not.toContain('tool-call-error')
    expect(summary).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz')
    expect(summary).not.toContain('sk-live-12345678')
    expect(summary).not.toContain('xoxb-1234567890-secret-secret')
    expect(summary).not.toContain('2026-06-25')
    expect(summary).not.toContain('sourceHash')
    expect(summary).not.toContain('tokenEstimate')
    expect(summary).not.toContain('"detail"')
    expect(summary?.endsWith('</hesper_run_context>')).toBe(true)
  })

  it('summarizes long tool output through the reducer and still applies maxChars truncation', () => {
    const detail = [
      'Command: cat logs/build.log',
      'Exit code: 0',
      '',
      'stdout:',
      'line 1',
      'Bearer abcdefghijklmnop',
      ...Array.from({ length: 80 }, (_, index) => `trace line ${index + 2}`)
    ].join('\n')

    const expanded = buildRunContextSummary({
      run: { id: 'run-ctx-long' },
      maxChars: 1200,
      steps: [
        createStep({
          id: 'step-long-output',
          type: 'tool_call',
          status: 'succeeded',
          title: 'Read log',
          createdAt: '2026-06-25T04:02:00.000Z',
          detail
        })
      ]
    })

    expect(expanded).toBeDefined()
    expect(expanded).toMatch(/^<hesper_run_context run_id="run-ctx-long" version="2">/)
    const [activity] = extractToolActivity(expanded ?? '')
    expect(activity).toMatchObject({
      category: 'bulk_output',
      command: 'cat logs/build.log',
      exitCode: 0,
      status: 'succeeded',
      title: 'Read log'
    })
    expect(activity?.outputSummary).toContain('line 1')
    expect(activity?.outputSummary).toContain('[redacted-sensitive-value]')
    expect(activity?.outputSummary).not.toContain('Bearer abcdefghijklmnop')
    expect(activity?.omittedChars).toBeTypeOf('number')
    expect(Number(activity?.omittedChars)).toBeGreaterThan(0)
    expect(expanded).not.toContain('trace line 40')

    const truncatedInput = {
      run: { id: 'run-ctx-long' },
      maxChars: 220,
      steps: [
        createStep({
          id: 'step-long-output',
          type: 'tool_call',
          status: 'succeeded',
          title: 'Read log',
          createdAt: '2026-06-25T04:02:00.000Z',
          detail
        })
      ]
    }

    const first = buildRunContextSummary(truncatedInput)
    const second = buildRunContextSummary(truncatedInput)

    expect(first).toBe(second)
    expect(first).toMatch(/^<hesper_run_context run_id="run-ctx-long" version="2">/)
    expect(first).toMatch(/\[truncated \d+ chars\]/)
    expect(first).toMatch(/<\/hesper_run_context>$/)
    expect(first?.length ?? 0).toBeLessThanOrEqual(220)
  })
})
