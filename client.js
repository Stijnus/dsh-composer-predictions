/**
 * Browser half of composer predictions.
 *
 * Two modes share one overlay:
 * - `next`: after a turn settles and the composer is empty, the Host streams
 *   candidate follow-up messages as ghost text over the placeholder.
 * - `continue`: while the user pauses mid-draft with the caret at the end, the
 *   Host streams continuations of that draft and the ghost follows the caret.
 *
 * Tab accepts the current candidate as an editable draft, Alt+Down / Alt+Up
 * cycle between candidates, Escape dismisses one. Typing aborts in-flight work
 * and hides the ghost; nothing is ever sent to the agent by accepting.
 *
 * The overlay seat is anchored to the composer card, so the ghost measures the
 * resident editor and follows its padding, line height, and scroll position.
 */

window.__ModuleLoader__.load({
  id: 'dsh-composer-predictions',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * Local switch button. The host's own switch is a harness Client package,
     * which a bundle must not load: it can change without notice, and a throw
     * would take the whole plugin down. This reproduces its markup, CSS and
     * behaviour with plugin-owned classes and theme tokens only.
     */
    const SETTINGS_CSS = [
      '.cp-setting-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 24px}',
      '.cp-settings{display:grid;gap:12px;padding:16px 0}',
      '.cp-setting-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.cp-settings :is(select,input,button.cp-save){box-sizing:border-box;min-height:32px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-fill-l3);color:var(--dsw-alias-label-primary);font:inherit}',
      '.cp-settings select{width:min(100%,19rem);color-scheme:light}.cp-settings input{width:5rem}',
      'body[data-ds-dark-theme] .cp-settings select{color-scheme:dark}',
      // Opt into Chromium's styleable picker so the open menu uses the DSH palette.
      '@supports (appearance:base-select) and selector(::picker(select)){',
      '.cp-settings select,.cp-settings select::picker(select){appearance:base-select}',
      '.cp-settings select::picker(select){box-sizing:border-box;margin-block:4px;padding:4px;max-block-size:min(22rem,55dvh);overflow:auto;border:0;border-radius:8px;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);font:inherit}',
      '.cp-settings select::picker-icon{color:var(--dsw-alias-menu-icon)}',
      '.cp-settings optgroup{color:var(--dsw-alias-label-secondary);font-weight:600}',
      '.cp-settings option{min-block-size:30px;padding:5px 8px;border-radius:6px;color:var(--dsw-alias-label-primary);font-weight:400}',
      '.cp-settings option:checked{background:var(--dsw-alias-interactive-bg-active)}',
      '.cp-settings option:is(:hover,:focus-visible){background:var(--dsw-alias-interactive-bg-hover)}',
      '.cp-settings option::checkmark{color:var(--dsw-alias-brand-primary)}',
      '}',
      '@supports not (appearance:base-select){.cp-settings :is(option,optgroup){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}}',
      '.cp-settings :is(select,input,button.cp-save):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.cp-save:disabled{opacity:.5}.cp-save:not(:disabled){cursor:pointer}',
    ].join('')

    const SWITCH_CSS = [
      '.cp-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.cp-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.cp-switch:disabled{cursor:default;opacity:.5}',
      '.cp-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.cp-switch__thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s}',
      '.cp-switch[aria-checked="false"] .cp-switch__thumb{background:var(--dsw-alias-switch-thumb)}',
      '.cp-switch[aria-checked="true"] .cp-switch__thumb{transform:translate(16px)}',
    ].join('')

    function Switch({ checked, label, onChange, disabled }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked === true ? 'true' : 'false',
          'aria-label': label,
          className: 'cp-switch',
          disabled: disabled === true,
          onClick: () => onChange(checked !== true),
        },
        h('span', { className: 'cp-switch__thumb', 'aria-hidden': 'true' }),
      )
    }

    const NS = 'composer-predictions'
    const ENDPOINT = '/composer-prediction/v2'
    const SETTINGS_ENDPOINT = '/composer-prediction/settings'
    const MODELS_ENDPOINT = '/composer-prediction/models'
    const SLOT = 'conversation.input.overlay'

    /** Wait for the settled UI before asking, so a fresh turn is fully committed. */
    const SETTLE_MS = 600
    /** A continuation needs enough text to continue from. */
    const CONTINUE_MIN_CHARS = 3
    /** The Host bounds the draft too; this keeps the request body small. */
    const MAX_DRAFT_CHARS = 4_000
    /** Ignore the first characters of a streaming answer to avoid flicker. */
    const STREAM_MIN_CHARS = 3

    /** Editor text insets from the resident composer styles. */
    const EDITOR_INSET_TOP = 4
    const EDITOR_INSET_LEFT = 14
    const EDITOR_INSET_RIGHT = 8
    /** The editable scroll container's right margin, outside the text column. */
    const EDITOR_SCROLL_MARGIN = 4
    const FALLBACK_LINE_HEIGHT = 24

    const DICTIONARIES = {
      en: {
        label: 'Composer prediction',
        accept: 'Press Tab to accept this suggestion',
        more: 'Alt+Down for the next suggestion',
        enabled: 'Composer predictions',
        description: 'Suggest your next message and continue drafts using model tokens.',
        starSuite: 'Star the suite',
        starSuiteTitle: 'Star the Stijnus DSH plugin suite on GitHub',
        predictionModel: 'Prediction model',
        followSession: 'Follow the conversation model',
        unavailableModel: 'Unavailable model',
        delay: 'Typing pause (seconds)',
        delayNote: 'Applies to draft continuation. Enter 1–60 seconds.',
        loading: 'Loading prediction settings…',
        loadFailed: 'Prediction settings could not be loaded.',
        modelsFailed: 'Model list could not be loaded.',
        retry: 'Retry',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Could not save. Check your selection and try again.',
        ready: 'Suggestion: {text}. Press Tab to accept. Alt+Down or Alt+Up changes candidates. Escape dismisses.',
      },
      zh: {
        label: '输入预测',
        accept: '按 Tab 采纳该建议',
        more: '按 Alt+↓ 查看下一条建议',
        enabled: '输入预测',
        description: '预测下一条消息和续写草稿会消耗模型用量。',
        starSuite: '为插件套件点星',
        starSuiteTitle: '在 GitHub 上为 Stijnus 的 DSH 插件套件点星',
        predictionModel: '预测模型',
        followSession: '跟随当前会话模型',
        unavailableModel: '模型当前不可用',
        delay: '输入停顿（秒）',
        delayNote: '适用于草稿续写，可设为 1–60 秒。',
        loading: '正在加载输入预测设置…',
        loadFailed: '无法加载输入预测设置。',
        modelsFailed: '无法加载模型列表。',
        retry: '重试',
        save: '保存',
        saving: '正在保存…',
        saved: '已保存',
        saveFailed: '保存失败。请检查所选模型和停顿时间后重试。',
        ready: '建议：{text}。按 Tab 采纳，Alt+↓ 或 Alt+↑ 切换，Escape 关闭。',
      },
    }

    const PREFERENCE_KEY = 'dsh-composer-predictions.enabled'
    const SETTINGS_CHANGED_KEY = 'dsh-composer-predictions.settings-changed'
    const STAR_SUITE_URL = 'https://github.com/Stijnus?tab=repositories&q=dsh'
    let enabled = true
    try {
      enabled = window.localStorage.getItem(PREFERENCE_KEY) !== 'false'
    } catch {
      // Restricted storage keeps the preference in memory for this window.
    }
    const preferenceListeners = new Set()
    const subscribePreference = (listener) => {
      preferenceListeners.add(listener)
      return () => preferenceListeners.delete(listener)
    }
    const readEnabled = () => enabled
    function setEnabled(value) {
      enabled = value
      try {
        window.localStorage.setItem(PREFERENCE_KEY, String(value))
      } catch {
        // The switch still works for this window when storage is unavailable.
      }
      for (const listener of preferenceListeners) listener()
    }
    function useEnabled() {
      return React.useSyncExternalStore(subscribePreference, readEnabled, readEnabled)
    }
    let settings = null
    let settingsRevision = 0
    let savingSettings = false
    const readSettings = () => settings
    const readSaving = () => savingSettings
    function setSaving(value) {
      savingSettings = value
      for (const listener of preferenceListeners) listener()
    }
    function publishSettings(value) {
      settings = value
      for (const listener of preferenceListeners) listener()
    }
    function useSettings() {
      return React.useSyncExternalStore(subscribePreference, readSettings, readSettings)
    }
    async function fetchJson(path, options) {
      const response = await fetch(path, options)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }
    async function loadSettings(signal) {
      if (savingSettings) return
      const revision = ++settingsRevision
      try {
        const value = await fetchJson(SETTINGS_ENDPOINT, { signal })
        if (!signal?.aborted && revision === settingsRevision) publishSettings(value)
      } catch {
        if (!signal?.aborted && revision === settingsRevision && settings === null) publishSettings(false)
      }
    }
    const modelKey = ({ provider, model }) => JSON.stringify([provider, model])
    const followSessionKey = modelKey({ provider: '', model: '' })

    function PredictionsSetting({ t }) {
      const checked = useEnabled()
      const current = useSettings()
      const [catalog, setCatalog] = React.useState(null)
      const [catalogAttempt, retryCatalog] = React.useReducer((count) => count + 1, 0)
      const [selectedModel, setSelectedModel] = React.useState(null)
      const [delayInput, setDelayInput] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const saving = React.useSyncExternalStore(subscribePreference, readSaving, readSaving)
      React.useEffect(() => {
        if (settings !== null) void loadSettings()
      }, [])
      React.useEffect(() => {
        const controller = new AbortController()
        fetchJson(MODELS_ENDPOINT, { signal: controller.signal }).then(
          (groups) => { if (!controller.signal.aborted) setCatalog(groups) },
          () => { if (!controller.signal.aborted) setCatalog(false) },
        )
        return () => controller.abort()
      }, [catalogAttempt])

      const showFields = current && typeof current === 'object'
      const savedModel = showFields ? modelKey(current) : followSessionKey
      const route = selectedModel ?? savedModel
      const delay = delayInput ?? String(current?.delaySeconds ?? '')
      const seconds = Number(delay)
      const dirty = showFields && (route !== savedModel || seconds !== current.delaySeconds)
      const groups = Array.isArray(catalog) ? catalog : []
      const savedModelListed = groups.some((group) => group.models.some((model) =>
        modelKey({ provider: group.id, model: model.id }) === savedModel))

      async function save(event) {
        event.preventDefault()
        if (!dirty || savingSettings || !Number.isInteger(seconds) || seconds < 1 || seconds > 60) return
        const changes = {}
        if (seconds !== current.delaySeconds) changes.delaySeconds = seconds
        if (route !== savedModel) {
          const [provider, model] = JSON.parse(route)
          Object.assign(changes, { provider, model })
        }
        settingsRevision += 1
        setSaving(true)
        setStatus('saving')
        try {
          const saved = await fetchJson(SETTINGS_ENDPOINT, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes),
          })
          publishSettings(saved)
          try { window.localStorage.setItem(SETTINGS_CHANGED_KEY, String(Date.now())) } catch { /* Other windows refresh on focus. */ }
          setSelectedModel(null)
          setDelayInput(null)
          setStatus('saved')
        } catch {
          setStatus('saveFailed')
        } finally {
          setSaving(false)
        }
      }

      return h('div', { className: 'cp-settings' },
        h('style', null, SWITCH_CSS + SETTINGS_CSS),
        h('div', { className: 'cp-setting-row' },
          h('div', null, t('enabled'), h('div', { className: 'cp-setting-note' }, t('description'))),
          h(Switch, { checked, label: t('enabled'), onChange: setEnabled }),
        ),
        current === null && h('div', { role: 'status' }, t('loading')),
        current === false && h('div', { className: 'cp-setting-row', role: 'status' }, t('loadFailed'),
          h('button', { type: 'button', className: 'cp-save', onClick: () => { publishSettings(null); void loadSettings() } }, t('retry'))),
        showFields && h('form', { onSubmit: save, style: { display: 'grid', gap: 12 } },
          h('label', { className: 'cp-setting-row' }, t('predictionModel'),
            h('select', { value: route, disabled: saving || catalog === null, onChange: (event) => { setSelectedModel(event.target.value); setStatus('') } },
              h('option', { value: followSessionKey }, t('followSession')),
              savedModel !== followSessionKey && !savedModelListed && h('option', { value: savedModel }, `${t('unavailableModel')} (${current.model})`),
              groups.map((group) => h('optgroup', { key: group.id, label: group.name },
                group.models.map((model) => {
                  const key = modelKey({ provider: group.id, model: model.id })
                  return h('option', { key, value: key }, `${model.name} (${group.name})`)
                }))),
            ),
          ),
          catalog === false && h('div', { className: 'cp-setting-row', role: 'status' }, t('modelsFailed'),
            h('button', { type: 'button', className: 'cp-save', onClick: () => { setCatalog(null); retryCatalog() } }, t('retry'))),
          h('label', { className: 'cp-setting-row' },
            h('span', null, t('delay'), h('span', { className: 'cp-setting-note', style: { display: 'block' } }, t('delayNote'))),
            h('input', { type: 'number', min: 1, max: 60, step: 1, required: true, value: delay, disabled: saving,
              onChange: (event) => { setDelayInput(event.target.value); setStatus('') } }),
          ),
          h('div', { className: 'cp-setting-row' },
            h('div', { role: 'status', className: 'cp-setting-note' }, status && t(status)),
            h('button', { type: 'submit', className: 'cp-save', disabled: !dirty || saving }, t('save')),
          ),
        ),
        h('a', { href: STAR_SUITE_URL, target: '_blank', rel: 'noopener noreferrer', title: t('starSuiteTitle'),
          style: { justifySelf: 'start', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-link)', textDecoration: 'none' } },
          '★ ' + t('starSuite')),
      )
    }

    const NO_GHOST = { mode: 'next', items: [], index: 0, stream: '', active: false }

    const NEXT_GHOST_STYLE = {
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      color: 'var(--dsw-alias-label-caption)',
      background: 'var(--dsw-specific-input-major)',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: 2,
    }

    /** The continuation ghost hugs its text and sits where the caret is. */
    const CONTINUE_GHOST_STYLE = {
      ...NEXT_GHOST_STYLE,
      gap: '6px',
      padding: '0 4px',
      borderRadius: '4px',
      zIndex: 3,
    }

    const TEXT_STYLE = {
      flex: '1 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      opacity: 0.9,
    }

    const CONTINUE_TEXT_STYLE = {
      ...TEXT_STYLE,
      flex: '0 1 auto',
    }

    const KEYCAP_STYLE = {
      flex: 'none',
      fontSize: '11px',
      lineHeight: '16px',
      padding: '0 5px',
      borderRadius: '4px',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-tertiary)',
      background: 'transparent',
    }

    const BADGE_STYLE = {
      flex: 'none',
      fontSize: '10px',
      lineHeight: '14px',
      color: 'var(--dsw-alias-label-tertiary)',
      opacity: 0.8,
    }

    /**
     * Locate the composer card this overlay actually belongs to.
     *
     * The seat is rendered inside the resident composer card, so the anchor node
     * is an ancestor-scoped key: a global `querySelector` would pick whichever
     * card happens to be first in the document and paint that conversation's
     * ghost over another one.
     */
    function composerElementsNear(anchor) {
      if (typeof document === 'undefined') return null
      if (anchor === null || anchor === undefined || !anchor.isConnected) return null
      const card = anchor.closest('[data-composer-card]')
      if (card === null) return null
      const editor = card.querySelector('[contenteditable="true"]') || card.querySelector('[role="textbox"]')
      return editor === null ? null : { card, editor }
    }

    /** The collapsed selection inside the editor, when it is there at all. */
    function readCaret(editor) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return null
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      if (range === null || !range.collapsed) return null
      if (!editor.contains(range.startContainer)) return null

      const prefixRange = document.createRange()
      prefixRange.selectNodeContents(editor)
      prefixRange.setEnd(range.startContainer, range.startOffset)
      const prefix = prefixRange.toString()

      const rect = caretRect(range)
      if (rect === null) return null
      return { prefix, left: rect.left, top: rect.top, height: rect.height }
    }

    function caretRect(range) {
      let rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        const rects = range.getClientRects()
        if (rects.length > 0) rect = rects[0]
      }
      if ((rect.width === 0 && rect.height === 0) || rect.top === 0 && rect.left === 0) {
        const fallback = rectBeforeCaret(range)
        if (fallback !== null) return fallback
      }
      if (rect.width === 0 && rect.height === 0) return null
      return { left: rect.left, top: rect.top, height: rect.height }
    }

    /** Measure the character before the caret when the collapsed range is empty. */
    function rectBeforeCaret(range) {
      const node = range.startContainer
      const offset = range.startOffset
      if (typeof Node === 'undefined' || node === null || node.nodeType !== Node.TEXT_NODE || offset <= 0) return null
      const probe = document.createRange()
      probe.setStart(node, offset - 1)
      probe.setEnd(node, offset)
      const rect = probe.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return null
      return { left: rect.right, top: rect.top, height: rect.height }
    }

    /** Whether the caret is at the effective end of the draft. */
    function caretAtEnd(editor, draft) {
      const caret = readCaret(editor)
      if (caret === null) return null
      const draftText = collapse(draft.trimEnd())
      const prefix = collapse(caret.prefix.trimEnd())
      if (prefix === '') return null
      // Strict equality: a prefix that also happens to be a suffix must not
      // pass, or the ghost targets (and later inserts at) a mid-draft caret.
      return draftText === prefix ? caret : null
    }

    function collapse(text) {
      return text.replace(/\s+/gu, ' ').trim()
    }

    /** A half-typed `/command` or `@reference` is not a message continuation. */
    function isTriggerToken(draft) {
      return /(?:^|\s)\/[^\s]*$/u.test(draft) || /(?:^|\s)@"?[^\s]*$/u.test(draft)
    }

    /** Show the model's first line while it is still streaming. */
    function streamingCandidate(stream) {
      if (stream.trim().length < STREAM_MIN_CHARS) return ''
      for (const raw of stream.split(/\r?\n/u)) {
        let line = raw.trim()
        if (line === '') continue
        if (/^none$/iu.test(line)) return ''
        line = cleanLine(line)
        if (line === '') continue
        return line.length > 240 ? line.slice(0, 240) : line
      }
      return ''
    }

    function cleanLine(line) {
      return line
        .replace(/^(?:[-*•]|\d+[.)])\s+/u, '')
        .replace(/^["'`\u201c\u201d]+|["'`\u201c\u201d]+$/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
    }

    /**
     * Join a continuation onto the draft without gluing words together.
     * Avoid repeating a separator already present in the exact draft.
     */
    function joinContinuation(draft, value) {
      if (draft === '' || value === '') return value
      if (/\s$/u.test(draft)) return value.replace(/^\s+/u, '')
      if (/^\s/u.test(value)) return value
      const last = draft.slice(-1)
      const first = value.slice(0, 1)
      // CJK text does not use a word separator; never invent one there.
      if (isCjk(last) || isCjk(first)) return value
      if (/[([{/\-—"'`]$/u.test(last)) return value
      if (/^[,.;:!?)\]}%]/u.test(first)) return value
      return ` ${value}`
    }

    function isCjk(character) {
      return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(character)
    }

    function sameBox(left, right) {
      return (
        left !== null &&
        left !== undefined &&
        left.top === right.top &&
        left.left === right.left &&
        left.height === right.height &&
        left.right === right.right &&
        left.maxWidth === right.maxWidth
      )
    }

    /** Parse a fully buffered SSE body, for shells that cannot stream fetch bodies. */
    function parseSseText(text) {
      const events = []
      for (const frame of text.split('\n\n')) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '') continue
          try {
            events.push(JSON.parse(payload))
          } catch {
            // Ignore a malformed frame.
          }
        }
      }
      return events
    }

    /** Read one SSE body and hand every `data:` payload to the callback. */
    async function consumeStream(body, signal, onEvent) {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let terminal = false
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (signal.aborted) break
          buffer += decoder.decode(value, { stream: true })
          let boundary = buffer.indexOf('\n\n')
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue
              const payload = line.slice(5).trim()
              if (payload === '') continue
              try {
                const event = JSON.parse(payload)
                if (event.type === 'done' || event.type === 'error') terminal = true
                onEvent(event)
              } catch {
                // A malformed frame is ignored; the draft keeps working.
              }
            }
            boundary = buffer.indexOf('\n\n')
          }
        }
        return terminal
      } finally {
        if (signal.aborted) {
          try {
            await reader.cancel()
          } catch {
            // Cancelling a finished stream is harmless.
          }
        }
        reader.releaseLock()
      }
    }

    function ComposerPrediction(props) {
      const { sessionId, useInput, useSessionStatus, inputActions, t } = props
      const predictionsEnabled = useEnabled()
      const settings = useSettings()
      const delaySeconds = settings?.delaySeconds
      const provider = settings?.provider
      const model = settings?.model
      const draft = useInput((state) => (state === undefined ? '' : state.draft || ''))
      const running = useSessionStatus((state) => (state === undefined ? false : state.get(sessionId)?.running === true))
      const [ghost, setGhost] = React.useState(NO_GHOST)
      const [box, setBox] = React.useState(null)
      const [compositionEnd, setCompositionEnd] = React.useState(0)

      const anchorRef = React.useRef(null)
      const elements = () => composerElementsNear(anchorRef.current)
      const abortRef = React.useRef(null)
      const composingRef = React.useRef(false)
      const dismissedRef = React.useRef(null)
      const acceptRef = React.useRef(null)
      const cycleRef = React.useRef(null)
      const currentRef = React.useRef('')

      const request = React.useCallback(
        async (mode, draftText) => {
          if (sessionId === undefined || sessionId === null) return
          if (typeof document !== 'undefined' && document.hidden) return
          abortRef.current?.abort()
          const controller = new AbortController()
          abortRef.current = controller
          setGhost({ mode, items: [], index: 0, stream: '', active: true })

          const settle = (items) => {
            if (controller.signal.aborted) return
            setGhost((previous) => {
              if (previous.mode !== mode) return previous
              if (items.length === 0) return NO_GHOST
              return { mode, items, index: 0, stream: '', active: false }
            })
          }

          try {
            const response = await fetch(ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
              body: JSON.stringify({ sessionId, mode, draft: draftText }),
              signal: controller.signal,
            })
            if (!response.ok || controller.signal.aborted) {
              settle([])
              return
            }

            const contentType = response.headers.get('content-type') || ''
            if (!contentType.includes('text/event-stream')) {
              // Compatibility path: an older Host answers one JSON prediction.
              const payload = await response.json().catch(() => null)
              const items = Array.isArray(payload?.suggestions)
                ? payload.suggestions.filter((item) => typeof item === 'string' && item !== '')
                : typeof payload?.suggestion === 'string' && payload.suggestion !== ''
                  ? [payload.suggestion]
                  : []
              settle(items)
              return
            }

            if (response.body === null) {
              // Some desktop shells buffer the fetch body; parse the whole stream.
              const text = await response.text().catch(() => '')
              const done = parseSseText(text).find((event) => event.type === 'done')
              settle(
                Array.isArray(done?.items)
                  ? done.items.filter((item) => typeof item === 'string' && item !== '')
                  : [],
              )
              return
            }

            const terminal = await consumeStream(response.body, controller.signal, (event) => {
              if (controller.signal.aborted) return
              if (event.type === 'delta' && typeof event.text === 'string') {
                setGhost((previous) =>
                  previous.active && previous.mode === mode
                    ? { ...previous, stream: previous.stream + event.text }
                    : previous,
                )
              } else if (event.type === 'done') {
                const items = Array.isArray(event.items)
                  ? event.items.filter((item) => typeof item === 'string' && item !== '')
                  : []
                settle(items)
              } else if (event.type === 'error') {
                settle([])
              }
            })
            if (!terminal) settle([])
          } catch {
            // An aborted or failed prediction is silent: the composer keeps working.
            if (!controller.signal.aborted) settle([])
          }
        },
        [sessionId],
      )

      React.useEffect(() => {
        if (predictionsEnabled) return
        abortRef.current?.abort()
        setGhost(NO_GHOST)
        setBox(null)
      }, [predictionsEnabled])

      // IME composition owns the draft until it commits: no prediction work.
      React.useEffect(() => {
        const onCompositionStart = () => {
          composingRef.current = true
          abortRef.current?.abort()
          setGhost(NO_GHOST)
          setBox(null)
        }
        const onCompositionEnd = () => {
          composingRef.current = false
          setCompositionEnd(value => value + 1)
        }
        document.addEventListener('compositionstart', onCompositionStart, true)
        document.addEventListener('compositionend', onCompositionEnd, true)
        return () => {
          document.removeEventListener('compositionstart', onCompositionStart, true)
          document.removeEventListener('compositionend', onCompositionEnd, true)
        }
      }, [])

      // A different Session starts from a clean slate.
      React.useEffect(() => {
        dismissedRef.current = null
        abortRef.current?.abort()
        setGhost(NO_GHOST)
        setBox(null)
        return () => abortRef.current?.abort()
      }, [sessionId])

      const priorRoute = React.useRef(null)
      React.useEffect(() => {
        if (provider === undefined || model === undefined) return
        const nextRoute = modelKey({ provider, model })
        if (priorRoute.current !== null && priorRoute.current !== nextRoute) {
          abortRef.current?.abort()
          setGhost(NO_GHOST)
          dismissedRef.current = null
        }
        priorRoute.current = nextRoute
      }, [provider, model])

      // Typing invalidates what was predicted for the previous text.
      React.useEffect(() => {
        abortRef.current?.abort()
        setGhost(NO_GHOST)
        if (dismissedRef.current !== null && dismissedRef.current.draft !== draft) {
          dismissedRef.current = null
        }
      }, [draft])

      // A starting turn drops the ghost and re-arms a dismissed prediction.
      React.useEffect(() => {
        if (!running) return
        abortRef.current?.abort()
        setGhost(NO_GHOST)
        dismissedRef.current = null
      }, [running])

      // `next`: ask once the turn has settled and the composer is empty.
      React.useEffect(() => {
        if (sessionId === undefined || sessionId === null) return undefined
        if (!predictionsEnabled || running || draft !== '') return undefined
        if (dismissedRef.current !== null && dismissedRef.current.draft === draft) return undefined
        const timer = setTimeout(() => {
          if (composingRef.current) return
          void request('next', '')
        }, SETTLE_MS)
        return () => clearTimeout(timer)
      }, [sessionId, running, draft, request, predictionsEnabled, compositionEnd])

      // `continue`: ask after a pause, only with the caret at the draft's end.
      React.useEffect(() => {
        if (sessionId === undefined || sessionId === null) return undefined
        if (!predictionsEnabled || delaySeconds === undefined || draft.trim() === '' || draft.length < CONTINUE_MIN_CHARS) return undefined
        if (isTriggerToken(draft)) return undefined
        if (dismissedRef.current !== null && dismissedRef.current.draft === draft) return undefined
        const timer = setTimeout(() => {
          if (composingRef.current) return
          const found = elements()
          if (found === null) return
          if (caretAtEnd(found.editor, draft) === null) return
          void request('continue', draft.slice(-MAX_DRAFT_CHARS))
        }, delaySeconds * 1000)
        return () => clearTimeout(timer)
      }, [sessionId, draft, request, predictionsEnabled, compositionEnd, delaySeconds, provider, model])

      // A prediction skipped while the page was hidden is retried on return.
      React.useEffect(() => {
        const onVisibility = () => {
          if (!predictionsEnabled || document.hidden) return
          if (draft !== '' || running) return
          if (currentRef.current !== '' || dismissedRef.current !== null) return
          if (sessionId === undefined || sessionId === null) return
          void request('next', '')
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
      }, [draft, running, sessionId, request, predictionsEnabled])

      const rawCandidate = ghost.items.length > 0
        ? ghost.items[Math.min(ghost.index, ghost.items.length - 1)] ?? ''
        : streamingCandidate(ghost.stream)
      const current = ghost.mode === 'continue' ? joinContinuation(draft, rawCandidate) : rawCandidate
      currentRef.current = current
      const hasCandidate = current !== ''

      const visible =
        predictionsEnabled &&
        current !== '' &&
        box !== null &&
        (ghost.mode === 'next'
          ? draft === '' && !running
          : draft.trim() !== '' && !isTriggerToken(draft))

      // `next` ghost spans the editor's text column.
      React.useLayoutEffect(() => {
        if (ghost.mode !== 'next') return undefined
        const measure = () => {
          const found = elements()
          if (found === null) {
            setBox((previous) => (previous === null ? previous : null))
            return
          }
          const cardRect = found.card.getBoundingClientRect()
          const editorRect = found.editor.getBoundingClientRect()
          if (editorRect.width <= 0 || editorRect.height <= 0) {
            setBox((previous) => (previous === null ? previous : null))
            return
          }
          const computed = window.getComputedStyle(found.editor)
          const lineHeight = Number.parseFloat(computed.lineHeight)
          const paddingTop = Number.parseFloat(computed.paddingTop)
          const paddingLeft = Number.parseFloat(computed.paddingLeft)
          const topInset = Number.isFinite(paddingTop) ? paddingTop : EDITOR_INSET_TOP
          const leftInset = Number.isFinite(paddingLeft) ? paddingLeft : EDITOR_INSET_LEFT
          const next = {
            top: Math.max(0, Math.round(editorRect.top - cardRect.top + topInset)),
            left: Math.max(0, Math.round(editorRect.left - cardRect.left + leftInset)),
            right: Math.max(EDITOR_INSET_RIGHT, Math.round(cardRect.right - editorRect.right + EDITOR_SCROLL_MARGIN)),
            height: Number.isFinite(lineHeight) && lineHeight > 0 ? Math.round(lineHeight) : FALLBACK_LINE_HEIGHT,
          }
          setBox((previous) => (sameBox(previous, next) ? previous : next))
        }
        measure()
        const found = elements()
        let observer
        if (found !== null && typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure)
          observer.observe(found.card)
          observer.observe(found.editor)
        }
        window.addEventListener('resize', measure)
        return () => {
          observer?.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [ghost.mode, draft, sessionId, running, hasCandidate])

      // `continue` ghost follows the caret.
      React.useLayoutEffect(() => {
        if (ghost.mode !== 'continue') return undefined
        let frame = 0
        const measure = () => {
          frame = 0
          const found = elements()
          if (found === null) {
            setBox((previous) => (previous === null ? previous : null))
            return
          }
          const caret = caretAtEnd(found.editor, draft)
          if (caret === null) {
            setBox((previous) => (previous === null ? previous : null))
            return
          }
          const editorRect = found.editor.getBoundingClientRect()
          if (editorRect.width <= 0 || editorRect.height <= 0) {
            setBox((previous) => (previous === null ? previous : null))
            return
          }
          const cardRect = found.card.getBoundingClientRect()
          const computed = window.getComputedStyle(found.editor)
          const lineHeight = Number.parseFloat(computed.lineHeight)
          const height =
            Number.isFinite(caret.height) && caret.height > 0
              ? Math.round(caret.height)
              : Number.isFinite(lineHeight) && lineHeight > 0
                ? Math.round(lineHeight)
                : FALLBACK_LINE_HEIGHT
          const desired = caret.left - cardRect.left
          const left = Math.max(0, desired)
          const maxWidth = cardRect.right - (cardRect.left + left) - 16
          if (maxWidth < 48) {
            setBox((previous) => (previous === null ? previous : null))
            return
          }
          const top = caret.top - cardRect.top
          // A caret scrolled above or below the card has no honest place to draw.
          if (top < 0 || top > cardRect.height - 8) {
            setBox((previous) => (previous === null ? previous : null))
            return
          }
          const next = {
            top: Math.round(top),
            left: Math.round(left),
            maxWidth: Math.round(maxWidth),
            height,
          }
          setBox((previous) => (sameBox(previous, next) ? previous : next))
        }
        const schedule = () => {
          if (frame === 0) frame = requestAnimationFrame(measure)
        }
        measure()
        document.addEventListener('selectionchange', schedule)
        document.addEventListener('scroll', schedule, true)
        const found = elements()
        window.addEventListener('resize', schedule)
        let observer
        if (found !== null && typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(schedule)
          observer.observe(found.card)
          observer.observe(found.editor)
        }
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          document.removeEventListener('selectionchange', schedule)
          document.removeEventListener('scroll', schedule, true)
          window.removeEventListener('resize', schedule)
          observer?.disconnect()
        }
      }, [ghost.mode, draft, sessionId, running, hasCandidate])

      const accept = () => {
        const value = currentRef.current
        if (value === '' || ghost.active) return
        const expected = ghost.mode === 'continue' ? draft + value : value
        dismissedRef.current = { draft: expected }
        abortRef.current?.abort()
        setGhost(NO_GHOST)
        setBox(null)
        try {
          // A refused insertion must never be bypassed by replacing the draft.
          if (inputActions.insertText(value, inputActions.captureInsertion()) !== true) return
        } catch {
          return
        }
        // Accepting leaves an editable draft: hand the keyboard back to the editor.
        try {
          const found = elements()
          if (found !== null && !found.card.contains(document.activeElement)) found.editor.focus()
        } catch {
          // Focus is a courtesy, never a failure.
        }
      }
      acceptRef.current = accept

      const cycle = (delta) => {
        setGhost((previous) => {
          if (previous.items.length <= 1) return previous
          const index = (previous.index + delta + previous.items.length) % previous.items.length
          return { ...previous, index }
        })
      }
      cycleRef.current = cycle

      React.useEffect(() => {
        if (!visible) return undefined
        const onKeyDown = (event) => {
          if (event.defaultPrevented) return
          // An IME candidate window owns the keyboard while composing.
          if (event.isComposing === true || event.keyCode === 229) return
          const found = elements()
          if (found === null) return
          const target = typeof Node !== 'undefined' && event.target instanceof Node ? event.target : null
          const inEditor = found.editor.contains(document.activeElement)
          const inCard =
            found.card.contains(document.activeElement) || (target !== null && found.card.contains(target))
          if (!inCard) return
          if (event.key === 'Escape') {
            // Dismiss only this suggestion: keep the gesture away from the
            // composer's own Escape handling (the Esc-Esc stop sequence).
            event.preventDefault()
            event.stopPropagation()
            dismissedRef.current = { draft }
            abortRef.current?.abort()
            setGhost(NO_GHOST)
            setBox(null)
            return
          }
          if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            if (ghost.items.length <= 1) return
            event.preventDefault()
            event.stopPropagation()
            cycleRef.current?.(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
          // Tab belongs to the editor only; on composer controls it must keep
          // its normal focus-traversal behavior.
          if (!inEditor || ghost.active) return
          if (ghost.mode === 'continue' && caretAtEnd(found.editor, draft) === null) return
          event.preventDefault()
          event.stopPropagation()
          acceptRef.current?.()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [visible, draft, ghost.items.length, ghost.active, ghost.mode])

      const anchor = h('span', {
        ref: anchorRef,
        'data-composer-prediction-anchor': '',
        'aria-hidden': 'true',
        style: { display: 'none' },
      })

      if (!visible || box === null) return anchor

      const continuation = ghost.mode === 'continue'
      const style = continuation ? CONTINUE_GHOST_STYLE : NEXT_GHOST_STYLE
      const showKeycap = !ghost.active && (!continuation || (box.maxWidth ?? 0) >= 96)
      const showBadge = ghost.items.length > 1

      return h(React.Fragment, null,
        h('span', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } }, ghost.active ? '' : t('ready').replace('{text}', current)),
        h('div',
          {
            style: { ...style, ...box },
            'aria-hidden': 'true',
            'data-composer-prediction': ghost.mode,
            title: current,
          },
          h('span', { style: continuation ? CONTINUE_TEXT_STYLE : TEXT_STYLE }, current),
          showBadge ? h('span', { style: BADGE_STYLE, title: t('more') }, `${ghost.index + 1}/${ghost.items.length}`) : null,
          showKeycap ? h('kbd', { style: KEYCAP_STYLE, title: t('accept') }, 'Tab') : null,
        ),
        anchor,
      )
    }


    return {
      inject: ['slots', 'locale'],
      __testing: { joinContinuation, parseSseText, streamingCandidate, cleanLine, consumeStream, setEnabled, readEnabled },
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES))
        ctx.effect(() => {
          const controller = new AbortController()
          const refresh = () => void loadSettings(controller.signal)
          const onStorage = (event) => {
            if (event.key === SETTINGS_CHANGED_KEY || event.key === null) refresh()
            if (event.key !== PREFERENCE_KEY && event.key !== null) return
            enabled = event.newValue !== 'false'
            for (const listener of preferenceListeners) listener()
          }
          refresh()
          window.addEventListener('storage', onStorage)
          window.addEventListener('focus', refresh)
          return () => {
            controller.abort()
            window.removeEventListener('storage', onStorage)
            window.removeEventListener('focus', refresh)
          }
        })
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: 'composer-predictions', order: 51, label: () => t('enabled') },
          () => h(PredictionsSetting, { t }),
        ))
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register(
            {
              name: SLOT,
              id: 'composer-predictions',
              order: 10,
              label: () => t('label'),
            },
            (slotProps) => h(ComposerPrediction, { ...slotProps, t }),
          ),
        )
      },
    }
  },
})
