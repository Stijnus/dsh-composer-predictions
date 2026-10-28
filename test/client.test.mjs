import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Load the browser half the way the Harness module loader does, then run its
 * `apply` against a fake slot/locale context. This catches top-level mistakes
 * (bad imports, wrong slot name, missing registration) without a DOM.
 */
test('client half registers the composer overlay slot', async () => {
  let definition
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }

  await import('../client.js')
  assert.ok(definition, 'the module loader receives one definition')
  assert.equal(definition.id, 'dsh-composer-predictions')
  assert.equal(typeof definition.factory, 'function')

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: () => [undefined, () => {}],
    useRef: () => ({ current: undefined }),
    useCallback: (fn) => fn,
    useLayoutEffect: () => {},
    useEffect: () => {},
  }

  const module = definition.factory((id) => {
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: 'switch' }
    throw new Error(`unexpected require: ${id}`)
  })

  assert.deepEqual(module.inject, ['slots', 'locale'])
  assert.equal(typeof module.__testing, 'object')

  const registered = []
  const localeRegistrations = []
  const ctx = {
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale: {
      bind: (namespace) => (key) => `${namespace}:${key}`,
      register: (namespace, dictionaries) => {
        localeRegistrations.push({ namespace, dictionaries })
        return () => {}
      },
    },
    slots: {
      inject: (name, register) => register(),
      register: (spec, component) => {
        registered.push({ spec, component })
        return () => {}
      },
    },
  }

  module.apply(ctx)

  assert.equal(localeRegistrations.length, 1)
  assert.equal(localeRegistrations[0].namespace, 'composer-predictions')
  assert.equal(typeof localeRegistrations[0].dictionaries.en.accept, 'string')

  assert.equal(registered.length, 2)

  const overlayRegistration = registered.find((entry) => entry.spec.name === 'conversation.input.overlay')
  assert.ok(overlayRegistration)
  assert.equal(overlayRegistration.spec.id, 'composer-predictions')
  assert.equal(typeof overlayRegistration.component, 'function')

  assert.ok(!registered.some((entry) => entry.spec.name === 'shell.overlay'), 'no timed star popup registers on the shell overlay')
})


test('continuation joining only separates real words', async () => {
  let definition
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  await import('../client.js?join')
  const module = definition.factory(() => ({ createElement: () => null }))
  const { joinContinuation } = module.__testing

  assert.equal(joinContinuation('Can you also', 'add the tests'), ' add the tests')
  assert.equal(joinContinuation('Can you also ', 'add the tests'), 'add the tests')
  assert.equal(joinContinuation('Can you also ', ' add the tests'), 'add the tests')
  assert.equal(joinContinuation('Can you also', ' add the tests'), ' add the tests')
  assert.equal(joinContinuation('', 'text'), 'text')
  assert.equal(joinContinuation('Use (', 'x)'), 'x)')
  assert.equal(joinContinuation('Run it,', 'then check'), ' then check')
  assert.equal(joinContinuation('\u8bf7\u4f60', '\u7ee7\u7eed'), '\u7ee7\u7eed')
})

test('SSE text and streaming candidates are parsed defensively', async () => {
  let definition
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  await import('../client.js?parse')
  const module = definition.factory(() => ({ createElement: () => null }))
  const { parseSseText, streamingCandidate } = module.__testing

  assert.deepEqual(parseSseText('data: {"type":"done","items":["a"]}\n\ndata: nope\n\ndata: {"type":"delta","text":"x"}\n\n'), [
    { type: 'done', items: ['a'] },
    { type: 'delta', text: 'x' },
  ])
  assert.equal(streamingCandidate('- first option'), 'first option')
  assert.equal(streamingCandidate('NONE'), '')
  assert.equal(streamingCandidate(''), '')
})


test('stream consumption requires a terminal event and handles split UTF-8 frames', async () => {
  let definition
  globalThis.window = { __ModuleLoader__: { load: value => { definition = value } } }
  await import('../client.js?consume')
  const { consumeStream } = definition.factory(() => ({})).__testing
  const bytes = new TextEncoder().encode('data: {"type":"delta","text":"继续"}\n\ndata: {"type":"done","items":["继续"]}\n\n')
  const events = []
  const stream = new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1))
    controller.close()
  } })
  assert.equal(await consumeStream(stream, new AbortController().signal, event => events.push(event)), true)
  assert.equal(events[0].text, '继续')
  assert.equal(stream.locked, false)
  const incomplete = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"unfinished"}\n\n'))
    controller.close()
  } })
  assert.equal(await consumeStream(incomplete, new AbortController().signal, () => {}), false)
})

test('prediction preference persists and works without local storage', async () => {
  let definition
  let stored = 'false'
  globalThis.window = { localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value } }, __ModuleLoader__: { load: value => { definition = value } } }
  await import('../client.js?preference')
  const { readEnabled, setEnabled } = definition.factory(() => ({})).__testing
  assert.equal(readEnabled(), false)
  setEnabled(true)
  assert.equal(readEnabled(), true)
  assert.equal(stored, 'true')
  window.localStorage.setItem = () => { throw new Error('Storage blocked') }
  setEnabled(false)
  assert.equal(readEnabled(), false)
})
