import type { RunStep } from '@hesper/shared'
import { describe, expect, it } from 'vitest'
import { reduceToolOutput } from '../tool-output-reducer'

function createStep(input: {
  id?: string
  type?: RunStep['type']
  status?: RunStep['status']
  title?: string
  detail?: string
}): RunStep {
  return {
    id: input.id ?? 'step-1',
    runId: 'run-1',
    type: input.type ?? 'tool_call',
    status: input.status ?? 'succeeded',
    title: input.title ?? '工具步骤',
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    createdAt: '2026-06-27T04:00:00.000Z'
  }
}

describe('reduceToolOutput', () => {
  it('returns undefined for non-tool steps', () => {
    expect(reduceToolOutput(createStep({ type: 'thought', title: '思考中', detail: '不会被压缩' }))).toBeUndefined()
  })

  it('reduces successful shell output to a compact deterministic summary', () => {
    const step = createStep({
      title: '运行测试',
      detail: JSON.stringify({
        kind: 'tool_call',
        input: {
          command: 'pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
          purpose: '验证 reducer 测试'
        },
        output: {
          content: [{
            type: 'text',
            text: [
              'Command: pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
              'Exit code: 0',
              '',
              'stdout:',
              'PASS packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
              'Created packages/agent-runtime/src/tool-output-reducer.ts',
              'Created packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts'
            ].join('\n')
          }],
          details: {
            toolId: 'shell.run',
            result: {
              toolId: 'shell.run',
              command: 'pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
              exitCode: 0,
              stdout: [
                'PASS packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
                'Created packages/agent-runtime/src/tool-output-reducer.ts',
                'Created packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts'
              ].join('\n'),
              stderr: ''
            }
          }
        },
        isError: false
      })
    })

    expect(reduceToolOutput(step)).toEqual({
      title: '运行测试',
      status: 'succeeded',
      type: 'tool_call',
      category: 'success',
      command: 'pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
      exitCode: 0,
      files: [
        'packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
        'packages/agent-runtime/src/tool-output-reducer.ts'
      ],
      outputSummary: [
        'PASS packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
        'Created packages/agent-runtime/src/tool-output-reducer.ts',
        'Created packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts'
      ].join('\n')
    })
  })

  it('redacts CLI-style secrets in command text and fallback summaries', () => {
    const reduced = reduceToolOutput(createStep({
      title: '部署命令',
      detail: [
        'Command: deploy --token supersecret --password hunter2 --api-key abc123',
        'Exit code: 0'
      ].join('\n')
    }))

    expect(reduced).toMatchObject({
      title: '部署命令',
      status: 'succeeded',
      type: 'tool_call',
      category: 'success',
      command: 'deploy --token [redacted-sensitive-value] --password [redacted-sensitive-value] --api-key [redacted-sensitive-value]',
      exitCode: 0
    })
    expect(reduced?.outputSummary).toContain('--token [redacted-sensitive-value]')
    expect(reduced?.outputSummary).toContain('--password [redacted-sensitive-value]')
    expect(reduced?.outputSummary).toContain('--api-key [redacted-sensitive-value]')
    expect(reduced?.command).not.toContain('supersecret')
    expect(reduced?.command).not.toContain('hunter2')
    expect(reduced?.command).not.toContain('abc123')
    expect(reduced?.outputSummary).not.toContain('supersecret')
    expect(reduced?.outputSummary).not.toContain('hunter2')
    expect(reduced?.outputSummary).not.toContain('abc123')
  })

  it('does not let stdout body command markers override plain-text headers', () => {
    const reduced = reduceToolOutput(createStep({
      title: '读取旧日志',
      detail: [
        'Command: outer-command --safe',
        'Exit code: 0',
        '',
        'stdout:',
        'Command: inner-command --should-not-win',
        'Exit code: 1',
        'Still normal output'
      ].join('\n')
    }))

    expect(reduced).toMatchObject({
      title: '读取旧日志',
      status: 'succeeded',
      type: 'tool_call',
      category: 'success',
      command: 'outer-command --safe',
      exitCode: 0
    })
    expect(reduced?.outputSummary).toContain('Command: inner-command --should-not-win')
    expect(reduced?.outputSummary).toContain('Exit code: 1')
  })

  it('does not classify non-search tools ending with find as diagnostic', () => {
    const reduced = reduceToolOutput(createStep({
      title: '查找角色',
      detail: JSON.stringify({
        kind: 'tool_call',
        output: {
          content: [{ type: 'text', text: '{"roles":[{"id":"editor","name":"Editor"}],"count":1}' }],
          details: {
            toolId: 'roles.find',
            result: {
              query: 'editor',
              roles: [{ id: 'editor', name: 'Editor' }],
              count: 1
            }
          }
        },
        isError: false
      })
    }))

    expect(reduced).toEqual({
      title: '查找角色',
      status: 'succeeded',
      type: 'tool_call',
      category: 'success',
      outputSummary: '{"roles":[{"id":"editor","name":"Editor"}],"count":1}'
    })
  })

  it('keeps grep or search diagnostics while sorting files and redacting secrets', () => {
    const step = createStep({
      title: '搜索代码',
      detail: JSON.stringify({
        kind: 'tool_call',
        input: {
          path: 'packages/agent-runtime/src',
          condition: { contentContains: 'token' }
        },
        output: {
          content: [{ type: 'text', text: '{"results":2}' }],
          details: {
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

    expect(reduceToolOutput(step)).toEqual({
      title: '搜索代码',
      status: 'succeeded',
      type: 'tool_call',
      category: 'diagnostic',
      files: ['src/a-first.ts', 'src/z-last.ts'],
      outputSummary: [
        'src/a-first.ts:4 const token = "[redacted-sensitive-value]"',
        'src/z-last.ts:9 const apiKey = "[redacted-sensitive-value]"',
        '[additional search results omitted]'
      ].join('\n')
    })
  })

  it('preserves failed test signal with assertion diff and stack excerpt', () => {
    const step = createStep({
      status: 'failed',
      title: '运行失败测试',
      detail: JSON.stringify({
        kind: 'tool_call',
        input: {
          command: 'pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts'
        },
        output: {
          content: [{
            type: 'text',
            text: [
              'Command: pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
              'Exit code: 1',
              '',
              'stderr:',
              'FAIL packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts > reduceToolOutput > preserves failures',
              'AssertionError: expected 1 to be 2',
              '- Expected',
              '+ Received',
              '- 2',
              '+ 1',
              '    at packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts:18:11',
              'xoxb-1234567890-secret-secret'
            ].join('\n')
          }],
          details: {
            toolId: 'shell.run',
            result: {
              toolId: 'shell.run',
              command: 'pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
              exitCode: 1,
              stdout: '',
              stderr: [
                'FAIL packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts > reduceToolOutput > preserves failures',
                'AssertionError: expected 1 to be 2',
                '- Expected',
                '+ Received',
                '- 2',
                '+ 1',
                '    at packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts:18:11',
                'xoxb-1234567890-secret-secret'
              ].join('\n')
            }
          }
        },
        isError: true
      })
    })

    expect(reduceToolOutput(step)).toEqual({
      title: '运行失败测试',
      status: 'failed',
      type: 'tool_call',
      category: 'error',
      command: 'pnpm test -- packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts',
      exitCode: 1,
      files: ['packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts'],
      errorExcerpt: [
        'FAIL packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts > reduceToolOutput > preserves failures',
        'AssertionError: expected 1 to be 2',
        '- Expected',
        '+ Received',
        '- 2',
        '+ 1',
        'at packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts:18:11'
      ].join('\n'),
      outputSummary: [
        'FAIL packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts > reduceToolOutput > preserves failures',
        'AssertionError: expected 1 to be 2',
        '- Expected',
        '+ Received',
        '- 2',
        '+ 1',
        'at packages/agent-runtime/src/__tests__/tool-output-reducer.test.ts:18:11'
      ].join('\n')
    })
  })

  it('classifies failed search-like tools as error before diagnostic handling', () => {
    const reduced = reduceToolOutput(createStep({
      status: 'failed',
      title: '搜索失败',
      detail: JSON.stringify({
        kind: 'tool_call',
        input: {
          command: 'grep -R --line-number token src'
        },
        output: {
          content: [{
            type: 'text',
            text: [
              'Command: grep -R --line-number token src',
              'Exit code: 2',
              '',
              'stderr:',
              'Permission denied while reading src/secret.txt'
            ].join('\n')
          }],
          details: {
            toolId: 'filesystem.search-files',
            result: {
              toolId: 'filesystem.search-files',
              command: 'grep -R --line-number token src',
              exitCode: 2,
              stdout: '',
              stderr: 'Permission denied while reading src/secret.txt'
            }
          }
        },
        isError: true
      })
    }))

    expect(reduced).toEqual({
      title: '搜索失败',
      status: 'failed',
      type: 'tool_call',
      category: 'error',
      command: 'grep -R --line-number token src',
      exitCode: 2,
      errorExcerpt: 'Permission denied while reading src/secret.txt',
      outputSummary: 'Permission denied while reading src/secret.txt'
    })
  })

  it('treats blank output as empty without retaining raw text', () => {
    const step = createStep({
      title: '空输出',
      detail: JSON.stringify({
        kind: 'tool_call',
        output: {
          content: [{ type: 'text', text: '  \n\n  ' }],
          details: { toolId: 'filesystem.read-file' }
        },
        isError: false
      })
    })

    expect(reduceToolOutput(step)).toEqual({
      title: '空输出',
      status: 'succeeded',
      type: 'tool_call',
      category: 'empty'
    })
  })

  it('treats runtime-shaped blank structured output as empty even with metadata and input path', () => {
    const reduced = reduceToolOutput(createStep({
      title: '读取文件',
      detail: JSON.stringify({
        kind: 'tool_call',
        input: {
          path: 'packages/agent-runtime/src/tool-output-reducer.ts',
          purpose: '读取 reducer 文件'
        },
        output: {
          content: [{ type: 'text', text: ' \n ' }],
          details: {
            toolId: 'filesystem.read-file',
            toolCallId: 'tool-call-1',
            displayName: '读取文件',
            toolIcon: '📖',
            display: { name: 'Read File' }
          }
        },
        isError: false
      })
    }))

    expect(reduced).toEqual({
      title: '读取文件',
      status: 'succeeded',
      type: 'tool_call',
      category: 'empty',
      files: ['packages/agent-runtime/src/tool-output-reducer.ts']
    })
  })

  it('treats runtime result bookkeeping for empty file reads as empty output', () => {
    const reduced = reduceToolOutput(createStep({
      title: '读取空文件',
      detail: JSON.stringify({
        kind: 'tool_call',
        output: {
          content: [{ type: 'text', text: '' }],
          details: {
            toolId: 'filesystem.read-file',
            result: {
              toolId: 'filesystem.read-file',
              path: 'README.md',
              bytes: 0,
              truncated: false
            }
          }
        },
        isError: false
      })
    }))

    expect(reduced).toEqual({
      title: '读取空文件',
      status: 'succeeded',
      type: 'tool_call',
      category: 'empty',
      files: ['README.md']
    })
  })

  it('keeps structured root filenames without extensions in files', () => {
    const reduced = reduceToolOutput(createStep({
      title: '读取根文件',
      detail: JSON.stringify({
        kind: 'tool_call',
        output: {
          content: [{ type: 'text', text: '' }],
          details: {
            toolId: 'filesystem.read-file',
            result: {
              toolId: 'filesystem.read-file',
              path: 'README',
              bytes: 0,
              truncated: false
            }
          }
        },
        isError: false
      })
    }))

    expect(reduced).toEqual({
      title: '读取根文件',
      status: 'succeeded',
      type: 'tool_call',
      category: 'empty',
      files: ['README']
    })
  })

  it('falls back to safe plain-text reduction for oversized output', () => {
    const detail = [
      'Command: cat logs/build.log',
      'Exit code: 0',
      '',
      'stdout:',
      'line 1',
      'Bearer abcdefghijklmnop',
      ...Array.from({ length: 80 }, (_, index) => `trace line ${index + 2}`)
    ].join('\n')

    const first = reduceToolOutput(createStep({ title: '读取日志', detail }))
    const second = reduceToolOutput(createStep({ title: '读取日志', detail }))

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      title: '读取日志',
      status: 'succeeded',
      type: 'tool_call',
      category: 'bulk_output',
      command: 'cat logs/build.log',
      exitCode: 0
    })
    expect(first?.outputSummary).toContain('[redacted-sensitive-value]')
    expect(first?.outputSummary).not.toContain('Bearer abcdefghijklmnop')
    expect(first?.omittedChars).toBeGreaterThan(0)
  })
})
