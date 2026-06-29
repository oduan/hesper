# Craft 风格 Task / Plan 质量优化设计

日期：2026-06-29

## 背景

同一模型下，Craft Agent 生成 Task / Plan 的质量通常比 Hesper 更稳定：计划更具体、执行边界更清楚、子代理任务更像可交付工作单。对比后可以看到，差距不主要来自模型能力，而来自**输入栈**：Craft 给模型提供了更完整、更高优先级、更可执行的工作流提示、文档索引、技能读取约束、会话状态和输出能力说明；Hesper 当前提示更偏安全与工具清单，缺少足够强的“如何计划、如何分解、如何验收、如何展示”的产品化指导。

本设计基于 Craft Agents OSS 本地源码对照：

- `packages/shared/src/prompts/system.ts`
- `packages/shared/src/agent/base-agent.ts`
- `packages/shared/src/agent/core/prerequisite-manager.ts`
- `packages/shared/src/skills/storage.ts`
- `packages/shared/src/skills/types.ts`
- `packages/session-tools-core/src/handlers/skill-validate.ts`
- `packages/session-tools-core/src/tool-defs.ts`

Hesper 侧重点对照：

- `packages/app-core/src/prompt-assembly-service.ts`
- `packages/agent-runtime/src/worker-agent-service.ts`
- `packages/agent-runtime/src/pi-core-adapter.ts`
- `packages/agent-runtime/src/prompt-attachments.ts`
- `packages/tools/src/builtin-tools.ts`
- `packages/shared/src/domain.ts`
- `packages/ui/src/conversation/Composer.tsx`

本设计**暂不纳入权限体系实现**，只讨论提升计划与 Worker Agent 任务质量所需的 prompt / skill / task 输入栈优化。

## 目标

1. 让 Hesper 在同一模型下生成接近 Craft Agent 质量的计划：具体、可执行、分任务、带验收与验证。
2. 让 Worker Agent 任务输入从“简短任务描述”升级为“可独立执行的工作包”。
3. 让技能与项目上下文在计划阶段稳定生效，而不是依赖模型自觉或 UI 注入文案。
4. 保持 MVP 范围可控，不引入完整 Craft 权限系统、source 系统或预览渲染系统。

## 非目标

- 不实现 Craft Agent 的 Explore / Ask / Execute 权限模式。
- 不实现 Craft Sources、MCP source 配置、OAuth source 流程。
- 不实现 Craft 的所有 preview block 能力（datatable、html-preview、pdf-preview、image-preview、markdown-preview）。
- 不重写 Hesper 的 agent runtime 或迁移到 Craft Agent SDK。
- 不要求复制 Craft 的完整系统提示文本；只提炼影响计划质量的输入栈结构和关键规则。

## Craft 输入栈

Craft 的输入栈不是单一系统提示，而是多层上下文组合。它把“身份、工作流、文档索引、技能机制、工具使用方式、会话状态、项目上下文、日期时间、工作目录、数据展示能力、计划审批规则、子代理/LLM 分工”等都作为模型输入的一部分。

### 1. 静态系统提示：强产品化工作流

`packages/shared/src/prompts/system.ts` 中 `getCraftAssistantPrompt()` 构造 Craft 的核心系统提示。它包含：

- Craft Agent 身份与能力边界。
- External Sources 的使用/创建流程。
- Skills 的定位、读取要求和三层存储路径。
- Project Context 的读取策略。
- Configuration Documentation 索引：当修改 sources、skills、automations、themes、statuses、labels、permissions 等配置前必须先读对应文档。
- Interaction Guidelines：简洁、进度说明、破坏性操作确认、Markdown 链接、数学分隔符等。
- Permission Modes 与 SubmitPlan 工作流。
- Web Search 使用规则。
- Data Table / Spreadsheet / HTML / PDF / Image / Markdown Preview 输出能力说明。
- LLM Tool 与 Task/subagent 的职责区分。
- Browser Tools、Session Self-Management、Mermaid 图等能力说明。

这类提示给模型的不只是“有哪些工具”，而是“在什么任务类型下应该采用什么工作方式”。这会直接改善 plan：模型更容易写出带文档前置条件、验证路径、交互方式和展示方式的计划。

### 2. 动态会话上下文：日期、工作目录、会话状态、source 状态

Craft 的 Pi Agent 在每轮请求中组合：

- `getSystemPrompt(...)`：静态、可缓存系统提示。
- `sourceManager.formatSourceState()`：当前 sources 状态。
- `promptBuilder.buildStableContextParts()`：稳定上下文，例如工作区能力、工作目录。
- `promptBuilder.buildVolatileContextParts(...)`：易变上下文，例如日期时间、`<session_state>`、`plansFolderPath`、`dataFolderPath`、source state。

结果是模型始终知道：

- 当前真实时间。
- 当前工作目录。
- 当前模式。
- plan 文件应写到哪里。
- 数据文件应写到哪里。
- 当前可用/不可用 sources。

对于计划质量，`<session_state>` 尤其重要：Craft 明确告诉模型何时需要 SubmitPlan、何时可以执行、计划文件位置是什么。Hesper 当前缺少同等强度的计划工件约束。

### 3. 项目上下文发现：只列目录，不预加载内容

Craft 通过 `findAllProjectContextFiles()` 递归发现 `AGENTS.md` / `CLAUDE.md`，并在系统提示中插入：

```xml
<project_context_files working_directory="...">
- AGENTS.md (root)
- packages/foo/AGENTS.md
</project_context_files>
```

系统提示明确要求：先读 root context，再读相关子目录 context。这里的关键不是把所有内容塞进 prompt，而是把“必须读哪些 convention 文件”变成模型可见的工作流规则。

Hesper 已有 `projectContextFiles?: string[]` 和 `renderProjectContextFiles()`，但提示强度较低，且计划模板没有把“读取上下文文件”固化为计划前置步骤。

### 4. Skills：文件级技能 + 强制读取前置条件

Craft 的 skill 机制有两个关键点：

1. **三层解析和覆盖**
   - Global：`~/.agents/skills/{slug}/SKILL.md`
   - Workspace：`{workspace}/skills/{slug}/SKILL.md`
   - Project：`{projectRoot}/.agents/skills/{slug}/SKILL.md`
   - 优先级：global < workspace < project

2. **必须读取 SKILL.md，且工具调用会被拦截**
   - `base-agent.ts` 中 `extractSkillPaths()` 解析 `[skill:slug]`，解析出真实 `SKILL.md` 路径。
   - `formatSkillDirective()` 把“必须先读这些 SKILL.md”插入用户消息。
   - `PrerequisiteManager.registerSkillPrerequisites()` 注册前置条件。
   - 在读取完成前，除 Read / 精确 cat 外的工具调用会被阻止，并返回“必须先读技能文件”的提示。

这使技能不是“prompt summary”，而是**可验证已读的完整规范输入**。对于 superpowers / executing-plans / subagent-driven-development 这类技能，完整 SKILL.md 往往就是计划质量的来源。

### 5. 工具说明中内置行为模式

Craft 的工具说明和系统提示彼此配合。例如：

- `SubmitPlan` 明确是用户可见审批门，提交后会暂停运行。
- `call_llm` 明确适合批处理、结构化提取、上下文隔离、并行处理。
- `spawn_session` 明确适合并行研究、分析、草稿。
- `transform_data` 明确 20+ 行数据应写文件并用 datatable/spreadsheet 引用。
- `render_template`、预览工具、Mermaid 验证工具都有具体工作流。

计划生成时，模型会自然把这些能力编排进任务，而不仅仅列“修改文件、运行测试”。

## Hesper 输入栈

Hesper 当前输入栈主要由 `createPromptAssemblyService()` 组装，结构更轻：

### 1. 系统提示主干

`packages/app-core/src/prompt-assembly-service.ts` 的 `baseSystemLines()` 包含：

- Hesper Agent / Worker Agent 身份。
- Session、Workspace、Output mode、Role 信息。
- 安全规则。
- Skill usage rules。
- Planning approval rules。
- Interaction guidelines。
- Capability fallback rules。
- Tool-use rules。
- Search discipline rules。
- Coding workflow rules。
- Project context rules。
- Local workspace file reference rules。

这已经覆盖了很多基础纪律，但相比 Craft 有几个特点：

- 工作流规则较抽象，缺少可复制的计划结构模板。
- 文档索引较少，没有“遇到某主题先读哪个 docs”的强规则。
- 计划审批存在规则，但没有 plan 文件 / SubmitPlan 这样的强工件与暂停机制。
- 输出能力提示弱，模型不容易主动用图、表、报告结构提升计划表达。

### 2. 工具清单 Manifest

Hesper 把可用工具渲染为：

```text
- callable: filesystem_read-file
  registry id: "filesystem.read-file" (...)
  name: ...
  description: ...
```

这对安全和调用正确性有帮助，但占据大量 prompt 空间，且工具描述本身更偏 schema，而不是面向任务编排的工作流说明。

### 3. 技能 Manifest 与技能读取

Hesper 的 `Skill` 类型是：

```ts
export type Skill = {
  id: string
  name: string
  description?: string
  source: 'builtin' | 'workspace' | 'project' | 'user'
  path?: string
  sourcePath?: string
  prompt?: string
  allowedToolIds?: string[]
  enabled?: boolean
}
```

系统提示会渲染技能摘要，包含最多 1200 字 `prompt guidance`。UI Composer 在用户 `@技能` 时注入中文提示：要求先用 `skills_get` 读取完整 SKILL.md。

但当前弱点是：

- 技能 ID 以 name 为唯一标识，而不是 Craft 的 slug + tier 解析模型。
- `skills_get` 是普通工具调用，缺少 Craft 那种 pre-tool-use 强制读取门。
- manifest 里会注入截断后的 prompt guidance，模型可能误以为已经足够，不再读完整技能。
- Worker Agent 默认只继承 `session.enabledSkillIds` 和 role 允许技能；父任务里提到的技能不一定被转成 worker 的强制输入。

### 4. Worker Agent 输入

Hesper Worker Agent 的输入由两部分构成：

- systemPrompt：`assembleWorkerAgentPrompt()` 注入 role、工具、技能、边界规则、`Worker Agent task`、`Expected output`。
- user prompt：`composeWorkerPrompt(task, contextSummary)`，只包含 `Context summary` 和 `Task`。

`agent.spawn-worker-agent` 工具说明已经明确：批准后应把 Task N、write scope、expected output、acceptance criteria、verification instructions 放进 task。但这是“建议”，不是结构化强约束。

当前问题：

- Worker task 是自由文本，父代理常常只写一句话。
- `expectedOutput` 可选，且不强制包含 changed files / verification / risks。
- `contextSummary` 可选，且没有固定字段。
- Worker 没有自动获得“批准计划全文 / 当前 Task N / 不做范围 / 验收标准”的结构化包。
- Worker 系统提示没有 Craft 那样丰富的开发工作流和文档索引。

### 5. 附件与历史

Hesper 的 `PiCoreAgentAdapter` 会把文本附件渲染为：

```xml
<attachment name="..." mimeType="...">
...
</attachment>
```

Worker Agent 子运行使用空历史：`historyMessages: []`，依赖父代理传入 task / contextSummary。这有利于隔离，但对任务质量提出更高要求：父代理必须写好任务包，否则 Worker 无法恢复上下文。

## 差距原因

### 差距 1：Craft 有“计划产品说明书”，Hesper 只有“计划纪律”

Hesper 当前 Planning approval rules 规定：先读技能、最小上下文、提出 Task 1/2、等审批、批准后执行。但它没有明确一个高质量计划应该包含哪些章节、每个任务应包含哪些字段、如何标注并行/串行/Worker 可委派性、如何写验证与风险。

Craft 系统提示虽然没有单独叫“plan template”，但它通过 SubmitPlan、权限模式、数据/预览/图表/LLM/subagent 文档，把计划质量要求散布到完整工作流中。模型在计划时会自然生成更完整的执行提案。

### 差距 2：Craft 技能是“必须读取的完整文件”，Hesper 技能更像“摘要/可选工具”

Craft 的 `PrerequisiteManager` 会阻止未读技能时继续使用工具。Hesper 只提示“请先用 skills_get”，但不能保证执行顺序。对于 superpowers 类技能，未完整读取会直接导致 plan 风格退化：

- 不知道 plan 应该 task-by-task。
- 不知道 subagent-driven development 的分工模板。
- 不知道验收、回报、复核格式。

### 差距 3：Craft 的上下文分层更清楚

Craft 区分：

- 静态系统提示：稳定、长期行为规范。
- 稳定上下文：工作目录、项目上下文文件列表。
- 易变上下文：时间、session state、source state。
- 用户消息：技能读取指令、branch seed、transferred summary、附件。

Hesper 当前把较多内容合并在一个 system prompt 中，缺少 session state / plan artifact / approval artifact 这类强信号。模型不知道“计划应该落成一个被审批的工件”，因此计划更像聊天回复。

### 差距 4：Worker Agent 任务没有结构化工作包

Craft 的子代理/LLM 工具提示强调：并行、上下文隔离、结构化输出、成本优化、任务边界。Hesper 虽然有 Worker Agent 规则，但 spawn schema 里只有自由文本 `task`、可选 `expectedOutput`、可选 `contextSummary`。当主代理计划质量稍弱时，Worker 任务质量会二次衰减。

### 差距 5：Craft 提供了更丰富的“表达/验证工具心智”

Craft 明确告诉模型什么时候用 Mermaid、datatable、spreadsheet、preview、diff、transform_data、call_llm。Hesper 缺少同等级提示，导致计划输出更少图示、更少表格、更少对验证产物和审阅体验的考虑。

### 差距 6：Hesper 工具 manifest 偏调用，Craft 提示偏工作流

Hesper manifest 让模型知道“能调用什么”，Craft prompt 让模型知道“面对某类任务该怎么做”。计划质量更依赖后者。

## MVP 优化范围

MVP 目标是在不引入 Craft 权限体系的情况下，补齐对 Task / Plan 质量影响最大的输入栈。

### MVP 1：新增 Craft-style planning prompt 模块

在 `packages/app-core/src/prompt-assembly-service.ts` 增加独立渲染函数，例如：

```ts
function renderCraftStylePlanningRules(): string[]
```

建议内容：

- 计划必须包含：目标、背景/已知约束、任务列表、不做范围、验证计划、风险/回滚、Worker Agent 分工建议。
- 每个 Task 必须包含：范围、要改/要读的文件或模块、预期结果、是否可委派给 Worker、输入上下文、验收标准、验证命令。
- 如果用户已批准计划，执行必须严格映射到 Task N。
- 如果要委派 Worker，Worker task 必须包含：approved Task N、scope、write boundaries、expected output、acceptance criteria、verification、report format。
- 计划阶段不要过度实现；实现阶段不要重写计划之外内容。

这可以替换或扩展当前 `renderPlanningApprovalRules()`，但不改变权限执行机制。

### MVP 2：引入 Worker Agent Task Packet 模板

在主 Agent 的 Worker 规则和 `agent.spawn-worker-agent` description 中增加强模板。要求调用 `agent.spawn-worker-agent` 时，`task` 应尽量采用以下结构：

```text
Approved Task: Task N - <标题>
Goal:
Scope:
Allowed files / directories:
Do not touch:
Relevant context:
Steps:
Acceptance criteria:
Verification:
Expected report:
- changed files
- verification performed
- blockers
- residual risks
```

同时把 `expectedOutput` 从可随意省略的字段变成 prompt 中的强建议：实现型 Worker 必须填写。

MVP 不需要改 schema 强制 required，因为这可能影响兼容性；先通过 prompt 和测试固化。

### MVP 3：强化技能读取规则，但不做完整 pre-tool-use 拦截

短期先做 prompt 级强化：

- 在 `baseSystemLines()` 中明确：`@技能` 或用户提到 `skill:` / `superpowers` / `subagent-driven` / `executing-plans` 时，第一步必须 `skills_get`。
- 明确：manifest 中的 `prompt guidance` 只是摘要，不能替代完整 SKILL.md。
- 明确：生成计划前必须先读取相关技能。
- Worker Agent 若父任务引用技能，应在 task packet 的 Relevant context 中说明，并在 Worker 可用时让 Worker 读取同名技能。

如果已有 `skills_get` 工具可用，应计划前读取；如果不可用，应在计划中声明限制。

### MVP 4：减少技能摘要对模型的误导

当前 `renderSkillManifest()` 会注入 `prompt guidance` 的前 1200 字。建议调整为：

- 默认只显示 name / id / source / description / sourcePath。
- 对 `prompt guidance` 加强警告：“摘要不完整，不得作为完整技能执行依据”。
- 或把 prompt guidance 降到更短，仅用于选择技能，不用于执行。

这样可减少模型“看了摘要就开始做”的倾向。

### MVP 5：主 Agent 与 Worker Agent 使用同一套计划质量规则的子集

本轮不加入 Hesper 自身文档索引。计划质量改进优先依靠通用上下文读取顺序、技能读取纪律、计划输出骨架和 Worker Task Packet，而不是在系统提示中维护固定 docs/specs 路径表。

`assembleWorkerAgentPrompt()` 也应包含 Worker 版本的开发工作流：

- 先确认任务边界。
- 只读/改指定范围。
- 先读相关文件。
- 小步修改。
- 验证窄范围。
- 最终汇报 changed files / verification / blockers / risks。

当前已有类似规则，但应和 Task Packet 模板对齐，强调“父任务是批准计划的一部分”。

### MVP 6：测试 prompt 输出

更新 `packages/app-core/src/__tests__/prompt-assembly-service.test.ts`，至少覆盖：

- main prompt 包含 Craft-style planning sections。
- main Worker rules 包含 Task Packet 模板字段。
- worker prompt 包含 changed files / verification / blockers / risks。
- skill rules 明确 prompt guidance 不是完整技能。
- project context rules 要求计划前读 root context 和相关 context。

更新 `packages/tools/src/__tests__/builtin-tools.test.ts`，覆盖 `agent.spawn-worker-agent` description 包含 Task Packet 关键字段。

## 不做范围

MVP 不做以下事项：

1. **不实现 SubmitPlan 工具**
   Hesper 可以先通过对话审批和 Task N 结构提升质量，不引入 Craft 的计划文件和暂停机制。

2. **不实现 Craft 权限模式**
   不引入 Explore / Ask / Execute 的运行时拦截，不改工具权限决策。

3. **不实现技能 pre-tool-use 强制拦截**
   先用 prompt 强化技能读取。后续路线再考虑类似 `PrerequisiteManager` 的硬约束。

4. **不重构技能存储为 Craft 三层 slug 模型**
   先兼容 Hesper 现有 `Skill` 类型和 `skills.get`。

5. **不实现 source 系统与 source docs 索引，也不加入 Hesper 自身固定文档索引**
   本轮不在系统提示中维护固定 docs/specs 路径表；只保留通用 project context、技能读取、相关代码和附近测试的上下文读取顺序。

6. **不改 Worker Agent schema required 字段**
   不把 `expectedOutput` / `contextSummary` 立即改为必填，避免破坏现有调用。

7. **不加入新的 preview 渲染能力**
   Mermaid / 表格等可先作为文案建议，不要求运行时支持 Craft preview block。

## 建议实现设计

### Prompt 结构建议

Hesper main prompt 建议调整为：

```text
You are the Hesper Agent.
Session / Workspace / Role
Security rules
Craft-style planning and execution rules
Skill usage rules
Worker Agent usage rules
Project context rules
Tool-use rules
Search / coding workflow rules
Local workspace links
Available tools
Enabled skills
Worker Agent role discovery
```

把 planning rules 提前到 skill 之后、工具 manifest 之前，让模型先建立工作流再看工具列表。

### 推荐新增函数

```ts
function renderPlanQualityRules(): string[]
function renderTaskBreakdownTemplate(): string[]
function renderWorkerTaskPacketRules(): string[]
function renderSkillReadinessRules(): string[]
```

这些函数应保持纯字符串，便于单测断言。

### Worker Task Packet 推荐字段

用于主 Agent prompt 和 spawn tool description：

```text
Worker Task Packet:
- Approved task: Task N and title from the approved plan.
- Goal: one concrete outcome.
- Scope: files, directories, modules, or docs to inspect/edit.
- Write boundaries: what may be modified.
- Do not touch: explicit exclusions.
- Relevant context: summary from parent, links to plan/spec/context files.
- Steps: concise ordered steps.
- Acceptance criteria: observable completion criteria.
- Verification: exact commands/checks or explain why not practical.
- Report format: changed files, verification performed, blockers, residual risks.
```

### Plan 输出推荐结构

```text
## 目标
## 已知上下文与约束
## 执行计划
### Task 1: ...
- 范围：
- 预期结果：
- Worker Agent：可/不可，原因：
- 验证：
### Task 2: ...
...
## 不做范围
## 验证计划
## 风险与回滚
```

Hesper 的中文用户场景较多，prompt 可要求“遵循用户语言输出计划”。

## 后续路线

### Phase 1：Prompt-only 质量提升

- 加入 Craft-style planning rules。
- 加入 Worker Task Packet 模板。
- 强化技能读取提示。
- 加入上下文读取顺序和 compact plan output shape。
- 更新 prompt 单测、工具描述单测和 plan-quality golden cases。

这是最低风险版本，能最快验证同模型质量提升。

### Phase 2：技能读取硬约束

参考 Craft：

- 在 Hesper runtime 中记录当前 run 被 mention 的 skills。
- 在第一次非 `skills.get` 工具调用前检查是否已读取。
- 未读取时返回可恢复错误，引导模型先调用 `skills_get`。
- 对 Worker Agent 也支持父任务声明的 required skills。

这会显著提升 superpowers 类技能的一致性。

### Phase 3：计划工件与审批状态

可考虑引入轻量 Plan Artifact：

- main Agent 在计划阶段输出结构化 plan artifact。
- 用户批准后，runtime 把 approved plan summary 注入后续 run。
- Worker Agent spawn 自动带上 approved Task N。

不必完整复制 Craft SubmitPlan，但要让“已批准计划”成为模型输入的一等对象。

### Phase 4：Worker Agent 结构化输入

扩展 `agent.spawn-worker-agent` schema：

```ts
planTaskId?: string
scope?: string[]
writeBoundaries?: string[]
doNotTouch?: string[]
acceptanceCriteria?: string[]
verification?: string[]
```

运行时把这些字段渲染成 Worker system prompt / user prompt，减少父代理自由文本质量波动。

### Phase 5：上下文分层与缓存优化

借鉴 Craft 的 stable / volatile context 分层：

- 静态系统提示可缓存。
- workspace / project context files 属于稳定上下文。
- current time / session state / approved plan / run mode 属于 volatile context。
- attachments 独立包装。

这既提高质量，也减少重复 token 成本。

### Phase 6：表达能力提示与预览能力

逐步补充：

- Mermaid 规则与验证工具。
- 文档预览或 markdown artifact。
- 表格/数据展示规则。
- diff 展示规则。

这不会直接改变工具执行能力，但会改善计划和最终报告的可读性。

## 验收标准

MVP 完成后，同一模型在 Hesper 中面对“使用 worktree 和 subagent 执行计划”类请求时，应表现为：

1. 先读取相关技能/项目上下文，而不是直接实现。
2. 生成包含 Task N、范围、验证、不做范围、Worker 可委派性的计划。
3. 批准后 Worker Agent 的 task 是结构化工作包，而不是一句话。
4. Worker 最终回报 changed files、verification、blockers、risks。
5. 主 Agent 会复核 Worker 变更和验证结果，再继续后续任务。
6. 对权限体系没有新增行为依赖。

## 结论

Craft Agent 的 Task / Plan 质量优势主要来自输入栈工程，而不是模型差异。Hesper 当前已经具备 Worker Agent、skills、roles、tool manifest 和 project context files 的基础能力，短板在于这些能力没有被组织成足够强的计划生成协议。

MVP 应优先做 prompt-only 改造：补齐 Craft-style planning rules、上下文读取顺序、compact plan output shape、Worker Task Packet 和技能读取纪律。这样无需引入权限系统或重构 runtime，就能显著提升计划可执行性和 Worker Agent 委派质量。后续再逐步引入技能读取硬约束、批准计划 artifact 和结构化 Worker 输入。
