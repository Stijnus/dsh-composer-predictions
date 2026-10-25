# dsh-composer-predictions · 输入框补全

[English](./README.md) · [中文](./README.zh-CN.md)

给输入框加上**幽灵文本补全**：智能体回复后提示你下一条消息，输入时补全当前句子，**Tab** 接受为可编辑草稿。

## 快速开始

```sh
dsh plugin --profile web add dsh-composer-predictions
```

重启 Harness（或刷新 Web 界面）。输入框开始出现幽灵文本建议。

## 功能

- **下一条消息**：一轮结束后，空输入框流式给出下一条消息的草稿，Tab 接受。
- **行内补全**：打字过程中补全当前句子，保持你的语气与上下文。
- **Tab 接受 / Esc 忽略**，接受后是普通草稿，不会自动发送。
- **不改动会话历史**，只在你接受时写入输入框。

## 要求

DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`，Web profile（桌面版或 Web 界面）

## 相关链接

- 英文说明（完整细节）：[README.md](./README.md)
- npm：<https://www.npmjs.com/package/dsh-composer-predictions>
- 更新记录：[CHANGELOG.md](./CHANGELOG.md)

<sub>同系列插件：[情绪板](https://github.com/Stijnus/dsh-moodboard) · [输入补全](https://github.com/Stijnus/dsh-composer-predictions) · [移动到工作区](https://github.com/Stijnus/dsh-move-to-workspace) · [工作区状态](https://github.com/Stijnus/dsh-workspace-status) · [提示词改写](https://github.com/Stijnus/dsh-prompt-optimizer)</sub>

<sub>⭐ 如果它帮你省了一步，点个 star 能让更多 DSH 用户发现它。</sub>
