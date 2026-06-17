import type { AgentMode } from './service-container'

type AgentModeEnv = {
  HESPER_AGENT_MODE?: string
}

export function resolveAgentMode(env: AgentModeEnv = process.env): AgentMode {
  return env.HESPER_AGENT_MODE === 'mock' ? 'mock' : 'pi-core'
}
