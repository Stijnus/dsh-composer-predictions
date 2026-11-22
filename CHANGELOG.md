# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.10] - 2026-11-22

### Fixed

- A saved prediction model or typing pause takes effect at once, without relying
  on the Harness to reload the plugin after a config edit.
- Changing the prediction model now asks again for a next-message suggestion in
  an empty composer, instead of clearing the old one and leaving it blank.

### Changed

- Identical prediction requests that are still running share one model call,
  so two views of the same session no longer pay for the same suggestion twice.
  A late request catches up on the text streamed so far; one view leaving does
  not cancel the others, and the call stops once every view has left.

## [1.2.9] - 2026-11-22

### Added

- **Settings → Composer predictions** holds the prediction switch and a
  theme-aware model picker. Follow the conversation model or choose a fixed
  model for predictions in the active profile.
- The typing pause before a draft continuation is configurable as any whole
  number from 1 to 60 seconds, saved to the active profile.

### Changed

- The default typing pause before a draft continuation is now 1 second (was
  500 ms). If the settings cannot be loaded, the default still applies.

### Fixed

- The ghost no longer weaves into the composer's placeholder. The overlay paints
  exactly where the placeholder sits, using `--dsw-specific-input-major` as its
  background; a theme that makes that token translucent (dream-skin sets it to
  about 7% alpha) let the placeholder show through the suggestion, so both texts
  superimposed and neither was readable. The placeholder is now hidden while a
  ghost is on screen, which also covers the streaming preview. One test added.

## [1.2.8] - 2026-10-28

### Changed

- Replaced the timed, one-time "star the suite" overlay prompt with a quiet,
  user-initiated star link in the plugin's own UI. It never interrupts or
  auto-opens; it links to the Stijnus DSH plugin suite on GitHub.

## [1.2.7] - 2026-10-28

### Added

- A one-time, dismissible "star the suite" prompt in the app overlay links to
  the five Stijnus plugin repositories. It shows at most once per browser and
  the whole suite shares the marker, so installing all five cannot stack five
  prompts.

## [1.2.6] - 2026-10-26

### Changed

- Declare `dsh.catalog` (English/Chinese summary, `ui` category) so plugin
  markets place the plugin under UI with a real summary instead of guessing.

## [1.2.5] - 2026-10-25

### Changed

- The **Settings → General** row draws its own switch instead of loading
  `@deepseek-ai/dsh-client-ui-primitives`. A harness-side change to that package
  could previously fail the whole plugin at load; the markup, theme tokens and
  behaviour are unchanged.
- The README comparison table names the Settings switch.


## [1.2.4] - 2026-10-25

### Fixed

- The ghost is anchored to the composer card that owns the overlay, found
  through the overlay's own DOM ancestry. It previously measured the first
  `[data-composer-card]` in the document, so with more than one composer
  mounted (another panel, a transition, a second window) the suggestion could
  paint over another conversation and Tab would consult the wrong card.
- Switching Sessions also clears the measured box, not just the suggestion.

## [1.2.3] - 2026-10-25

### Changed

- Narrowed package keywords to the six core terms. Runtime behaviour is
  unchanged; this release tests whether npm search indexes the package.

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

[Unreleased]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.10...HEAD
[1.2.10]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.9...v1.2.10
[1.2.9]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.3...v1.2.0
[1.1.3]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/Stijnus/dsh-composer-predictions/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Stijnus/dsh-composer-predictions/releases/tag/v1.1.0
