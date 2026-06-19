import type { ToolDefinition } from '@hesper/shared'

function currentCommandRuntimeDescription(): string {
  if (process.platform === 'win32') {
    return 'Current platform is Windows; commands run once through Windows PowerShell from the selected workspace.'
  }
  if (process.platform === 'darwin') {
    return 'Current platform is macOS; commands run once through bash from the selected workspace.'
  }
  return `Current platform is ${process.platform}; commands run once through bash from the selected workspace.`
}

export function createBuiltinToolDefinitions(): ToolDefinition[] {
  return [
    {
      id: 'filesystem.read-file',
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      icon: '📖',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'File path relative to the selected workspace.' }
        }
      }
    },
    {
      id: 'filesystem.write-file',
      name: 'Write File',
      description: 'Write a text file in the selected workspace.',
      category: 'filesystem',
      icon: '✍️',
      inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: 'File path relative to the selected workspace.' },
          content: { type: 'string', description: 'UTF-8 text content to write.' }
        }
      }
    },
    {
      id: 'filesystem.delete-file',
      name: 'Delete File',
      description: 'Delete a file inside the selected workspace. The path must resolve to a file.',
      category: 'filesystem',
      icon: '🗑️',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'File path relative to the selected workspace.' }
        }
      }
    },
    {
      id: 'filesystem.delete-directory',
      name: 'Delete Directory',
      description: 'Delete a directory inside the selected workspace. Use recursive=true to delete non-empty directories.',
      category: 'filesystem',
      icon: '🧹',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Directory path relative to the selected workspace. The workspace root itself cannot be deleted.' },
          recursive: { type: 'boolean', description: 'When true, delete directory contents recursively. Defaults to false.' }
        }
      }
    },
    {
      id: 'filesystem.list-directory',
      name: 'List Directory',
      description: 'List direct child files and directories under a workspace-relative directory. By default returns each item name and type only.',
      category: 'filesystem',
      icon: '📂',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to the selected workspace. Defaults to workspace root.' },
          includeSize: { type: 'boolean', description: 'Include file size in bytes. Directory size is always 0.' },
          includeCreatedAt: { type: 'boolean', description: 'Include creation timestamp.' },
          includeModifiedAt: { type: 'boolean', description: 'Include last modified timestamp.' },
          includeOwner: { type: 'boolean', description: 'Include numeric owner uid/gid when available.' }
        }
      }
    },
    {
      id: 'filesystem.find',
      name: 'Find Files',
      description: 'Recursively find file or directory names under a workspace-relative directory using a regular expression.',
      category: 'filesystem',
      icon: '🔎',
      inputSchema: {
        type: 'object',
        required: ['pattern'],
        properties: {
          path: { type: 'string', description: 'Directory path relative to the selected workspace. Defaults to workspace root.' },
          pattern: { type: 'string', description: 'Regular expression matched against file and directory names.' },
          caseSensitive: { type: 'boolean', description: 'Use case-sensitive regular expression matching. Defaults to false.' },
          includeSize: { type: 'boolean', description: 'Include file size in bytes. Directory size is always 0.' },
          includeCreatedAt: { type: 'boolean', description: 'Include creation timestamp.' },
          includeModifiedAt: { type: 'boolean', description: 'Include last modified timestamp.' },
          includeOwner: { type: 'boolean', description: 'Include numeric owner uid/gid when available.' },
          maxResults: { type: 'number', description: 'Maximum number of matches to return. Defaults to 200, maximum 1000.' }
        }
      }
    },
    {
      id: 'filesystem.search',
      name: 'Search Files',
      description: 'Search files under a workspace-relative path using composable conditions. Supports name globs, content contains, content regex, and all/any/not condition groups. Content matches return the matching line plus two surrounding lines.',
      category: 'filesystem',
      icon: '🔍',
      inputSchema: {
        type: 'object',
        required: ['condition'],
        properties: {
          path: { type: 'string', description: 'Directory path relative to the selected workspace. Defaults to workspace root.' },
          condition: {
            type: 'object',
            description: 'Search condition. Examples: {"nameGlob":"*.ts"}, {"contentContains":"hello"}, {"all":[{"nameGlob":"*.ts"},{"contentRegex":"create.*Tool"}]}, {"any":[...]} or {"not":{...}}.'
          },
          caseSensitive: { type: 'boolean', description: 'Use case-sensitive name/content matching. Defaults to false.' },
          maxResults: { type: 'number', description: 'Maximum result files to return. Defaults to 50, maximum 500.' },
          maxFileBytes: { type: 'number', description: 'Maximum bytes read per file for content search. Defaults to 262144, maximum 1048576.' }
        }
      }
    },
    {
      id: 'git.status',
      name: 'Git Status',
      description: 'Read git working tree status.',
      category: 'git',
      icon: '🌿',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'git.run',
      name: 'Git Command',
      description: 'Run git in the selected workspace. Pass only the arguments after git, not the git command itself. Arguments are executed as git -C <workspace> ...args.',
      category: 'git',
      icon: '🌿',
      inputSchema: {
        type: 'object',
        required: ['args'],
        properties: {
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Git arguments after the git command, for example ["status", "--short"] or ["log", "--oneline", "-5"]. Do not include "git".'
          },
          timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds. Defaults to 10000, maximum 60000.' }
        }
      }
    },
    {
      id: 'web.fetch-url',
      name: 'Fetch URL',
      description: 'Fetch and extract text from a URL.',
      category: 'web',
      icon: '🌐',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' }
        }
      }
    },
    {
      id: 'web.search',
      name: 'Web Search',
      description: 'Search the web with the TinyFish Search API. Requires a TinyFish API key saved in Tools settings; the key is never exposed to the agent prompt.',
      category: 'web',
      icon: '🌐',
      requiresApiKey: true,
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query.' },
          location: { type: 'string', description: 'Optional region/country code for geo-targeted results, for example FR or US.' },
          language: { type: 'string', description: 'Optional language code for localized results, for example fr or en.' },
          page: { type: 'number', description: 'Optional result page. Defaults to 0.' },
          limit: { type: 'number', description: 'Maximum results to return from the response. Defaults to 10, maximum 20.' }
        }
      }
    },
    {
      id: 'system.execute-command',
      name: 'Execute Command',
      description: `Execute one complete shell command from the selected workspace. ${currentCommandRuntimeDescription()} The command is run after changing to the workspace directory.`,
      category: 'system',
      icon: '🖥️',
      inputSchema: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', description: 'Complete command string appropriate for the current platform shell.' },
          timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds. Defaults to 30000, maximum 120000.' }
        }
      }
    },
    {
      id: 'system.show-notification',
      name: 'Show Notification',
      description: 'Show a desktop notification.',
      category: 'system',
      icon: '🔔',
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
