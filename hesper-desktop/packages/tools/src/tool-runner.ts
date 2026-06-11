import type { ToolDefinition } from '@hesper/shared'

export type ToolExecutionContext = {
  runId: string
  sessionId: string
  workspacePath?: string
  allowedToolIds: string[]
  signal?: AbortSignal
}

export type ToolExecutionResult = {
  content: string
  details?: unknown
  isError?: boolean
  terminate?: boolean
}

export type ToolPermissionDecision = {
  allowed: boolean
  reason?: string
}

export type ToolPermissionPolicy = {
  evaluate(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): ToolPermissionDecision | Promise<ToolPermissionDecision>
}

export type ToolExecutor = {
  execute(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

export type ToolRunner = {
  run(tool: ToolDefinition, args: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

export function createAllowlistPermissionPolicy(): ToolPermissionPolicy {
  return {
    evaluate(tool, _args, context) {
      if (!context.allowedToolIds.includes(tool.id)) {
        return { allowed: false, reason: `Tool is not allowed for this run: ${tool.id}` }
      }
      return { allowed: true }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createToolRunner(options: { policy: ToolPermissionPolicy; executor: ToolExecutor }): ToolRunner {
  return {
    async run(tool, args, context) {
      let decision: ToolPermissionDecision
      try {
        decision = await options.policy.evaluate(tool, args, context)
      } catch (error) {
        return {
          content: `Tool blocked by permission policy: Permission policy failed closed: ${errorMessage(error)}`,
          details: { code: 'permission_policy_error', toolId: tool.id },
          isError: true
        }
      }

      if (!decision.allowed) {
        return {
          content: `Tool blocked by permission policy: ${decision.reason ?? 'Permission denied.'}`,
          details: { code: 'permission_denied', toolId: tool.id },
          isError: true
        }
      }

      try {
        return await options.executor.execute(tool, args, context)
      } catch (error) {
        return {
          content: `Tool execution failed: ${errorMessage(error)}`,
          details: { code: 'tool_execution_error', toolId: tool.id },
          isError: true
        }
      }
    }
  }
}
