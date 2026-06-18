import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { ToolDefinition } from '@hesper/shared'
import type { ToolExecutionContext, ToolRunner } from '@hesper/tools'

type PiToolAdapterInput = {
  tools: ToolDefinition[]
  runner: ToolRunner
  context: Omit<ToolExecutionContext, 'signal'>
}

const purposeParameter = {
  type: 'string',
  description: 'Briefly explain why this tool is being called and what it is meant to accomplish. This is shown to the user while the tool runs.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function withPurposeParameter(schema: unknown): unknown {
  const base = isRecord(schema) ? schema : { type: 'object' }
  const baseProperties = isRecord(base.properties) ? base.properties : {}
  const baseRequired = Array.isArray(base.required) ? base.required.filter((item): item is string => typeof item === 'string') : []
  const required = [...baseRequired.filter((item) => item !== 'purpose'), 'purpose']

  return {
    ...base,
    type: 'object',
    properties: {
      ...baseProperties,
      purpose: purposeParameter
    },
    required
  }
}

function stripPurposeParameter(params: unknown): unknown {
  if (!isRecord(params)) return params
  const { purpose: _purpose, ...rest } = params
  return rest
}

function normalizePiToolName(toolId: string): string {
  const normalized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return normalized || 'tool'
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
    name: normalizePiToolName(tool.id),
    label: tool.name,
    description: tool.description,
    parameters: withPurposeParameter(tool.inputSchema) as any,
    async execute(toolCallId, params, signal) {
      const result = await input.runner.run(tool, stripPurposeParameter(params), {
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
