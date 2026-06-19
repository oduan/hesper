# Role Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现用户定义角色管理页面、IPC、持久化，以及 Agent 可调用的 `roles.create` / `roles.update` 工具。

**Architecture:** 使用现有 `roles` 数据表保存用户定义角色，新增 `ManagedRoleService` 作为 UI/API 专用业务层。Electron IPC 和 renderer fallback 暴露 roles CRUD；`@hesper/tools` 增加创建/更新角色工具，并通过 `service-container` 注入 app-core handler。Roles 页面使用现有一级导航 `roles`，左侧列表展示角色，右侧编辑详情。

**Tech Stack:** TypeScript, React, Electron IPC, sql.js persistence, Vitest, Testing Library, pnpm workspace.

---

## 文件结构总览

### 新增文件

- `hesper-desktop/packages/app-core/src/role-management-service.ts`  
  角色管理业务层：DTO 映射、创建、更新、删除、工具 ID 校验。

- `hesper-desktop/packages/app-core/src/__tests__/role-management-service.test.ts`  
  app-core 角色管理服务测试。

- `hesper-desktop/apps/desktop/renderer/src/roles-panel.tsx`  
  Roles 页面右侧详情、新建/编辑/删除表单。

- `hesper-desktop/apps/desktop/renderer/tests/roles-panel.test.tsx`  
  角色详情表单组件测试。

### 修改文件

- `hesper-desktop/packages/persistence/src/repositories.ts`  
  给 `RoleRepository` 增加 `delete(id)`。

- `hesper-desktop/packages/persistence/src/__tests__/repositories.test.ts`  
  覆盖 role 删除。

- `hesper-desktop/packages/app-core/src/index.ts`  
  导出 `role-management-service`。

- `hesper-desktop/packages/app-core/src/registry-services.ts`  
  主 Agent 默认工具增加 `roles.create` 和 `roles.update`。

- `hesper-desktop/packages/app-core/src/__tests__/registry-services.test.ts`  
  更新默认工具断言。

- `hesper-desktop/packages/tools/src/builtin-tools.ts`  
  新增 `roles.create` / `roles.update` 工具定义。

- `hesper-desktop/packages/tools/src/builtin-executor.ts`  
  新增角色工具 handler 注入和执行逻辑。

- `hesper-desktop/packages/tools/src/__tests__/builtin-tools.test.ts`  
  覆盖角色工具定义，确认不存在删除工具。

- `hesper-desktop/packages/tools/src/__tests__/builtin-executor.test.ts`  
  覆盖角色工具执行和未注入 handler 的可控错误。

- `hesper-desktop/apps/desktop/electron/ipc-contract.ts`  
  新增 roles channels、schemas、types、`HesperDesktopApi.roles`。

- `hesper-desktop/apps/desktop/electron/preload.ts`  
  暴露 roles API。

- `hesper-desktop/apps/desktop/electron/preload.cjs`  
  同步 preload CJS 合约。

- `hesper-desktop/apps/desktop/electron/ipc-handlers.ts`  
  注册 roles list/create/update/delete handler，mutating channel 保存持久化。

- `hesper-desktop/apps/desktop/electron/service-container.ts`  
  创建 `roleManagementService`，把 create/update handler 注入 builtin executor，并返回服务。

- `hesper-desktop/apps/desktop/tests/ipc-handlers.test.ts`  
  覆盖 roles IPC、默认工具列表变化、service container wiring。

- `hesper-desktop/apps/desktop/renderer/src/ipc-client.ts`  
  fallback API 增加 roles CRUD。

- `hesper-desktop/apps/desktop/renderer/tests/ipc-client.test.ts`  
  覆盖 fallback roles CRUD。

- `hesper-desktop/packages/ui/src/layout/AppShell.tsx`  
  增加 roles props 并传给 `EntityListPane`。

- `hesper-desktop/packages/ui/src/layout/EntityListPane.tsx`  
  `roles` section 展示角色列表和“新建角色”按钮。

- `hesper-desktop/packages/ui/src/__tests__/components.test.tsx`  
  覆盖角色列表渲染和选择/新建回调。

- `hesper-desktop/apps/desktop/renderer/src/App.tsx`  
  加载角色、管理选中角色/新建草稿、渲染 `RolesPanel`。

- `hesper-desktop/apps/desktop/renderer/tests/app-shell.test.tsx`  
  mock roles API，覆盖 Roles 页面从“即将支持”变成可用管理页。

---

## Task 0: 执行准备与基线验证

**Files:**
- Read: `docs/superpowers/specs/2026-06-20-role-management-design.md`
- Read: `docs/superpowers/plans/2026-06-20-role-management.md`

- [ ] **Step 1: 创建或确认隔离 worktree**

执行实现前，使用 `superpowers:using-git-worktrees` 技能。不要直接在非隔离 `master` 上实现。

推荐分支名：

```bash
git worktree add .worktrees/role-management -b feature/role-management
```

如果已经在隔离 worktree 中，跳过创建。

- [ ] **Step 2: 安装依赖**

```bash
cd hesper-desktop
pnpm install
```

Expected: lockfile 不变或正常安装完成。

- [ ] **Step 3: 跑基线验证**

```bash
cd hesper-desktop
pnpm check
pnpm lint
```

Expected: 当前基线通过。如果失败，先汇报失败并停止，不要开始实现。

---

## Task 1: Persistence 支持删除角色

**Files:**
- Modify: `hesper-desktop/packages/persistence/src/repositories.ts`
- Test: `hesper-desktop/packages/persistence/src/__tests__/repositories.test.ts`

- [ ] **Step 1: 写失败测试**

在 `repositories.test.ts` 的角色仓库测试附近新增测试。测试代码：

```ts
it('deletes roles by id', async () => {
  const db = await createInMemoryPersistence()
  await db.roles.save({
    id: 'role-to-delete',
    name: 'Temporary Role',
    description: 'Will be deleted',
    systemPrompt: 'Temporary prompt',
    allowedSkillIds: [],
    defaultSkillIds: [],
    defaultToolIds: ['filesystem.read-file'],
    canBeMainAgent: true,
    canBeWorkerAgent: false,
    canBeAssignedToWorkerAgent: false
  })

  await expect(db.roles.get('role-to-delete')).resolves.toMatchObject({ id: 'role-to-delete' })

  await db.roles.delete('role-to-delete')

  await expect(db.roles.get('role-to-delete')).resolves.toBeUndefined()
  expect((await db.roles.list()).map((role) => role.id)).not.toContain('role-to-delete')
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/persistence test -- --run src/__tests__/repositories.test.ts
```

Expected: FAIL，错误包含 `db.roles.delete is not a function` 或 TypeScript 编译提示 `delete` 不存在。

- [ ] **Step 3: 实现 `RoleRepository.delete`**

在 `repositories.ts` 中把接口改成：

```ts
export type RoleRepository = {
  save(role: Role): Promise<void>
  get(id: string): Promise<Role | undefined>
  list(): Promise<Role[]>
  delete(id: string): Promise<void>
}
```

在 `roles` repository object 中加入：

```ts
async delete(id) {
  db.run('DELETE FROM roles WHERE id = ?', [id])
}
```

放在 `list()` 后或 `get()` 后都可以，但保持同一个 `roles` object 内部。

- [ ] **Step 4: 验证测试通过**

```bash
cd hesper-desktop
pnpm --filter @hesper/persistence test -- --run src/__tests__/repositories.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add hesper-desktop/packages/persistence/src/repositories.ts hesper-desktop/packages/persistence/src/__tests__/repositories.test.ts
git commit -m "feat: support deleting roles from persistence"
```

---

## Task 2: App Core 新增 ManagedRoleService

**Files:**
- Create: `hesper-desktop/packages/app-core/src/role-management-service.ts`
- Create: `hesper-desktop/packages/app-core/src/__tests__/role-management-service.test.ts`
- Modify: `hesper-desktop/packages/app-core/src/index.ts`

- [ ] **Step 1: 写失败测试**

创建 `role-management-service.test.ts`：

```ts
import { createInMemoryPersistence } from '@hesper/persistence'
import { describe, expect, it } from 'vitest'
import { createToolCatalogService } from '../registry-services'
import { createRoleManagementService } from '../role-management-service'

const tools = [
  { id: 'filesystem.read-file', name: 'Read File', description: 'Read', category: 'filesystem' as const, inputSchema: {} },
  { id: 'roles.create', name: 'Create Role', description: 'Create role', category: 'agent' as const, inputSchema: {} }
]

function createService() {
  const persistencePromise = createInMemoryPersistence()
  return persistencePromise.then((persistence) => ({
    persistence,
    service: createRoleManagementService({
      persistence,
      toolCatalogService: createToolCatalogService(tools)
    })
  }))
}

describe('role management service', () => {
  it('creates and lists user-defined roles', async () => {
    const { persistence, service } = await createService()

    const role = await service.createRole({
      name: '运维助手',
      description: '执行 Git 和 Linux 命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: ['filesystem.read-file']
    })

    expect(role).toMatchObject({
      name: '运维助手',
      description: '执行 Git 和 Linux 命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: ['filesystem.read-file']
    })
    expect(role.id).toMatch(/^role-/)
    expect(await service.listRoles()).toEqual([role])
    await expect(persistence.roles.get(role.id)).resolves.toMatchObject({
      id: role.id,
      allowedSkillIds: [],
      defaultSkillIds: [],
      defaultToolIds: ['filesystem.read-file'],
      canBeMainAgent: true,
      canBeWorkerAgent: false,
      canBeAssignedToWorkerAgent: false
    })
  })

  it('normalizes optional text fields to empty strings', async () => {
    const { service } = await createService()

    const role = await service.createRole({ name: '搜索专家' })

    expect(role).toMatchObject({
      name: '搜索专家',
      description: '',
      systemPrompt: '',
      defaultToolIds: []
    })
  })

  it('rejects blank names and unknown default tools', async () => {
    const { service } = await createService()

    await expect(service.createRole({ name: '   ' })).rejects.toThrow('Role name is required')
    await expect(service.createRole({ name: 'Bad tools', defaultToolIds: ['missing.tool'] })).rejects.toThrow('Unknown tool id: missing.tool')
  })

  it('updates existing roles without overwriting omitted fields', async () => {
    const { service } = await createService()
    const role = await service.createRole({
      name: 'Original',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      defaultToolIds: ['filesystem.read-file']
    })

    const updated = await service.updateRole({ id: role.id, name: 'Updated' })

    expect(updated).toEqual({
      id: role.id,
      name: 'Updated',
      description: 'Original description',
      systemPrompt: 'Original prompt',
      defaultToolIds: ['filesystem.read-file']
    })
  })

  it('rejects invalid updates and deletes roles', async () => {
    const { service } = await createService()
    const role = await service.createRole({ name: 'Delete me' })

    await expect(service.updateRole({ id: 'missing', name: 'Nope' })).rejects.toThrow('Role not found: missing')
    await expect(service.updateRole({ id: role.id, name: '' })).rejects.toThrow('Role name is required')

    await expect(service.deleteRole(role.id)).resolves.toEqual({ deleted: true, id: role.id })
    await expect(service.listRoles()).resolves.toEqual([])
    await expect(service.deleteRole(role.id)).rejects.toThrow(`Role not found: ${role.id}`)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/app-core test -- --run src/__tests__/role-management-service.test.ts
```

Expected: FAIL，`role-management-service` 模块不存在。

- [ ] **Step 3: 实现服务**

创建 `role-management-service.ts`：

```ts
import type { Persistence } from '@hesper/persistence'
import { createId, type Role } from '@hesper/shared'
import type { ToolCatalogService } from './registry-services'

export type ManagedRoleDto = {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultToolIds: string[]
}

export type CreateManagedRoleInput = {
  name: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
}

export type UpdateManagedRoleInput = {
  id: string
  name?: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
}

export type ManagedRoleService = {
  listRoles(): Promise<ManagedRoleDto[]>
  createRole(input: CreateManagedRoleInput): Promise<ManagedRoleDto>
  updateRole(input: UpdateManagedRoleInput): Promise<ManagedRoleDto>
  deleteRole(id: string): Promise<{ deleted: true; id: string }>
}

export type RoleManagementServiceOptions = {
  persistence: Persistence
  toolCatalogService: ToolCatalogService
}

function normalizeRequiredName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Role name is required')
  return trimmed
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? ''
}

function toManagedRole(role: Role): ManagedRoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? '',
    systemPrompt: role.systemPrompt ?? '',
    defaultToolIds: role.defaultToolIds ?? []
  }
}

function toStoredRole(input: ManagedRoleDto): Role {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    systemPrompt: input.systemPrompt,
    allowedSkillIds: [],
    defaultSkillIds: [],
    defaultToolIds: input.defaultToolIds,
    canBeMainAgent: true,
    canBeWorkerAgent: false,
    canBeAssignedToWorkerAgent: false
  }
}

export function createRoleManagementService(options: RoleManagementServiceOptions): ManagedRoleService {
  const validateToolIds = (toolIds: string[] | undefined): string[] => {
    const ids = toolIds ?? []
    for (const id of ids) {
      if (!options.toolCatalogService.get(id)) {
        throw new Error(`Unknown tool id: ${id}`)
      }
    }
    return [...ids]
  }

  return {
    async listRoles() {
      return (await options.persistence.roles.list()).map(toManagedRole)
    },

    async createRole(input) {
      const role: ManagedRoleDto = {
        id: createId('role'),
        name: normalizeRequiredName(input.name),
        description: normalizeOptionalText(input.description),
        systemPrompt: normalizeOptionalText(input.systemPrompt),
        defaultToolIds: validateToolIds(input.defaultToolIds)
      }
      await options.persistence.roles.save(toStoredRole(role))
      return role
    },

    async updateRole(input) {
      const existing = await options.persistence.roles.get(input.id)
      if (!existing) throw new Error(`Role not found: ${input.id}`)
      const current = toManagedRole(existing)
      const role: ManagedRoleDto = {
        id: current.id,
        name: input.name === undefined ? current.name : normalizeRequiredName(input.name),
        description: input.description === undefined ? current.description : normalizeOptionalText(input.description),
        systemPrompt: input.systemPrompt === undefined ? current.systemPrompt : normalizeOptionalText(input.systemPrompt),
        defaultToolIds: input.defaultToolIds === undefined ? current.defaultToolIds : validateToolIds(input.defaultToolIds)
      }
      await options.persistence.roles.save(toStoredRole(role))
      return role
    },

    async deleteRole(id) {
      const existing = await options.persistence.roles.get(id)
      if (!existing) throw new Error(`Role not found: ${id}`)
      await options.persistence.roles.delete(id)
      return { deleted: true as const, id }
    }
  }
}
```

- [ ] **Step 4: 导出服务**

在 `packages/app-core/src/index.ts` 加一行：

```ts
export * from './role-management-service'
```

- [ ] **Step 5: 验证测试通过**

```bash
cd hesper-desktop
pnpm --filter @hesper/app-core test -- --run src/__tests__/role-management-service.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add hesper-desktop/packages/app-core/src/role-management-service.ts hesper-desktop/packages/app-core/src/__tests__/role-management-service.test.ts hesper-desktop/packages/app-core/src/index.ts
git commit -m "feat: add role management service"
```

---

## Task 3: 新增 Agent 可调用角色工具

**Files:**
- Modify: `hesper-desktop/packages/tools/src/builtin-tools.ts`
- Modify: `hesper-desktop/packages/tools/src/builtin-executor.ts`
- Modify: `hesper-desktop/packages/tools/src/__tests__/builtin-tools.test.ts`
- Modify: `hesper-desktop/packages/tools/src/__tests__/builtin-executor.test.ts`
- Modify: `hesper-desktop/packages/app-core/src/registry-services.ts`
- Modify: `hesper-desktop/packages/app-core/src/__tests__/registry-services.test.ts`

- [ ] **Step 1: 写工具定义失败测试**

在 `builtin-tools.test.ts` 更新数量并增加断言：

```ts
expect(tools).toHaveLength(16)
```

在 stable ids 里加入：

```ts
'roles.create',
'roles.update'
```

在 non-filesystem tools 测试中加入：

```ts
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
```

- [ ] **Step 2: 运行工具定义测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/tools test -- --run src/__tests__/builtin-tools.test.ts
```

Expected: FAIL，因为 roles 工具尚未定义。

- [ ] **Step 3: 实现工具定义**

在 `builtin-tools.ts` 中 `system.show-notification` 前或后插入：

```ts
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
      defaultToolIds: { type: 'array', items: { type: 'string' }, description: 'Default tool IDs for this role.' }
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
      defaultToolIds: { type: 'array', items: { type: 'string' }, description: 'Replacement default tool IDs for this role.' }
    }
  }
},
```

- [ ] **Step 4: 写 executor 失败测试**

在 `builtin-executor.test.ts` 添加测试：

```ts
it('creates and updates roles through injected role handlers', async () => {
  const createRole = vi.fn(async (input) => ({ id: 'role-1', description: '', systemPrompt: '', defaultToolIds: [], ...input }))
  const updateRole = vi.fn(async (input) => ({ id: input.id, name: input.name ?? 'Existing', description: input.description ?? '', systemPrompt: input.systemPrompt ?? '', defaultToolIds: input.defaultToolIds ?? [] }))
  const executor = createBuiltinToolExecutor({ roleTools: { createRole, updateRole } })

  const created = await executor.execute(tool('roles.create'), { name: '运维助手', defaultToolIds: ['git.status'] }, {
    runId: 'run-1',
    sessionId: 'session-1',
    allowedToolIds: ['roles.create']
  })
  expect(createRole).toHaveBeenCalledWith({ name: '运维助手', defaultToolIds: ['git.status'] })
  expect(JSON.parse(created.content)).toMatchObject({ id: 'role-1', name: '运维助手' })

  const updated = await executor.execute(tool('roles.update'), { id: 'role-1', systemPrompt: '更新提示词' }, {
    runId: 'run-1',
    sessionId: 'session-1',
    allowedToolIds: ['roles.update']
  })
  expect(updateRole).toHaveBeenCalledWith({ id: 'role-1', systemPrompt: '更新提示词' })
  expect(JSON.parse(updated.content)).toMatchObject({ id: 'role-1', systemPrompt: '更新提示词' })
})

it('returns a controlled error when role tools are unavailable', async () => {
  const executor = createBuiltinToolExecutor()

  await expect(executor.execute(tool('roles.create'), { name: '角色' }, {
    runId: 'run-1',
    sessionId: 'session-1',
    allowedToolIds: ['roles.create']
  })).resolves.toMatchObject({
    isError: true,
    details: { code: 'not_available', toolId: 'roles.create' }
  })
})
```

- [ ] **Step 5: 运行 executor 测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/tools test -- --run src/__tests__/builtin-executor.test.ts
```

Expected: FAIL，因为 `roleTools` option 和 switch 分支不存在。

- [ ] **Step 6: 实现 executor role handlers**

在 `builtin-executor.ts` 增加类型：

```ts
type RoleToolInput = {
  id?: string
  name?: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
}

export type RoleToolHandlers = {
  createRole(input: Omit<RoleToolInput, 'id'> & { name: string }): Promise<unknown>
  updateRole(input: RoleToolInput & { id: string }): Promise<unknown>
}
```

在 `BuiltinToolExecutorOptions` 加：

```ts
roleTools?: RoleToolHandlers
```

新增 helper：

```ts
function optionalStringArrayArg(args: unknown, key: string): string[] | undefined {
  const value = argsObject(args)[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Tool argument must be an array of non-empty strings: ${key}`)
  }
  return value
}

function optionalRoleToolInput(args: unknown): RoleToolInput {
  const record = argsObject(args)
  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(typeof record.systemPrompt === 'string' ? { systemPrompt: record.systemPrompt } : {}),
    ...(optionalStringArrayArg(args, 'defaultToolIds') !== undefined ? { defaultToolIds: optionalStringArrayArg(args, 'defaultToolIds') } : {})
  }
}

function roleToolsUnavailable(tool: ToolDefinition): ToolExecutionResult {
  return {
    content: 'Role management tools are not available in this runtime.',
    details: { code: 'not_available', toolId: tool.id },
    isError: true
  }
}

async function createRoleTool(tool: ToolDefinition, args: unknown, roleTools: RoleToolHandlers | undefined): Promise<ToolExecutionResult> {
  if (!roleTools) return roleToolsUnavailable(tool)
  const input = { ...optionalRoleToolInput(args), name: stringArg(args, 'name') }
  const role = await roleTools.createRole(input)
  return { content: jsonContent(role), details: { toolId: tool.id, role } }
}

async function updateRoleTool(tool: ToolDefinition, args: unknown, roleTools: RoleToolHandlers | undefined): Promise<ToolExecutionResult> {
  if (!roleTools) return roleToolsUnavailable(tool)
  const input = { ...optionalRoleToolInput(args), id: stringArg(args, 'id') }
  const role = await roleTools.updateRole(input)
  return { content: jsonContent(role), details: { toolId: tool.id, role } }
}
```

在 switch 中加入：

```ts
case 'roles.create':
  return createRoleTool(tool, args, options.roleTools)
case 'roles.update':
  return updateRoleTool(tool, args, options.roleTools)
```

- [ ] **Step 7: 更新默认角色工具列表测试**

在 `registry-services.test.ts` 的 `main-agent.defaultToolIds` 中追加：

```ts
'roles.create',
'roles.update'
```

不要加到 worker-agent 默认工具中。

- [ ] **Step 8: 更新默认角色服务**

在 `registry-services.ts` 的 `main-agent.defaultToolIds` 中追加：

```ts
'roles.create',
'roles.update'
```

- [ ] **Step 9: 验证 tools 和 app-core 测试**

```bash
cd hesper-desktop
pnpm --filter @hesper/tools test -- --run src/__tests__/builtin-tools.test.ts src/__tests__/builtin-executor.test.ts
pnpm --filter @hesper/app-core test -- --run src/__tests__/registry-services.test.ts
```

Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add hesper-desktop/packages/tools/src/builtin-tools.ts hesper-desktop/packages/tools/src/builtin-executor.ts hesper-desktop/packages/tools/src/__tests__/builtin-tools.test.ts hesper-desktop/packages/tools/src/__tests__/builtin-executor.test.ts hesper-desktop/packages/app-core/src/registry-services.ts hesper-desktop/packages/app-core/src/__tests__/registry-services.test.ts
git commit -m "feat: add role management tools"
```

---

## Task 4: Electron IPC、preload、service container 接入 roles

**Files:**
- Modify: `hesper-desktop/apps/desktop/electron/ipc-contract.ts`
- Modify: `hesper-desktop/apps/desktop/electron/preload.ts`
- Modify: `hesper-desktop/apps/desktop/electron/preload.cjs`
- Modify: `hesper-desktop/apps/desktop/electron/ipc-handlers.ts`
- Modify: `hesper-desktop/apps/desktop/electron/service-container.ts`
- Modify: `hesper-desktop/apps/desktop/tests/ipc-handlers.test.ts`

- [ ] **Step 1: 写 IPC handler 失败测试**

在 `ipc-handlers.test.ts` 增加测试：

```ts
it('manages roles through typed IPC handlers and persists mutations', async () => {
  const persistence = await createInMemoryPersistence()
  const container = createServiceContainer({ persistence, agentMode: 'mock' })
  const savePersistence = vi.fn(async () => {})
  const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<unknown> | unknown) => {
      handles.set(channel, handler)
    }),
    removeHandler: vi.fn()
  }
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }

  registerIpcHandlers({ ipcMain, dialog, container, savePersistence })

  const created = await handles.get(ipcChannels.rolesCreate)?.({ sender: { id: 1 } }, {
    name: '运维助手',
    description: '执行命令',
    systemPrompt: '你是运维助手。',
    defaultToolIds: ['git.status']
  }) as { id: string }

  expect(created).toMatchObject({ name: '运维助手', defaultToolIds: ['git.status'] })
  await expect(handles.get(ipcChannels.rolesList)?.({ sender: { id: 1 } })).resolves.toEqual([expect.objectContaining({ id: created.id })])

  await expect(handles.get(ipcChannels.rolesUpdate)?.({ sender: { id: 1 } }, {
    id: created.id,
    name: '更新后的角色'
  })).resolves.toMatchObject({ id: created.id, name: '更新后的角色' })

  await expect(handles.get(ipcChannels.rolesDelete)?.({ sender: { id: 1 } }, created.id)).resolves.toEqual({ deleted: true, id: created.id })
  await expect(handles.get(ipcChannels.rolesList)?.({ sender: { id: 1 } })).resolves.toEqual([])
  expect(savePersistence).toHaveBeenCalledTimes(3)
})
```

同时在 service container 测试中加断言：

```ts
expect(container.roleManagementService).toBeDefined()
```

- [ ] **Step 2: 运行 IPC 测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop exec vitest --run -c vitest.config.ts tests/ipc-handlers.test.ts
```

Expected: FAIL，因为 `rolesCreate` 等 channel 不存在。

- [ ] **Step 3: 更新 IPC contract**

在 `ipcChannels` 添加：

```ts
rolesList: 'roles:list',
rolesCreate: 'roles:create',
rolesUpdate: 'roles:update',
rolesDelete: 'roles:delete',
```

在 schemas 区域添加：

```ts
export const managedRoleDtoSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: z.string(),
  systemPrompt: z.string(),
  defaultToolIds: z.array(nonEmptyStringSchema)
}).strict()

export const createRoleInputSchema = z.object({
  name: nonEmptyStringSchema,
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultToolIds: z.array(nonEmptyStringSchema).optional()
}).strict()

export const updateRoleInputSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema.optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultToolIds: z.array(nonEmptyStringSchema).optional()
}).strict()
```

导出 types：

```ts
export type ManagedRoleDto = z.infer<typeof managedRoleDtoSchema>
export type CreateRoleInput = z.infer<typeof createRoleInputSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>
```

在 `HesperDesktopApi` 中添加：

```ts
roles: {
  list(): Promise<ManagedRoleDto[]>
  create(input: CreateRoleInput): Promise<ManagedRoleDto>
  update(input: UpdateRoleInput): Promise<ManagedRoleDto>
  delete(id: string): Promise<{ deleted: true; id: string }>
}
```

- [ ] **Step 4: 更新 preload.ts**

在 `hesperApi` 添加：

```ts
roles: {
  list: () => ipcRenderer.invoke(ipcChannels.rolesList),
  create: (input) => ipcRenderer.invoke(ipcChannels.rolesCreate, input),
  update: (input) => ipcRenderer.invoke(ipcChannels.rolesUpdate, input),
  delete: (id) => ipcRenderer.invoke(ipcChannels.rolesDelete, id)
},
```

- [ ] **Step 5: 更新 preload.cjs**

同步 `ipcChannels` 常量和 `hesperApi.roles`。保持方法名与 `preload.ts` 一致：`list/create/update/delete`。

- [ ] **Step 6: 更新 service-container**

导入 `createRoleManagementService`：

```ts
createRoleManagementService,
```

在 `toolCatalogService` 创建后添加：

```ts
const roleManagementService = createRoleManagementService({ persistence: options.persistence, toolCatalogService })
```

在 `createBuiltinToolExecutor` options 中加入：

```ts
roleTools: {
  createRole: (input) => roleManagementService.createRole(input),
  updateRole: (input) => roleManagementService.updateRole(input)
},
```

在 return object 中加入：

```ts
roleManagementService,
```

- [ ] **Step 7: 更新 ipc-handlers**

导入 schemas：

```ts
createRoleInputSchema,
managedRoleDtoSchema,
updateRoleInputSchema,
```

把 mutating channels 加入：

```ts
ipcChannels.rolesCreate,
ipcChannels.rolesUpdate,
ipcChannels.rolesDelete,
```

在 handlers 中加入：

```ts
[ipcChannels.rolesList]: async () => z.array(managedRoleDtoSchema).parse(await options.container.roleManagementService.listRoles()),
[ipcChannels.rolesCreate]: async (_event, payload) => {
  const role = await options.container.roleManagementService.createRole(createRoleInputSchema.parse(payload))
  await savePersistence()
  return managedRoleDtoSchema.parse(role)
},
[ipcChannels.rolesUpdate]: async (_event, payload) => {
  const role = await options.container.roleManagementService.updateRole(updateRoleInputSchema.parse(payload))
  await savePersistence()
  return managedRoleDtoSchema.parse(role)
},
[ipcChannels.rolesDelete]: async (_event, payload) => {
  const result = await options.container.roleManagementService.deleteRole(sessionIdInputSchema.parse(payload))
  await savePersistence()
  return result
},
```

`rolesDelete` 可以复用 `sessionIdInputSchema` 作为非空字符串解析器，或新增 `roleIdInputSchema = nonEmptyStringSchema`。

- [ ] **Step 8: 更新默认工具期望**

`ipc-handlers.test.ts` 里 `expectedDefaultEnabledTools` 和 `expectedEnabledTools` 都追加：

```ts
'roles.create',
'roles.update'
```

- [ ] **Step 9: 验证 IPC/preload**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop test -- --run tests/ipc-handlers.test.ts
```

Expected: PASS，且 preload contract 脚本通过。

- [ ] **Step 10: 提交**

```bash
git add hesper-desktop/apps/desktop/electron/ipc-contract.ts hesper-desktop/apps/desktop/electron/preload.ts hesper-desktop/apps/desktop/electron/preload.cjs hesper-desktop/apps/desktop/electron/ipc-handlers.ts hesper-desktop/apps/desktop/electron/service-container.ts hesper-desktop/apps/desktop/tests/ipc-handlers.test.ts
git commit -m "feat: expose role management ipc"
```

---

## Task 5: Renderer fallback API 支持 roles CRUD

**Files:**
- Modify: `hesper-desktop/apps/desktop/renderer/src/ipc-client.ts`
- Modify: `hesper-desktop/apps/desktop/renderer/tests/ipc-client.test.ts`

- [ ] **Step 1: 写失败测试**

在 `ipc-client.test.ts` 添加：

```ts
it('manages roles in fallback mode', async () => {
  const api = createHesperApi({ allowFallback: true })

  const created = await api.roles.create({
    name: 'Fallback Role',
    description: 'Created locally',
    systemPrompt: 'Fallback prompt',
    defaultToolIds: ['filesystem.read-file']
  })

  expect(created).toMatchObject({ name: 'Fallback Role', defaultToolIds: ['filesystem.read-file'] })
  expect(await api.roles.list()).toEqual([created])

  const updated = await api.roles.update({ id: created.id, name: 'Updated Fallback Role' })
  expect(updated).toMatchObject({ id: created.id, name: 'Updated Fallback Role', description: 'Created locally' })

  await expect(api.roles.delete(created.id)).resolves.toEqual({ deleted: true, id: created.id })
  expect(await api.roles.list()).toEqual([])
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop exec vitest --run -c vitest.config.ts renderer/tests/ipc-client.test.ts
```

Expected: FAIL，因为 fallback API 没有 `roles`。

- [ ] **Step 3: 实现 fallback roles**

更新 imports，加入 types：

```ts
CreateRoleInput,
ManagedRoleDto,
UpdateRoleInput,
```

在 `createFallbackHesperApi()` 中添加状态：

```ts
let roles: ManagedRoleDto[] = []
```

添加 helper：

```ts
function normalizeFallbackRole(input: CreateRoleInput, id = createId('role')): ManagedRoleDto {
  const name = input.name.trim()
  if (!name) throw new Error('Role name is required')
  return {
    id,
    name,
    description: input.description?.trim() ?? '',
    systemPrompt: input.systemPrompt?.trim() ?? '',
    defaultToolIds: input.defaultToolIds ?? []
  }
}
```

在 returned API 中添加：

```ts
roles: {
  list: async () => roles.map((role) => ({ ...role, defaultToolIds: [...role.defaultToolIds] })),
  create: async (input: CreateRoleInput) => {
    const role = normalizeFallbackRole(input)
    roles = [role, ...roles]
    return { ...role, defaultToolIds: [...role.defaultToolIds] }
  },
  update: async (input: UpdateRoleInput) => {
    const existing = roles.find((role) => role.id === input.id)
    if (!existing) throw new Error(`Role not found: ${input.id}`)
    const updated = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt.trim() } : {}),
      ...(input.defaultToolIds !== undefined ? { defaultToolIds: [...input.defaultToolIds] } : {})
    }
    if (!updated.name) throw new Error('Role name is required')
    roles = roles.map((role) => role.id === input.id ? updated : role)
    return { ...updated, defaultToolIds: [...updated.defaultToolIds] }
  },
  delete: async (id: string) => {
    if (!roles.some((role) => role.id === id)) throw new Error(`Role not found: ${id}`)
    roles = roles.filter((role) => role.id !== id)
    return { deleted: true as const, id }
  }
},
```

- [ ] **Step 4: 验证测试通过**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop exec vitest --run -c vitest.config.ts renderer/tests/ipc-client.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add hesper-desktop/apps/desktop/renderer/src/ipc-client.ts hesper-desktop/apps/desktop/renderer/tests/ipc-client.test.ts
git commit -m "feat: add fallback role management api"
```

---

## Task 6: UI 包支持 Roles 列表

**Files:**
- Modify: `hesper-desktop/packages/ui/src/layout/AppShell.tsx`
- Modify: `hesper-desktop/packages/ui/src/layout/EntityListPane.tsx`
- Modify: `hesper-desktop/packages/ui/src/__tests__/components.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `components.test.tsx` 新增测试：

```tsx
it('renders role list rows and create role action', async () => {
  const user = userEvent.setup()
  const onSelectRole = vi.fn()
  const onCreateRole = vi.fn()

  render(
    <AppShell
      sessions={[]}
      activeSection="roles"
      title="角色"
      roles={[
        { id: 'role-ops', name: '运维助手', description: '执行命令' },
        { id: 'role-search', name: '搜索专家', description: '搜索资料' }
      ]}
      activeRoleId="role-ops"
      onSelectRole={onSelectRole}
      onCreateRole={onCreateRole}
    >
      <div>Role detail</div>
    </AppShell>
  )

  expect(screen.getByRole('button', { name: /运维助手/ })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('执行命令')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /搜索专家/ }))
  expect(onSelectRole).toHaveBeenCalledWith('role-search')

  await user.click(screen.getByRole('button', { name: '新建角色' }))
  expect(onCreateRole).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 运行 UI 测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/ui test -- --run src/__tests__/components.test.tsx
```

Expected: FAIL，因为 `roles` props 不存在。

- [ ] **Step 3: 更新 AppShell props**

在 `AppShell.tsx` 添加类型：

```ts
export type RoleListItem = {
  id: string
  name: string
  description: string
}
```

在 `AppShellProps` 添加：

```ts
roles?: RoleListItem[]
activeRoleId?: string
onSelectRole?: (roleId: string) => void
onCreateRole?: () => void
```

在函数参数中接收并传给 `EntityListPane`：

```tsx
roles,
activeRoleId,
onSelectRole,
onCreateRole,
```

传参：

```tsx
{...(roles ? { roles } : {})}
{...(activeRoleId ? { activeRoleId } : {})}
{...(onSelectRole ? { onSelectRole } : {})}
{...(onCreateRole ? { onCreateRole } : {})}
```

- [ ] **Step 4: 更新 EntityListPane props 和渲染**

在 `EntityListPane.tsx` 导入 `RoleListItem` 或本文件定义同形类型。推荐从 `AppShell` 同文件导出会造成循环风险，所以在 `EntityListPane.tsx` 本地定义：

```ts
export type RoleListItem = {
  id: string
  name: string
  description: string
}
```

给 props 添加：

```ts
roles?: RoleListItem[]
activeRoleId?: string
onSelectRole?: (roleId: string) => void
onCreateRole?: () => void
```

更新 heading：

```ts
const heading = title ?? (activeSection === 'sessions' ? '所有会话' : activeSection === 'settings' ? '设置' : activeSection === 'tools' ? '工具' : activeSection === 'roles' ? '角色' : '列表')
```

在 tools 分支前加入 roles 分支：

```tsx
) : activeSection === 'roles' ? (
  <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', gap: 12, minHeight: 0 }}>
    <button type="button" onClick={onCreateRole} style={newRoleButtonStyle}>+ 新建角色</button>
    {roles.length > 0 ? (
      <ul aria-label="角色列表" className="hesper-theme-scrollbar" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, overflow: 'auto', minHeight: 0 }}>
        {roles.map((role) => {
          const isActive = role.id === activeRoleId
          return (
            <li key={role.id}>
              <button
                type="button"
                className={`hesper-session-row${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`${role.name} ${role.description}`.trim()}
                onClick={() => onSelectRole?.(role.id)}
              >
                <span style={{ fontWeight: 700 }}>{role.name}</span>
                <span style={{ color: darkTheme.color.textMuted, fontSize: darkTheme.typography.caption, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role.description || '暂无简介'}</span>
              </button>
            </li>
          )
        })}
      </ul>
    ) : (
      <div style={{ margin: 'auto', color: darkTheme.color.textMuted, fontSize: darkTheme.typography.body, textAlign: 'center' }}>暂无角色</div>
    )}
  </div>
```

新增 style：

```ts
const newRoleButtonStyle = {
  width: '100%',
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: 12,
  background: darkTheme.color.surfaceMuted,
  color: darkTheme.color.text,
  padding: '10px 12px',
  fontWeight: 700,
  cursor: 'pointer'
} satisfies CSSProperties
```

如果文件没有导入 `CSSProperties`，从 React import 中加入。

- [ ] **Step 5: 验证 UI 测试通过**

```bash
cd hesper-desktop
pnpm --filter @hesper/ui test -- --run src/__tests__/components.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add hesper-desktop/packages/ui/src/layout/AppShell.tsx hesper-desktop/packages/ui/src/layout/EntityListPane.tsx hesper-desktop/packages/ui/src/__tests__/components.test.tsx
git commit -m "feat: render roles in app shell"
```

---

## Task 7: Renderer 实现 RolesPanel 和 App wiring

**Files:**
- Create: `hesper-desktop/apps/desktop/renderer/src/roles-panel.tsx`
- Create: `hesper-desktop/apps/desktop/renderer/tests/roles-panel.test.tsx`
- Modify: `hesper-desktop/apps/desktop/renderer/src/App.tsx`
- Modify: `hesper-desktop/apps/desktop/renderer/tests/app-shell.test.tsx`

- [ ] **Step 1: 写 RolesPanel 失败测试**

创建 `roles-panel.test.tsx`：

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RolesPanel } from '../src/roles-panel'

const tools = [
  { id: 'filesystem.read-file', name: 'Read File', description: 'Read', category: 'filesystem' as const, inputSchema: {}, enabled: true },
  { id: 'git.status', name: 'Git Status', description: 'Git status', category: 'git' as const, inputSchema: {}, enabled: true }
]

const role = {
  id: 'role-1',
  name: '运维助手',
  description: '执行命令',
  systemPrompt: '你是运维助手。',
  defaultToolIds: ['git.status']
}

describe('RolesPanel', () => {
  afterEach(() => cleanup())

  it('renders an empty state with create action', async () => {
    const onCreateDraft = vi.fn()
    render(<RolesPanel roles={[]} tools={tools} onCreateDraft={onCreateDraft} />)

    expect(screen.getByText('暂无角色')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '创建第一个角色' }))
    expect(onCreateDraft).toHaveBeenCalledTimes(1)
  })

  it('edits and saves an existing role', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<RolesPanel roles={[role]} selectedRole={role} tools={tools} onCreateDraft={vi.fn()} onSave={onSave} onDelete={vi.fn()} />)

    await user.clear(screen.getByLabelText('角色名称'))
    await user.type(screen.getByLabelText('角色名称'), '更新角色')
    await user.click(screen.getByLabelText('Read File'))
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(onSave).toHaveBeenCalledWith({
      id: 'role-1',
      name: '更新角色',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: expect.arrayContaining(['filesystem.read-file', 'git.status'])
    })
  })

  it('confirms before deleting a role', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<RolesPanel roles={[role]} selectedRole={role} tools={tools} onCreateDraft={vi.fn()} onSave={vi.fn()} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: '删除角色' }))

    expect(window.confirm).toHaveBeenCalledWith('确定要删除角色“运维助手”吗？此操作无法撤销。')
    expect(onDelete).toHaveBeenCalledWith('role-1')
  })
})
```

- [ ] **Step 2: 运行 RolesPanel 测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop exec vitest --run -c vitest.config.ts renderer/tests/roles-panel.test.tsx
```

Expected: FAIL，因为组件不存在。

- [ ] **Step 3: 实现 RolesPanel**

创建 `roles-panel.tsx`，导出：

```tsx
import { useEffect, useState, type CSSProperties } from 'react'
import type { ManagedRoleDto, ToolDto } from '../../electron/ipc-contract'

type RoleDraft = ManagedRoleDto

export function RolesPanel({
  roles,
  selectedRole,
  creating = false,
  tools,
  pending = false,
  error,
  onCreateDraft,
  onCancelDraft,
  onSave,
  onDelete
}: {
  roles: ManagedRoleDto[]
  selectedRole?: ManagedRoleDto
  creating?: boolean
  tools: ToolDto[]
  pending?: boolean
  error?: string
  onCreateDraft: () => void
  onCancelDraft?: () => void
  onSave?: (role: RoleDraft) => void
  onDelete?: (id: string) => void
}) {
  const current = selectedRole ?? (creating ? { id: '', name: '', description: '', systemPrompt: '', defaultToolIds: [] } : undefined)
  const [draft, setDraft] = useState<RoleDraft | undefined>(current)

  useEffect(() => {
    setDraft(current)
  }, [current?.id, creating])

  if (!draft) {
    return (
      <section aria-label="角色详情" style={emptyStateStyle}>
        <div>
          <h2 style={emptyTitleStyle}>暂无角色</h2>
          <p style={mutedTextStyle}>创建角色后，可以为它设置名称、简介、完整提示词和默认工具。</p>
          <button type="button" onClick={onCreateDraft} style={primaryButtonStyle(false)}>创建第一个角色</button>
          {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}
        </div>
      </section>
    )
  }

  const toggleTool = (toolId: string) => {
    setDraft((currentDraft) => {
      if (!currentDraft) return currentDraft
      const hasTool = currentDraft.defaultToolIds.includes(toolId)
      return {
        ...currentDraft,
        defaultToolIds: hasTool ? currentDraft.defaultToolIds.filter((id) => id !== toolId) : [...currentDraft.defaultToolIds, toolId]
      }
    })
  }

  const saveLabel = creating ? '创建角色' : '保存修改'

  return (
    <section aria-label="角色详情" style={panelStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>{creating ? '新建角色' : '角色详情'}</p>
          <h2 style={titleStyle}>{draft.name || '未命名角色'}</h2>
        </div>
        {!creating && draft.id ? <button type="button" disabled={pending} onClick={() => {
          if (window.confirm(`确定要删除角色“${draft.name}”吗？此操作无法撤销。`)) onDelete?.(draft.id)
        }} style={dangerButtonStyle(pending)}>删除角色</button> : null}
      </header>

      {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}

      <label style={fieldStyle}>
        <span style={labelStyle}>角色名称</span>
        <input aria-label="角色名称" value={draft.name} disabled={pending} onChange={(event) => setDraft({ ...draft, name: event.target.value })} style={inputStyle} />
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>角色简介</span>
        <input aria-label="角色简介" value={draft.description} disabled={pending} onChange={(event) => setDraft({ ...draft, description: event.target.value })} style={inputStyle} />
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>完整提示词</span>
        <textarea aria-label="完整提示词" value={draft.systemPrompt} disabled={pending} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} style={textareaStyle} />
      </label>

      <section style={fieldStyle}>
        <h3 style={sectionTitleStyle}>默认工具</h3>
        <div style={toolGridStyle}>
          {tools.map((tool) => {
            const checked = draft.defaultToolIds.includes(tool.id)
            return (
              <label key={tool.id} style={toolOptionStyle(checked)}>
                <input aria-label={tool.name} type="checkbox" checked={checked} disabled={pending} onChange={() => toggleTool(tool.id)} />
                <span>{tool.name}</span>
                <small style={toolIdStyle}>{tool.id}</small>
              </label>
            )
          })}
        </div>
      </section>

      <footer style={footerStyle}>
        {creating ? <button type="button" disabled={pending} onClick={onCancelDraft} style={secondaryButtonStyle(pending)}>取消</button> : null}
        <button type="button" disabled={pending || !draft.name.trim()} onClick={() => onSave?.({ ...draft, name: draft.name.trim(), description: draft.description.trim(), systemPrompt: draft.systemPrompt.trim() })} style={primaryButtonStyle(pending || !draft.name.trim())}>{saveLabel}</button>
      </footer>
    </section>
  )
}
```

同文件底部补齐样式常量。复用 `ToolDetailsPanel` 的命名和色值：`panelStyle`, `emptyStateStyle`, `headerStyle`, `eyebrowStyle`, `titleStyle`, `mutedTextStyle`, `errorTextStyle`, `primaryButtonStyle`, `secondaryButtonStyle`, `dangerButtonStyle`, `fieldStyle`, `labelStyle`, `inputStyle`, `textareaStyle`, `sectionTitleStyle`, `toolGridStyle`, `toolOptionStyle`, `toolIdStyle`, `footerStyle`。样式只影响本组件，不改全局 CSS。

- [ ] **Step 4: 验证 RolesPanel 测试通过**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop exec vitest --run -c vitest.config.ts renderer/tests/roles-panel.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 写 App wiring 失败测试**

在 `app-shell.test.tsx` 的 hoisted mocks 中加入：

```ts
listRoles: vi.fn(async () => []),
createRole: vi.fn(async (input) => ({ id: 'role-created', description: '', systemPrompt: '', defaultToolIds: [], ...input })),
updateRole: vi.fn(async (input) => ({ id: input.id, name: input.name ?? 'Role', description: input.description ?? '', systemPrompt: input.systemPrompt ?? '', defaultToolIds: input.defaultToolIds ?? [] })),
deleteRole: vi.fn(async (id: string) => ({ deleted: true as const, id })),
```

在 mock `hesperApi` 中加入：

```ts
roles: { list: listRoles, create: createRole, update: updateRole, delete: deleteRole },
```

在 beforeEach 重置并设置默认：

```ts
listRoles.mockReset()
createRole.mockClear()
updateRole.mockClear()
deleteRole.mockClear()
listRoles.mockResolvedValue([])
```

新增测试：

```tsx
it('renders the roles management section instead of a placeholder', async () => {
  listRoles.mockResolvedValueOnce([
    { id: 'role-1', name: '运维助手', description: '执行命令', systemPrompt: '你是运维助手。', defaultToolIds: ['filesystem.read-file'] }
  ])

  render(<App />)

  await userEvent.click(screen.getByRole('button', { name: '角色' }))

  expect(await screen.findByRole('button', { name: /运维助手/ })).toBeInTheDocument()
  expect(screen.queryByText('Roles 即将支持')).not.toBeInTheDocument()
  expect(screen.getByLabelText('角色名称')).toHaveValue('运维助手')
})
```

- [ ] **Step 6: 运行 App 测试确认失败**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop exec vitest --run -c vitest.config.ts renderer/tests/app-shell.test.tsx
```

Expected: FAIL，因为 App 尚未加载 roles，也仍显示 placeholder。

- [ ] **Step 7: App.tsx 接入 roles state 和 handlers**

更新 imports：

```ts
import type { AppSettings, ManagedRoleDto, ToolCredentialStatus, ToolDto, UpdateSettingsInput } from '../../electron/ipc-contract'
import { RolesPanel } from './roles-panel'
```

添加 state：

```ts
const [roles, setRoles] = useState<ManagedRoleDto[]>([])
const [rolesError, setRolesError] = useState<string>()
const [activeRoleId, setActiveRoleId] = useState<string>()
const [creatingRole, setCreatingRole] = useState(false)
const [rolesPending, setRolesPending] = useState(false)
```

添加加载 effect：

```ts
useEffect(() => {
  let cancelled = false
  void hesperApi.roles.list().then((loadedRoles) => {
    if (!cancelled) {
      setRoles(loadedRoles)
      setRolesError(undefined)
    }
  }).catch((error) => {
    if (!cancelled) setRolesError(error instanceof Error ? error.message : '未知角色加载错误')
  })
  return () => { cancelled = true }
}, [])
```

添加自动选中 effect：

```ts
useEffect(() => {
  if (creatingRole) return
  if (roles.length === 0) {
    setActiveRoleId(undefined)
    return
  }
  if (!activeRoleId || !roles.some((role) => role.id === activeRoleId)) {
    setActiveRoleId(roles[0]!.id)
  }
}, [activeRoleId, creatingRole, roles])
```

添加 helpers：

```ts
const activeRole = roles.find((role) => role.id === activeRoleId)

const refreshRoles = async () => {
  const loadedRoles = await hesperApi.roles.list()
  setRoles(loadedRoles)
  return loadedRoles
}

const saveRole = async (role: ManagedRoleDto) => {
  setRolesPending(true)
  try {
    const saved = creatingRole
      ? await hesperApi.roles.create({ name: role.name, description: role.description, systemPrompt: role.systemPrompt, defaultToolIds: role.defaultToolIds })
      : await hesperApi.roles.update(role)
    const loadedRoles = await refreshRoles()
    setCreatingRole(false)
    setActiveRoleId(saved.id)
    if (!loadedRoles.some((candidate) => candidate.id === saved.id)) {
      setRoles((current) => [saved, ...current])
    }
    setRolesError(undefined)
  } catch (error) {
    setRolesError(error instanceof Error ? error.message : '未知角色保存错误')
  } finally {
    setRolesPending(false)
  }
}

const deleteRole = async (roleId: string) => {
  setRolesPending(true)
  try {
    await hesperApi.roles.delete(roleId)
    const loadedRoles = await refreshRoles()
    setActiveRoleId(loadedRoles[0]?.id)
    setRolesError(undefined)
  } catch (error) {
    setRolesError(error instanceof Error ? error.message : '未知角色删除错误')
  } finally {
    setRolesPending(false)
  }
}
```

传给 AppShell：

```tsx
roles={roles.map((role) => ({ id: role.id, name: role.name, description: role.description }))}
{...(activeRoleId ? { activeRoleId } : {})}
onSelectRole={(roleId) => {
  setCreatingRole(false)
  setActiveRoleId(roleId)
}}
onCreateRole={() => {
  setCreatingRole(true)
  setActiveRoleId(undefined)
}}
```

在 children 分支中替换 roles placeholder：

```tsx
) : state.activeSection === 'roles' ? (
  <RolesPanel
    roles={roles}
    {...(activeRole ? { selectedRole: activeRole } : {})}
    creating={creatingRole}
    tools={tools}
    pending={rolesPending}
    {...(rolesError ? { error: rolesError } : {})}
    onCreateDraft={() => {
      setCreatingRole(true)
      setActiveRoleId(undefined)
    }}
    onCancelDraft={() => {
      setCreatingRole(false)
      setActiveRoleId(roles[0]?.id)
    }}
    onSave={(role) => { void saveRole(role) }}
    onDelete={(roleId) => { void deleteRole(roleId) }}
  />
```

更新 section title：

```ts
roles: '角色'
```

- [ ] **Step 8: 验证 App 测试通过**

```bash
cd hesper-desktop
pnpm --filter @hesper/desktop exec vitest --run -c vitest.config.ts renderer/tests/app-shell.test.tsx renderer/tests/roles-panel.test.tsx
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add hesper-desktop/apps/desktop/renderer/src/App.tsx hesper-desktop/apps/desktop/renderer/src/roles-panel.tsx hesper-desktop/apps/desktop/renderer/tests/app-shell.test.tsx hesper-desktop/apps/desktop/renderer/tests/roles-panel.test.tsx
git commit -m "feat: add roles management UI"
```

---

## Task 8: 全面回归与修正联动测试

**Files:**
- Modify as needed based on failing tests from changed default tool list or preload API.

- [ ] **Step 1: 跑全量测试**

```bash
cd hesper-desktop
pnpm check
```

Expected: PASS。如果失败，优先检查以下常见联动点：

- 默认工具数量从 14 变 16 后，测试断言未同步。
- `roles.create` / `roles.update` 加入 main-agent 默认工具后，prompt assembly 或 IPC expected tool list 未同步。
- `preload.cjs` channels 或 API methods 与 `ipc-contract.ts` / `preload.ts` 不一致。
- App mock `hesperApi` 缺少 `roles` namespace。

- [ ] **Step 2: 跑 lint**

```bash
cd hesper-desktop
pnpm lint
```

Expected: PASS。

- [ ] **Step 3: 手动 smoke 路径**

```bash
cd hesper-desktop
pnpm dev
```

手动检查：

1. 点击左侧“角色”。
2. 初始没有角色时显示空状态。
3. 点击“新建角色”。
4. 输入名称、简介、提示词。
5. 勾选一个默认工具。
6. 保存后左侧列表出现角色。
7. 点击角色后右侧详情正确显示。
8. 修改名称并保存。
9. 删除角色时出现确认，确认后角色消失。

- [ ] **Step 4: 提交任何测试修正**

如果 Task 8 发现并修复联动问题：

```bash
git add <changed-files>
git commit -m "test: align role management integration"
```

如果没有修正文件，不创建提交。

---

## Task 9: 最终完成流程

**Files:**
- Check: all changed files

- [ ] **Step 1: 查看状态**

```bash
git status --short --branch
```

Expected: 只有已提交变更；工作区干净。

- [ ] **Step 2: 最终验证**

```bash
cd hesper-desktop
pnpm check
pnpm lint
```

Expected:

- `pnpm check` PASS。
- `pnpm lint` PASS。

- [ ] **Step 3: 使用完成分支技能**

使用 `superpowers:finishing-a-development-branch`。按用户选择处理：合并、保留、推送 PR 或丢弃。

---

## 自查清单

- [ ] 覆盖设计文档中的角色 CRUD。
- [ ] 覆盖 Agent 创建/更新角色工具。
- [ ] 明确不提供 Agent 删除工具。
- [ ] 明确不接入会话运行。
- [ ] 每个实现任务都有失败测试、实现、验证和提交。
- [ ] 所有新增 IPC 都同步到 preload.ts、preload.cjs、renderer fallback。
- [ ] Roles 页面替换 “Roles 即将支持”。
- [ ] 最终运行 `pnpm check` 和 `pnpm lint`。
