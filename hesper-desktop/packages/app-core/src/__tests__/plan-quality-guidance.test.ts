import type { Session, ToolDefinition } from '@hesper/shared'
import { describe, expect, it } from 'vitest'
import { planQualityGoldenCases } from './fixtures/plan-quality-golden-cases'
import { createPromptAssemblyService } from '../prompt-assembly-service'

const session: Session = {
  id: 'session-plan-quality',
  title: 'Plan quality guidance test',
  status: 'active',
  workspacePath: 'C:/workspace/hesper',
  outputMode: 'markdown',
  enabledSkillIds: [],
  enabledToolIds: ['agent.spawn-worker-agent', 'filesystem.read-file'],
  allowedWorkerAgentRoleIds: ['implementation-worker'],
  maxWorkerAgentDepth: 1,
  maxWorkerAgentsPerRun: 2,
  createdAt: '2026-06-29T00:00:00.000Z',
  updatedAt: '2026-06-29T00:00:00.000Z'
}

const tools: ToolDefinition[] = [
  {
    id: 'agent.spawn-worker-agent',
    name: 'Spawn Worker Agent',
    description: 'Spawn a constrained Worker Agent',
    category: 'agent',
    inputSchema: { type: 'object', required: ['task', 'allowedToolIds'], properties: {} }
  },
  {
    id: 'filesystem.read-file',
    name: 'Read File',
    description: 'Read a workspace file',
    category: 'filesystem',
    inputSchema: { type: 'object', required: ['path'], properties: {} }
  }
]

describe('plan quality guidance', () => {
  it('keeps golden plan quality cases structurally complete and evaluation-only', () => {
    expect(planQualityGoldenCases).toHaveLength(5)

    const expectedIds = [
      'worktree-subagent-implementation',
      'bug-analysis-fix-plan',
      'prompt-tools-optimization',
      'documentation-only-change',
      'ui-change-plan'
    ]
    expect(planQualityGoldenCases.map((goldenCase) => goldenCase.id)).toEqual(expectedIds)

    for (const goldenCase of planQualityGoldenCases) {
      expect(goldenCase.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(goldenCase.userRequest.trim().length).toBeGreaterThan(20)
      expect(goldenCase.expectedTraits.length).toBeGreaterThanOrEqual(5)
      expect(goldenCase.antiPatterns.length).toBeGreaterThanOrEqual(3)
      expect(goldenCase.workerHandoffExpectations.length).toBeGreaterThanOrEqual(1)

      for (const value of [
        goldenCase.userRequest,
        ...goldenCase.expectedTraits,
        ...goldenCase.antiPatterns,
        ...goldenCase.workerHandoffExpectations
      ]) {
        expect(value.trim()).toBe(value)
        expect(value).not.toMatch(/\b(?:TBD|TODO)\b/i)
      }
    }
  })

  it('injects a Craft-style plan writer skeleton without changing Hesper identity', () => {
    const output = createPromptAssemblyService().assembleMainPrompt({
      session,
      skills: [],
      tools,
      projectContextFiles: ['AGENTS.md', 'hesper-desktop/CLAUDE.md']
    })

    expect(output.systemPrompt).toContain('You are the Hesper Agent.')
    expect(output.systemPrompt).not.toContain('You are Craft Agent')

    for (const section of [
      'Context intake order rules:',
      'Planning workflow rules:',
      'Plan output shape:',
      'Plan quality rules:',
      'Worker Task Packet:',
      'Plan self-review rules:',
      'Execution handoff rules:'
    ]) {
      expect(output.systemPrompt).toContain(section)
    }

    for (const field of [
      'Task 1, Task 2',
      'Goal',
      'Files',
      'Steps',
      'Verification',
      'Acceptance criteria',
      'Worker Agent handoff',
      'Risk / rollback'
    ]) {
      expect(output.systemPrompt).toContain(field)
    }

    for (const forbiddenPlaceholder of [
      'TBD',
      'TODO',
      'later',
      'similar to Task N',
      'add appropriate tests'
    ]) {
      expect(output.systemPrompt).toContain(forbiddenPlaceholder)
    }

    expect(output.systemPrompt).toContain('read required skill instructions')
    expect(output.systemPrompt).toContain('project context files')
    expect(output.systemPrompt).toContain('root context')
    expect(output.systemPrompt).toContain('relevant subdirectory context')
    expect(output.systemPrompt).toContain('nearby tests')
    expect(output.systemPrompt).toContain('Stop gathering context')
    expect(output.systemPrompt).toContain('Write the plan in the user\'s language')
    expect(output.systemPrompt).toContain('do not claim implementation or verification has already happened')
    expect(output.systemPrompt).toContain('## Goal')
    expect(output.systemPrompt).toContain('## Context / constraints')
    expect(output.systemPrompt).toContain('### Task 1:')
    expect(output.systemPrompt).toContain('## Out of scope')
    expect(output.systemPrompt).toContain('## Overall verification')
    expect(output.systemPrompt).toContain('prompt guidance are incomplete summaries')
    expect(output.systemPrompt).toContain('do not replace full skill instructions')
    expect(output.systemPrompt).toContain('explicit user approval')
    expect(output.systemPrompt).toContain('Worker Task Packet')
    expect(output.systemPrompt).toContain('Task id')
    expect(output.systemPrompt).toContain('Context summary')
    expect(output.systemPrompt).toContain('Files/read scope')
    expect(output.systemPrompt).toContain('Do not touch')
    expect(output.systemPrompt).toContain('Expected report format')
    expect(output.systemPrompt).toContain('Constraints')
    expect(output.systemPrompt).toContain('Write boundaries')
    expect(output.systemPrompt).toContain('changed files')
    expect(output.systemPrompt).toContain('verification performed')
    expect(output.systemPrompt).toContain('blockers')
    expect(output.systemPrompt).toContain('residual risks')
  })
})
