# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.2] - 2026-10-25

### Fixed

- Both prediction routes require Harness connection admission and owner access,
  including the app's Host/Origin checks, before reading sessions or using tokens.
- Reject non-JSON, malformed, oversized and invalid-mode requests without model work.
- Simultaneous requests from different views no longer cancel each other; disabling
  the host plugin cancels outstanding model calls and clears its cache.
- Cache draft text exactly, preventing one draft from reusing a hash collision's suggestion.
- Disconnected or cancelled calls never cache partial output; token-limited output
  offers only complete lines.
- Clear a refused insertion's ghost and resume predictions after IME composition ends.

### Changed

- Declare Harness compatibility `>=0.2.1-rc.3 <0.3.0-0` (tested on `0.2.1-rc.3`).
- Add HTTP admission, input validation, cancellation, cache and IME regressions.
- The manual probe now requires an authenticated cookie and fails on HTTP errors.

## [1.2.1] - 2026-10-25

### Changed

- Publish desktop/web installation guidance and Chinese usage instructions on npm.
- Expand package search terms for ghost text and inline autocomplete.
- Release verification waits for npm's asynchronous publication to become visible.
- Validate GitHub Actions trusted publishing with provenance. Runtime behavior is
  unchanged from 1.2.0.

## [1.2.0] - 2026-10-24

### Added

- Settings → General switch to pause both modes, remembered on this device.
- Accessible announcement of final candidates and keyboard controls.
- Regression tests for real overlay behavior, split UTF-8 streams and preferences.

### Fixed

- Tab accepts only final, normalized candidates, avoiding duplicated draft text
  and prompt echoes while a response is still streaming.
- A stream without a terminal event clears the partial suggestion.
- Continuations keep their caret position and hide when there is no room.
- Joining a continuation no longer doubles a draft's trailing space.
- A refused editor insertion never falls back to replacing the entire draft.
- Comparison copy describes the actual differences between prediction plugins.

## [1.1.3] - 2026-10-23

### Changed

- README leads with what makes this plugin different: caret continuation plus
  keyboard-only candidate cycling, in a comparison table against the other
  composer-prediction plugins.
- npm description now names both modes.


### Added

- A demo GIF in the README showing the continuation ghost and Tab acceptance.

## [1.1.2] - 2026-10-23

### Changed

- README screenshots use absolute GitHub URLs so they render on the npm package page.
- README links to the changelog on GitHub.
- Package metadata points at the repository, homepage, and issue tracker.

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

[Unreleased]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.3...HEAD
[1.1.3]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Stijnus/dsh-composer-predictions/releases/tag/v1.1.0
