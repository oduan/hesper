import type { ToolDefinition } from '@hesper/shared'

export function createBuiltinToolDefinitions(): ToolDefinition[] {
  return [
    {
      id: 'filesystem.read-file',
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' }
        }
      }
    },
    {
      id: 'filesystem.write-file',
      name: 'Write File',
      description: 'Write a text file in the selected workspace.',
      category: 'filesystem',
      inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        }
      }
    },
    {
      id: 'git.status',
      name: 'Git Status',
      description: 'Read git working tree status.',
      category: 'git',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'web.fetch-url',
      name: 'Fetch URL',
      description: 'Fetch and extract text from a URL.',
      category: 'web',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' }
        }
      }
    },
    {
      id: 'agent.spawn-subagent',
      name: 'Spawn Subagent',
      description: 'Reserved MVP1 definition for future subagent execution.',
      category: 'agent',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' }
        }
      }
    },
    {
      id: 'system.show-notification',
      name: 'Show Notification',
      description: 'Show a desktop notification.',
      category: 'system',
      inputSchema: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' }
        }
      }
    }
  ]
}
