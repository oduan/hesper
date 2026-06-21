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

const roleDefaultModelIdDescription = 'Legacy default model id for this role. Empty string means inherit the caller/parent model; prefer defaultModelRef for provider-aware selection.'
const roleDefaultModelRefDescription = "Provider-aware default model metadata/reference from models.list-available. Saved or updated only when a non-empty defaultModelId is also provided; defaultModelRef.modelId must match defaultModelId. Use defaultModelId: '' to inherit/clear the default model, which also clears this ref."

export function createBuiltinToolDefinitions(): ToolDefinition[] {
  return [
    {
      id: 'filesystem.read-file',
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      icon: '📖',
      display: { name: 'Read File', names: { 'zh-CN': '读取文件' }, resourceFields: ['path'] },
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
      display: { name: 'Write File', names: { 'zh-CN': '写入文件' }, resourceFields: ['path'] },
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
      display: { name: 'Edit File', names: { 'zh-CN': '编辑文件' }, resourceFields: ['path'] },
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
      display: { name: 'Delete File', names: { 'zh-CN': '删除文件' }, resourceFields: ['path'] },
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
      display: { name: 'Delete Directory', names: { 'zh-CN': '删除目录' }, resourceFields: ['path'] },
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
      display: { name: 'List Directory', names: { 'zh-CN': '列出目录' }, resourceFields: ['path'] },
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
      display: { name: 'Find Files', names: { 'zh-CN': '查找文件' }, resourceFields: ['pattern'] },
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
      display: { name: 'Search Files', names: { 'zh-CN': '搜索文件' }, resourceFields: ['condition'] },
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
      display: { name: 'Git Status', names: { 'zh-CN': '查看 Git 状态' } },
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'git.run',
      name: 'Git Command',
      description: 'Run git in the selected workspace. Pass only the arguments after git, not the git command itself. Arguments are executed as git -C <workspace> ...args.',
      category: 'git',
      icon: '🌿',
      display: { name: 'Git Command', names: { 'zh-CN': '运行 Git 命令' }, resourceFields: ['args'] },
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
      display: { name: 'Fetch URL', names: { 'zh-CN': '抓取网页' }, resourceFields: ['url'] },
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
      display: { name: 'Web Search', names: { 'zh-CN': '搜索网页' }, resourceFields: ['query'] },
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
      description: 'List all available roles, including built-in and user-defined roles, with their id, name, description, full prompt, default tools, and default model metadata. Any listed role id can be used as a Worker Agent roleId unless the current session explicitly restricts role choices.',
      category: 'agent',
      icon: '🎭',
      display: { name: 'List Roles', names: { 'zh-CN': '列出角色' } },
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'roles.find',
      name: 'Find Roles',
      description: 'Fuzzy search available built-in and user-defined roles by id, name, description, prompt text, default tool IDs, or default model metadata. Use this before spawning when an existing reusable Worker Agent role might fit.',
      category: 'agent',
      icon: '🎭',
      display: { name: 'Find Roles', names: { 'zh-CN': '查找角色' }, resourceFields: ['query'] },
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
      description: 'Create a reusable role with a name, description, full prompt, default tools, and optional default model. Do not use for one-off Worker Agent tasks; pass temporaryRole to agent.spawn-worker-agent instead. Only create roles when the user explicitly approves adding a reusable role to the role library.',
      category: 'agent',
      icon: '🎭',
      display: { name: 'Create Role', names: { 'zh-CN': '创建角色' }, resourceFields: ['name'] },
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Role name.' },
          description: { type: 'string', description: 'Short role description shown in the roles list.' },
          systemPrompt: { type: 'string', description: 'Full prompt for this role.' },
          defaultToolIds: { type: 'array', items: { type: 'string' }, description: 'Default tool IDs for this role.' },
          defaultModelId: { type: 'string', description: roleDefaultModelIdDescription },
          defaultModelRef: {
            type: 'object',
            description: roleDefaultModelRefDescription,
            required: ['providerId', 'modelId'],
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
      description: 'Update an existing reusable user-defined role. This tool cannot delete roles. Only update the role library when the user explicitly approves changing a reusable role.',
      category: 'agent',
      icon: '🎭',
      display: { name: 'Update Role', names: { 'zh-CN': '更新角色' }, resourceFields: ['id'] },
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Role ID to update.' },
          name: { type: 'string', description: 'New role name.' },
          description: { type: 'string', description: 'New short role description.' },
          systemPrompt: { type: 'string', description: 'New full prompt.' },
          defaultToolIds: { type: 'array', items: { type: 'string' }, description: 'Replacement default tool IDs for this role.' },
          defaultModelId: { type: 'string', description: roleDefaultModelIdDescription },
          defaultModelRef: {
            type: 'object',
            description: roleDefaultModelRefDescription,
            required: ['providerId', 'modelId'],
            properties: {
              providerId: { type: 'string' },
              modelId: { type: 'string' }
            }
          }
        }
      }
    },
    {
      id: 'skills.list',
      name: 'List Skills',
      description: 'List all available skills with metadata including id, name, description, source, path, sourcePath, prompt, allowed tool IDs, and enabled status. Returns metadata only and never returns credentials.',
      category: 'agent',
      icon: '🧩',
      display: { name: 'List Skills', names: { 'zh-CN': '列出技能' } },
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'skills.get',
      name: 'Get Skill',
      description: 'Get detailed information for one available skill by id, including prompt text and source metadata. Returns a controlled not_found result when the skill id does not exist.',
      category: 'agent',
      icon: '🧩',
      display: { name: 'Get Skill', names: { 'zh-CN': '查看技能' }, resourceFields: ['id'] },
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Skill id to inspect, for example builtin:install-skills or user:review.' }
        }
      }
    },
    {
      id: 'models.list-available',
      name: 'List Available Models',
      description: 'List currently available model providers and models, including provider-aware modelRef values, so the main Agent can choose a model for itself or Worker Agents. Returns metadata only and never returns API keys.',
      category: 'agent',
      icon: '🤖',
      display: { name: 'List Available Models', names: { 'zh-CN': '列出可用模型' } },
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'agent.spawn-worker-agent',
      name: 'Spawn Worker Agent',
      description: 'Create a constrained Worker Agent child run with either any existing roleId or a one-off temporaryRole, task, limited tool set, and optional model override. Use roles.find or roles.list first when you need to inspect existing reusable roles. Use temporaryRole when no suitable existing role fits a single run; temporaryRole is not saved as a reusable role and is not written to the role library; the invocation persists a roleSnapshot for tracing. Do not call roles.create for one-off Worker Agent tasks; only create roles when the user explicitly approves adding a reusable role. Use models.list-available first to choose a provider-aware modelRef when possible; modelRef takes precedence over modelId, temporaryRole/default role defaults, and the parent run model. If no explicit model is provided, temporaryRole.defaultModelRef/default role defaultModelRef is used before temporaryRole.defaultModelId/default role defaultModelId, then the parent run model. By default waits only for a bounded timeout and returns a diagnosis if still running.',
      category: 'agent',
      icon: '🧑‍💻',
      display: { name: 'Spawn Worker Agent', names: { 'zh-CN': '启动 Worker Agent' }, resourceFields: ['task'] },
      inputSchema: {
        type: 'object',
        required: ['task', 'allowedToolIds'],
        oneOf: [
          { required: ['roleId'], not: { required: ['temporaryRole'] } },
          { required: ['temporaryRole'], not: { required: ['roleId'] } }
        ],
        properties: {
          task: { type: 'string', description: 'Specific task for the Worker Agent.' },
          roleId: { type: 'string', description: 'Existing role id to use as the Worker Agent role. Provide exactly one of roleId or temporaryRole.' },
          temporaryRole: {
            type: 'object',
            description: 'One-off Worker Agent role used only for this spawn. It is not saved to the role library; use this instead of roles.create for single-use tasks.',
            required: ['name', 'systemPrompt'],
            properties: {
              name: { type: 'string', description: 'Temporary role display name for this run.' },
              description: { type: 'string', description: 'Optional temporary role description for tracing.' },
              systemPrompt: { type: 'string', description: 'Full system prompt/instructions for this temporary Worker Agent role.' },
              defaultToolIds: { type: 'array', items: { type: 'string' }, description: 'Optional default tools for the temporary role. If omitted, requested allowedToolIds are used as the role tool side of the intersection.' },
              defaultModelId: { type: 'string', description: 'Optional legacy default model id for this temporary role. Empty string means inherit the parent model; prefer defaultModelRef for provider-aware selection.' },
              defaultModelRef: {
                type: 'object',
                description: 'Optional provider-aware default model reference for this temporary role. Takes precedence over defaultModelId unless spawn provides an explicit modelRef/modelId.',
                required: ['providerId', 'modelId'],
                properties: {
                  providerId: { type: 'string', description: 'Model provider id returned by models.list-available.' },
                  modelId: { type: 'string', description: 'Model id returned by models.list-available.' }
                }
              }
            }
          },
          allowedToolIds: { type: 'array', items: { type: 'string' }, description: 'Requested tool ids. Effective tools are intersected with parent, requested, role/temporaryRole defaults, and global limits.' },
          modelRef: {
            type: 'object',
            description: 'Provider-aware model reference from models.list-available. Takes precedence over modelId, role defaults, and the parent run model.',
            required: ['providerId', 'modelId'],
            properties: {
              providerId: { type: 'string', description: 'Model provider id returned by models.list-available.' },
              modelId: { type: 'string', description: 'Model id returned by models.list-available.' }
            }
          },
          modelId: { type: 'string', description: 'Legacy model id override. Used only when modelRef is not provided; otherwise role defaults or the parent run model are used.' },
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
      display: { name: 'List Worker Agents', names: { 'zh-CN': '列出 Worker Agent' }, resourceFields: ['parentRunId'] },
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
      display: { name: 'Get Worker Agent', names: { 'zh-CN': '查看 Worker Agent' }, resourceFields: ['invocationId'] },
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
      display: { name: 'Wait Worker Agent', names: { 'zh-CN': '等待 Worker Agent' }, resourceFields: ['invocationId'] },
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
      display: { name: 'Cancel Worker Agent', names: { 'zh-CN': '取消 Worker Agent' }, resourceFields: ['invocationId'] },
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
      id: 'ssh.list-servers',
      name: 'List SSH Servers',
      description: 'List SSH servers configured for agent use. Sensitive connection details such as hostnames, usernames, and credentials are not returned.',
      category: 'system',
      icon: '🔐',
      display: { name: 'List SSH Servers', names: { 'zh-CN': '列出 SSH 服务器' } },
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'ssh.run-commands',
      name: 'Run SSH Commands',
      description: 'Run one or more shell commands on a configured SSH server using stored credentials. Commands run sequentially and may stop after the first failure.',
      category: 'system',
      icon: '🔐',
      display: { name: 'Run SSH Commands', names: { 'zh-CN': '执行 SSH 命令' }, resourceFields: ['serverId'] },
      inputSchema: {
        type: 'object',
        required: ['serverId', 'commands'],
        properties: {
          serverId: { type: 'string', description: 'SSH server id returned by ssh.list-servers.' },
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Shell commands to run sequentially on the selected SSH server.'
          },
          stopOnError: { type: 'boolean', description: 'When true, skip remaining commands after the first failed command. Defaults to true.' },
          timeoutMs: { type: 'number', description: 'Whole execution timeout in milliseconds. Defaults to 0, which means no timeout.' },
          wait: { type: 'boolean', description: 'When true, wait for command execution to finish before returning. Defaults to true.' }
        }
      }
    },
    {
      id: 'ssh.list-executions',
      name: 'List SSH Executions',
      description: 'List SSH command executions for the current session, optionally filtered by status.',
      category: 'system',
      icon: '🔐',
      display: { name: 'List SSH Executions', names: { 'zh-CN': '列出 SSH 执行' }, resourceFields: ['status'] },
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Optional execution status filter: queued, running, succeeded, failed, or cancelled.' }
        }
      }
    },
    {
      id: 'ssh.get-execution-output',
      name: 'Get SSH Execution Output',
      description: 'Get stdout, stderr, status, and result metadata for a previous SSH command execution in the current session.',
      category: 'system',
      icon: '🔐',
      display: { name: 'Get SSH Execution Output', names: { 'zh-CN': '获取 SSH 执行输出' }, resourceFields: ['executionId'] },
      inputSchema: {
        type: 'object',
        required: ['executionId'],
        properties: {
          executionId: { type: 'string', description: 'SSH execution id returned by ssh.run-commands or ssh.list-executions.' }
        }
      }
    },
    {
      id: 'time.current',
      name: 'Current Time',
      description: 'Get the current date, time, timezone, and UTC offset for this desktop runtime.',
      category: 'system',
      icon: '🕒',
      display: { name: 'Current Time', names: { 'zh-CN': '获取当前时间' } },
      inputSchema: { type: 'object', properties: {} }
    },
    {
      id: 'time.sleep',
      name: 'Sleep',
      description: 'Pause the Agent for a specified number of seconds before continuing. Use this to wait briefly before checking again.',
      category: 'system',
      icon: '💤',
      display: { name: 'Sleep', names: { 'zh-CN': '等待' }, resourceFields: ['seconds'] },
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
      display: { name: 'Wait Until Time', names: { 'zh-CN': '等待到时间' }, resourceFields: ['wakeAt'] },
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
      display: { name: 'Execute Command', names: { 'zh-CN': '执行命令' }, resourceFields: ['command'] },
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
      display: { name: 'Show Notification', names: { 'zh-CN': '显示通知' }, resourceFields: ['message'] },
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
