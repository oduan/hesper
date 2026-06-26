# Hesper

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)]()

Hesper 是一个**本地优先**的桌面 AI Agent 客户端。它在本地运行完整的 Agent 会话循环——推理、工具调用、重试和持久化——全部在你自己的设备上完成。

**设计理念：** 高密度、接近原生的桌面体验。不是浏览器的包装，而是为 Agent 交互重新思考的原生界面。

## 功能特性

- 完整的 Agent 会话循环：推理、工具调用、流式输出、自动重试
- 本地优先：会话数据存储在本地文件系统，API 密钥存储在系统 keychain
- 高密度原生 UI：为长时间 Agent 任务设计的界面，非简单 Chat 窗口
- Markdown / HTML 渲染输出
- 可扩展的 Agent 运行时：支持 mock 适配器（开发/测试）和 `@earendil-works/pi-agent-core` 真实运行时
- Skills、Roles、Tools、Worker Agents 数据模型（MVP1 阶段 UX 保持精简）

## 架构概览

```
hesper-desktop/
├── apps/desktop/          # Electron 桌面应用
│   ├── electron/          #   Electron 主进程 + preload
│   └── src/               #   React 渲染进程
├── packages/
│   ├── app-core/          #   应用核心服务
│   └── agent-runtime/     #   Agent 运行时（队列、重试、持久化桥接）
└── docs/
    ├── architecture/      #   架构文档
    └── decisions/         #   设计决策记录
```

Agent 运行时通过适配器模式支持多种后端。默认开发环境使用确定性 mock 适配器，无需外部 API 凭证即可运行和测试。

详见 [hesper-desktop/README.md](hesper-desktop/README.md)。

## 快速开始

### 下载安装

从 [GitHub Releases](https://github.com/oduan/hesper/releases) 下载最新版本：

- **Windows:** `.exe` 安装包
- **macOS:** `.dmg` 安装包

### 本地开发

**环境要求：**

- Node.js >= 22.19.0
- pnpm 11.5.2

```bash
git clone https://github.com/oduan/hesper.git
cd hesper/hesper-desktop
pnpm install
pnpm dev
```

**常用命令：**

```bash
pnpm check                          # 类型检查 + 测试
pnpm build                          # 构建 workspace
pnpm --filter @hesper/desktop build # 构建桌面应用
pnpm --filter @hesper/desktop smoke # 冒烟检查
pnpm --filter @hesper/desktop e2e   # 端到端测试
```

**切换 Agent 运行时：**

默认使用 mock 适配器。使用 pi core 真实运行时：

```bash
HESPER_AGENT_MODE=pi-core pnpm dev
```

## 路线图

| 阶段 | 状态 |
|---|---|
| 桌面端 MVP1 | 已发布 |
| 桌面端后续迭代 | 开发中 |
| 服务端 (Hesper Server) | 规划中 |
| 移动端 (Hesper Mobile) | 规划中 |

## 贡献

欢迎贡献。请先阅读：

- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发环境、PR 流程、commit 规范
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — 社区行为准则
- [SECURITY.md](SECURITY.md) — 安全漏洞报告流程

## 许可证

[MIT](LICENSE)
