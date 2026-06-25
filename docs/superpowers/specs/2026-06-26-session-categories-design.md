# 会话分类设计

日期：2026-06-26

## 背景

当前桌面端把所有会话放在同一个列表里。用户希望在最左侧“会话”入口下增加二级分类，用来切换会话范围，并能通过右键菜单把会话移动到分类中。

分类以后还会承载默认项目目录、默认模型、分类级 SOUL 等配置。本次先实现分类归属和管理，但数据模型和服务边界需要为这些配置预留空间。

## 目标

- 在最左侧“会话”下面显示“所有会话”和用户分类。
- “会话”前增加可展开/收起图标：收起为向右，展开为向下。两个图标使用相同容器、相同视觉中心和相同尺寸；向下图标需要与向右图标对齐，不出现偏心。
- 右键“所有会话”可以新建分类。
- 新建分类后立即显示在“会话”下方，自动进入重命名状态，并默认选中“新分类”三个字。
- 右键分类可以重命名或删除。
- 删除分类前二次确认。确认后删除该分类下所有会话，再删除分类。
- 右键会话增加“分类”子菜单，支持移动单个或批量选中的会话。
- 当前选中某个分类时，点击“新建会话”会直接在该分类下创建会话，不切回“所有会话”。
- “所有会话”始终包含所有分类下的会话和未分类会话。

## 非目标

- 本次不做分类排序、拖拽、颜色、图标。
- 本次不做分类默认项目目录、默认模型、分类级 SOUL 的设置 UI。
- 本次不改变现有 SOUL 的生效逻辑。
- 本次不删除任何本地文件。此前提到“文件”是口误；删除分类只删除该分类下的会话记录。

## 数据模型

新增领域类型：

```ts
export type SessionCategory = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
```

`Session` 新增可选字段：

```ts
categoryId?: string
```

数据库新增：

- `session_categories` 表：`id`、`name`、`created_at`、`updated_at`、`sort_seq`。
- `sessions.category_id` 列。

规则：

- “所有会话”是固定 UI 入口，不是数据库分类。
- `categoryId` 为空表示未分类。
- 删除分类时，服务层按 `categoryId` 找到所有未删除会话并标记为 deleted，然后删除分类记录。
- 如果后续需要分类默认配置，可以在 `session_categories` 上增加字段，如 `default_workspace_path`、`default_model_id`、`default_soul` 或 `settings_json`。本次不提前暴露这些字段到 UI。

## 服务与 IPC

新增分类服务，负责分类 CRUD 和删除分类时的级联会话删除：

- `listCategories()`
- `createCategory({ name })`
- `updateCategory({ id, name })`
- `deleteCategory(id)`：返回被删除分类和被删除会话 id 列表，便于渲染端同步状态。

会话服务增加：

- `createSession({ categoryId? })`
- `setCategory(id, categoryId?)`
- `setCategoryForSessions(sessionIds, categoryId?)`

IPC 建议分为两组：

- `sessionCategories:list`
- `sessionCategories:create`
- `sessionCategories:update`
- `sessionCategories:delete`
- `sessions:setCategory`

命名保持“分类是独立资源，会话只保存归属”的边界。后续分类默认配置仍然可以挂在 `sessionCategories:update` 上，不需要重做接口。

## 左侧导航

`ActivityRail` 接收分类数据和当前分类选择：

- `sessionCategories`
- `activeSessionCategoryId?: string`
- `sessionsExpanded`
- `onToggleSessionsExpanded`
- `onSelectSessionCategory(categoryId?: string)`
- `onCreateSessionCategory`
- `onRenameSessionCategory`
- `onDeleteSessionCategory`

展开后的层级：

1. 会话
   1. 所有会话
   2. 分类 A
   3. 分类 B

交互：

- 点击“会话”行或其图标切换展开/收起。
- 点击“所有会话”选择全部会话视图。
- 点击分类选择该分类视图。
- 分类行比“会话”缩进一档。
- 右键“所有会话”打开菜单：`新建分类`。
- 右键分类打开菜单：`重命名`、`删除`。
- 新建分类后，分类行进入编辑状态，输入框聚焦并选中“新分类”。
- 重命名分类时，输入框聚焦并选中原名称。
- 分类名为空时不提交。对于刚创建且还没有有效命名的新分类，失焦或取消会删除该空分类，避免留下无意义分类。

## 会话列表

`EntityListPane` 继续负责中间会话列表，但接收已经过滤后的 `sessions` 和标题：

- 选中“所有会话”：列表标题为“所有会话”，显示所有未删除会话。
- 选中分类：列表标题为分类名，只显示该分类下的未删除会话。

会话右键菜单增加“分类”项：

- 鼠标悬停“分类”时，右侧展开子菜单。
- 子菜单包含：`未分类` 和所有分类。
- 如果右键点击的会话已经在多选集合中，移动全部选中会话。
- 如果右键点击的会话不在多选集合中，只移动该会话。
- 移动后按当前视图重新过滤。比如在“产品图”分类中把会话移到“头像”，该会话会从当前列表消失。

## 新建会话

创建会话时使用当前分类选择：

- 当前为“所有会话”：创建未分类会话。
- 当前为某个分类：创建带 `categoryId` 的会话。

未来扩展分类默认配置时，新建会话流程可以这样叠加：

1. 读取分类。
2. 如果分类有 `defaultWorkspacePath`，写入新会话 `workspacePath`。
3. 如果分类有 `defaultModelId`，写入新会话 `defaultModelId`。
4. 如果分类有 SOUL 或其他配置，后续由 prompt 组装层处理。

本次只传 `categoryId`，不改变项目目录、模型或 SOUL。

## 删除确认

删除分类必须二次确认。确认文案包含分类名和会话数量：

```text
删除分类“产品图”？该分类下的 12 个会话也会被删除，此操作不可撤销。
```

用户确认后才调用删除接口。取消时不做任何修改。

如果当前正在查看被删除分类，删除完成后回到“所有会话”。如果当前 active session 被删除，沿用现有 reducer 逻辑选择下一个可见会话。

## 错误处理

- 分类创建失败：不进入编辑状态，并显示/记录错误。
- 分类重命名失败：恢复原分类名。
- 会话移动失败：保持原列表状态，记录错误。
- 删除分类失败：不移除分类或会话。
- 删除分类时分类不存在：服务返回明确错误，渲染端刷新分类列表后回到“所有会话”。

## 测试计划

- 共享类型和 schema：`Session` 支持 `categoryId`，新增 `SessionCategory` schema。
- 持久化：保存、读取、列出分类；保存和读取会话 `categoryId`；迁移旧数据库新增列和表。
- 服务层：创建/重命名/删除分类；删除分类会删除该分类下会话；批量移动会话到分类或未分类。
- IPC：分类 CRUD 和 `sessions:setCategory` 校验 payload，并触发持久化保存。
- UI 组件：
  - “会话”展开/收起图标尺寸和居中一致。
  - 右键“所有会话”出现“新建分类”。
  - 新建分类后输入框聚焦并选中“新分类”。
  - 右键分类有“重命名”和“删除”。
  - 会话右键菜单展示分类子菜单。
- 渲染 App：
  - 点击分类过滤会话。
  - 在分类下新建会话会带 `categoryId`。
  - 批量移动会话后当前列表正确更新。
  - 删除分类确认后删除分类和其中会话，并回到“所有会话”。
