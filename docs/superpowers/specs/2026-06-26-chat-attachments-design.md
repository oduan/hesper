# 对话图片与文件输入设计

日期：2026-06-26

## 目标

为 Hesper 对话输入增加附件能力：用户可以粘贴或拖拽图片、TXT、Markdown、HTML 文件到输入框；发送后用户消息上方显示附件缩略图或文件 chip；模型调用时根据模型图片能力决定是否发送图片，文本附件以文本上下文提供给模型。

## 范围

本设计覆盖：

- Composer 中的图片粘贴、文件拖拽、附件预览、删除附件。
- 用户消息中的附件展示。
- 图片和文本附件的本地文件落盘。
- 数据库仅保存附件元数据和相对路径。
- 模型图片输入能力判断与切换模型时的显示/发送过滤。
- Renderer、IPC、main process、persistence、agent runtime、pi-core adapter 的端到端传递。
- 自动化测试策略。

不覆盖：

- 音频、视频、PDF、Word、Excel 等文件类型。
- 历史图片在后续轮次自动重复发送给模型。
- 附件导出、附件管理器、附件压缩或云同步。

## 交互设计

### Composer 布局

保持现有 Composer 样式和结构不变：

- 外层 `section` 继续使用现有圆角、背景、padding、grid 布局。
- `textareaStyle` 保持 `background: 'transparent'`、`border: 0`、`borderRadius: 0`。
- 底部工作区按钮、模型选择、思考强度、发送/停止按钮不改变样式。

只在 textarea 所在 `editorWrapperStyle` 上方新增附件预览区域：

```tsx
{visibleAttachments.length > 0 ? (
  <ComposerAttachmentPreview attachments={visibleAttachments} onRemove={...} />
) : null}
<div style={editorWrapperStyle}>...</div>
```

### 图片粘贴

用户在输入框中粘贴图片时：

1. 从 `clipboardData.items` 读取 `image/*`。
2. 生成草稿附件对象并用 object URL 或 data URL 做当前输入框预览。
3. 图片缩略图显示在 textarea 上方。
4. 图片缩略图不显示文件名。
5. 图片只显示右上角一个 `×` 按钮。
6. 点击 `×` 从草稿附件中移除；被移除的图片不会发送。

如果当前模型不支持图片：

- 图片仍保留在草稿附件状态中。
- 图片在 UI 中静默隐藏。
- 发送时图片不会进入 IPC payload，也不会传给模型接口。
- 切回支持图片的模型后，图片重新显示，并且发送时会带上。

### 拖拽文件

用户拖动文件到 Composer 区域上方时：

- Composer 整体区域轻微高亮。
- 显示提示文案：`松开即可添加附件`。
- 松开后读取支持的文件类型。

支持类型：

- 图片：`image/*`
- 文本：`.txt`, `.md`, `.markdown`, `.html`, `.htm`

不支持的文件类型不加入附件。可用轻量提示说明暂不支持。

### 附件预览

图片附件：

- 在 Composer 顶部显示小缩略图。
- 不显示文件名。
- 仅显示右上角删除 `×`。

文本附件：

- 显示为文件 chip。
- 显示文件名。
- 显示删除 `×`。

### 发送按钮启用规则

发送按钮在以下情况启用：

- 文本输入非空。
- 或存在当前模型可发送的附件。

如果草稿里只有图片，且当前模型不支持图片，发送按钮保持不可用。若同时有文本内容或文本附件，则可以发送，但图片会被静默排除。

### 用户消息展示

`MessageBubble` 保持现有消息气泡样式。仅在用户消息正文上方新增附件展示：

- 图片：小缩略图，不显示文件名。
- 文本：文件 chip，显示文件名。
- 正文、时间戳、布局方向保持现状。

## 附件数据设计

### 持久化附件类型

在 `@hesper/shared` 中新增：

```ts
export type MessageAttachmentKind = 'image' | 'text'

export type MessageAttachment = {
  id: string
  kind: MessageAttachmentKind
  name: string
  mimeType: string
  bytes: number
  relativePath: string
}
```

`Message` 增加：

```ts
attachments?: MessageAttachment[]
```

说明：

- 图片和文本文件都落盘为文件。
- 数据库只保存 `relativePath` 和元数据。
- 图片 `name` 仅用于调试、可访问性或未来导出；UI 不显示图片名。

### 文件存储位置

附件文件存储在 Electron `userData` 目录下：

```txt
<userData>/
  hesper.sqlite
  attachments/
    <sessionId>/
      <messageId>/
        <attachmentId>.png
        <attachmentId>.md
```

`relativePath` 示例：

```txt
attachments/session_1/message_1/attachment_abc.png
```

### 数据库字段

`messages` 表新增：

```sql
attachments_json TEXT
```

读写规则：

- 无附件时保存为 `NULL` 或空字段。
- 读取旧消息时 `attachments` 为 `undefined`。
- 读取有附件消息时解析为 `MessageAttachment[]` 并通过 zod schema 校验。

### 草稿附件类型

Renderer 中草稿附件保留临时内容，用于预览和发送 IPC：

```ts
type ComposerDraftAttachment =
  | {
      id: string
      kind: 'image'
      name: string
      mimeType: string
      bytes: number
      dataUrl: string
      objectUrl?: string
    }
  | {
      id: string
      kind: 'text'
      name: string
      mimeType: string
      bytes: number
      content: string
    }
```

草稿附件按 session 保存：

```ts
draftAttachmentsBySession: Record<string, ComposerDraftAttachment[]>
```

发送成功后清空当前 session 草稿附件。

## 附件文件服务

在 Electron main process 新增附件存储服务，例如 `apps/desktop/electron/attachment-storage.ts`。

职责：

- 根据 `sessionId`、`messageId`、临时附件 payload 写入文件。
- 返回可持久化的 `MessageAttachment[]`。
- 读取图片附件为 data URL，供历史消息缩略图显示。
- 删除某条 message 的附件目录，用于发送失败清理。
- 对 `relativePath` 做安全校验，只允许访问 `<userData>/attachments` 下的文件。

安全要求：

- 禁止绝对路径。
- 禁止 `..` 路径穿越。
- `path.resolve(attachmentRoot, relativePath)` 必须仍在 `attachmentRoot` 内。
- data URL 读取只允许图片附件。

## 模型图片能力判断

### 新能力值

`ModelCapability` 增加：

```ts
'imageInput'
```

同步更新：

- `packages/shared/src/domain.ts`
- `packages/shared/src/schemas.ts`
- `packages/persistence/src/repositories.ts`
- `apps/desktop/electron/ipc-contract.ts`
- `packages/app-core/src/model-provider-service.ts`
- renderer fallback/mock model 数据

### 集中能力模块

新增共享模块：

```txt
hesper-desktop/packages/shared/src/model-capabilities.ts
```

导出：

```ts
export function inferModelCapabilitiesFromName(input: {
  modelId: string
  modelName?: string
  providerId?: string
  providerKind?: ModelProviderKind
  existingCapabilities?: ModelCapability[]
}): ModelCapability[]

export function supportsImageInput(input: {
  modelId: string
  modelName?: string
  providerId?: string
  providerKind?: ModelProviderKind
  capabilities?: ModelCapability[]
}): boolean
```

### 判断优先级

1. 显式配置优先：`capabilities` 包含 `imageInput` 才认为支持。
2. 新建/导入模型时通过 `inferModelCapabilitiesFromName()` 自动补能力。
3. runtime 二次保护：只有 `resolved.model.input.includes('image')` 且模型配置包含 `imageInput` 时才真正传图片。

### 预置规则

默认支持图片：

- OpenAI：`gpt-4o`, `gpt-4.1`, `gpt-5`, `gpt-5.x`, `gpt-5.5`，以及名称含 `vision`, `omni`, `multimodal` 的模型。
- Gemini：`gemini-*`。
- Claude：`claude-3*`, `claude-4*`, `claude-5*`。
- Kimi：`kimi-k2.6`, `kimi-k2p6`，以及名称含 `vision`, `vl`, `image` 的 Kimi 模型。
- GLM：仅名称含 `vision`, `vl`, `image` 的 GLM 模型默认支持。
- 其他：名称含 `vision`, `vl`, `image`, `multimodal`, `omni` 时默认支持。

默认不支持图片：

- DeepSeek：`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-chat`, `deepseek-reasoner`。
- 普通 GLM：如 `glm-4.7`, `glm-5`。
- 普通纯文本/代码/推理模型：如 `coder`, `reasoner`, `r1`，除非同时满足明确图片关键词或显式配置。

## 发送链路设计

### Renderer 发送

`ComposerSendOptions` 增加临时附件字段：

```ts
draftAttachments?: ComposerDraftAttachment[]
```

Renderer 发送前根据当前模型能力过滤：

- 图片：仅当前模型支持图片时进入 payload。
- 文本：始终进入 payload。

### IPC payload

`agent.enqueue` schema 增加临时附件字段：

```ts
draftAttachments?: Array<
  | { kind: 'image'; name: string; mimeType: string; bytes: number; dataUrl: string }
  | { kind: 'text'; name: string; mimeType: string; bytes: number; content: string }
>
```

这些临时内容只用于 main process 写文件，不进入数据库。

### Main process 顺序

`agent.enqueue` handler 调整为：

1. 解析 IPC payload。
2. 根据 `messageId` 和 `sessionId` 写附件文件。
3. 得到 `MessageAttachment[]`。
4. 调用 `agentRuntime.enqueue()`，传入附件 metadata 和附件根路径。
5. runtime enqueue 失败时删除 `attachments/<sessionId>/<messageId>/` 并抛错。
6. runtime enqueue 成功后创建用户消息，写入附件 metadata。
7. 用户消息写入失败时删除附件目录，并调用 `agentRuntime.failRun()`。
8. 成功后触发 persistence save。

### AgentRuntime 输入

`EnqueueRunInput` 增加：

```ts
attachments?: MessageAttachment[]
attachmentRootPath?: string
```

队列中的 run entry 也保存这些字段，保证排队运行时附件仍可读取。

### PiCoreAgentAdapter 输入

`AgentPromptInput` 增加：

```ts
attachments?: MessageAttachment[]
attachmentRootPath?: string
```

adapter 处理：

- 文本附件：读取 UTF-8 内容，拼入 prompt 的附件段落。
- 图片附件：模型支持图片时读取文件并转为 base64，传给 `agent.prompt(prompt, images)`。

已确认 `pi-agent-core` 支持：

```ts
prompt(input: string, images?: ImageContent[]): Promise<void>
```

图片内容格式：

```ts
{ type: 'image', data: base64, mimeType: attachment.mimeType }
```

### 当前轮与历史轮

当前发送轮次：

- 支持图片模型收到图片附件。
- 不支持图片模型不会收到图片附件。
- 文本附件会作为文本上下文追加到 prompt。

历史消息：

- 默认不重复发送历史图片，避免重复上传和费用膨胀。
- 历史消息可在文本上下文中保留轻量提示，例如 `[该消息包含 1 张图片附件]`。

## 限制与错误处理

第一版限制：

- 图片单个最大 10MB。
- 文本文件单个最大 1MB。
- 支持图片 MIME：`image/*`。
- 支持文本后缀：`.txt`, `.md`, `.markdown`, `.html`, `.htm`。

错误处理：

- 不支持文件类型：不加入附件，并给轻量提示。
- 文件过大：不加入附件，并给轻量提示。
- 附件写盘失败：发送失败，显示现有发送错误。
- runtime enqueue 失败：删除本次 message 附件目录。
- 用户消息写库失败：删除本次 message 附件目录并标记 run failed。
- 缩略图读取失败：显示占位，不影响消息正文。

## 测试策略

### Shared

- `messageAttachmentSchema` 校验 image/text 附件。
- `modelConfigSchema` 接受 `imageInput`。
- `supportsImageInput()`：
  - GPT-5.5 返回 true。
  - Gemini 返回 true。
  - Claude 返回 true。
  - DeepSeek V4 Flash / Pro 返回 false。
  - 普通 GLM 返回 false。
  - GLM vision / VL 返回 true。

### UI

- 粘贴图片后 Composer 顶部出现缩略图。
- 图片缩略图不显示文件名，只显示一个 `×`。
- 点击 `×` 后图片移除。
- 当前模型不支持图片时，图片静默隐藏。
- 切回支持图片模型后，图片重新显示。
- 拖拽文件时显示 `松开即可添加附件`。
- 仅有不可发送图片时，发送按钮不可用。

### Renderer/App

- 发送时过滤不可发送图片。
- 文本附件始终进入 payload。
- optimistic 用户消息带实际发送附件 metadata。
- 发送失败时恢复现有错误行为。

### Electron main

- 附件写入 `<userData>/attachments/<sessionId>/<messageId>/`。
- 数据库只保存 `relativePath` 和元数据。
- runtime enqueue 失败时删除附件目录。
- 用户消息写入失败时删除附件目录并 fail run。
- `attachments.readDataUrl` 阻止路径穿越。

### Agent Runtime

- 支持图片模型调用 `agent.prompt(prompt, images)`。
- 不支持图片模型调用 `agent.prompt(prompt)`。
- 文本附件内容拼入 prompt。
- 排队 run 保留附件 metadata 和附件根路径。

## 实施方式

实现时使用：

- 独立 git worktree。
- subagent-driven development：每个任务由新 subagent 实现，并进行 spec 合规审查与代码质量审查。
- TDD：每个行为先写失败测试，再实现。

## 自审结论

- 设计没有把图片或文本内容写进数据库；数据库仅保存 metadata 与 `relativePath`。
- UI 设计明确保持现有 Composer 样式，仅新增顶部附件预览区域。
- 模型能力判断集中在共享模块，避免分散硬编码。
- runtime 有二次保护，不会向不支持图片的模型接口发送图片。
- 文件失败清理路径明确，避免 orphan 附件目录。
- 历史图片默认不重复发给模型，避免不可控成本。
