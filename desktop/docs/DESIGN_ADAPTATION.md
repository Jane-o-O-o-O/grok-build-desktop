# Reference adaptation record

参考包中的 `tokens.css`、`components.css`、交互展示页、完整 token/font/keyframe inventory 和四组渲染截图均用于视觉归纳。迁移时保留了 4px 密度、12/14px 文字层级、细边框卡片、模糊浮层、紧凑标题栏、768–820px 对话宽度、Composer 阴影和 150/320ms 动效规律。

本实现重新定义了品牌色、表面层级、标记、信息架构、任务图谱、runtime 接入和工程上下文展示；没有把参考应用的品牌文案或业务组件直接作为最终界面。

## Grok 标志来源

桌面标志以 TUI 的权威实现 `views/welcome/logo.rs` 为准：TUI 正常布局选择 `logo07.txt`，紧凑布局选择 `logo05.txt`。桌面导出使用同一标志族、同一轮廓的高分辨率 `logo24.txt`，避免系统图标放大后失真。`desktop/scripts/generate-icon.py` 将每个 Unicode Braille 单元还原为 2×4 点阵，从而保留终端欢迎页使用的开环 Grok 轮廓与对角线。颜色同样遵循 `logo.rs`：静止灰色向主文字色高光过渡，高光从左下向右上扫过。生成结果同时用于标题栏、欢迎页、助手头像和系统应用图标。
