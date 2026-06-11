import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { ToolDefinition } from '@hesper/shared'
import type { ToolExecutionContext, ToolRunner } from '@hesper/tools'

type PiToolAdapterInput = {
  tools: ToolDefinition[]
  runner: ToolRunner
  context: Omit<ToolExecutionContext, 'signal'>
}

function toPiToolResult(tool: ToolDefinition, toolCallId: string, result: Awaited<ReturnType<ToolRunner['run']>>): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: result.content }],
    details: {
      toolId: tool.id,
      toolCallId,
      ...(result.details !== undefined ? { result: result.details } : {})
    },
    ...(result.terminate !== undefined ? { terminate: result.terminate } : {})
  }
}

export function createPiAgentTools(input: PiToolAdapterInput): AgentTool<any>[] {
  return input.tools.map((tool) => ({
    name: tool.id,
    label: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as any,
    async execute(toolCallId, params, signal) {
      const result = await input.runner.run(tool, params, {
        ...input.context,
        ...(signal !== undefined ? { signal } : {})
      })

      if (result.isError) {
        const error = new Error(result.content) as Error & { details?: unknown }
        error.details = result.details
        throw error
      }

      return toPiToolResult(tool, toolCallId, result)
    }
  }))
}
