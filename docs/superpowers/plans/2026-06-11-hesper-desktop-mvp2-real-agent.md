# Hesper Desktop MVP2 Implementation Plan

> **For agentic workers:** 这份计划要求使用 `subagent-driven` 拆分方式推进；每个任务先验证再实现，再独立 review / 提交。

**Goal:** 把 `hesper-desktop/` 从 MVP1 的单会话运行骨架，升级为基于 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` 的真实 Agent runtime：支持多 provider、多模型、安全密钥、工具权限、skills/roles registry、subagent child run，以及可解释的 prompt assembly。

**Architecture:** Electron 只负责桌面壳；`app-core` 负责 registry 与设置；`agent-runtime` 负责 pi core 执行和 child run；`prompt-assembly` 负责把 tools / skills / roles / subagent rules 注入主 Agent 和 subagent prompt；`persistence` 负责本地持久化。

**Tech Stack:** Node >= 22.19.0, pnpm 11.5.2, TypeScript 6.0.3, Electron 42.4.0, React 19.2.7, Vite 8.0.16, Vitest 4.1.8, Playwright 1.60.0, zod 4.4.3, sql.js 1.14.1, `@earendil-works/pi-agent-core` 0.79.1, `@earendil-works/pi-ai` 0.79.1.

---

## 0. 执行约束

- 每个任务必须 TDD：先写测试/验收，再实现，再验证。
- 每个任务拆小，避免一次改太多层。
- 每个任务完成后单独 review，必要时回滚再修。
- 主 Agent 只在接口、数据流和验收清晰后合并。
- 使用 worktree 进行隔离开发，不回并到 `master`。
- 不删除 `nul` 文件，不修改 `.agent-reports`。
- MVP2 必须保留 MVP1 deterministic mock adapter、单会话运行骨架、现有 `AgentRuntimeEvent` 合约和 mock E2E 路径；真实 runtime 只能作为新增/切换层，不得把旧 baseline 推翻。
- 任何 renderer、prompt assembly、IPC 返回值、日志、runtime events、test snapshots 都不得接触原始 API key 或可还原密钥数据；只有 `main/app-core` 的 credential vault 受控 provider client 构造路径可读取明文，且读取后不得落日志/进 prompt/回传 UI。
- 提交信息必须包含：

```bash
Co-Authored-By: Craft Agent <agents-noreply@craft.do>
```

---

## 1. 里程碑拆分

### Milestone A：基础 registry 与安全存储

目标：让 provider / model / secret / settings 有统一抽象。

### Milestone B：工具、权限与 prompt 组装

目标：让主 Agent 在进入 runtime 前就知道“能用什么、不能用什么、何时调用 subagent”，并严格遵守 `PermissionPolicy → ToolExecutor → child run/result` 的执行顺序。

### Milestone C：真实 agent-runtime + child run

目标：把 `pi-agent-core` / `pi-ai` 接入运行链路，并让 child run 真正作为树结构事件流出现。

### Milestone D：Settings UI 与验收

目标：把 registry 和权限能力暴露给用户，并确保状态可见、可改、可验证；同时让 prompt assembly、credential vault、tool registry、subagent service 先有最小接口，再分任务落盘。

---

## 2. 任务列表

| 需求 | Task 编号 | 验收点 |
|---|---:|---|
| 保留 MVP1 mock baseline / 事件合约 / mock E2E 路径 | 1 | 旧路径仍可运行，真实 runtime 可切换但不破坏 baseline |
| 安全存储 API key | 2 | 明文 key 只在 credential vault 受控路径内短暂存在 |
| registry 驱动 provider/model/tool/skill/role | 2-6 | UI/runtime/prompt 共享同一 registry 源 |
| pi core real agent loop | 7 | 真实 loop 基于 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` |
| subagent child run | 8 | `agent.spawn-subagent`、`roleId`、`allowedToolIds`、`maxDepth`、`maxCount` 生效 |
| Settings UI 分拆与验收 | 9 | provider/model/tools/skills/roles/runtime 分区清晰且可保存 |


### Task 1: 确认目录结构与基础约束

**Files:**
- No code changes yet; validate existing workspace layout and branch state.

- [ ] 确认当前分支为 `feature/hesper-desktop-mvp2-real-agent`
- [ ] 确认 worktree 只在指定目录内操作
- [ ] 确认没有误改 `.agent-reports` / `nul`

**Exit criteria:**
- branch / worktree 状态明确
- 无代码变更

---

### Task 2: provider / model registry + secret storage

**Interface first:** 先落 `provider-registry` / `credential-vault` 最小接口，再拆实现与 UI。

**Files to create/update:**
- `hesper-desktop/packages/app-core/src/provider-registry.ts`
- `hesper-desktop/packages/app-core/src/model-registry.ts`
- `hesper-desktop/packages/app-core/src/secret-store.ts`
- `hesper-desktop/packages/shared/src/domain.ts`
- related tests

**Checklist:**
- [ ] 建立 provider registry，覆盖 DeepSeek / OpenAI / custom OpenAI-compatible endpoint
- [ ] 建立 model registry，统一描述模型能力
- [ ] 建立 secret vault 抽象，确保 API key 不明文落盘
- [ ] 只有 main/app-core 受控 provider client 构造路径可读取明文，并且读取后不进日志/提示词/事件
- [ ] 提供 provider connection test
- [ ] 补充失败/成功测试

**Review:**
- registry 是否驱动 UI 和 runtime，而不是 UI 单独维护

---

### Task 3: tools definitions + executors + permission policy

**Interface first:** 先落 `tool-registry` / `permission-policy` 最小接口，再接 executor。

**Files to create/update:**
- `hesper-desktop/packages/tools/*`
- `hesper-desktop/packages/app-core/src/tool-registry.ts`
- `hesper-desktop/packages/app-core/src/permission-policy.ts`
- related tests

**Checklist:**
- [ ] 定义工具结构：definition / executor / policy
- [ ] 为文件、shell、web、agent 等工具建立分类
- [ ] 让 policy 先判定后执行
- [ ] 明确 `PermissionPolicy → ToolExecutor → child run/result` 的不可绕过顺序
- [ ] 工具失败进入步骤流

**Review:**
- permission policy 是否可解释、可组合

---

### Task 4: skills registry / UI / prompt 注入

**Files to create/update:**
- `hesper-desktop/packages/app-core/src/skill-registry.ts`
- `hesper-desktop/packages/ui/src/settings/SkillsPanel.tsx`
- `hesper-desktop/packages/app-core/src/prompt-assembly.ts`
- tests

**Checklist:**
- [ ] skills discovery
- [ ] skills 来源与摘要展示
- [ ] skills 注入 prompt
- [ ] 支持会话级启用/禁用

**Review:**
- prompt 里是否清楚说明 skills 的选择规则

---

### Task 5: roles registry / UI / prompt 注入

**Files to create/update:**
- `hesper-desktop/packages/app-core/src/role-registry.ts`
- `hesper-desktop/packages/ui/src/settings/RolesPanel.tsx`
- `hesper-desktop/packages/app-core/src/prompt-assembly.ts`
- tests

**Checklist:**
- [ ] role metadata 包含 defaultModelId / allowedToolIds / allowedSkillIds
- [ ] 支持主 Agent 与 subagent 角色区分
- [ ] role prompt 注入清晰且可审计

**Review:**
- role 能力边界是否足够清晰

---

### Task 6: PromptAssemblyService

**Interface first:** 先落 `prompt-assembly` 最小接口，再接 registry 数据与 UI 展示。

**Files to create/update:**
- `hesper-desktop/packages/app-core/src/prompt-assembly.ts`
- tests

**Checklist:**
- [ ] 主 Agent prompt 列出可用工具
- [ ] 主 Agent prompt 说明如何使用 subagent
- [ ] subagent prompt 列出 roleId / allowedToolIds / max depth / max count
- [ ] prompt assembly 依赖 registry，而不是散落状态
- [ ] prompt 中清楚列出可用工具、如何使用 subagent、如何给 subagent 分配可用角色

**Review:**
- prompt 是否足够可解释、可扩展、可测试

---

### Task 7: real agent-runtime with pi core

**Files to create/update:**
- `hesper-desktop/packages/agent-runtime/src/pi-core-adapter.ts`
- `hesper-desktop/packages/agent-runtime/src/runtime.ts`
- `hesper-desktop/packages/agent-runtime/src/map-pi-event.ts`
- tests

**Checklist:**
- [ ] 使用 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`
- [ ] 保持事件流与 persistence 对接
- [ ] 支持 streaming / tool calls / retry / failure
- [ ] 为 child run 预留 parent-child 关系

**Review:**
- 是否真的依赖 pi core，而不是自研 loop

---

### Task 8: subagent child run

**Interface first:** 先落 `subagent-service` 最小接口，再接 child run 路由与权限控制。

**Files to create/update:**
- `hesper-desktop/packages/agent-runtime/src/subagent.ts`
- `hesper-desktop/packages/app-core/src/subagent-service.ts`
- tests

**Checklist:**
- [ ] 主 Agent 通过 `agent.spawn-subagent` 调 child run
- [ ] 子 Agent 接受 `roleId` / `allowedToolIds` / `max depth` / `max count`
- [ ] child run 事件可追踪
- [ ] 禁止未经授权的工具进入 subagent prompt 或 executor
- [ ] 防止无限递归与越权工具调用

**Review:**
- 递归深度与权限边界是否安全

---

### Task 9: Settings UI 拆分与验收

**Interface first:** 先落 settings 分区与状态契约，再补 UI 细节。

**Files to create/update:**
- `hesper-desktop/packages/ui/src/settings/*`
- `hesper-desktop/apps/desktop/renderer/*`

**Checklist:**
- [ ] provider & API keys
- [ ] model registry
- [ ] tools & permissions
- [ ] skills
- [ ] roles
- [ ] runtime settings
- [ ] 变更能正确影响 prompt/runtime

**Review:**
- UI 是否清楚区分系统默认和当前会话覆盖

---

### Task 10: end-to-end smoke checks

**Files:**
- existing test suites only

**Checklist:**
- [ ] 最小聊天回路
- [ ] provider 连接失败提示
- [ ] tool permission 拒绝提示
- [ ] child run 显示与回传

**Review:**
- 不跑重型完整 E2E，只保留轻量 smoke

---

## 3. 交付验收

- MVP2 不是“能跑”，而是“能解释、能扩展、能审计”。
- provider/model/secret/tool/skill/role 都有 registry。
- 主 Agent 使用 pi core。
- subagent 真实 child run。
- PromptAssemblyService 覆盖主 Agent 与 subagent。
- Settings UI 拆分清晰。
- 每个任务都有测试、review 和独立提交。
