# ChatGPT Codex Fast 模式设计

日期：2026-06-27

## 背景

Hesper 已支持通过 OpenAI OAuth 登录 ChatGPT Codex，并把该连接保存为 `chatgpt-codex` provider。用户希望这个 OAuth Codex 连接可以开启 Fast 模式：请求走 OpenAI Priority processing，获得更低延迟，同时在 UI 上清楚标识该连接处于 Fast 状态。

本设计只覆盖 ChatGPT Codex OAuth 连接，不改变普通 OpenAI API key、自定义 OpenAI-compatible、DeepSeek、Anthropic 或 mock provider 的行为。

## 已验证的底层参数

当前依赖 `@earendil-works/pi-ai@0.79.1` 中，`openai-codex-responses` 暴露并使用 `serviceTier`：

```ts
serviceTier?: ResponseCreateParamsStreaming["service_tier"]
```

实现会把它写入请求体：

```js
body.service_tier = options.serviceTier
```

OpenAI 官方 Priority processing 文档也要求在 Responses / Completions 请求中传：

```json
{ "service_tier": "priority" }
```

因此 Hesper 运行时使用内部字段 `serviceTier: 'priority'`，由依赖转换成 wire payload 的 `service_tier: 'priority'`。

注意：Fast/Priority 的计费倍率由底层 provider/usage 返回与依赖处理决定。当前依赖里大多数模型按 2x 处理，`gpt-5.5` 按 2.5x 处理。UI 不硬编码“2 倍消耗”。

## 用户可见行为

- 只有 `kind: 'pi'`、`authType: 'oauth'`、`piAuthProvider: 'openai-codex'` 的连接显示 Fast 开关。
- Fast 开启后，连接列表显示 `ChatGPT Codex ⚡`。
- Fast 开启后，连接状态行显示 `pi · Fast · 使用默认端点 · 已授权`。
- ChatGPT Codex 连接三点菜单新增一项：
  - 关闭时：`开启 Fast 模式`
  - 开启时：`关闭 Fast 模式`
- 现有菜单项保留：`重新授权`、`验证连接`、`删除`。
- 普通 API key 连接不显示 Fast 菜单项。
- Composer 模型选择里的连接分组同步显示 `ChatGPT Codex ⚡`。

## 数据模型

在 `ModelProviderConfig` 上新增可选字段：

```ts
fastModeEnabled?: boolean
```

语义：该 provider 是否请求 Fast/Priority 处理。运行时只对 ChatGPT Codex OAuth provider 生效。其他 provider 即使携带该字段，也不改变请求行为。

相关 schema：

- `packages/shared/src/domain.ts`
- `packages/shared/src/schemas.ts`
- `apps/desktop/electron/ipc-contract.ts`

`SaveModelProviderInput` 同步增加 `fastModeEnabled?: boolean`，供设置页菜单切换保存。

## 持久化

`model_providers` 表新增：

```sql
fast_mode_enabled INTEGER
```

保存和读取规则：

- `undefined` 表示关闭，不写入 UI 文案。
- `1` 表示开启。
- 旧数据库迁移后字段为 `NULL`，按关闭处理。
- `saveProvider()` merge 时保留现有值，除非输入显式传入 `fastModeEnabled`。
- `saveOAuthConnection()` 新建连接默认关闭；重新授权已有 Codex 连接时保留原 Fast 状态。

相关文件：

- `packages/persistence/src/schema.ts`
- `packages/persistence/src/repositories.ts`
- `packages/persistence/src/__tests__/repositories.test.ts`

## App core

`createModelProviderService()` 继续作为 provider 配置唯一入口。

关键规则：

- `mergeProvider()` 接收并保留 `fastModeEnabled`。
- Codex OAuth generic save 限制仍保留：不能把 Codex OAuth provider 改成 custom API provider。
- 允许同一 Codex provider 通过 generic save 更新名称、enabled、defaultModelId 和 `fastModeEnabled`。
- `saveOAuthConnection()` 保存 OAuth 凭据和模型时保留旧 provider 的 `fastModeEnabled`。

相关文件：

- `packages/app-core/src/model-provider-service.ts`
- `packages/app-core/src/__tests__/model-provider-service.test.ts`

## Renderer UI

`ProviderSettingsPanel` 负责连接列表和三点菜单。

新增 helper：

- `providerFastModeEnabled(provider)`：只对 Codex OAuth provider 且 `fastModeEnabled === true` 返回 true。
- `providerDisplayName(provider)`：Fast 开启时返回 `${provider.name} ⚡`。
- `providerMetaText(provider)`：Fast 开启时在 kind 后插入 `Fast`。

新增动作：

```ts
const toggleCodexFastMode = async (provider: ModelProviderDto) => {
  await hesperApi.providers.save({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    enabled: provider.enabled !== false,
    authType: provider.authType,
    piAuthProvider: provider.piAuthProvider,
    defaultModelId: provider.defaultModelId,
    fastModeEnabled: !provider.fastModeEnabled
  })
  await loadProviderSettings()
  await onModelRegistryChanged?.()
}
```

三点菜单中，Codex OAuth provider 的第一项为 Fast 开关，然后是现有的重新授权、验证连接、删除。

## 模型 catalog / Composer

`createSessionModelCatalog()` 生成 `ModelOptionGroup` 时，如果 provider 为 Fast Codex，就把 group label 改成 `ChatGPT Codex ⚡`。模型 option label 也使用这个 group label，例如：

```text
ChatGPT Codex ⚡/gpt-5.5
```

这样连接卡片和 Composer 模型选择器显示一致。

相关文件：

- `apps/desktop/renderer/src/model-options.ts`
- `apps/desktop/renderer/tests/model-options.test.ts`
- `packages/ui/src/conversation/ThemedSelect.tsx`（无需改结构）

## 运行时

`createRegistryModelResolver()` 在解析 provider/model 时，如果 provider 是 Fast Codex，返回额外运行时选项：

```ts
runtimeOptions: {
  serviceTier: 'priority'
}
```

`ResolvedModel` 新增：

```ts
runtimeOptions?: {
  serviceTier?: 'priority'
}
```

消费点：

- `PiCoreAgentAdapter` 不能把 `serviceTier` 作为 `AgentOptions` 直接传入，因为当前 `pi-agent-core` 的 `AgentOptions` 不暴露该字段。主 Agent 运行时应为 Fast Codex provider 创建一个 `streamFn` 包装器，在调用底层 `streamSimple(model, context, options)` 时追加 `{ serviceTier: 'priority' }`。
- `SessionTitleGenerator` 调用 `completeSimple()` 时传入同样的 `serviceTier`。
- Worker Agent 共用同一个 adapter/modelResolver，因此自动生效。

Fast 关闭或非 Codex provider 时不注入 `serviceTier`。

相关文件：

- `packages/agent-runtime/src/model-resolver.ts`
- `packages/agent-runtime/src/pi-core-adapter.ts`
- `packages/agent-runtime/src/title-generator.ts`
- `packages/agent-runtime/src/__tests__/model-resolver.test.ts`
- `packages/agent-runtime/src/__tests__/pi-core-adapter.test.ts`
- `packages/agent-runtime/src/__tests__/title-generator.test.ts`

## 测试计划

采用 TDD。新增或更新测试覆盖：

1. `@hesper/shared`
   - `modelProviderConfigSchema` 接收并输出 `fastModeEnabled`。
   - `undefined` 字段仍被清理。

2. `@hesper/persistence`
   - `model_providers.fast_mode_enabled` round-trip。
   - 旧数据库迁移后默认关闭。

3. `@hesper/app-core`
   - Codex OAuth 保存连接默认 Fast 关闭。
   - 重命名保留 Fast 状态。
   - 重新授权保留 Fast 状态。
   - 普通 provider 不产生 Codex Fast 运行时效果。

4. `@hesper/desktop` renderer
   - Codex 三点菜单显示 `开启 Fast 模式` / `关闭 Fast 模式`。
   - 点击开关调用 `providers.save()` 并刷新列表。
   - Fast 开启时连接名显示 `ChatGPT Codex ⚡`。
   - Fast 开启时状态行显示 `Fast`。
   - 普通连接不显示 Fast 菜单项。

5. `model-options`
   - Fast Codex provider 的 option group label 为 `ChatGPT Codex ⚡`。

6. `@hesper/agent-runtime`
   - Fast Codex provider 解析出 `runtimeOptions.serviceTier === 'priority'`。
   - 非 Fast Codex 或非 Codex provider 不返回该选项。
   - `PiCoreAgentAdapter` 用 `streamFn` 包装器把 `serviceTier` 注入底层 `streamSimple()`。
   - `SessionTitleGenerator` 把 `serviceTier` 传给 `completeSimple()`。

## 验证

基线已在隔离 worktree 中通过：

```text
pnpm check
63 test files passed
893 tests passed
```

实现完成后至少运行：

```bash
pnpm check
```

如果某个任务只改局部文件，先运行相关 vitest 文件，再运行完整 `pnpm check`。

## 非目标

- 不新增 project-level 或 session-level Fast 设置。
- 不为普通 OpenAI API key provider 增加 Fast 开关。
- 不在 UI 中承诺固定“2 倍消耗”。
- 不改 OAuth 授权流程、模型列表来源或 token 刷新策略。
