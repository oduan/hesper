import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentRuntimeEvent } from '@hesper/shared'
import type { AgentAdapter, AgentPromptInput } from './adapters'
import { mapPiEventToHesperEvents } from './map-pi-event'
import { createStaticModelResolver, type ModelResolver } from './model-resolver'

const DEFAULT_SYSTEM_PROMPT = 'You are hesper, a desktop coding assistant. Be concise, stable, and explicit about tool actions.'

export type PiCoreAgentAdapterOptions = {
  tools?: AgentTool<any>[]
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

    const resolved = await this.modelResolver.resolve({ modelId: input.modelId })

    if (input.signal.aborted) {
      throw { code: 'unknown', message: 'Run was aborted before the pi core agent started.', retryable: false }
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        model: resolved.model,
        tools: this.options.tools ?? [],
        messages: []
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
