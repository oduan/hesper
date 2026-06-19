import { describe, expect, it } from 'vitest'
import { createBuiltinToolDefinitions } from '../builtin-tools'

describe('builtin tools', () => {
  it('contains the builtin tool set without exposing legacy worker execution', () => {
    const tools = createBuiltinToolDefinitions()
    expect(tools).toHaveLength(16)
    expect(tools.map((tool) => tool.id)).not.toContain('agent.spawn-worker-agent')
    expect(tools.every((tool) => typeof tool.icon === 'string' && tool.icon.length > 0)).toBe(true)
  })

  it('uses stable ids', () => {
    const ids = createBuiltinToolDefinitions().map((tool) => tool.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'filesystem.read-file',
        'filesystem.write-file',
        'filesystem.edit-file',
        'filesystem.delete-file',
        'filesystem.delete-directory',
        'filesystem.list-directory',
        'filesystem.find',
        'filesystem.search',
        'git.status',
        'git.run',
        'web.fetch-url',
        'web.search',
        'roles.create',
        'roles.update',
        'system.execute-command',
        'system.show-notification'
      ])
    )
    expect(ids).not.toContain('agent.spawn-worker-agent')
  })

  it('defines filesystem tools with required schema fields', () => {
    const tools = createBuiltinToolDefinitions()
    const readFile = tools.find((tool) => tool.id === 'filesystem.read-file')
    const writeFile = tools.find((tool) => tool.id === 'filesystem.write-file')
    const editFile = tools.find((tool) => tool.id === 'filesystem.edit-file')
    const listDirectory = tools.find((tool) => tool.id === 'filesystem.list-directory')
    const find = tools.find((tool) => tool.id === 'filesystem.find')
    const search = tools.find((tool) => tool.id === 'filesystem.search')

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

    expect(editFile).toMatchObject({
      category: 'filesystem',
      inputSchema: {
        type: 'object',
        required: ['path', 'edits'],
        properties: {
          path: { type: 'string' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              required: ['startLine', 'content'],
              properties: {
                startLine: { type: 'number' },
                endLine: { type: 'number' },
                content: { type: 'string' }
              }
            }
          }
        }
      }
    })

    expect(listDirectory).toMatchObject({ category: 'filesystem', inputSchema: { type: 'object' } })
    expect(find).toMatchObject({ category: 'filesystem', inputSchema: { type: 'object', required: ['pattern'] } })
    expect(search).toMatchObject({ category: 'filesystem', inputSchema: { type: 'object', required: ['condition'] } })
  })

  it('defines non-filesystem tools with key schema fields', () => {
    const tools = createBuiltinToolDefinitions()

    expect(tools.find((tool) => tool.id === 'git.status')).toMatchObject({
      category: 'git',
      inputSchema: { type: 'object', properties: {} }
    })

    expect(tools.find((tool) => tool.id === 'git.run')).toMatchObject({
      category: 'git',
      inputSchema: { type: 'object', required: ['args'] }
    })

    expect(tools.find((tool) => tool.id === 'web.fetch-url')).toMatchObject({
      category: 'web',
      requiresApiKey: true,
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: expect.objectContaining({ type: 'string' }),
          format: expect.objectContaining({ type: 'string' }),
          links: expect.objectContaining({ type: 'boolean' }),
          imageLinks: expect.objectContaining({ type: 'boolean' }),
          ttl: expect.objectContaining({ type: 'number' }),
          perUrlTimeoutMs: expect.objectContaining({ type: 'number' })
        }
      }
    })

    expect(tools.find((tool) => tool.id === 'web.search')).toMatchObject({
      category: 'web',
      requiresApiKey: true,
      inputSchema: { type: 'object', required: ['query'] }
    })

    expect(tools.find((tool) => tool.id === 'agent.spawn-worker-agent')).toBeUndefined()

    expect(tools.find((tool) => tool.id === 'roles.create')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: expect.objectContaining({ type: 'string' }),
          description: expect.objectContaining({ type: 'string' }),
          systemPrompt: expect.objectContaining({ type: 'string' }),
          defaultToolIds: expect.objectContaining({ type: 'array' })
        }
      }
    })
    expect(tools.find((tool) => tool.id === 'roles.update')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: expect.objectContaining({ type: 'string' }),
          name: expect.objectContaining({ type: 'string' }),
          description: expect.objectContaining({ type: 'string' }),
          systemPrompt: expect.objectContaining({ type: 'string' }),
          defaultToolIds: expect.objectContaining({ type: 'array' })
        }
      }
    })
    expect(tools.find((tool) => tool.id === 'roles.delete')).toBeUndefined()

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
