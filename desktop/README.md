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
npm run pack
```

## 设计来源与 Grok 风格

`C:\Users\26891\Desktop\chatgpt_ui_reverse` 中的设计包用于提炼桌面密度、语义色、浮层、Composer、侧栏、Markdown 和微动效。字体副本位于 `renderer/assets`，原始样本清单存档于 `docs/REFERENCE_SOURCE_MANIFEST.json`。

关键界面采用独立的 Grok 视觉语言：

- 黑色宇宙底色与 signal-cyan 信号色，而非通用蓝色品牌方案；
- 由斜向双轨和轨道构成的 Grok 标记；
- Activity Map、信号节点和任务脉络检查器；
- 工程工作区、Git 分支、runtime 在线状态和工具许可作为一级信息；
- Chromium renderer 保持 `contextIsolation`、sandbox 和无 Node 注入。

会话历史保存在本地 renderer storage；附件仅在当前编辑状态保留，提交时以本地路径附加到 prompt。自动批准工具默认为关闭，可在右侧检查器或设置中开启。
