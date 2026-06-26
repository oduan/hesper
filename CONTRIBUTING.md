# Contributing to Hesper

感谢你考虑为 Hesper 做出贡献。

## 开发环境

- Node.js >= 22.19.0
- pnpm 11.5.2
- Git

## 搭建本地开发环境

```bash
git clone https://github.com/oduan/hesper.git
cd hesper/hesper-desktop
pnpm install
```

## 项目结构

Hesper 是一个 pnpm workspace 单仓。当前核心是 `hesper-desktop/`：

- `hesper-desktop/apps/desktop/` — Electron 桌面应用
- `hesper-desktop/packages/` — 共享包（app-core、agent-runtime 等）

更多细节参见 [hesper-desktop/README.md](hesper-desktop/README.md)。

## 常用命令

```bash
pnpm dev                          # 启动开发模式
pnpm check                        # 类型检查 + 测试
pnpm build                        # 构建 workspace
pnpm --filter @hesper/desktop build   # 构建桌面应用
pnpm --filter @hesper/desktop smoke   # 冒烟检查
pnpm --filter @hesper/desktop e2e     # 端到端测试
```

## 开发流程

1. **Fork** 本仓库并克隆到本地
2. 从 `main` 分支创建 feature 分支：`git checkout -b feature/your-feature`
3. 进行修改，确保 `pnpm check` 通过
4. 提交代码，遵循下方 commit 规范
5. 推送到你的 fork 并开启 Pull Request

## Commit 规范

本仓库使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
type(scope): description

[optional body]
```

常用 type：

| type | 说明 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 重构 |
| `test` | 测试 |
| `chore` | 构建/工具链 |

## Pull Request 指南

- PR 标题使用 Conventional Commits 格式
- 如有 UI 变更，建议附带 before/after 截图
- 新功能应包含测试
- 确保 CI 全部通过

## Code Style

项目使用 ESLint + Prettier 统一代码风格。运行 `pnpm check` 会自动执行校验。

## 报告问题

使用 GitHub Issues 报告 bug 或提出 feature request。

## 许可证

贡献的代码将采用与项目相同的 [MIT 许可证](LICENSE)。
