# Hesper

Hesper 是一个本地优先的桌面 AI Agent 客户端。项目目前以 `hesper-desktop/` 为核心，是一个基于 Electron、React 和 TypeScript 的 pnpm workspace。

它的目标是提供一个高密度、接近原生体验的桌面界面，用来运行和管理 Agent 会话。当前实现包含 Electron 桌面壳、React 渲染层、应用核心服务、Agent runtime、本地持久化，以及基于 `@earendil-works/pi-agent-core` 的真实 Agent 运行时适配。

## 使用

### 环境要求

- Node.js >= 22.19.0
- pnpm 11.5.2

### 本地开发

```bash
git clone https://github.com/oduan/hesper.git
cd hesper/hesper-desktop
pnpm install
pnpm dev
```

### 常用命令

```bash
pnpm check                         # 类型检查和测试
pnpm build                         # 构建 workspace
pnpm --filter @hesper/desktop build # 构建桌面应用
pnpm --filter @hesper/desktop smoke # 运行桌面应用冒烟检查
pnpm --filter @hesper/desktop e2e   # 运行端到端测试
```

默认开发模式使用可预测的 mock Agent 适配器。如果要使用 pi core 真实运行时：

```bash
HESPER_AGENT_MODE=pi-core pnpm dev
```

## 许可证

本项目使用 MIT 许可证。详见 [LICENSE](LICENSE)。
