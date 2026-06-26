# Security Policy

## Reporting a Vulnerability

如果你发现了安全漏洞，请**不要**在公开 Issue 中报告。

请通过 GitHub Security Advisory 页面私下报告：

[Report a vulnerability](https://github.com/oduan/hesper/security/advisories/new)

我们将尽力在 48 小时内确认收到报告，并在 90 天内提供修复方案。

## Supported Versions

当前仅支持最新 release 版本。MVP1 阶段请始终升级到最新版本。

## Security Model

Hesper 是一个本地优先的桌面应用。关键安全原则：

- 所有会话数据默认存储在本地文件系统
- Agent API 密钥存储在本地平台安全存储中（系统 keychain）
- 不向任何外部服务发送遥测数据
- Electron 渲染进程遵循最小权限原则（contextIsolation + sandbox）
