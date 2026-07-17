# Grok Build Desktop

Grok Build Desktop 是当前 Rust TUI 的图形桌面入口。它以 Electron 提供原生窗口，通过 Grok CLI 的 `streaming-json` 模式接入现有 agent runtime，并使用 `sessionId` 续接多轮会话。

## 启动

```powershell
cd desktop
npm install
npm start
```

应用会依次查找 `GROK_BINARY`、仓库的 release/debug 构建、`~/.grok/bin/grok` 和 `PATH` 中的 `grok`。

只预览界面：

```powershell
npm run preview
# http://127.0.0.1:4174
```

## 验证与打包

```powershell
npm run verify
npm run test:providers
npm run test:config
npm run test:account
npm run test:git
npm run pack
```

## 桌面工作区功能

- 设置中的第三方模型支持自动探测 OpenAI 与 Anthropic 协议、获取模型列表并按勾选结果写入 `~/.grok/config.toml`。密钥由 Electron `safeStorage` 保存在桌面端数据目录，不写入 TOML 或 renderer storage。
- 完整设置窗口直接读写原生 `~/.grok/config.toml`，提供 59 项类型化设置、搜索、分区导航、集成概览和原始 TOML 编辑器；每次写入会生成 `config.toml.desktop-backup`。
- 左下角账号入口同时展示 Grok 登录身份、Runtime 在线状态和版本，并连接个人资料、完整设置、浏览器 OAuth 登录、退出登录与可见的 Runtime 重新检测流程。
- 右侧工作台支持审阅、终端、浏览器、文件和侧边任务标签；终端、浏览器与侧边任务可以创建多个独立实例，标签栏支持左右滑动浏览。
- 侧边任务是与主区域一致的流式对话页：独立续接 Runtime 会话，并在每次发送时同步主对话最新上下文与同一项目 Memory。
- 每个终端标签运行一份以当前项目目录为起点的持久 PowerShell / Shell，会保留 `cd`、环境变量、输出和命令历史；浏览器标签则各自保留地址与导航历史。
- 主工具栏 Git 按钮会读取当前分支、Dirty/暂存状态、上游 Ahead/Behind，并支持搜索、切换、创建本地分支及跳转审阅。
- 原生 TUI 与参考设置页的能力对照见 [`docs/settings-capability-audit.md`](docs/settings-capability-audit.md)。

## 设计来源与 Grok 风格

`C:\Users\26891\Desktop\chatgpt_ui_reverse` 中的设计包用于提炼桌面密度、语义色、浮层、Composer、侧栏、Markdown 和微动效。字体副本位于 `renderer/assets`，原始样本清单存档于 `docs/REFERENCE_SOURCE_MANIFEST.json`。

关键界面采用独立的 Grok 视觉语言：

- 黑色宇宙底色与 signal-cyan 信号色，而非通用蓝色品牌方案；
- 直接沿用 TUI `views/welcome/logo.rs` 选择的 Braille 标志族：界面运行时使用 `logo07.txt`，桌面图标从同轮廓的高分辨率 `logo24.txt` 解码生成，并复用 TUI 的灰色到主文字色斜向 shimmer；
- 多会话侧边对话、持久终端和浏览器式可滚动标签工作台；
- 工程工作区、Git 分支、runtime 在线状态和工具许可作为一级信息；
- Chromium renderer 保持 `contextIsolation`、sandbox 和无 Node 注入。

会话历史保存在本地 renderer storage；附件仅在当前编辑状态保留，提交时以本地路径附加到 prompt。自动批准工具默认为关闭，可在右侧检查器或设置中开启。
