import { describe, expect, it } from 'vitest'
import { createBuiltinToolDefinitions } from '../builtin-tools'

describe('builtin tools', () => {
  it('contains the builtin tool set including SOUL, model listing, Worker Agent management, and SSH tools', () => {
    const tools = createBuiltinToolDefinitions()
    expect(tools).toHaveLength(35)
    expect(tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        'skills.list',
        'skills.get',
        'models.list-available',
        'soul.get',
        'soul.update',
        'agent.spawn-worker-agent',
        'agent.list-worker-agents',
        'agent.get-worker-agent',
        'agent.wait-worker-agent',
        'agent.cancel-worker-agent',
        'ssh.list-servers',
        'ssh.run-commands',
        'ssh.list-executions',
        'ssh.get-execution-output'
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
        'skills.list',
        'skills.get',
        'models.list-available',
        'soul.get',
        'soul.update',
        'agent.spawn-worker-agent',
        'agent.list-worker-agents',
        'agent.get-worker-agent',
        'agent.wait-worker-agent',
        'agent.cancel-worker-agent',
        'ssh.list-servers',
        'ssh.run-commands',
        'ssh.list-executions',
        'ssh.get-execution-output',
        'time.current',
        'time.sleep',
        'time.wait-until',
        'system.execute-command',
        'system.show-notification'
      ])
    )
  })

  it('adds display metadata for step titles and resources', () => {
    const tools = createBuiltinToolDefinitions()
    expect(tools.every((tool) => tool.display?.name === tool.name)).toBe(true)
    expect(tools.find((tool) => tool.id === 'filesystem.read-file')).toMatchObject({
      display: {
        name: 'Read File',
        names: { 'zh-CN': '读取文件' },
        resourceFields: ['path']
      }
    })
    expect(tools.find((tool) => tool.id === 'web.fetch-url')).toMatchObject({
      display: {
        names: { 'zh-CN': '抓取网页' },
        resourceFields: ['url']
      }
    })
    expect(tools.find((tool) => tool.id === 'soul.get')).toMatchObject({
      display: {
        name: 'Get SOUL',
        names: { 'zh-CN': '查看 SOUL' }
      }
    })
    expect(tools.find((tool) => tool.id === 'soul.update')).toMatchObject({
      display: {
        name: 'Update SOUL',
        names: { 'zh-CN': '更新 SOUL' },
        resourceFields: ['soul']
      }
    })
    expect(tools.find((tool) => tool.id === 'agent.spawn-worker-agent')).toMatchObject({
      display: {
        names: { 'zh-CN': '启动 Worker Agent' },
        resourceFields: ['task']
      }
    })
  })

  it('defines Worker Agent model override schema and guidance', () => {
    const spawnWorkerAgent = createBuiltinToolDefinitions().find((tool) => tool.id === 'agent.spawn-worker-agent')

    expect(spawnWorkerAgent?.description).toContain('models.list-available')
    expect(spawnWorkerAgent?.description).toContain('modelRef')
    expect(spawnWorkerAgent?.description).toContain('modelId')
    expect(spawnWorkerAgent?.description).toContain('modelRef takes precedence')
    expect(spawnWorkerAgent).toMatchObject({
      inputSchema: {
        type: 'object',
        properties: {
          modelRef: {
            type: 'object',
            properties: {
              providerId: expect.objectContaining({ type: 'string' }),
              modelId: expect.objectContaining({ type: 'string' })
            }
          },
          modelId: expect.objectContaining({ type: 'string' })
        }
      }
    })
  })

  it('defines temporary Worker Agent role schema and one-off guidance', () => {
    const spawnWorkerAgent = createBuiltinToolDefinitions().find((tool) => tool.id === 'agent.spawn-worker-agent')
    const schema = spawnWorkerAgent?.inputSchema as any

    expect(schema.required).toEqual(['task', 'allowedToolIds'])
    expect(schema.required).not.toContain('roleId')
    expect(schema.oneOf).toEqual([
      { required: ['roleId'], not: { required: ['temporaryRole'] } },
      { required: ['temporaryRole'], not: { required: ['roleId'] } }
    ])
    expect(schema.properties.temporaryRole).toMatchObject({
      type: 'object',
      required: ['name', 'systemPrompt'],
      properties: {
        name: expect.objectContaining({ type: 'string' }),
        description: expect.objectContaining({ type: 'string' }),
        systemPrompt: expect.objectContaining({ type: 'string' }),
        defaultToolIds: expect.objectContaining({ type: 'array' }),
        defaultModelId: expect.objectContaining({ type: 'string' }),
        defaultModelRef: expect.objectContaining({
          type: 'object',
          required: ['providerId', 'modelId'],
          properties: {
            providerId: expect.objectContaining({ type: 'string' }),
            modelId: expect.objectContaining({ type: 'string' })
          }
        })
      }
    })
    expect(schema.properties.temporaryRole.properties.defaultModelRef.description).toContain('Takes precedence over defaultModelId')
    expect(spawnWorkerAgent?.description).toContain('temporaryRole')
    expect(spawnWorkerAgent?.description).toContain('any existing roleId')
    expect(spawnWorkerAgent?.description).toContain('roles.find or roles.list')
    expect(spawnWorkerAgent?.description).toContain('roleSnapshot')
    expect(spawnWorkerAgent?.description).toContain('role library')
    expect(spawnWorkerAgent?.description).not.toMatch(/not persisted/i)
    expect(spawnWorkerAgent?.description).toContain('roles.create')
  })

  it('describes provider-aware model discovery, Worker spawning, and reusable role creation consistently', () => {
    const tools = createBuiltinToolDefinitions()
    const modelList = tools.find((tool) => tool.id === 'models.list-available')
    const spawnWorkerAgent = tools.find((tool) => tool.id === 'agent.spawn-worker-agent')
    const createRole = tools.find((tool) => tool.id === 'roles.create')

    expect(modelList?.description).toContain('provider-aware modelRef')
    expect(modelList?.description).toContain('never returns API keys')
    expect(spawnWorkerAgent?.description).toContain('modelRef takes precedence')
    expect(spawnWorkerAgent?.description).toContain('temporaryRole is not saved')
    expect(spawnWorkerAgent?.description).toContain('roleSnapshot')
    expect(createRole?.description).toContain('reusable role')
    expect(createRole?.description).toContain('Do not use for one-off Worker Agent tasks')
    expect(createRole?.description).toContain('temporaryRole')
    expect(createRole?.description).toContain('user explicitly approves')
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
      description: expect.stringContaining('built-in and user-defined roles'),
      inputSchema: { type: 'object', properties: {} }
    })
    expect(tools.find((tool) => tool.id === 'roles.find')).toMatchObject({
      category: 'agent',
      description: expect.stringContaining('default model metadata'),
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
            description: 'Legacy default model id for this role. Empty string means inherit the caller/parent model; prefer defaultModelRef for provider-aware selection.'
          }),
          defaultModelRef: expect.objectContaining({
            type: 'object',
            required: ['providerId', 'modelId'],
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
            description: 'Legacy default model id for this role. Empty string means inherit the caller/parent model; prefer defaultModelRef for provider-aware selection.'
          }),
          defaultModelRef: expect.objectContaining({
            type: 'object',
            required: ['providerId', 'modelId'],
            properties: {
              providerId: expect.objectContaining({ type: 'string' }),
              modelId: expect.objectContaining({ type: 'string' })
            }
          })
        }
      }
    })

    for (const toolId of ['roles.create', 'roles.update']) {
      const defaultModelRef = (tools.find((tool) => tool.id === toolId)?.inputSchema as any).properties.defaultModelRef
      expect(defaultModelRef.description).toMatch(/provider-aware/i)
      expect(defaultModelRef.description).toContain('defaultModelId')
      expect(defaultModelRef.description).toMatch(/must match/i)
      expect(defaultModelRef.description).toContain("defaultModelId: ''")
      expect(defaultModelRef.description).not.toContain('does not require defaultModelId')
      expect(defaultModelRef.required).toEqual(['providerId', 'modelId'])
    }

    expect(tools.find((tool) => tool.id === 'skills.list')).toMatchObject({
      name: 'List Skills',
      category: 'agent',
      icon: '🧩',
      description: expect.stringContaining('Skill id is the unique skill name'),
      inputSchema: { type: 'object', properties: {} }
    })
    expect(tools.find((tool) => tool.id === 'skills.get')).toMatchObject({
      name: 'Get Skill',
      category: 'agent',
      icon: '🧩',
      display: {
        names: { 'zh-CN': '查看技能' },
        resourceFields: ['id']
      },
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: expect.objectContaining({ type: 'string', description: expect.stringContaining('Skill name/id') })
        }
      }
    })

    expect(tools.find((tool) => tool.id === 'models.list-available')).toMatchObject({
      name: 'List Available Models',
      category: 'agent',
      icon: '🤖',
      inputSchema: { type: 'object', properties: {} }
    })

    expect(tools.find((tool) => tool.id === 'soul.get')).toMatchObject({
      name: 'Get SOUL',
      category: 'agent',
      icon: '🪶',
      inputSchema: { type: 'object', properties: {} }
    })
    expect(tools.find((tool) => tool.id === 'soul.update')).toMatchObject({
      name: 'Update SOUL',
      category: 'agent',
      icon: '🪶',
      inputSchema: {
        type: 'object',
        required: ['soul'],
        properties: {
          soul: expect.objectContaining({ type: 'string' })
        }
      }
    })

    expect(tools.find((tool) => tool.id === 'agent.spawn-worker-agent')).toMatchObject({
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['task', 'allowedToolIds'],
        properties: {
          task: expect.objectContaining({ type: 'string' }),
          roleId: expect.objectContaining({ type: 'string' }),
          temporaryRole: expect.objectContaining({ type: 'object' }),
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

    const runCommands = tools.find((tool) => tool.id === 'ssh.run-commands')!
    expect(runCommands).toMatchObject({ name: 'Run SSH Commands', category: 'system', icon: '🔐' })
    expect(runCommands.inputSchema).toMatchObject({
      type: 'object',
      required: ['serverId', 'commands'],
      properties: expect.objectContaining({
        serverId: expect.objectContaining({ type: 'string' }),
        commands: expect.objectContaining({ type: 'array' }),
        stopOnError: expect.objectContaining({ type: 'boolean' }),
        timeoutMs: expect.objectContaining({
          type: 'number',
          description: expect.stringContaining('Whole execution timeout')
        }),
        wait: expect.objectContaining({ type: 'boolean' })
      })
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
