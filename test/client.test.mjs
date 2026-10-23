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

  assert.equal(registered.length, 1)
  assert.equal(registered[0].spec.name, 'conversation.input.overlay')
  assert.equal(registered[0].spec.id, 'composer-predictions')
  assert.equal(typeof registered[0].component, 'function')
})


test('continuation joining only separates real words', async () => {
  let definition
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  await import('../client.js?join')
  const module = definition.factory(() => ({ createElement: () => null }))
  const { joinContinuation } = module.__testing

  assert.equal(joinContinuation('Can you also', 'add the tests'), ' add the tests')
  assert.equal(joinContinuation('Can you also ', 'add the tests'), 'add the tests')
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
