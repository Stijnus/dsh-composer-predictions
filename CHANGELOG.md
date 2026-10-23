# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-10-23

### Changed

- Ship `CHANGELOG.md` in the published tarball.

## [1.1.0] - 2026-10-23

First public release. (`1.0.0` was prepared locally and never published; the
first registry version is `1.1.0`.)

### Added

- **Next-message ghost** — after a turn settles, the empty composer streams a
  suggestion for the likely next message. `Tab` accepts it as an editable draft
  and never sends it.
- **Inline continuation** — pausing mid-draft with the caret at the end completes
  the sentence at the caret.
- **Multiple candidates** — up to three per request, cycled with
  `Alt+Down` / `Alt+Up`, dismissed with `Escape`; typing aborts in-flight
  requests and hides the ghost.
- **Tool-aware context** — the prompt includes a short list of recent tool calls
  and their outcomes (`maxToolNotes`).
- **Streaming transport** — `POST /composer-prediction/v2` emits
  `meta` / `delta` / `done` over Server-Sent Events; the original JSON
  `POST /composer-prediction` is kept for older clients.
- **Caching** — results are cached per Session sequence, and per draft for
  continuations, so an unchanged context costs no model call.
- **Configuration** — `maxOutputTokens`, `timeoutMs`, `maxMessages`,
  `maxChars`, `maxSuggestions`, `maxToolNotes`, plus an optional fixed
  `provider` / `model` / `reasoningEffort` route.
- **Tests and tooling** — host and client unit tests (`node --test`) and
  `tools/live-probe.mjs` for watching the stream against a running GUI.

### Notes

- Uses the Session's own provider/model at the model's lowest reasoning effort
  unless a route is configured.
- Nothing is written to the Session log, and predictions do not appear in the
  token meter.
- Requires a Harness build that provides `conversation.input.overlay`,
  `ctx.llm`, and `sessions.deriveMessages()`.

[Unreleased]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Stijnus/dsh-composer-predictions/releases/tag/v1.1.0
