export type PlanQualityGoldenCase = {
  id: string
  userRequest: string
  expectedTraits: string[]
  antiPatterns: string[]
  workerHandoffExpectations: string[]
}

export const planQualityGoldenCases: PlanQualityGoldenCase[] = [
  {
    id: 'worktree-subagent-implementation',
    userRequest: 'Use a worktree and subagents to implement the approved plan for improving prompt quality.',
    expectedTraits: [
      'identifies or creates an isolated worktree before implementation',
      'maps execution to approved Task N items',
      'uses Worker Agents only for bounded independent tasks',
      'names files or bounded directories for each task',
      'includes narrow verification commands and acceptance criteria',
      'states risks and rollback for each task'
    ],
    antiPatterns: [
      'starts editing before approval or worktree confirmation',
      'delegates a vague one-line implementation task',
      'omits verification or risk/rollback details'
    ],
    workerHandoffExpectations: [
      'includes Task id, Goal, Context summary, Files/read scope, Write boundaries, and Do not touch',
      'requires changed files and verification performed in the final report',
      'runs workers in parallel only for independent write sets'
    ]
  },
  {
    id: 'bug-analysis-fix-plan',
    userRequest: 'Analyze a failing scheduler test, explain the root cause, and make a careful fix plan.',
    expectedTraits: [
      'reads the failing test and nearby implementation before planning',
      'separates diagnosis from implementation tasks',
      'names the exact test command to reproduce the failure',
      'defines acceptance criteria in terms of the failing behavior',
      'identifies concurrency or timing risks when relevant',
      'does not assume root cause without evidence'
    ],
    antiPatterns: [
      'proposes a broad rewrite without inspecting code',
      'claims tests have passed before running them',
      'uses placeholders such as add appropriate tests'
    ],
    workerHandoffExpectations: [
      'assigns read-only investigation before implementation when root cause is unknown',
      'bounds any implementation worker to the scheduler and its tests',
      'requires reproduction command and post-fix command in the report'
    ]
  },
  {
    id: 'prompt-tools-optimization',
    userRequest: 'Optimize the system prompt and tool descriptions so generated implementation plans are more specific.',
    expectedTraits: [
      'audits current prompt sections before adding new text',
      'keeps Hesper identity distinct from other agents',
      'avoids introducing permission-system behavior unless requested',
      'updates prompt and tool tests with stable key-phrase assertions',
      'names affected prompt assembly and tool definition files',
      'checks prompt duplication and token growth risk'
    ],
    antiPatterns: [
      'copies another agent brand into Hesper identity',
      'adds long duplicated prompt blocks without tests',
      'implements runtime permission changes in a prompt-only task'
    ],
    workerHandoffExpectations: [
      'gives implementation workers exact prompt/tool files to edit',
      'requires tests that lock behavior without overfitting full prose',
      'asks review workers to check identity and scope boundaries'
    ]
  },
  {
    id: 'documentation-only-change',
    userRequest: 'Create documentation explaining how to write high-quality Hesper implementation plans.',
    expectedTraits: [
      'states that the change is documentation-only',
      'names target documentation paths',
      'uses source evidence from existing prompt and tests',
      'defines manual verification for readability and links',
      'does not modify runtime behavior',
      'records out-of-scope implementation ideas separately'
    ],
    antiPatterns: [
      'silently changes code during a documentation-only task',
      'uses broad claims without source evidence',
      'leaves unresolved placeholder notes in the doc'
    ],
    workerHandoffExpectations: [
      'uses a review worker rather than implementation worker when useful',
      'bounds writes to documentation paths only',
      'requires report of changed docs and unresolved risks'
    ]
  },
  {
    id: 'ui-change-plan',
    userRequest: 'Plan a small UI change to improve how approved plans are shown in the desktop app.',
    expectedTraits: [
      'reads relevant UI component files and nearby tests or stories first',
      'separates UI state/data-flow tasks from visual styling tasks',
      'includes manual verification steps when visual automation is unavailable',
      'names files or bounded component directories',
      'states accessibility and regression risks',
      'avoids unrelated layout refactors'
    ],
    antiPatterns: [
      'changes broad app layout without request',
      'omits manual verification for visual behavior',
      'delegates UI work without component boundaries'
    ],
    workerHandoffExpectations: [
      'bounds writes to named UI components and tests',
      'requires screenshots or manual verification notes when available',
      'requires changed files, verification performed, and residual visual risks'
    ]
  }
]
