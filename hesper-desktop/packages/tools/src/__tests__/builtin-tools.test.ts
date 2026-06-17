import { describe, expect, it } from 'vitest'
import { createBuiltinToolDefinitions } from '../builtin-tools'

describe('builtin tools', () => {
  it('contains exactly five builtin tools', () => {
    const tools = createBuiltinToolDefinitions()
    expect(tools).toHaveLength(5)
    expect(tools.map((tool) => tool.id)).not.toContain('agent.spawn-subagent')
  })

  it('uses stable ids', () => {
    const ids = createBuiltinToolDefinitions().map((tool) => tool.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'filesystem.read-file',
        'filesystem.write-file',
        'git.status',
        'web.fetch-url',
        'system.show-notification'
      ])
    )
    expect(ids).not.toContain('agent.spawn-subagent')
  })

  it('defines filesystem tools with required schema fields', () => {
    const tools = createBuiltinToolDefinitions()
    const readFile = tools.find((tool) => tool.id === 'filesystem.read-file')
    const writeFile = tools.find((tool) => tool.id === 'filesystem.write-file')

    expect(readFile).toMatchObject({
      category: 'filesystem',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' }
        }
      }
    })

    expect(writeFile).toMatchObject({
      category: 'filesystem',
      inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        }
      }
    })
  })

  it('defines non-filesystem tools with key schema fields', () => {
    const tools = createBuiltinToolDefinitions()

    expect(tools.find((tool) => tool.id === 'git.status')).toMatchObject({
      category: 'git',
      inputSchema: { type: 'object', properties: {} }
    })

    expect(tools.find((tool) => tool.id === 'web.fetch-url')).toMatchObject({
      category: 'web',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' }
        }
      }
    })

    expect(tools.find((tool) => tool.id === 'agent.spawn-subagent')).toBeUndefined()

    expect(tools.find((tool) => tool.id === 'system.show-notification')).toMatchObject({
      category: 'system',
      inputSchema: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' }
        }
      }
    })
  })
})
