import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core'
import { getModel, type KnownProvider } from '@earendil-works/pi-ai'
import type { AgentRuntimeEvent } from '@hesper/shared'
import type { AgentAdapter, AgentPromptInput } from './adapters'
import { mapPiEventToHesperEvents } from './map-pi-event'

const DEFAULT_SYSTEM_PROMPT = 'You are hesper, a desktop coding assistant. Be concise, stable, and explicit about tool actions.'

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

export class PiCoreAgentAdapter implements AgentAdapter {
  async run(input: AgentPromptInput, emit: (event: AgentRuntimeEvent) => void | Promise<void>): Promise<void> {
    const { provider, modelName } = parseModelId(input.modelId)
    const model = getModel(provider as KnownProvider, modelName as never)

    const agent = new Agent({
      initialState: {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        model,
        tools: [],
        messages: []
      },
      toolExecution: 'parallel'
    })

    const unsubscribe = agent.subscribe(async (piEvent: AgentEvent) => {
      for (const event of mapPiEventToHesperEvents(input.runId, piEvent)) {
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
