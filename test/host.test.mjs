import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'

import { apply } from '../index.js'

function text(role, value) {
  return { role, content: [{ type: 'text', text: value }] }
}

function toolCall(id, name, args) {
  return { role: 'assistant', content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] }
}

function toolResult(callId, value, isError = false) {
  return { role: 'tool', toolCallId: callId, isError, content: [{ type: 'text', text: value }] }
}

function makeSession(messages, options = {}) {
  return {
    seq: options.seq ?? 1,
    requestHeader: () => ({ config: options.route ?? { provider: 'deepseek-account', model: 'deepseek-flash' } }),
    deriveMessages: () => messages,
  }
}

function makeHarness(options = {}) {
  const routes = new Map()
  const sessions = new Map()
  const llmCalls = []
  const sessionReads = []
  const disposers = []
  let reply = options.reply ?? 'ok'
  let finish = options.finish ?? { kind: 'stop' }
  let failing = options.fail === true

  const llm = {
    async prepareCall(config, _signal, configure) {
      const model = options.model ?? { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } }
      const controls = configure === undefined ? { ...config } : configure({ ...config }, model)
      return {
        config: { ...config, ...controls },
        async *stream(request) {
          llmCalls.push({ config, controls, request, model })
          if (failing) throw new Error('model exploded')
          const chunks = typeof reply === 'function' ? reply(request) : [{ type: 'text-delta', text: reply }]
          for await (const chunk of chunks) yield chunk
          yield { type: 'finish', reason: finish }
        },
      }
    },
  }

  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (dispose) disposers.push(dispose)
      return () => dispose?.()
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    sessions: { get: (id) => { sessionReads.push(id); return sessions.get(id) } },
    connection: { admit: options.admit ?? (() => ({ peer: { principal: { kind: 'owner' } } })) },
    llm,
    get: () => options.fallbackModel,
  }

  apply(ctx, options.config)
  return {
    routes,
    sessions,
    llmCalls,
    sessionReads,
    dispose: () => disposers.reverse().forEach(fn => fn()),
    setReply(value) {
      reply = value
    },
    setFinish(value) {
      finish = value
    },
    setFail(value) {
      failing = value
    },
  }
}

function makeRequest(body, method = 'POST') {
  const request = new EventEmitter()
  request.method = method
  request.headers = { 'content-type': 'application/json' }
  request.destroy = () => {}
  setImmediate(() => {
    if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)))
    request.emit('end')
  })
  return request
}

function makeResponse() {
  const response = new EventEmitter()
  response.writableEnded = false
  response.status = 0
  response.headers = {}
  response.chunks = []
  response.writeHead = (status, headers) => {
    response.status = status
    response.headers = headers ?? {}
  }
  response.flushHeaders = () => {}
  response.write = (chunk) => {
    response.chunks.push(String(chunk))
    return true
  }
  response.end = (chunk) => {
    if (chunk !== undefined) response.chunks.push(String(chunk))
    response.writableEnded = true
    response.emit('finish')
  }
  return response
}

function callRoute(route, body, method) {
  const response = makeResponse()
  const settled = new Promise((resolve) => response.once('finish', () => resolve(response)))
  route.handler(makeRequest(body, method), response)
  return settled
}

function sseEvents(response) {
  return response.chunks
    .join('')
    .split('\n\n')
    .filter((frame) => frame.trim() !== '')
    .map((frame) => JSON.parse(frame.replace(/^data: /, '').trim()))
}

const JSON_ENTRY = '/composer-prediction'
const STREAM_ENTRY = '/composer-prediction/v2'

const CONVERSATION = [
  text('user', 'The build is failing on the new test.'),
  text('assistant', 'The failure is in test/parser.test.ts; the fixture expects a trailing newline.'),
]

test('next mode returns cleaned candidates and caches by session sequence', async () => {
  const harness = makeHarness({ reply: '- Run the test again\n- Show me the failing assertion\n"Commit the fix"' })
  const session = makeSession(CONVERSATION)
  harness.sessions.set('s1', session)
  const route = harness.routes.get(JSON_ENTRY)

  const first = await callRoute(route, { sessionId: 's1' })
  const payload = JSON.parse(first.chunks.join(''))
  assert.equal(payload.suggestion, 'Run the test again')
  assert.deepEqual(payload.suggestions, ['Run the test again', 'Show me the failing assertion', 'Commit the fix'])
  assert.equal(harness.llmCalls.length, 1)
  assert.match(harness.llmCalls[0].request.system, /follow-up suggestion engine/)
  assert.match(harness.llmCalls[0].request.messages[0].content[0].text, /Conversation tail/)

  const second = await callRoute(route, { sessionId: 's1' })
  const cached = JSON.parse(second.chunks.join(''))
  assert.equal(cached.cached, true)
  assert.deepEqual(cached.suggestions, payload.suggestions)
  assert.equal(harness.llmCalls.length, 1, 'an unchanged session sequence must not call the model twice')

  session.seq = 2
  const third = await callRoute(route, { sessionId: 's1' })
  assert.equal(harness.llmCalls.length, 2, 'a new turn must invalidate the cached prediction')
  assert.equal(JSON.parse(third.chunks.join('')).cached, false)
})

test('stream mode sends meta, deltas, and the final candidates', async () => {
  const harness = makeHarness({ reply: 'update the README\nrun the full suite' })
  harness.sessions.set('s1', makeSession(CONVERSATION))
  const route = harness.routes.get(STREAM_ENTRY)

  const response = await callRoute(route, { sessionId: 's1', mode: 'continue', draft: 'Can you also' })
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /text\/event-stream/)

  const events = sseEvents(response)
  assert.equal(events[0].type, 'meta')
  assert.equal(events[0].mode, 'continue')
  const streamed = events.filter((event) => event.type === 'delta').map((event) => event.text).join('')
  assert.equal(streamed, 'update the README\nrun the full suite')
  const done = events.at(-1)
  assert.equal(done.type, 'done')
  assert.deepEqual(done.items, ['update the README', 'run the full suite'])

  const prompt = harness.llmCalls[0].request.messages[0].content[0].text
  assert.match(prompt, /Draft text ending at the caret/)
  assert.match(prompt, /"Can you also"/)
  assert.match(prompt, /Write only the continuation text\./)
})

test('a max-tokens finish still offers whole streamed lines', async () => {
  const harness = makeHarness({ reply: 'first option\nsecond option', finish: { kind: 'max-tokens' } })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const payload = JSON.parse(response.chunks.join(''))
  assert.deepEqual(payload.suggestions, ['first option'])
})

test('next mode declines when the agent has not replied yet', async () => {
  const harness = makeHarness()
  harness.sessions.set('s1', makeSession([text('user', 'still working?')]))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const payload = JSON.parse(response.chunks.join(''))
  assert.equal(payload.suggestion, null)
  assert.deepEqual(payload.suggestions, [])
  assert.equal(payload.reason, 'no-conversation')
  assert.equal(harness.llmCalls.length, 0)
})

test('tool activity reaches the prompt', async () => {
  const harness = makeHarness({ reply: 'Show the failing assertion' })
  harness.sessions.set(
    's1',
    makeSession([
      text('user', 'Fix the failing test.'),
      toolCall('c1', 'bash', { command: 'npm test' }),
      toolResult('c1', '3 failing assertions in parser.test.ts', true),
      text('assistant', 'The parser test fails on the trailing newline.'),
    ]),
  )

  await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const prompt = harness.llmCalls[0].request.messages[0].content[0].text
  assert.match(prompt, /Recent tool activity/)
  assert.match(prompt, /bash\(\{"command":"npm test"\}\) -> failed/)
  assert.match(prompt, /3 failing assertions/)
})

test('configuration selects the route and reasoning effort', async () => {
  const harness = makeHarness({
    reply: 'go on',
    config: { provider: 'local', model: 'tiny', reasoningEffort: 'high' },
  })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const call = harness.llmCalls[0]
  assert.equal(call.config.provider, 'local')
  assert.equal(call.config.model, 'tiny')
  assert.equal(call.controls.reasoningEffort, 'high')
})

test('an unadvertised effort falls back to the model lowest', async () => {
  const harness = makeHarness({
    reply: 'go on',
    config: { reasoningEffort: 'max' },
    model: { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }] } },
  })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  assert.equal(harness.llmCalls[0].controls.reasoningEffort, 'off')
})

test('a continuation request without a draft does nothing', async () => {
  const harness = makeHarness()
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1', mode: 'continue', draft: '   ' })
  const payload = JSON.parse(response.chunks.join(''))
  assert.equal(payload.suggestion, null)
  assert.equal(payload.reason, 'no-draft')
  assert.equal(harness.llmCalls.length, 0)
})

test('invalid requests are answered without touching the model', async () => {
  const harness = makeHarness()
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const wrongMethod = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' }, 'GET')
  assert.equal(wrongMethod.status, 405)

  const missing = await callRoute(harness.routes.get(JSON_ENTRY), {})
  assert.equal(missing.status, 400)
  assert.equal(JSON.parse(missing.chunks.join('')).reason, 'missing-session')

  const offline = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 'gone' })
  assert.equal(JSON.parse(offline.chunks.join('')).reason, 'session-not-live')

  assert.equal(harness.llmCalls.length, 0)
})

test('duplicates are dropped and a restated draft is trimmed', async () => {
  const harness = makeHarness({ reply: 'Can you also update the README\nCan you also update the README\nNONE' })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), {
    sessionId: 's1',
    mode: 'continue',
    draft: 'Can you also ',
  })
  const payload = JSON.parse(response.chunks.join(''))
  assert.deepEqual(payload.suggestions, [' update the README'])
})

test('a suggestion is bounded at a word boundary', async () => {
  const long = 'word '.repeat(80).trim()
  const harness = makeHarness({ reply: long })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const [suggestion] = JSON.parse(response.chunks.join('')).suggestions
  assert.ok(suggestion.length <= 240)
  assert.ok(suggestion.endsWith('word'))
  assert.ok(!suggestion.includes('  '))
})

test('a failed model call is reported instead of hanging', async () => {
  const harness = makeHarness({ fail: true })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const json = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const payload = JSON.parse(json.chunks.join(''))
  assert.equal(payload.suggestion, null)
  assert.deepEqual(payload.suggestions, [])
  assert.match(payload.reason, /model exploded/)

  const streamed = await callRoute(harness.routes.get(STREAM_ENTRY), { sessionId: 's1' })
  const events = sseEvents(streamed)
  assert.equal(events.at(-1).type, 'error')
  assert.match(events.at(-1).reason, /model exploded/)
})

test('a bare NONE reply yields no suggestion', async () => {
  const harness = makeHarness({ reply: 'NONE' })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const payload = JSON.parse(response.chunks.join(''))
  assert.deepEqual(payload.suggestions, [])
  assert.equal(payload.reason, 'empty')
})

test('maxSuggestions caps the candidate list', async () => {
  const harness = makeHarness({
    reply: 'one\ntwo\nthree\nfour',
    config: { maxSuggestions: 2 },
  })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  assert.deepEqual(JSON.parse(response.chunks.join('')).suggestions, ['one', 'two'])
})

test('half a route override is ignored in favor of the Session route', async () => {
  const harness = makeHarness({ reply: 'go on', config: { provider: 'local' } })
  harness.sessions.set('s1', makeSession(CONVERSATION, { route: { provider: 'deepseek-account', model: 'deepseek-flash' } }))

  await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  assert.equal(harness.llmCalls[0].config.provider, 'deepseek-account')
  assert.equal(harness.llmCalls[0].config.model, 'deepseek-flash')
})


test('a tool-call-only assistant tail does not count as a reply', async () => {
  const harness = makeHarness()
  harness.sessions.set(
    's1',
    makeSession([
      text('user', 'Fix the failing test.'),
      toolCall('c1', 'bash', { command: 'npm test' }),
      toolResult('c1', '3 failing', true),
    ]),
  )

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const payload = JSON.parse(response.chunks.join(''))
  assert.equal(payload.suggestion, null)
  assert.equal(payload.reason, 'no-conversation')
  assert.equal(harness.llmCalls.length, 0)
})

test('continuations cache per draft at one session sequence', async () => {
  const harness = makeHarness({ reply: ' add one' })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const first = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1', mode: 'continue', draft: 'Can you' })
  assert.deepEqual(JSON.parse(first.chunks.join('')).suggestions, [' add one'])
  assert.equal(harness.llmCalls.length, 1)

  harness.setReply(' add two')
  const second = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1', mode: 'continue', draft: 'Can you also' })
  assert.deepEqual(JSON.parse(second.chunks.join('')).suggestions, [' add two'])
  assert.equal(harness.llmCalls.length, 2, 'a different draft at the same sequence is a different request')

  const third = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1', mode: 'continue', draft: 'Can you' })
  assert.equal(JSON.parse(third.chunks.join('')).cached, true)
  assert.equal(harness.llmCalls.length, 2)
})

test('a failed terminal finish reports the provider failure', async () => {
  const harness = makeHarness({ reply: 'ignored', finish: { kind: 'error', failure: { code: 'SERVER', message: 'provider exploded' } } })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const payload = JSON.parse(response.chunks.join(''))
  assert.deepEqual(payload.suggestions, [])
  assert.equal(payload.reason, 'provider exploded')
})

test('a model continuation keeps its leading separator space', async () => {
  const harness = makeHarness({ reply: ' add the runner' })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), {
    sessionId: 's1',
    mode: 'continue',
    draft: 'Can you also',
  })
  assert.deepEqual(JSON.parse(response.chunks.join('')).suggestions, [' add the runner'])
})


test('prompt labels and the task cue are not offered as suggestions', async () => {
  const harness = makeHarness({
    reply: 'Write only the continuation text.\nConversation tail (oldest first):\nDraft text ending at the caret:\n add a loading state',
  })
  harness.sessions.set('s1', makeSession(CONVERSATION))

  const response = await callRoute(harness.routes.get(JSON_ENTRY), {
    sessionId: 's1',
    mode: 'continue',
    draft: 'Can you also',
  })
  assert.deepEqual(JSON.parse(response.chunks.join('')).suggestions, [' add a loading state'])
})

test('both HTTP routes enforce connection admission before reading sessions or calling the model', async t => {
  const admissions = []
  const harness = makeHarness({ admit: request => {
    admissions.push(request.url)
    if (request.headers.origin === 'https://example.org' || request.headers['sec-fetch-site'] === 'cross-site') return { rejection: 403 }
    if (request.headers.cookie !== 'test-owner=valid') return { rejection: 401 }
    return { peer: { principal: { kind: request.headers['x-test-principal'] ?? 'owner' } } }
  } })
  harness.sessions.set('s1', makeSession(CONVERSATION))
  const server = createServer((request, response) => harness.routes.get(request.url).handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const base = `http://127.0.0.1:${server.address().port}`
  for (const path of [JSON_ENTRY, STREAM_ENTRY]) {
    for (const [headers, status] of [
      [{}, 401],
      [{ origin: 'https://example.org', 'content-type': 'text/plain' }, 403],
      [{ cookie: 'test-owner=valid', 'sec-fetch-site': 'cross-site' }, 403],
      [{ cookie: 'test-owner=valid', 'x-test-principal': 'delegate' }, 403],
      [{ cookie: 'test-owner=valid', 'content-type': 'text/plain' }, 415],
    ]) {
      const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ sessionId: 's1' }) })
      assert.equal(response.status, status)
      await response.text()
    }
    assert.equal(harness.llmCalls.length, 0)
  }
  for (const path of [JSON_ENTRY, STREAM_ENTRY]) {
    for (const body of ['{', 'null', '[]', '3', JSON.stringify({ sessionId: 's1', mode: 'bogus' }), JSON.stringify({ sessionId: 's1', draft: 'x'.repeat(65536) })]) {
      const response = await fetch(base + path, { method: 'POST', headers: { cookie: 'test-owner=valid', 'content-type': 'application/json' }, body })
      assert.equal(response.status, 400)
      await response.text()
    }
  }
  assert.equal(harness.llmCalls.length, 0)
  assert.equal(harness.sessionReads.length, 0)
  for (const path of [JSON_ENTRY, STREAM_ENTRY]) {
    const response = await fetch(base + path, { method: 'POST', headers: { cookie: 'test-owner=valid', 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ sessionId: 's1' }) })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /ok/)
  }
  assert.equal(harness.llmCalls.length, 1, 'authenticated JSON and SSE share the cache')
  assert.equal(admissions.length, 24)
})

test('a token-limited partial first candidate is discarded', async () => {
  const harness = makeHarness({ reply: 'Run the tests and then che', finish: { kind: 'max-tokens' } })
  harness.sessions.set('s1', makeSession(CONVERSATION))
  const response = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  assert.deepEqual(JSON.parse(response.chunks.join('')).suggestions, [])
})

test('continuations with colliding former draft hashes never reuse another draft suggestion', async () => {
  const harness = makeHarness({ reply: ' first suggestion' })
  harness.sessions.set('s1', makeSession(CONVERSATION))
  const route = harness.routes.get(JSON_ENTRY)
  await callRoute(route, { sessionId: 's1', mode: 'continue', draft: 'Please update 1s8d3zb' })
  harness.setReply(' second suggestion')
  const response = await callRoute(route, { sessionId: 's1', mode: 'continue', draft: 'Please update xc4ukp' })
  assert.deepEqual(JSON.parse(response.chunks.join('')).suggestions, [' second suggestion'])
  assert.equal(harness.llmCalls.length, 2)
})

test('simultaneous requests do not cancel each other and plugin disposal aborts outstanding work', async () => {
  const signals = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const harness = makeHarness({ reply: async function* (request) {
    signals.push(request.signal)
    await gate
    yield { type: 'text-delta', text: 'Try the build again' }
  } })
  harness.sessions.set('s1', makeSession(CONVERSATION))
  const first = callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  const second = callRoute(harness.routes.get(STREAM_ENTRY), { sessionId: 's1' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(signals.length, 2)
  assert.equal(signals[0].aborted, false)
  assert.equal(signals[1].aborted, false)
  harness.dispose()
  assert.ok(signals.every(signal => signal.aborted))
  release()
  const [json, stream] = await Promise.all([first, second])
  assert.deepEqual(JSON.parse(json.chunks.join('')).suggestions, [])
  assert.equal(sseEvents(stream).at(-1).type, 'error')
})

test('disconnect cancels only that request and never caches its partial output', async () => {
  let signal, release
  const gate = new Promise(resolve => { release = resolve })
  const harness = makeHarness({ reply: async function* (request) {
    signal = request.signal
    yield { type: 'text-delta', text: 'partial' }
    await gate
  } })
  harness.sessions.set('s1', makeSession(CONVERSATION))
  const response = makeResponse()
  const handled = harness.routes.get(STREAM_ENTRY).handler(makeRequest({ sessionId: 's1' }), response)
  await new Promise(resolve => setImmediate(resolve))
  response.destroyed = true
  response.emit('close')
  assert.equal(signal.aborted, true)
  release()
  await handled
  harness.setReply('A fresh completed suggestion')
  const next = await callRoute(harness.routes.get(JSON_ENTRY), { sessionId: 's1' })
  assert.equal(JSON.parse(next.chunks.join('')).cached, false)
  assert.equal(harness.llmCalls.length, 2)
})
