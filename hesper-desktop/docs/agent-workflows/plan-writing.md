# Hesper Plan Writing Workflow

This document defines the reusable plan-writing workflow for Hesper Agents and Worker Agent handoffs.

## Workflow

Use this sequence for non-trivial implementation, multi-step debugging, worktree-based work, skill-driven work, or Worker Agent delegation:

1. **Context intake**
   - Read user constraints carefully.
   - Read mentioned skill instructions when available.
   - Read project context files before editing relevant areas.
   - Inspect existing implementation and nearby tests.

2. **Design**
   - Summarize the actual problem.
   - Identify affected components.
   - Compare viable approaches and trade-offs.
   - Ask only necessary clarification questions.

3. **Plan**
   - Write a concrete, numbered task plan.
   - Keep tasks independently reviewable.
   - Include exact files or bounded discovery scope.
   - Include verification and acceptance criteria.

4. **Approval**
   - Wait for explicit user approval before implementation.
   - Before approval, do not edit files, run modifying commands, or delegate implementation to Worker Agents.

5. **Execute**
   - Execute approved tasks in order.
   - Delegate bounded tasks to Worker Agents when useful.
   - Review Worker Agent changes and verification before continuing.

6. **Review**
   - Run narrow tests first, then broader checks if appropriate.
   - Summarize changed files, verification, risks, and follow-ups.

## Plan Template

```markdown
# <Feature or Fix> Implementation Plan

## Goal

<Observable outcome and user value.>

## Context

- Relevant files:
  - `<path>`
- Relevant existing behavior:
  - <summary>
- Constraints:
  - <constraint>

## Architecture / Approach

<Chosen approach and why. Include alternatives only when useful.>

## Tasks

### Task 1: <specific task title>

**Goal**  
<What this task accomplishes.>

**Files**
- Inspect: `<path>`
- Modify: `<path>`
- Test: `<path>`

**Steps**
1. <Concrete step grounded in the current codebase.>
2. <Concrete step.>
3. <Concrete step.>

**Verification**
- `<command>`
- Expected result: <what should pass or fail and why>

**Acceptance criteria**
- <Observable completion condition.>
- <Observable completion condition.>

**Worker Agent handoff**
- Use Worker Agent: yes/no
- Scope: <bounded scope>
- Write boundaries: <allowed files/directories>
- Expected output: changed files, verification performed, blockers, residual risks, status

**Risk / rollback**
- Risk: <likely issue>
- Rollback: <how to revert or mitigate>
```

## Task Quality Rules

Every task should include:

- Goal;
- Files;
- Steps;
- Verification;
- Acceptance criteria;
- Worker Agent handoff;
- Risk / rollback.

Avoid vague or placeholder phrasing:

- TBD;
- TODO;
- later;
- follow-up;
- similar to Task N;
- add appropriate tests;
- implement the feature;
- fix the bug.

Replace vague phrasing with concrete files, commands, and observable outcomes.

## Worker Agent Handoff Template

Use this shape when delegating an approved task:

```markdown
You are implementing Task <N>: <title>.

Goal:
<goal>

Scope:
- Read/inspect: <paths>
- Allowed writes: <paths>
- Do not modify: <paths or areas>

Steps / focus:
1. <step>
2. <step>

Verification:
- Run: <command>
- Expected: <result>

Acceptance criteria:
- <criterion>

Final report format:
- Status: PASS / NEEDS_CHANGES / BLOCKED
- Changed files:
- Verification performed:
- Blockers:
- Residual risks:
```

## Self-review Checklist

Before presenting a plan, check:

- Does every task have all required fields?
- Are file paths specific or is discovery scope bounded?
- Are tasks ordered by dependency?
- Are independent Worker Agent tasks safe to parallelize?
- Does verification name commands or manual checks?
- Are acceptance criteria observable?
- Are risks and rollback notes present?
- Are there any placeholder phrases?
- Does the plan avoid unrequested permission-system work or unrelated refactors?
- Does Hesper keep its own identity and not copy another agent brand?

## Example: Prompt-only Change

### Task 1: Add plan quality prompt guidance

**Goal**  
Make the main Hesper Agent produce concrete implementation plans instead of generic Task 1 / Task 2 outlines.

**Files**
- Modify: `packages/app-core/src/prompt-assembly-service.ts`
- Test: `packages/app-core/src/__tests__/prompt-assembly-service.test.ts`

**Steps**
1. Add `renderPlanQualityRules()` with required plan fields.
2. Add `renderPlanSelfReviewRules()` with placeholder and coverage checks.
3. Include both sections in the main prompt assembly.
4. Update tests to assert section headings and key required fields.

**Verification**
- `pnpm --filter @hesper/app-core test -- src/__tests__/prompt-assembly-service.test.ts`

**Acceptance criteria**
- Main prompt includes Plan quality rules.
- Main prompt requires Files, Verification, Acceptance criteria, Worker Agent handoff, and Risk / rollback.
- Tests pass.

**Worker Agent handoff**
- Use Worker Agent: yes, if the file scope is isolated.
- Write boundaries: prompt assembly service and its tests only.

**Risk / rollback**
- Risk: prompt becomes too verbose or repetitive.
- Rollback: remove the new render helper calls and revert test expectations.

## Example: Service Implementation

Use a Worker Agent when the service and tests are isolated. Give exact files, expected behavior, and narrow test command. Do not delegate broad architecture decisions.

## Example: UI Implementation

Include component paths, state/data-flow files, styling boundaries, and manual verification steps. Avoid unrelated layout changes.

## Example: Documentation-only Change

Include target docs, required sections, source evidence, and a review checklist. Verification can be link/path checks and markdown readability when no automated test exists.
