import { describe, expect, it } from 'vitest'
import { createBuiltinToolDefinitions } from '../builtin-tools'

describe('builtin tools', () => {
  it('contains the builtin tool set including model listing and Worker Agent management tools', () => {
    const tools = createBuiltinToolDefinitions()
    expect(tools).toHaveLength(27)
    expect(tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        'models.list-available',
        'agent.spawn-worker-agent',
        'agent.list-worker-agents',
        'agent.get-worker-agent',
        'agent.wait-worker-agent',
        'agent.cancel-worker-agent'
      ])
    )
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
        'roles.list',
        'roles.find',
        'roles.create',
        'roles.update',
        'models.list-available',
        'agent.spawn-worker-agent',
        'agent.list-worker-agents',
        'agent.get-worker-agent',
        'agent.wait-worker-agent',
        'agent.cancel-worker-agent',
        'time.current',
        'time.sleep',
        'time.wait-until',
        'system.execute-command',
        'system.show-notification'
      ])
    )
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

  it('defines non-filesystem and Worker Agent tools with key schema fields', () => {
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

    expect(tools.find((tool) => tool.id === 'roles.list')).toMatchObject({
      category: 'agent',
      inputSchema: { type: 'object', properties: {} }
    })
    expect(tools.find((tool) => tool.id === 'roles.find')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: expect.objectContaining({ type: 'string' })
        }
      }
    })

    expect(tools.find((tool) => tool.id === 'roles.create')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: expect.objectContaining({ type: 'string' }),
          description: expect.objectContaining({ type: 'string' }),
          systemPrompt: expect.objectContaining({ type: 'string' }),
          defaultToolIds: expect.objectContaining({ type: 'array' }),
          defaultModelId: expect.objectContaining({
            type: 'string',
            description: 'Default model id for this role. Empty string means inherit the caller/parent model.'
          }),
          defaultModelRef: expect.objectContaining({
            type: 'object',
            description: 'Provider-aware model reference. Only used with a non-empty defaultModelId.',
            properties: {
              providerId: expect.objectContaining({ type: 'string' }),
              modelId: expect.objectContaining({ type: 'string' })
            }
          })
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
          defaultToolIds: expect.objectContaining({ type: 'array' }),
          defaultModelId: expect.objectContaining({
            type: 'string',
            description: 'Default model id for this role. Empty string means inherit the caller/parent model.'
          }),
          defaultModelRef: expect.objectContaining({
            type: 'object',
            description: 'Provider-aware model reference. Only used with a non-empty defaultModelId.',
            properties: {
              providerId: expect.objectContaining({ type: 'string' }),
              modelId: expect.objectContaining({ type: 'string' })
            }
          })
        }
      }
    })

    expect(tools.find((tool) => tool.id === 'models.list-available')).toMatchObject({
      name: 'List Available Models',
      category: 'agent',
      icon: '🤖',
      inputSchema: { type: 'object', properties: {} }
    })

    expect(tools.find((tool) => tool.id === 'agent.spawn-worker-agent')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['task', 'roleId', 'allowedToolIds'],
        properties: {
          task: expect.objectContaining({ type: 'string' }),
          roleId: expect.objectContaining({ type: 'string' }),
          allowedToolIds: expect.objectContaining({ type: 'array' }),
          expectedOutput: expect.objectContaining({ type: 'string' }),
          contextSummary: expect.objectContaining({ type: 'string' }),
          wait: expect.objectContaining({ type: 'boolean' }),
          timeoutMs: expect.objectContaining({ type: 'number' }),
          cancelOnTimeout: expect.objectContaining({ type: 'boolean' })
        }
      }
    })
    expect(tools.find((tool) => tool.id === 'agent.list-worker-agents')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        properties: {
          parentRunId: expect.objectContaining({ type: 'string' }),
          status: expect.objectContaining({ type: 'string' })
        }
      }
    })
    expect(tools.find((tool) => tool.id === 'agent.get-worker-agent')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: expect.objectContaining({ type: 'string' })
        }
      }
    })
    expect(tools.find((tool) => tool.id === 'agent.wait-worker-agent')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: expect.objectContaining({ type: 'string' }),
          timeoutMs: expect.objectContaining({ type: 'number' }),
          cancelOnTimeout: expect.objectContaining({ type: 'boolean' })
        }
      }
    })
    expect(tools.find((tool) => tool.id === 'agent.cancel-worker-agent')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: expect.objectContaining({ type: 'string' }),
          reason: expect.objectContaining({ type: 'string' })
        }
      }
    })

    expect(tools.find((tool) => tool.id === 'time.current')).toMatchObject({
      category: 'system',
      inputSchema: { type: 'object', properties: {} }
    })
    expect(tools.find((tool) => tool.id === 'time.sleep')).toMatchObject({
      category: 'system',
      inputSchema: {
        type: 'object',
        required: ['seconds'],
        properties: {
          seconds: expect.objectContaining({ type: 'number' })
        }
      }
    })
    expect(tools.find((tool) => tool.id === 'time.wait-until')).toMatchObject({
      category: 'system',
      inputSchema: {
        type: 'object',
        required: ['wakeAt'],
        properties: {
          wakeAt: expect.objectContaining({ type: 'string' })
        }
      }
    })

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
