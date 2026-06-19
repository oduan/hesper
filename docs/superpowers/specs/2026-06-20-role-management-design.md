# 角色管理功能设计

日期：2026-06-20

## 背景

Hesper Desktop 当前已经在一级导航中预留了 `roles` 页面，但还没有角色管理功能。现有代码中也已经存在内部运行用的 `Role` 类型、`roles` 持久化表和 `RoleRepository`，但当前 `createDefaultRoleService()` 主要服务运行时默认角色（例如 `main-agent` / `worker-agent`）。

本设计只实现用户可见的角色管理能力，不把角色接入会话运行流程。后续可以在创建会话或会话设置中选择角色，并让角色的提示词和默认工具影响 Agent 运行。

## 已确认的产品决策

1. 不提供内置用户角色。
2. 不区分内置角色和自定义角色。
3. Roles 页面中的所有角色都由用户创建。
4. 所有用户创建的角色都可以编辑和删除。
5. 删除角色只能通过 Roles 页面手动完成。
6. Agent 工具只提供创建和更新角色，不提供删除角色工具。
7. 本阶段只做角色管理 UI、IPC、持久化和 Agent 可调用工具；暂不接入会话运行。

## 目标

实现一个可用的 Roles 页面和角色管理 API，使用户可以：

- 查看角色列表。
- 创建角色。
- 编辑角色名称、简介、完整提示词和默认工具。
- 删除角色。
- 让 AI Agent 通过工具创建或更新角色。

## 非目标

本阶段不实现以下内容：

- 创建会话时选择角色。
- 会话运行时使用角色提示词。
- 会话运行时使用角色默认工具。
- 内置只读角色。
- Agent 删除角色工具。
- 未保存修改离开页面时的确认弹窗。

## 用户可见角色模型

页面和 IPC 使用专门的 Role DTO，避免把内部运行角色的全部字段暴露给 UI：

```ts
export type ManagedRoleDto = {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultToolIds: string[]
}
```

字段含义：

- `id`：角色 ID。
- `name`：角色名称，列表和详情中显示，必填。
- `description`：角色简介，列表中显示，可为空字符串。
- `systemPrompt`：完整提示词，可为空字符串。
- `defaultToolIds`：该角色默认可使用的工具 ID 列表。

## 持久化设计

使用现有 `roles` 表保存用户定义角色，不新增数据库表。

现有共享 `Role` 类型包含更多运行时字段。保存用户定义角色时使用固定默认值：

```ts
{
  id,
  name,
  description,
  systemPrompt,
  defaultToolIds,
  allowedSkillIds: [],
  defaultSkillIds: [],
  canBeMainAgent: true,
  canBeWorkerAgent: false,
  canBeAssignedToWorkerAgent: false
}
```

需要扩展 `RoleRepository`：

```ts
export type RoleRepository = {
  save(role: Role): Promise<void>
  get(id: string): Promise<Role | undefined>
  list(): Promise<Role[]>
  delete(id: string): Promise<void>
}
```

删除使用：

```sql
DELETE FROM roles WHERE id = ?
```

## App Core 服务设计

新增 `role-management-service.ts`，作为用户可见角色的业务层。

职责：

- 把数据库 `Role` 转换成 `ManagedRoleDto`。
- 创建角色。
- 更新角色。
- 删除角色。
- 校验输入。
- 校验 `defaultToolIds` 都来自当前工具目录。

建议接口：

```ts
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
```

校验规则：

- `name` 创建时必填，trim 后不能为空。
- `name` 更新时如果传入，trim 后不能为空。
- `description` 未传入时保存为空字符串。
- `systemPrompt` 未传入时保存为空字符串。
- `defaultToolIds` 未传入时保存为空数组。
- `defaultToolIds` 中每个 ID 必须存在于 `ToolCatalogService`。
- 更新或删除不存在的角色时返回明确错误。

## IPC 设计

在 `ipc-contract.ts` 新增 channel：

```ts
rolesList: 'roles:list'
rolesCreate: 'roles:create'
rolesUpdate: 'roles:update'
rolesDelete: 'roles:delete'
```

新增 schema：

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

在 `HesperDesktopApi` 新增：

```ts
roles: {
  list(): Promise<ManagedRoleDto[]>
  create(input: CreateRoleInput): Promise<ManagedRoleDto>
  update(input: UpdateRoleInput): Promise<ManagedRoleDto>
  delete(id: string): Promise<{ deleted: true; id: string }>
}
```

在 `preload.ts` 和 renderer fallback API 中同步新增 roles API。

## Agent 可调用工具设计

新增两个内置工具：

1. `roles.create`
2. `roles.update`

不提供 `roles.delete`，删除只能通过 Roles 页面手动确认执行。

### `roles.create`

定义：

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
      name: { type: 'string' },
      description: { type: 'string' },
      systemPrompt: { type: 'string' },
      defaultToolIds: { type: 'array', items: { type: 'string' } }
    }
  }
}
```

### `roles.update`

定义：

```ts
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
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      systemPrompt: { type: 'string' },
      defaultToolIds: { type: 'array', items: { type: 'string' } }
    }
  }
}
```

工具执行需要 app 层注入回调。扩展 `BuiltinToolExecutorOptions`：

```ts
export type RoleToolHandlers = {
  createRole(input: CreateManagedRoleInput): Promise<ManagedRoleDto>
  updateRole(input: UpdateManagedRoleInput): Promise<ManagedRoleDto>
}
```

`service-container.ts` 创建 builtin executor 时传入 `roleManagementService.createRole` 和 `roleManagementService.updateRole`。

默认工具配置：

- 将 `roles.create` 和 `roles.update` 加入主 Agent 默认工具列表。
- 不加入 Worker Agent 默认工具列表。

## Roles 页面 UI 设计

使用当前已经预留的一级导航 `roles`。

### 左侧列表

- 顶部标题：角色。
- 顶部按钮：新建角色。
- 每行显示：角色名称 + 角色简介。
- 选中角色后右侧显示详情。
- 无角色时显示空状态：提示用户创建第一个角色。

### 右侧详情编辑

字段：

- 角色名称。
- 角色简介。
- 完整提示词。
- 默认工具多选。

操作：

- 保存修改。
- 删除角色。

### 新建流程

点击“新建角色”后显示空白草稿表单：

- 名称为空。
- 简介为空。
- 提示词为空。
- 默认工具为空数组。

保存成功后：

- 角色写入数据库。
- 刷新角色列表。
- 自动选中新角色。

### 修改流程

用户修改字段后点击“保存修改”。保存成功后：

- 刷新角色列表。
- 保持当前角色选中。

本阶段不做未保存修改离开确认。

### 删除流程

点击“删除角色”后使用浏览器确认框或现有确认交互：

- 用户确认后删除。
- 删除成功后刷新列表。
- 自动选中下一个角色；如果没有角色，则显示空状态。

## 与现有运行时角色的关系

当前 `main-agent` / `worker-agent` 运行时角色继续保留在 `createDefaultRoleService()` 中，暂不在 Roles 页面展示，也不由 Roles 页面管理。

本阶段新增的是“用户可见角色管理”。它使用现有 `roles` 表保存用户定义角色，但暂不影响：

- Prompt 组装。
- Agent enqueue。
- Worker Agent 选择。
- 会话默认工具。

后续接入会话运行时，可以再把用户定义角色接入 `session.roleId` 和 prompt assembly。

## 测试计划

### Persistence

- `roles.delete` 删除角色后 `get` 返回 undefined。
- `roles.list` 不再包含已删除角色。

### App Core

- 创建角色成功。
- 创建角色时 name 为空失败。
- 创建角色时 defaultToolIds 包含未知工具失败。
- 更新角色成功。
- 更新不存在角色失败。
- 更新角色时 name 为空失败。
- 删除角色成功。
- 删除不存在角色失败。

### Tools

- `createBuiltinToolDefinitions()` 包含 `roles.create` 和 `roles.update`。
- `roles.create` 工具调用注入 handler 并返回创建的角色。
- `roles.update` 工具调用注入 handler 并返回更新后的角色。
- 未注入 role handler 时返回可控错误。
- 不存在 `roles.delete` 工具。

### Electron IPC

- `roles:list` 返回角色列表。
- `roles:create` 保存并返回角色。
- `roles:update` 更新并返回角色。
- `roles:delete` 删除角色。
- mutating channel 调用后触发 persistence save。
- preload API 暴露 roles 方法。

### Renderer/UI

- Roles 页面不再显示“即将支持”。
- 无角色时显示空状态。
- 创建角色后列表出现新角色并选中。
- 选中角色后右侧显示详情。
- 编辑角色并保存后列表和详情更新。
- 删除角色需要确认，确认后从列表移除。
- 默认工具多选显示当前工具列表并保存选中工具。
- fallback API 支持 roles CRUD，便于 renderer 测试。

## 风险与缓解

### 风险：现有 `Role` 类型混合运行时字段和用户管理字段

缓解：UI 和 IPC 使用 `ManagedRoleDto`，服务层负责映射，避免 UI 依赖运行时字段。

### 风险：Agent 工具更新角色可能误改用户角色

缓解：不提供删除工具；更新必须明确提供角色 ID；工具调用会出现在工具调用历史中，用户可追踪。

### 风险：本阶段不接入会话运行，用户可能误以为角色会影响当前对话

缓解：Roles 页面或空状态中注明“当前版本仅管理角色，后续会接入会话使用”。

## 迁移与兼容性

- 不需要新增数据库表。
- 需要给 `RoleRepository` 增加 `delete` 方法。
- 不需要迁移已有数据。
- 现有运行时默认角色继续通过代码提供，不受 Roles 页面影响。
