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

function normalizedText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || undefined : undefined
}

function preferredToolDisplayName(tool: ToolDefinition): string {
  return normalizedText(tool.display?.names?.['zh-CN']) ?? normalizedText(tool.display?.name) ?? tool.name
}

function displayNameParameterFor(tool: ToolDefinition) {
  return {
    type: 'string',
    description: 'Short user-facing action name for this tool call. Use a localized, human-readable verb phrase such as "读取文件" or "Fetch URL"; do not include internal tool IDs.',
    default: preferredToolDisplayName(tool)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function withPiRuntimeDisplayParameters(schema: unknown, tool: ToolDefinition): unknown {
  const base = isRecord(schema) ? schema : { type: 'object' }
  const baseProperties = isRecord(base.properties) ? base.properties : {}
  const baseRequired = Array.isArray(base.required) ? base.required.filter((item): item is string => typeof item === 'string') : []
  const required = [...baseRequired.filter((item) => item !== 'purpose' && item !== '_displayName'), 'purpose', '_displayName']

  return {
    ...base,
    type: 'object',
    properties: {
      ...baseProperties,
      purpose: purposeParameter,
      _displayName: displayNameParameterFor(tool)
    },
    required
  }
}

function stripPiRuntimeDisplayParameters(params: unknown): unknown {
  if (!isRecord(params)) return params
  const { purpose: _purpose, _displayName: _displayName, ...rest } = params
  return rest
}

function normalizePiToolName(toolId: string): string {
  const normalized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return normalized || 'tool'
}

const toolCallCountsByRunId = new Map<string, Map<string, number>>()

function parentStepIdForToolCall(runId: string, toolCallId: string, occurrence: number): string {
  return occurrence === 1 ? `step-${runId}-tool-${toolCallId}` : `step-${runId}-tool-${toolCallId}-${occurrence}`
}

export function clearPiToolRunState(runId: string): void {
  toolCallCountsByRunId.delete(runId)
}

function nextParentStepIdForToolCall(runId: string, toolCallId: string): string {
  const toolCounts = toolCallCountsByRunId.get(runId) ?? new Map<string, number>()
  const nextCount = (toolCounts.get(toolCallId) ?? 0) + 1
  toolCounts.set(toolCallId, nextCount)
  toolCallCountsByRunId.set(runId, toolCounts)
  return parentStepIdForToolCall(runId, toolCallId, nextCount)
}

function displayNameFromParams(params: unknown): string | undefined {
  return isRecord(params) ? normalizedText(params._displayName) : undefined
}

function toPiToolResult(tool: ToolDefinition, toolCallId: string, result: Awaited<ReturnType<ToolRunner['run']>>, displayName?: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: result.content }],
    details: {
      toolId: tool.id,
      toolCallId,
      ...(tool.icon !== undefined ? { toolIcon: tool.icon } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...(tool.display !== undefined ? { display: tool.display } : {}),
      ...(result.details !== undefined ? { result: result.details } : {})
    },
    ...(result.terminate !== undefined ? { terminate: result.terminate } : {})
  }
}

export function createPiAgentTools(input: PiToolAdapterInput): AgentTool<any>[] {
  return input.tools.map((tool) => ({
    name: normalizePiToolName(tool.id),
    label: preferredToolDisplayName(tool),
    description: tool.description,
    parameters: withPiRuntimeDisplayParameters(tool.inputSchema, tool) as any,
    async execute(toolCallId, params, signal) {
      const displayName = displayNameFromParams(params) ?? preferredToolDisplayName(tool)
      const result = await input.runner.run(tool, stripPiRuntimeDisplayParameters(params), {
        ...input.context,
        toolCallId,
        parentStepId: nextParentStepIdForToolCall(input.context.runId, toolCallId),
        ...(signal !== undefined ? { signal } : {})
      })

      if (result.isError) {
        const error = new Error(result.content) as Error & { details?: unknown }
        error.details = {
          toolId: tool.id,
          toolCallId,
          ...(tool.icon !== undefined ? { toolIcon: tool.icon } : {}),
          ...(displayName !== undefined ? { displayName } : {}),
          ...(tool.display !== undefined ? { display: tool.display } : {}),
          ...(result.details !== undefined ? { result: result.details } : {})
        }
        throw error
      }

      return toPiToolResult(tool, toolCallId, result, displayName)
    }
  }))
}
