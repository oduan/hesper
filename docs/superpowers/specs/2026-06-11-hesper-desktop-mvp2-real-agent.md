# hesper desktop MVP2 设计规格：real agent runtime

**日期：** 2026-06-11  
**产品名：** hesper  
**桌面端目录：** `hesper-desktop/`  
**状态：** 待用户审阅  

## 1. 目标

MVP2 的目标不是“再做一个会聊天的桌面端”，而是把 hesper desktop 升级为**真实可扩展 Agent runtime**：

- 支持多模型来源：**DeepSeek、OpenAI/GPT、自定义 OpenAI-compatible endpoint**。
- 支持 API key 的安全存储与读取，避免明文落盘。
- 建立统一的 **provider / model registry**，让 UI、runtime、prompt assembly、角色系统使用同一份模型能力描述。
- 真实 Agent loop 必须基于 **`@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`**，hesper 只负责编排、注入、持久化与展示。
- 完整建立 **tools definitions + executors + permission policy**。
- 建立 **skills registry / UI / prompt 注入**。
- 建立 **roles registry / UI / prompt 注入**。
- 支持主 Agent 通过 `agent.spawn-subagent` 调起 child run。
- 子 Agent 需支持角色指定：`roleId`、`allowedToolIds`、`max depth`、`max count`。
- 引入 **PromptAssemblyService**，在主 Agent 和 subagent prompt 中清楚列出：可用工具、如何使用 subagent、如何给 subagent 分配可用角色。
- Settings UI 必须按 provider / model / tools / skills / roles / runtime 分拆，且有明确验收标准。
- 后续实现必须以 **TDD + subagent-driven task 拆分 + 每任务 review** 的方式推进。
- MVP2 必须在保留 MVP1 的 deterministic mock adapter、单会话运行骨架、现有 `AgentRuntimeEvent` 合约、测试路径与 E2E mock 路径之上新增能力；真实 runtime 是可切换/可并存的增强层，不是推翻式重写。

## 2. 非目标

MVP2 明确不做：

- 不做云端同步与账号体系。
- 不做多用户协作。
- 不做远程执行环境或 Docker 环境。
- 不做工具市场。
- 不做复杂的角色编辑 DSL。
- 不做完整的权限审计后台。
- 不做自研 Agent core。

MVP2 的重点是把“可运行的原型”升级成“可落地的真实 Agent 内核架构”，同时**不破坏 MVP1 已经验证的最小可运行基线**。

## 3. 设计原则

1. **pi core 优先**：Agent loop、tool orchestration、streaming、child run 语义优先依赖 `pi-agent-core` / `pi-ai`。
2. **hesper 只做编排层**：不要把 provider、prompt、权限、工具、角色逻辑散落在 UI 里。
3. **统一 registry**：provider、model、tool、skill、role 都通过 registry 暴露，不允许各模块私有一份。
4. **安全优先**：API key 不明文保存；默认最小权限；工具执行受 policy 控制；任何 renderer、prompt assembly、IPC 返回值、logs/runtime events/test snapshots 都不得接触原始 API key 或可还原密钥数据。
5. **prompt 可解释**：主 Agent 与 subagent 的 prompt 必须显式列出可用工具、可用角色和调用规则。
6. **子任务可拆分**：所有复杂实现都应拆成小任务，由 subagent 先调研/实现/回归，再由主 Agent review。
7. **兼容优先**：MVP2 通过“保留 mock baseline + 新增真实 runtime/切换路径”演进，禁止把 MVP1 deterministic mock adapter、现有事件合约和 mock E2E 路径删掉或改成不可回退形态。

## 4. 核心架构决策

采用 **模块化内核 + 真正的 Agent runtime**。

- Electron 负责窗口、preload、IPC、系统能力桥接。
- UI 负责展示、输入、设置编辑、状态可视化。
- `app-core` 负责 registry、设置、会话状态与运行编排。
- `agent-runtime` 负责把 `pi-agent-core` 的流与事件，转成 hesper 的 run / step / message / child run 事件。
- `prompt-assembly` 负责把当前 session、角色、skills、tools、权限策略、subagent 规则，组装成主 Agent / child Agent prompt。
- `persistence` 负责本地持久化，不让 UI 或 runtime 直接接触底层存储实现。

```mermaid
graph LR
    UI[Settings / Chat UI] --> Core[app-core registries]
    Core --> Prompt[PromptAssemblyService]
    Core --> RT[agent-runtime]
    RT --> Pi[@earendil-works/pi-agent-core / pi-ai]
    Pi --> Providers[DeepSeek / OpenAI / OpenAI-compatible]
    Pi --> Tools[Tool executor bridge]
    Pi --> Child[agent.spawn-subagent]
    Core --> Store[(Local persistence)]
    RT --> Store
```

## 5. 多模型来源与 provider/model registry

### Provider 范围

MVP2 至少支持：

- **DeepSeek**
- **OpenAI / GPT**
- **自定义 OpenAI-compatible endpoint**

### Registry 要求

provider/model registry 必须统一提供：

- provider id、名称、类型、base URL、可用性状态
- 模型 id、展示名、上下文长度、价格/标签（可选）、能力标签
- 是否支持流式输出、工具调用、子 agent 调用
- 是否允许作为默认主模型 / subagent 模型
- provider 与 model 的关联关系

### 规则

- UI 选择的不是“散落的字符串”，而是 registry 里的可选项。
- 主 Agent 与 subagent 可用模型来源必须来自同一 registry。
- 自定义 endpoint 必须按 OpenAI-compatible 协议描述，避免单独实现一套模型分支。
- registry 的能力字段必须服务于 prompt assembly 和 permission policy，而不是只给 UI 显示。

## 6. API key 安全存储

### 要求

- API key 不能以明文写入设置文件。
- 优先使用操作系统安全存储能力；如需 fallback，必须至少采用本地加密封装。
- UI 只能显示“已连接 / 未连接 / 需要重新授权”状态，不能直接回显完整 key。
- provider 配置和密钥存储必须解耦：密钥只保存引用和状态。
- `renderer`、`prompt assembly`、IPC 返回值、日志、runtime events、测试快照都绝不接触原始 API key；只有 `main/app-core` 内部的 credential vault 受控 provider client 构造路径可以读取明文，读取后必须立即脱敏，不得落日志、不进 prompt、不回传 UI。

### 体验

- 用户可在 Settings 中为每个 provider 配置 API key。
- 可按 provider 独立测试连接。
- 失效时只显示该 provider 的错误状态，不影响其他 provider。

## 7. 工具 definitions + executors + permission policy

### Tool 三层模型

1. **Tool Definition**：
   - `id`、`name`、`description`、`inputSchema`、`category`、`display hints`
2. **Tool Executor**：
   - 真正执行工具逻辑的实现
3. **Permission Policy**：
   - 决定某个 run / role / subagent 是否可调用某个工具

### 规则

- definitions 与 executors 必须解耦。
- **强约束执行顺序：先 PermissionPolicy 校验，再执行 ToolExecutor，再创建 child run / 返回 tool result。**
- policy 先判定，再执行；未经授权的工具不得进入 executor，也不得进入 subagent prompt。
- 工具调用结果必须进入步骤流和持久化事件。
- 失败工具调用必须可见、可追踪、可复用到重试。
- `pi-agent-core` 发起的 tool call 必须经过 Hesper policy gate；未经授权的调用必须被拒绝并转成可见失败事件。

### 权限维度

- 主 Agent / subagent
- roleId
- allowedToolIds
- session 级别
- workspace 级别
- 风险级别（例如文件修改、命令执行、网络请求）

## 8. skills registry / UI / prompt 注入

### Registry

skills registry 需要统一描述：

- skill id、名称、描述、来源（builtin / workspace / project）
- 路径或内容源
- 是否可注入 prompt
- 是否可被 role 允许/禁止

### UI

Settings / skill 页面要支持：

- 浏览已发现的 skills
- 查看来源与内容摘要
- 标识可用性、冲突、缺失文件
- 让用户知道当前会话哪些 skills 会被注入

### Prompt 注入

- `PromptAssemblyService` 要把已启用 skills 以结构化方式注入 prompt。
- 不能把全部 skill 原文无差别堆进 prompt；要有摘要、规则和选择机制。

## 9. roles registry / UI / prompt 注入

### Registry

role registry 需要统一描述：

- `roleId`、名称、描述
- `defaultModelId`
- `allowedToolIds`
- `allowedSkillIds`
- 是否可作为主 Agent
- 是否可作为 subagent
- 允许的最大深度 / 最大数量

### UI

- 角色列表页可查看内置与自定义角色。
- 角色详情页可见允许的工具、skills、模型和 subagent 范围。
- 主 Agent 与 subagent 选择角色时，必须展示权限差异。

### Prompt 注入

- 主 Agent prompt 中必须说明当前 role 的职责、可用工具、可调起的 subagent 范围。
- subagent prompt 中必须说明它的角色边界、允许工具、深度与数量限制。

## 10. subagent 设计

### 调用方式

主 Agent 必须通过 `agent.spawn-subagent` 调 child run，而不是把 subagent 当普通工具调用。

### 子 Agent 入参

至少包含：

- `roleId`
- `allowedToolIds`
- `maxDepth`
- `maxCount`
- 目标任务描述
- 可继承上下文摘要

### 约束

- 子 Agent 不得超出允许的工具集合。
- 子 Agent 不能无限递归生成 child run。
- 主 Agent 必须知道什么时候该分配给 subagent、什么时候自己完成。
- child run 的事件流必须能回传到主线程并可视化为树结构。

## 11. PromptAssemblyService

PromptAssemblyService 是 MVP2 的关键中枢，且必须先行接口化、分层落盘，避免后续 provider / tool / role / subagent 反复耦合同一文件。

### 输入

- 会话上下文
- 主/子角色信息
- provider/model registry 结果
- 当前可用工具与权限策略
- skills registry 结果
- subagent 调用规则
- 运行深度、层级、历史摘要

### 输出

- 主 Agent prompt
- subagent prompt
- system instructions
- tool list
- subagent usage rules
- role assignment rules

### 最小接口草图

```ts
type PromptAssemblyInput = {
  sessionId: string
  roleId: string
  modelId: string
  depth: number
  parentRunId?: string
  allowedToolIds: string[]
}

type PromptAssemblyOutput = {
  systemPrompt: string
  toolManifest: string
  subagentRules: string
}
```

### 必须在 prompt 中显式写清楚

- 你能用哪些工具
- 每个工具如何调用
- 哪些工具不可用
- 什么时候调用 subagent
- 如何为 subagent 指定 roleId
- 如何限制 allowedToolIds / maxDepth / maxCount
- 如何引用 skills

## 12. Settings UI 拆分与验收

### 最小 registry / vault / service 接口草图

```ts
type ProviderRegistry = {
  listProviders(): ProviderSummary[]
  getProvider(providerId: string): ProviderSummary | undefined
}

type CredentialVault = {
  getSecretRef(providerId: string): string | undefined
  resolveForClient(providerId: string): Promise<{ apiKey: string }>
}

type ToolRegistry = {
  listDefinitions(roleId?: string): ToolDefinition[]
  getExecutor(toolId: string): ToolExecutor | undefined
}

type SubagentService = {
  spawn(input: { roleId: string; allowedToolIds: string[]; maxDepth: number; maxCount: number }): Promise<string>
}
```

Settings UI 需拆分为清晰模块：

- Provider & API Keys
- Model Registry
- Tools & Permissions
- Skills
- Roles
- Runtime / Agent Behavior
- Appearance / App-level settings

### 验收

- 每个模块都能独立打开和保存。
- provider 密钥配置与 model 选择解耦。
- role、skill、tool 的可见信息明确且不混乱。
- 能清晰区分“系统默认”和“当前会话覆盖”。
- 所有 settings 的变更会正确影响 prompt assembly。

## 13. TDD / subagent-driven task 拆分

后续实现必须遵守：

1. 每个任务先写测试或验证标准。
2. 任务拆小，单次只做一个薄切面。
3. 每个任务最好先交给 subagent 调研/草拟，再由主 Agent review。
4. 主 Agent 只在接口、数据流和验收标准明确后合并。
5. 每个任务完成后都要有独立检查与提交。

## 14. MVP2 验收标准

MVP2 完成时应满足：

- 能配置至少 3 类 provider：DeepSeek、OpenAI/GPT、自定义 OpenAI-compatible endpoint。
- API key 安全存储，不明文落盘。
- provider/model registry 可驱动 UI、runtime 与 prompt assembly。
- 主 Agent 真实运行于 `pi-agent-core` / `pi-ai`。
- 工具定义、执行器与权限策略可分层工作。
- skills 与 roles 能进入 registry、UI 和 prompt。
- 主 Agent 可通过 `agent.spawn-subagent` 创建 child run。
- 子 Agent 可按 `roleId`、`allowedToolIds`、`maxDepth`、`maxCount` 运行。
- Settings UI 能分模块展示并正确影响运行。
- 关键路径有 TDD 覆盖，并且每个任务有独立 review 记录。
- MVP1 deterministic mock adapter、事件合约与 mock E2E 路径仍可用且可回退。
- 任何原始 API key 都不会出现在 renderer、prompt、logs、runtime events 或 test snapshots。
- tool call 的顺序必须满足：policy gate → executor → child run/result。

## 15. 风险

- provider 差异会让 registry 设计过早复杂化。
- prompt assembly 可能成为“巨型字符串拼接器”，必须尽早模块化。
- subagent 深度和权限边界若不严格，容易引入递归和权限越界。
- tools / permissions 若不分层，后续会难以扩展。
- API key 存储若没有统一抽象，后续迁移成本很高。
