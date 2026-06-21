# SOUL 设置设计规格

## 背景

Hesper 当前已有全局设置、角色提示词、工具管理和 Worker Agent 能力。SOUL 用于表达主 Agent 的身份、口吻和行为偏好，需要让用户能在设置界面直接编辑，也需要让 Agent 能通过工具查看和修改。

## 已确认约束

- SOUL 默认是空字符串。
- SOUL 是额外的主 Agent 身份设定，不替换、不删除、不削弱现有系统提示词。
- SOUL 只注入主 Agent 的 system prompt，Worker Agent 不继承。
- 设置界面不强调“额外系统提示词”，也不在描述中写“额外系统提示词”。
- UI 布局、字号、间距、颜色和控件样式参考现有设置页、外观设置面板和角色提示词编辑器。
- 实现阶段必须在独立 git worktree 中进行，并使用 subagent 驱动开发。

## 推荐方案

复用现有 `AppSettings` 和 `app_settings` 表，新增 `soul: string` 字段。

选择原因：

- 现有设置已经有 `settings:get` / `settings:update` IPC、`SettingsService`、持久化和 renderer 状态管理。
- SOUL 是全局设置，不需要单独建模成 Role，也不需要新建独立表。
- 复用当前设置更新路径能保持自动保存、乐观更新、失败回滚和测试方式一致。

## 数据模型与持久化

### `AppSettings`

`packages/app-core/src/settings-service.ts` 中的 `AppSettings` 增加：

```ts
soul: string
```

默认值：

```ts
soul: ''
```

### 数据库

`packages/persistence/src/schema.ts` 的 `app_settings` 表增加：

```sql
soul TEXT NOT NULL DEFAULT ''
```

迁移策略：

- 在 `migrationColumns.app_settings` 中加入同样的 `soul TEXT NOT NULL DEFAULT ''`。
- 旧数据库打开时自动补列。
- `toAppSettingsRecord()` 对缺失或非字符串值按空字符串处理。

### Repository

`AppSettingsRecord` 增加 `soul: string`。

`settings.save()` 插入列时包含 `soul`。

`settings.get()` 返回 `soul`，未设置时返回 `''`。

## IPC 与 Renderer API

`apps/desktop/electron/ipc-contract.ts`：

- `appSettingsSchema` 增加 `soul: z.string()`。
- `updateSettingsInputSchema` 增加 `soul: z.string().optional()`。

不新增 IPC channel。现有：

- `settings:get`
- `settings:update`

继续作为设置读取和更新入口。

Renderer 中所有 mock/fallback settings 需要同步增加 `soul: ''`，避免类型和测试不一致。

## 设置界面

### 左侧分类

`packages/ui/src/layout/EntityListPane.tsx`：

- `SettingsCategory` 增加 `'soul'`。
- 设置分类增加：
  - 标题：`SOUL`
  - aria label：`SOUL 设置`
  - 描述：`身份设定`

### 主面板

新增 `apps/desktop/renderer/src/soul-settings-panel.tsx`。

布局：

- 使用 `AppearanceSettingsPanel` 的整体结构：滚动容器、标题、说明、卡片、错误提示。
- 使用 `RolesPanel` 的 textarea 风格：边框、圆角、surface-muted 背景、inherit 字体、可 vertical resize。

文案：

- 标题：`SOUL`
- 说明：`设置主 Agent 的身份、口吻和行为偏好。`
- 字段标签：`身份设定`
- 输入提示：`写下主 Agent 的身份、口吻、原则或长期行为偏好。`

交互：

- 输入框内容来自 `settings.soul`。
- 编辑时调用 `onUpdate({ soul })`。
- 沿用 `App.tsx` 的 `updateAppSettings()` 乐观更新、失败回滚和错误提示。

## Agent 工具

新增两个内置工具，分类为 `agent`，默认参与现有工具启用/禁用机制。

### `soul.get`

- name: `Get SOUL`
- 中文显示名：`查看 SOUL`
- 入参：无
- 返回：

```json
{
  "soul": "当前 SOUL 内容"
}
```

### `soul.update`

- name: `Update SOUL`
- 中文显示名：`更新 SOUL`
- 入参：

```json
{
  "soul": "新的 SOUL 内容"
}
```

- 行为：覆盖保存当前 SOUL。
- 返回：

```json
{
  "soul": "更新后的 SOUL 内容"
}
```

### 工具执行边界

`packages/tools/src/builtin-executor.ts` 新增可选 handler：

```ts
export type SoulToolHandlers = {
  getSoul(): Promise<string>
  updateSoul(soul: string): Promise<string>
}
```

`createBuiltinToolExecutor()` 中：

- `soul.get` 调用 `getSoul()`。
- `soul.update` 校验入参 `soul` 是字符串后调用 `updateSoul(soul)`。
- 如果 runtime 未注入 handler，返回受控错误。

`apps/desktop/electron/service-container.ts` 注入：

- `getSoul`: `settingsService.getSettings()` 后返回 `settings.soul`。
- `updateSoul`: `settingsService.updateSettings({ soul })` 后返回 `settings.soul`。

## Prompt 注入

`packages/app-core/src/prompt-assembly-service.ts`：

- `MainPromptAssemblyInput` 增加可选 `soul?: string`。
- `assembleMainPrompt()` 在 `soul.trim()` 非空时，将 SOUL 追加到基础身份信息之后、工具/技能 manifest 之前。
- `assembleWorkerAgentPrompt()` 不增加 SOUL 参数，也不读取 SOUL。

建议渲染形式：

```txt
Soul: "..."
```

SOUL 文本继续通过现有 `sanitizeText()` 处理，保持敏感值遮蔽和长度限制。

`apps/desktop/electron/ipc-handlers.ts` 在主 Agent enqueue 前读取 settings，并把 `settings.soul` 传入 `assembleMainPrompt()`。

## 测试计划

### 持久化

- 保存 `soul` 后导出数据库，再重新打开仍能读回。
- 旧数据库打开后 `settings.get()` 返回 `soul: ''`。

### SettingsService

- 默认 settings 包含 `soul: ''`。
- `updateSettings({ soul })` 后新服务实例能读回。
- 并发 patch 合并时 `soul` 不丢失。

### IPC 与工具

- `settings:update` 接受并持久化 `soul`。
- 未知字段仍被拒绝。
- `toolRunner` 可执行 `soul.get` 和 `soul.update`。
- `soul.update` 后 `settingsService.getSettings()` 返回新值。

### Prompt assembly

- 主 Agent prompt 在 `soul` 非空时包含 SOUL。
- 主 Agent prompt 在 `soul` 为空或只含空白时不包含 SOUL。
- Worker Agent prompt 不包含 SOUL。

### Renderer UI

- 设置分类中出现 `SOUL`。
- 点击 `SOUL 设置` 后显示 SOUL 面板。
- 编辑文本框调用 `settings.update({ soul: ... })`。
- 保存失败沿用现有设置错误提示。

## 非目标

- 不做按 session/workspace 的 SOUL 覆盖。
- 不做 SOUL 历史版本。
- 不把 SOUL 建模成 Role。
- 不改变 Worker Agent prompt。
- 不改变现有角色提示词、技能提示词和工具 manifest 的优先级关系。

## 自检结果

- 无占位符或未决需求。
- 数据、IPC、UI、工具和 prompt 注入路径一致。
- 范围聚焦于全局 SOUL 设置，不扩展到历史、会话覆盖或角色系统。
- 用户确认的文案约束已纳入 UI 设计。
