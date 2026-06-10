import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core'
import { getModel, type KnownProvider } from '@earendil-works/pi-ai'
import type { AgentRuntimeEvent } from '@hesper/shared'
import type { AgentAdapter, AgentPromptInput } from './adapters'
import { mapPiEventToHesperEvents } from './map-pi-event'

const DEFAULT_SYSTEM_PROMPT = 'You are hesper, a desktop coding assistant. Be concise, stable, and explicit about tool actions.'

export type PiCoreModelResolver = (provider: string, modelName: string) => ReturnType<typeof getModel>

export type PiCoreAgentAdapterOptions = {
  tools?: AgentTool<any>[]
  systemPrompt?: string
  modelResolver?: PiCoreModelResolver
}

function parseModelId(modelId: string): { provider: string; modelName: string } {
  if (modelId.includes('/')) {
    const [provider, modelName] = modelId.split('/', 2)
    return {
      provider: provider || 'openai',
      modelName: modelName || modelId
    }
  }

  return {
    provider: 'openai',
    modelName: modelId
  }
}

function defaultModelResolver(provider: string, modelName: string): ReturnType<typeof getModel> {
  return getModel(provider as KnownProvider, modelName as never)
}

export class PiCoreAgentAdapter implements AgentAdapter {
  constructor(private readonly options: PiCoreAgentAdapterOptions = {}) {}

  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    const { provider, modelName } = parseModelId(input.modelId)
    const model = (this.options.modelResolver ?? defaultModelResolver)(provider, modelName)

    const agent = new Agent({
      initialState: {
        systemPrompt: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        model,
        tools: this.options.tools ?? [],
        messages: []
      },
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
