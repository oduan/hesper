import { describe, expect, it } from 'vitest'
import { createBuiltinToolDefinitions } from '../builtin-tools'

describe('builtin tools', () => {
  it('contains filesystem, git, web, agent and system categories', () => {
    const tools = createBuiltinToolDefinitions()
    expect(new Set(tools.map((tool) => tool.category))).toEqual(
      new Set(['filesystem', 'git', 'web', 'agent', 'system'])
    )
  })

  it('uses stable ids', () => {
    const ids = createBuiltinToolDefinitions().map((tool) => tool.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'filesystem.read-file',
        'filesystem.write-file',
        'git.status',
        'web.fetch-url',
        'agent.spawn-subagent',
        'system.show-notification'
      ])
    )
  })
})
