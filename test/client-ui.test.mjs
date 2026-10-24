import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function mount({ draft = 'Can you also', active = false, stream = '', items = [' update the README'], caret = 100, width = 600, insert = true, fetch } = {}) {
  let definition, registered, request
  let index = 0
  const state = [{ mode: draft === '' ? 'next' : 'continue', items, index: 0, stream, active }, { left: 100, top: 10, maxWidth: 400, height: 24 }]
  const effects = [], layouts = [], listeners = new Map(), inserted = []
  const editor = { contains: () => true, getBoundingClientRect: () => ({ width, height: 100 }) }
  const card = { contains: () => true, querySelector: () => editor, getBoundingClientRect: () => ({ left: 0, top: 0, right: width, width, height: 100 }) }
  const document = { activeElement: editor, hidden: false, querySelector: () => card, createRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => draft }), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} }
  const window = { __ModuleLoader__: { load: value => { definition = value } }, getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ collapsed: true, startContainer: {}, startOffset: draft.length, getBoundingClientRect: () => ({ left: caret, top: 10, width: 0, height: 24 }) }) }), getComputedStyle: () => ({ lineHeight: '24px' }), addEventListener() {}, removeEventListener() {} }
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }), useState: () => { const i = index++; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] }, useRef: () => ({ current: null }), useCallback: fn => { request = fn; return fn }, useEffect: fn => effects.push(fn), useLayoutEffect: fn => layouts.push(fn), useSyncExternalStore: (_subscribe, read) => read() }
  vm.runInNewContext(source, { window, document, fetch, AbortController, TextDecoder, ReadableStream, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {} })
  const module = definition.factory(id => id === 'react' ? react : { Switch: 'switch' })
  module.apply({ locale: { bind: () => key => key, register() {} }, effect: fn => fn(), slots: { inject: (_name, fn) => fn(), register: (spec, component) => { if (spec.name === 'conversation.input.overlay') registered = component } } })
  const inputActions = { captureInsertion: () => ({}), insertText: value => { inserted.push(value); return insert }, setDraft: () => { throw new Error('Must never replace the draft') } }
  const wrapper = registered({ sessionId: 's1', useInput: select => select({ draft }), useSessionStatus: select => select(new Map()), inputActions })
  const tree = wrapper.type(wrapper.props)
  return { state, effects, layouts, listeners, inserted, request, tree }
}

function keyEvent(key, extra = {}) {
  return { key, prevented: false, preventDefault() { this.prevented = true }, stopPropagation() {}, ...extra }
}

test('Tab leaves a streaming preview alone and accepts only final text', () => {
  const preview = mount({ active: true, items: [], stream: 'Can you also update the README' })
  for (const effect of preview.effects) effect()
  const early = keyEvent('Tab')
  preview.listeners.get('keydown')(early)
  assert.equal(early.prevented, false)
  assert.deepEqual(preview.inserted, [])
  const ready = mount()
  for (const effect of ready.effects) effect()
  const tab = keyEvent('Tab')
  ready.listeners.get('keydown')(tab)
  assert.equal(tab.prevented, true)
  assert.deepEqual(ready.inserted, [' update the README'])
})

test('refused insertion never replaces the existing draft', () => {
  const view = mount({ insert: false })
  for (const effect of view.effects) effect()
  assert.doesNotThrow(() => view.listeners.get('keydown')(keyEvent('Tab')))
})

test('right edge hides the ghost instead of moving it over the draft', () => {
  const edge = mount({ caret: 590 })
  for (const effect of edge.layouts) effect()
  assert.equal(edge.state[1], null)
  const fits = mount({ caret: 400 })
  for (const effect of fits.layouts) effect()
  assert.equal(fits.state[1].left, 400)
  assert.equal(fits.state[1].maxWidth, 184)
})

test('a stream ending without done clears the partial ghost', async () => {
  const view = mount({ fetch: async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"partial text"}\n\n'))
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream' } }) })
  await view.request('continue', 'Can you also')
  assert.equal(view.state[0].active, false)
  assert.equal(view.state[0].stream, '')
  assert.equal(view.state[0].items.length, 0)
})

test('final suggestions have an accessible announcement, previews do not', () => {
  const ready = mount().tree
  assert.equal(ready.children[0].props.role, 'status')
  assert.equal(ready.children[0].props['aria-live'], 'polite')
  const preview = mount({ active: true, items: [], stream: 'preview text' }).tree
  assert.equal(preview.children[0].children[0], '')
})
