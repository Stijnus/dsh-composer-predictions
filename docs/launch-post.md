# Launch post — dsh-composer-predictions

## Title (EN)
Tab completion for the chat composer in DeepSeek Harness

## Title (ZH)
给输入框加上 Tab 补全：DeepSeek Harness 的幽灵文本

## Body (EN)

You type the same shapes over and over: "continue", "now run the tests", "check
the diff and fix only the failing case". **Composer Predictions** turns those
into ghost text you accept with **Tab** — in the empty composer after a reply,
and inline while you are still typing.

- **Next message** — when a turn ends and the composer is empty, it streams a
  suggestion for your likely next message. **Tab** accepts it as an editable draft.
- **Inline completion** — mid-sentence ghost text that follows your phrasing.
- **Never sends anything** — accepting produces a normal draft; the send button
  is still your decision.
- **Same route as your session** — predictions use the model route the session
  already uses; no extra key, no separate provider.

Install:

```sh
dsh plugin --profile web add dsh-composer-predictions
```

Requires DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0` on the Web profile. MIT,
SLSA provenance on npm.

**Limits, honestly:** suggestions consume tokens on the session's route, so they
are model calls, not free. It predicts, it does not refactor your prompt — that is
what `dsh-prompt-rewrite` is for.

Repo: https://github.com/Stijnus/dsh-composer-predictions · npm:
https://www.npmjs.com/package/dsh-composer-predictions

## Body (ZH)

有些话你每天都在重复输入：「继续」「现在跑测试」「看下 diff，只修失败的那个」。
**输入框补全**把这些变成幽灵文本，按 **Tab** 接受——既在一轮结束后的空输入框里
出现，也在你打字过程中逐字补全。

- **下一条消息**：一轮结束后输入框为空时，流式给出下一条消息的建议，Tab 接受为可
  编辑草稿。
- **行内补全**：打字中途补全当前句子，跟随你的措辞。
- **绝不自动发送**：接受后只是一段普通草稿，发不发由你。
- **沿用当前路由**：使用会话已经在用的模型路由，不需要额外 key 或另一个服务商。

安装：

```sh
dsh plugin --profile web add dsh-composer-predictions
```

要求 DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`，Web profile。MIT 许可，npm 带
SLSA provenance。

**老实说限制：** 建议本身要消耗当前路由的 token，不是免费的；它只预测，不改写你的
提示词——那是 `dsh-prompt-rewrite` 的事。

## Short version (X / 微博)

EN: Ghost-text tab completion for the DeepSeek Harness composer: next-message
suggestions after a reply, inline completion while typing, Tab to accept, never
auto-sends. `dsh plugin --profile web add dsh-composer-predictions`

ZH: 输入框的幽灵文本补全：回复结束后提示下一条消息、打字时逐字补全，Tab 接受，绝不
自动发送。`dsh plugin --profile web add dsh-composer-predictions`
