import { describe, expect, it } from 'vitest'
import { buildSessionCompaction } from '../session-compaction'

type ToolEntry = Record<string, unknown>

type RunSummaryInput = {
  runId: string
  createdAt: string
  user?: string
  assistant?: string
  toolEntries?: ToolEntry[]
  truncatedChars?: number
}

function runSummary(input: RunSummaryInput): { runId: string, content: string, createdAt: string, version: number } {
  const lines = [
    `<hesper_run_context run_id="${input.runId}" version="2">`,
    'purpose: previous_run_continuity_not_new_user_request'
  ]

  if (input.user) {
    lines.push('latest_user_request:', input.user)
  }

  if (input.assistant) {
    lines.push('latest_assistant_result:', input.assistant)
  }

  if (input.toolEntries && input.toolEntries.length > 0) {
    lines.push('tool_activity:', ...input.toolEntries.map((entry) => JSON.stringify(entry)))
  }

  if (input.truncatedChars) {
    lines.push(`[truncated ${input.truncatedChars} chars]`)
  }

  lines.push('</hesper_run_context>')
  return {
    runId: input.runId,
    createdAt: input.createdAt,
    version: 2,
    content: lines.join('\n')
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

describe('buildSessionCompaction', () => {
  it('returns undefined for empty or non-meaningful inputs', () => {
    expect(buildSessionCompaction({
      sessionId: 'session-empty',
      createdAt: '2026-06-27T09:00:00.000Z',
      runSummaries: []
    })).toBeUndefined()

    expect(buildSessionCompaction({
      sessionId: 'session-empty',
      createdAt: '2026-06-27T09:00:00.000Z',
      runSummaries: [
        {
          runId: 'run-1',
          createdAt: '2026-06-27T09:00:01.000Z',
          version: 2,
          content: '<hesper_run_context run_id="run-1" version="2">\npurpose: previous_run_continuity_not_new_user_request\n</hesper_run_context>'
        }
      ]
    })).toBeUndefined()
  })

  it('builds a deterministic session_summary item with stable covered run ids and deduped tool activity', () => {
    const duplicateTool = {
      category: 'diagnostic',
      status: 'succeeded',
      title: 'Search repo',
      files: ['packages/agent-runtime/src/context-assembler.ts'],
      outputSummary: 'packages/agent-runtime/src/context-assembler.ts:26 covered_run_ids'
    }

    const result = buildSessionCompaction({
      sessionId: 'session-5',
      createdAt: '2026-06-27T09:20:00.000Z',
      currentPrompt: [
        'Implement session-level overflow compaction.',
        '- Must keep XML wrapper complete',
        '- Do not implement runtime overflow trigger',
        '- Only change session compaction files'
      ].join('\n'),
      recentMessages: [
        {
          role: 'user',
          createdAt: '2026-06-27T09:18:00.000Z',
          content: 'Keep TDD and preserve important file paths.'
        }
      ],
      runSummaries: [
        runSummary({
          runId: 'run-2',
          createdAt: '2026-06-27T09:11:00.000Z',
          assistant: 'Decision: reuse context-summary XML escaping and stable hashing.',
          toolEntries: [duplicateTool]
        }),
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Build deterministic overflow compaction and keep hard constraints visible.',
          toolEntries: [duplicateTool]
        }),
        runSummary({
          runId: 'run-3',
          createdAt: '2026-06-27T09:12:00.000Z',
          assistant: 'Validation: targeted tests still fail before implementation.',
          toolEntries: [{
            category: 'error',
            status: 'failed',
            title: 'Run failing test',
            command: 'pnpm test -- --token supersecret',
            exitCode: 1,
            files: ['packages/agent-runtime/src/__tests__/session-compaction.test.ts'],
            errorExcerpt: 'AssertionError: expected undefined to be defined',
            outputSummary: 'FAIL session-compaction.test.ts'
          }],
          truncatedChars: 87
        })
      ]
    })

    expect(result).toBeDefined()
    expect(result?.coveredRunIds).toEqual(['run-1', 'run-2', 'run-3'])
    expect(result?.sourceHash).toBe(result?.item.sourceHash)
    expect(result?.item.kind).toBe('session_summary')
    expect(result?.item.version).toBe(1)
    expect(result?.item.sessionId).toBe('session-5')
    expect(result?.item.runId).toBe('run-3')
    expect(result?.item.id).toBe('context-item-run-3-session-summary-v1')
    expect(result?.item.tokenEstimate).toBe(Math.ceil((result?.item.content.length ?? 0) / 4))
    expect(result?.item.content).toMatch(/^<hesper_session_context session_id="session-5" covered_run_ids="run-1,run-2,run-3" version="1">/)
    expect(result?.item.content).toContain('earliest_user_goal:')
    expect(result?.item.content).toContain('Build deterministic overflow compaction and keep hard constraints visible.')
    expect(result?.item.content).toContain('hard_constraints:')
    expect(result?.item.content).toContain('Must keep XML wrapper complete')
    expect(result?.item.content).toContain('Do not implement runtime overflow trigger')
    expect(result?.item.content).toContain('confirmed_decisions:')
    expect(result?.item.content).toContain('Decision: reuse context-summary XML escaping and stable hashing.')
    expect(result?.item.content).toContain('recent_failures_and_validation:')
    expect(result?.item.content).toContain('AssertionError: expected undefined to be defined')
    expect(result?.item.content).toContain('important_files:')
    expect(result?.item.content).toContain('packages/agent-runtime/src/context-assembler.ts')
    expect(result?.item.content).toContain('packages/agent-runtime/src/__tests__/session-compaction.test.ts')
    expect(result?.item.content).toContain('source_omissions:')
    expect(result?.item.content).toContain('[truncated 87 chars]')
    expect(extractToolActivity(result?.item.content ?? '')).toEqual([
      {
        category: 'diagnostic',
        files: ['packages/agent-runtime/src/context-assembler.ts'],
        outputSummary: 'packages/agent-runtime/src/context-assembler.ts:26 covered_run_ids',
        status: 'succeeded',
        title: 'Search repo'
      },
      {
        category: 'error',
        command: 'pnpm test -- --token [redacted-sensitive-value]',
        errorExcerpt: 'AssertionError: expected undefined to be defined',
        exitCode: 1,
        files: ['packages/agent-runtime/src/__tests__/session-compaction.test.ts'],
        outputSummary: 'FAIL session-compaction.test.ts',
        status: 'failed',
        title: 'Run failing test'
      }
    ])
  })

  it('redacts sensitive values including CLI and bearer-style tokens', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-redact',
      createdAt: '2026-06-27T09:20:00.000Z',
      currentPrompt: 'Use --token supersecret and Bearer abcdefghijklmnop only as examples.',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Deploy with --password hunter2 and apiKey=plain-secret',
          assistant: 'Observed github_pat_abcdefghijklmnopqrstuvwxyz and sk-live-1234567890 in logs.',
          toolEntries: [{
            category: 'error',
            status: 'failed',
            title: 'Inspect secrets',
            command: 'deploy --token supersecret',
            errorExcerpt: 'Bearer abcdefghijklmnop',
            outputSummary: 'xoxb-1234567890-secret-secret'
          }]
        })
      ]
    })

    const content = result?.item.content ?? ''
    expect(content).toContain('[redacted-sensitive-value]')
    expect(content).not.toContain('supersecret')
    expect(content).not.toContain('hunter2')
    expect(content).not.toContain('plain-secret')
    expect(content).not.toContain('abcdefghijklmnop')
    expect(content).not.toContain('github_pat_abcdefghijklmnopqrstuvwxyz')
    expect(content).not.toContain('sk-live-1234567890')
    expect(content).not.toContain('xoxb-1234567890-secret-secret')
  })

  it('does not redact ordinary filenames or risk labels while still redacting real sk-style tokens', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-redact-safe-text',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Review reports/task-5-code-quality-review-report.md and keep risk-score-high visible.',
          assistant: 'Decision: compare reports/task-5-code-quality-review-report.md against sk-live-1234567890 while leaving risk-score-high unchanged.'
        })
      ]
    })

    const content = result?.item.content ?? ''
    expect(content).toContain('reports/task-5-code-quality-review-report.md')
    expect(content).toContain('risk-score-high')
    expect(content).toContain('[redacted-sensitive-value]')
    expect(content).not.toContain('sk-live-1234567890')
  })

  it('returns undefined when only filtered success noise remains', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-noise-only',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          assistant: 'Explored old logs and listed files.',
          toolEntries: [
            {
              category: 'success',
              status: 'succeeded',
              title: 'List files',
              outputSummary: 'listed 240 entries'
            },
            {
              category: 'bulk_output',
              status: 'succeeded',
              title: 'Read huge log',
              outputSummary: 'stdout line '.repeat(30),
              omittedChars: 900
            }
          ]
        })
      ]
    })

    expect(result).toBeUndefined()
  })

  it('drops non-meaningful success noise while retaining failures and diagnostic file activity', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-tool-filtering',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Keep only meaningful old tool activity.',
          toolEntries: [
            {
              category: 'success',
              status: 'succeeded',
              title: 'List files',
              outputSummary: 'listed 240 entries'
            },
            {
              category: 'bulk_output',
              status: 'succeeded',
              title: 'Read huge log',
              outputSummary: 'stdout line '.repeat(30),
              omittedChars: 900
            },
            {
              category: 'diagnostic',
              status: 'succeeded',
              title: 'Search repo',
              files: ['packages/agent-runtime/src/session-compaction.ts'],
              outputSummary: 'packages/agent-runtime/src/session-compaction.ts:142 normalizeOrderedRunSummaries'
            },
            {
              category: 'error',
              status: 'failed',
              title: 'Run failing test',
              command: 'pnpm test -- packages/agent-runtime/src/__tests__/session-compaction.test.ts',
              exitCode: 1,
              files: ['packages/agent-runtime/src/__tests__/session-compaction.test.ts'],
              errorExcerpt: 'AssertionError: expected false to be true',
              outputSummary: 'FAIL session-compaction.test.ts'
            }
          ]
        })
      ]
    })

    expect(result).toBeDefined()
    expect(result?.item.content).toContain('packages/agent-runtime/src/session-compaction.ts')
    expect(result?.item.content).toContain('AssertionError: expected false to be true')
    expect(result?.item.content).not.toContain('List files')
    expect(result?.item.content).not.toContain('Read huge log')
    expect(extractToolActivity(result?.item.content ?? '')).toEqual([
      {
        category: 'diagnostic',
        files: ['packages/agent-runtime/src/session-compaction.ts'],
        outputSummary: 'packages/agent-runtime/src/session-compaction.ts:142 normalizeOrderedRunSummaries',
        status: 'succeeded',
        title: 'Search repo'
      },
      {
        category: 'error',
        command: 'pnpm test -- packages/agent-runtime/src/__tests__/session-compaction.test.ts',
        errorExcerpt: 'AssertionError: expected false to be true',
        exitCode: 1,
        files: ['packages/agent-runtime/src/__tests__/session-compaction.test.ts'],
        outputSummary: 'FAIL session-compaction.test.ts',
        status: 'failed',
        title: 'Run failing test'
      }
    ])
  })

  it('returns undefined when only exploration bullets remain after extraction', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-exploration-only',
      createdAt: '2026-06-27T09:20:00.000Z',
      currentPrompt: [
        '- explored package A',
        '1. looked at package B'
      ].join('\n'),
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          assistant: [
            '- explored package A',
            '- looked at package B'
          ].join('\n')
        })
      ]
    })

    expect(result).toBeUndefined()
  })

  it('only keeps bullet and numbered lines when they actually match constraint, decision, or validation patterns', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-bullet-filtering',
      createdAt: '2026-06-27T09:20:00.000Z',
      currentPrompt: [
        '- explored package A',
        '- Must keep wrapper completeness',
        '1. looked at package B'
      ].join('\n'),
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Need deterministic session compaction.',
          assistant: [
            '- explored package A',
            '- looked at package B',
            '- confirmed architecture decision',
            '1. validation failed in smoke test'
          ].join('\n')
        })
      ]
    })

    expect(result).toBeDefined()
    expect(result?.item.content).toContain('hard_constraints:')
    expect(result?.item.content).toContain('Must keep wrapper completeness')
    expect(result?.item.content).toContain('confirmed_decisions:')
    expect(result?.item.content).toContain('confirmed architecture decision')
    expect(result?.item.content).toContain('recent_failures_and_validation:')
    expect(result?.item.content).toContain('validation failed in smoke test')
    expect(result?.item.content).not.toContain('explored package A')
    expect(result?.item.content).not.toContain('looked at package B')
  })

  it('does not treat exploratory assistant text as a confirmed decision', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-decision-filter',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Keep deterministic compaction behavior.',
          assistant: [
            'Plan: inspect package A and keep exploring logs.',
            'Decision: reuse the existing wrapper format.',
            'Architecture: keep session summaries compatible with the assembler.'
          ].join('\n')
        })
      ]
    })

    expect(result).toBeDefined()
    expect(result?.item.content).toContain('confirmed_decisions:')
    expect(result?.item.content).toContain('Decision: reuse the existing wrapper format.')
    expect(result?.item.content).toContain('Architecture: keep session summaries compatible with the assembler.')
    expect(result?.item.content).not.toContain('Plan: inspect package A and keep exploring logs.')
  })

  it('collects important files from recentMessages and currentPrompt', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-important-files',
      createdAt: '2026-06-27T09:20:00.000Z',
      currentPrompt: 'Update docs/task-5-code-quality-review-report.md and packages/agent-runtime/src/session-compaction.ts.',
      recentMessages: [
        {
          role: 'user',
          createdAt: '2026-06-27T09:18:00.000Z',
          content: 'Also inspect packages/agent-runtime/src/context-assembler.ts before changing anything.'
        }
      ],
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Preserve the original goal for deterministic compaction.'
        })
      ]
    })

    expect(result).toBeDefined()
    expect(result?.item.content).toContain('important_files:')
    expect(result?.item.content).toContain('docs/task-5-code-quality-review-report.md')
    expect(result?.item.content).toContain('packages/agent-runtime/src/session-compaction.ts')
    expect(result?.item.content).toContain('packages/agent-runtime/src/context-assembler.ts')
  })

  it('still returns a summary when truly meaningful goal or error context remains', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-meaningful-still-kept',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Preserve the original goal for deterministic compaction.',
          toolEntries: [{
            category: 'error',
            status: 'failed',
            title: 'Run failing test',
            files: ['packages/agent-runtime/src/__tests__/session-compaction.test.ts'],
            errorExcerpt: 'AssertionError: expected true to be false'
          }]
        })
      ]
    })

    expect(result).toBeDefined()
    expect(result?.item.content).toContain('earliest_user_goal:')
    expect(result?.item.content).toContain('Preserve the original goal for deterministic compaction.')
    expect(result?.item.content).toContain('recent_failures_and_validation:')
    expect(result?.item.content).toContain('AssertionError: expected true to be false')
  })

  it('does not return empty or header-only summaries under tight mid-sized budgets', () => {
    const result = buildSessionCompaction({
      sessionId: 's',
      createdAt: '2026-06-27T09:20:00.000Z',
      maxChars: 170,
      currentPrompt: 'Must keep wrapper completeness.',
      runSummaries: [
        runSummary({
          runId: 'r1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'This user goal is intentionally long enough to force truncation beyond a whole section boundary.',
          assistant: 'Decision: reuse the existing wrapper format for deterministic compaction.'
        })
      ]
    })

    if (!result) {
      expect(result).toBeUndefined()
      return
    }

    expect(result.item.content).toContain('[truncated ')
    expect(result.item.content).toMatch(/<\/hesper_session_context>$/)
    expect(result.item.content).not.toMatch(/^<hesper_session_context[\s\S]*>\n\[truncated \d+ chars\]\n<\/hesper_session_context>$/)
    expect(result.item.content).not.toMatch(/^<hesper_session_context[\s\S]*>\npurpose:\n(?:\[truncated \d+ chars\]|<\/hesper_session_context>)/)
    expect(result.item.content).not.toMatch(/\n(?:earliest_user_goal|hard_constraints|confirmed_decisions|recent_failures_and_validation|important_files|source_omissions|tool_activity):\n(?:\[truncated \d+ chars\]|<\/hesper_session_context>)/)
  })

  it('keeps the wrapper complete and includes a truncation marker under a tight maxChars budget', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-tight-budget',
      createdAt: '2026-06-27T09:20:00.000Z',
      maxChars: 260,
      currentPrompt: 'Must preserve wrapper completeness.',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'A very long user goal '.repeat(10),
          assistant: 'Decision: keep deterministic compaction '.repeat(10),
          toolEntries: [{
            category: 'bulk_output',
            status: 'succeeded',
            title: 'Read huge log',
            outputSummary: 'line '.repeat(40),
            omittedChars: 400
          }]
        })
      ]
    })

    expect(result).toBeDefined()
    expect(result?.item.content).toMatch(/^<hesper_session_context session_id="session-tight-budget" covered_run_ids="run-1" version="1">/)
    expect(result?.item.content).toContain('[truncated ')
    expect(result?.item.content).toMatch(/<\/hesper_session_context>$/)
    expect(result?.item.content.length ?? 0).toBeLessThanOrEqual(260)
    const activityLines = (result?.item.content ?? '').split('\n').filter((line) => line.startsWith('{'))
    for (const line of activityLines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('returns undefined when maxChars cannot fit a complete wrapper', () => {
    const result = buildSessionCompaction({
      sessionId: 'session-too-small',
      createdAt: '2026-06-27T09:20:00.000Z',
      maxChars: 40,
      currentPrompt: 'Must preserve wrapper completeness.',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Need a tiny budget failure case.'
        })
      ]
    })

    expect(result).toBeUndefined()
  })

  it('keeps sourceHash stable when tie-case summaries differ only in version and input order changes', () => {
    const duplicateContent = runSummary({
      runId: 'run-tie',
      createdAt: '2026-06-27T09:10:00.000Z',
      user: 'Preserve deterministic order even in tie cases.'
    }).content
    const summaryV1 = {
      runId: 'run-tie',
      createdAt: '2026-06-27T09:10:00.000Z',
      version: 1,
      content: duplicateContent
    }
    const summaryV2 = {
      runId: 'run-tie',
      createdAt: '2026-06-27T09:10:00.000Z',
      version: 2,
      content: duplicateContent
    }

    const first = buildSessionCompaction({
      sessionId: 'session-hash-tie',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [summaryV2, summaryV1]
    })
    const second = buildSessionCompaction({
      sessionId: 'session-hash-tie',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [summaryV1, summaryV2]
    })

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first?.item.content).toBe(second?.item.content)
    expect(first?.sourceHash).toBe(second?.sourceHash)
  })

  it('keeps recentMessages tie-cases deterministic when createdAt and role are identical', () => {
    const baseInput = {
      sessionId: 'session-recent-message-tie',
      createdAt: '2026-06-27T09:20:00.000Z',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'Preserve deterministic session compaction output.'
        })
      ]
    }
    const firstMessages = [
      {
        role: 'user',
        createdAt: '2026-06-27T09:18:00.000Z',
        content: 'Must keep wrapper completeness.'
      },
      {
        role: 'user',
        createdAt: '2026-06-27T09:18:00.000Z',
        content: 'Do not implement runtime trigger.'
      }
    ]
    const secondMessages = [...firstMessages].reverse()

    const first = buildSessionCompaction({
      ...baseInput,
      recentMessages: firstMessages
    })
    const second = buildSessionCompaction({
      ...baseInput,
      recentMessages: secondMessages
    })

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first?.item.content).toContain('Must keep wrapper completeness.')
    expect(first?.item.content).toContain('Do not implement runtime trigger.')
    expect(first?.item.content).toBe(second?.item.content)
    expect(first?.sourceHash).toBe(second?.sourceHash)
  })

  it('produces a deterministic sourceHash regardless of input order and changes when content changes', () => {
    const orderedInput = {
      sessionId: 'session-hash',
      createdAt: '2026-06-27T09:20:00.000Z',
      currentPrompt: 'Must preserve stable source hashes.',
      runSummaries: [
        runSummary({
          runId: 'run-1',
          createdAt: '2026-06-27T09:10:00.000Z',
          user: 'First goal'
        }),
        runSummary({
          runId: 'run-2',
          createdAt: '2026-06-27T09:11:00.000Z',
          assistant: 'Decision: keep deterministic ordering.'
        })
      ]
    }

    const reordered = {
      ...orderedInput,
      runSummaries: [...orderedInput.runSummaries].reverse()
    }
    const [firstSummary] = orderedInput.runSummaries

    expect(firstSummary).toBeDefined()

    const first = buildSessionCompaction(orderedInput)
    const second = buildSessionCompaction(reordered)
    const changed = buildSessionCompaction({
      ...orderedInput,
      runSummaries: [
        firstSummary!,
        runSummary({
          runId: 'run-2',
          createdAt: '2026-06-27T09:11:00.000Z',
          assistant: 'Decision: keep deterministic ordering, but update the architecture note.'
        })
      ]
    })

    expect(first?.coveredRunIds).toEqual(['run-1', 'run-2'])
    expect(second?.coveredRunIds).toEqual(['run-1', 'run-2'])
    expect(first?.sourceHash).toBe(second?.sourceHash)
    expect(first?.item.content).toBe(second?.item.content)
    expect(changed?.sourceHash).not.toBe(first?.sourceHash)
  })
})
