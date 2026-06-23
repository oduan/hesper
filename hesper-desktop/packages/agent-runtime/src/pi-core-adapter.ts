import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core'
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Message as PiMessage, type Model, type ModelThinkingLevel as PiModelThinkingLevel, type Usage } from '@earendil-works/pi-ai'
import type { AgentRuntimeEvent, Message as HesperMessage } from '@hesper/shared'
import type { AgentAdapter, AgentPromptInput } from './adapters'
import { mapPiEventToHesperEvents } from './map-pi-event'
import { createStaticModelResolver, type ModelResolver, type ResolvedModel } from './model-resolver'

const DEFAULT_SYSTEM_PROMPT = 'You are hesper, a desktop coding assistant. Be concise, stable, and explicit about tool actions.'

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

function timestampFromIso(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

function toPiHistoryMessage(message: HesperMessage, model: Model<Api>): PiMessage | undefined {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content,
      timestamp: timestampFromIso(message.createdAt)
    }
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: 'stop',
      timestamp: timestampFromIso(message.createdAt)
    }
  }

  return undefined
}

function toPiHistoryMessages(messages: HesperMessage[] | undefined, model: Model<Api>): PiMessage[] {
  return (messages ?? []).flatMap((message) => {
    const converted = toPiHistoryMessage(message, model)
    return converted ? [converted] : []
  })
}

function resolveThinkingLevel(input: AgentPromptInput, resolved: ResolvedModel): PiModelThinkingLevel {
  const reasoningCapable = resolved.model.reasoning || resolved.modelConfig.capabilities.includes('reasoning')
  if (!reasoningCapable) {
    return 'off'
  }

  const reasoningModel = resolved.model.reasoning ? resolved.model : { ...resolved.model, reasoning: true }
  const requested = input.thinkingLevel ?? 'medium'
  if (requested === 'xhigh') {
    return getSupportedThinkingLevels(reasoningModel).includes('xhigh')
      ? 'xhigh'
      : clampThinkingLevel(reasoningModel, 'high')
  }

  return clampThinkingLevel(reasoningModel, requested)
}

export type PiCoreAgentAdapterOptions = {
  tools?: AgentTool<any>[]
  createTools?: (input: AgentPromptInput) => AgentTool<any>[]
  systemPrompt?: string
  modelResolver?: ModelResolver
}

export class PiCoreAgentAdapter implements AgentAdapter {
  private readonly modelResolver: ModelResolver

  constructor(private readonly options: PiCoreAgentAdapterOptions = {}) {
    this.modelResolver = options.modelResolver ?? createStaticModelResolver()
  }

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    if (input.signal.aborted) {
      throw { code: 'unknown', message: 'Run was aborted before model resolution started.', retryable: false }
    }

    const resolved = await this.modelResolver.resolve(
      input.modelRef
        ? { providerId: input.modelRef.providerId, modelId: input.modelRef.modelId }
        : { modelId: input.modelId }
    )

    if (input.signal.aborted) {
      throw { code: 'unknown', message: 'Run was aborted before the pi core agent started.', retryable: false }
    }

    const tools = this.options.createTools?.(input) ?? this.options.tools ?? []
    const historyMessages = toPiHistoryMessages(input.historyMessages, resolved.model)

    const agent = new Agent({
      initialState: {
        systemPrompt: input.systemPrompt ?? this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        model: resolved.model,
        thinkingLevel: resolveThinkingLevel(input, resolved),
        tools,
        messages: historyMessages
      },
      ...(resolved.getApiKey ? { getApiKey: resolved.getApiKey } : {}),
      toolExecution: 'parallel'
    })

    const unsubscribe = agent.subscribe(async (piEvent: AgentEvent) => {
      for (const event of mapPiEventToHesperEvents({ runId: input.runId, sessionId: input.sessionId }, piEvent)) {
        await emit(event)
      }
    })

    input.signal.addEventListener('abort', () => agent.abort(), { once: true })

    try {
      await agent.prompt(input.prompt)
      await agent.waitForIdle()
    } finally {
      unsubscribe()
    }
  }
}
