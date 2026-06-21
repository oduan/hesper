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
      id: 'filesystem.edit-file',
      name: 'Edit File',
      description: 'Edit specific 1-based inclusive line ranges in an existing text file from the selected workspace. Multiple edits are applied against the original line numbers.',
      category: 'filesystem',
      icon: '📝',
      inputSchema: {
        type: 'object',
        required: ['path', 'edits'],
        properties: {
          path: { type: 'string', description: 'File path relative to the selected workspace.' },
          edits: {
            type: 'array',
            description: 'Line range edits using original 1-based inclusive line numbers. Empty content deletes the range.',
            items: {
              type: 'object',
              required: ['startLine', 'content'],
              properties: {
                startLine: { type: 'number', description: '1-based inclusive start line.' },
                endLine: { type: 'number', description: '1-based inclusive end line. Defaults to startLine.' },
                content: { type: 'string', description: 'Replacement text for the range. Empty string deletes the range.' }
              }
            }
          }
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
      description: 'Fetch and extract clean page content with the TinyFish Fetch API. Requires a TinyFish API key saved in Tools settings; the key is never exposed to the agent prompt.',
      category: 'web',
      icon: '🌐',
      requiresApiKey: true,
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'HTTP or HTTPS URL to fetch and extract.' },
          format: { type: 'string', description: 'Output format for extracted content: markdown, html, or json. Defaults to markdown.' },
          links: { type: 'boolean', description: 'When true, include extracted page links in the result metadata. Defaults to false.' },
          imageLinks: { type: 'boolean', description: 'When true, include extracted image links in the result metadata. Defaults to false.' },
          ttl: { type: 'number', description: 'Cache freshness tolerance in seconds. Set 0 for a live fetch. Omit to accept any cached entry.' },
          perUrlTimeoutMs: { type: 'number', description: 'TinyFish per-URL timeout in milliseconds. Defaults to 45000, maximum 110000.' }
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
      id: 'roles.list',
      name: 'List Roles',
      description: 'List all user-defined roles with their id, name, description, full prompt, and default tools.',
      category: 'agent',
      icon: '🎭',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'roles.find',
      name: 'Find Roles',
      description: 'Fuzzy search user-defined roles by id, name, description, prompt text, or default tool IDs.',
      category: 'agent',
      icon: '🎭',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Case-insensitive fuzzy search text.' },
          limit: { type: 'number', description: 'Maximum matching roles to return. Defaults to 20, maximum 100.' }
        }
      }
    },
    {
      id: 'roles.create',
      name: 'Create Role',
      description: 'Create a user-defined role with a name, description, full prompt, and default tools.',
      category: 'agent',
      icon: '🎭',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Role name.' },
          description: { type: 'string', description: 'Short role description shown in the roles list.' },
          systemPrompt: { type: 'string', description: 'Full prompt for this role.' },
          defaultToolIds: { type: 'array', items: { type: 'string' }, description: 'Default tool IDs for this role.' },
          defaultModelId: { type: 'string', description: 'Default model id for this role. Empty string means inherit the caller/parent model.' },
          defaultModelRef: {
            type: 'object',
            description: 'Provider-aware model reference. Only used with a non-empty defaultModelId.',
            properties: {
              providerId: { type: 'string' },
              modelId: { type: 'string' }
            }
          }
        }
      }
    },
    {
      id: 'roles.update',
      name: 'Update Role',
      description: 'Update an existing user-defined role. This tool cannot delete roles.',
      category: 'agent',
      icon: '🎭',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Role ID to update.' },
          name: { type: 'string', description: 'New role name.' },
          description: { type: 'string', description: 'New short role description.' },
          systemPrompt: { type: 'string', description: 'New full prompt.' },
          defaultToolIds: { type: 'array', items: { type: 'string' }, description: 'Replacement default tool IDs for this role.' },
          defaultModelId: { type: 'string', description: 'Default model id for this role. Empty string means inherit the caller/parent model.' },
          defaultModelRef: {
            type: 'object',
            description: 'Provider-aware model reference. Only used with a non-empty defaultModelId.',
            properties: {
              providerId: { type: 'string' },
              modelId: { type: 'string' }
            }
          }
        }
      }
    },
    {
      id: 'models.list-available',
      name: 'List Available Models',
      description: 'List currently available model providers and models so the main Agent can choose a model for itself or Worker Agents. Returns metadata only and never returns API keys.',
      category: 'agent',
      icon: '🤖',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'agent.spawn-worker-agent',
      name: 'Spawn Worker Agent',
      description: 'Create a constrained Worker Agent child run with a role, task, and limited tool set. By default waits only for a bounded timeout and returns a diagnosis if still running.',
      category: 'agent',
      icon: '🧑‍💻',
      inputSchema: {
        type: 'object',
        required: ['task', 'roleId', 'allowedToolIds'],
        properties: {
          task: { type: 'string', description: 'Specific task for the Worker Agent.' },
          roleId: { type: 'string', description: 'Assignable Worker Agent role id.' },
          allowedToolIds: { type: 'array', items: { type: 'string' }, description: 'Requested tool ids. Effective tools are intersected with parent, role, and global limits.' },
          expectedOutput: { type: 'string', description: 'Expected result format.' },
          contextSummary: { type: 'string', description: 'Relevant context from the parent run.' },
          wait: { type: 'boolean', description: 'When true, wait for a bounded timeout. Defaults to true.' },
          timeoutMs: { type: 'number', description: 'Maximum wait duration in milliseconds. Defaults to 60000 and is capped at 300000.' },
          cancelOnTimeout: { type: 'boolean', description: 'Cancel the Worker Agent if the bounded wait times out. Defaults to false.' }
        }
      }
    },
    {
      id: 'agent.list-worker-agents',
      name: 'List Worker Agents',
      description: 'List Worker Agent invocations for the current parent run or another run in the same session.',
      category: 'agent',
      icon: '📋',
      inputSchema: {
        type: 'object',
        properties: {
          parentRunId: { type: 'string', description: 'Parent run id. Defaults to the current run.' },
          status: { type: 'string', description: 'Optional status filter: queued, running, succeeded, failed, or cancelled.' }
        }
      }
    },
    {
      id: 'agent.get-worker-agent',
      name: 'Get Worker Agent',
      description: 'Get a Worker Agent invocation status, diagnosis, and result if available.',
      category: 'agent',
      icon: '🔎',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: { type: 'string', description: 'Worker Agent invocation id.' }
        }
      }
    },
    {
      id: 'agent.wait-worker-agent',
      name: 'Wait Worker Agent',
      description: 'Wait for a Worker Agent to finish for a bounded timeout and return a diagnosis if it is still running.',
      category: 'agent',
      icon: '⏱️',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: { type: 'string', description: 'Worker Agent invocation id.' },
          timeoutMs: { type: 'number', description: 'Maximum wait duration in milliseconds. Defaults to 60000 and is capped at 300000.' },
          cancelOnTimeout: { type: 'boolean', description: 'Cancel if timeout elapses. Defaults to false.' }
        }
      }
    },
    {
      id: 'agent.cancel-worker-agent',
      name: 'Cancel Worker Agent',
      description: 'Cancel a running Worker Agent in the same session.',
      category: 'agent',
      icon: '🛑',
      inputSchema: {
        type: 'object',
        required: ['invocationId'],
        properties: {
          invocationId: { type: 'string', description: 'Worker Agent invocation id.' },
          reason: { type: 'string', description: 'Optional cancellation reason.' }
        }
      }
    },
    {
      id: 'time.current',
      name: 'Current Time',
      description: 'Get the current date, time, timezone, and UTC offset for this desktop runtime.',
      category: 'system',
      icon: '🕒',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'time.sleep',
      name: 'Sleep',
      description: 'Pause the Agent for a specified number of seconds before continuing. Use this to wait briefly before checking again.',
      category: 'system',
      icon: '💤',
      inputSchema: {
        type: 'object',
        required: ['seconds'],
        properties: {
          seconds: { type: 'number', description: 'Number of seconds to sleep. Decimals are allowed; must be >= 0.' }
        }
      }
    },
    {
      id: 'time.wait-until',
      name: 'Wait Until Time',
      description: 'Pause the Agent until a specific wake-up time, then return success. Provide an ISO 8601 timestamp with timezone, for example 2026-06-20T21:30:00+08:00.',
      category: 'system',
      icon: '⏰',
      inputSchema: {
        type: 'object',
        required: ['wakeAt'],
        properties: {
          wakeAt: { type: 'string', description: 'Wake-up timestamp. Prefer ISO 8601 with timezone, e.g. 2026-06-20T21:30:00+08:00.' }
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
