import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { apply } from '../index.js'

const settingsPath = '/composer-prediction/settings'
const savedModel = { provider: 'alternate', model: 'quick' }

async function launch(t, initial = {}, { owner = true, editorFails = false, reapplies = true } = {}) {
  const routes = new Map()
  const calls = []
  const entry = {}
  let sessionRoute = { provider: 'main', model: 'default' }
  let config = initial
  const ctx = {
    fiber: { entry },
    get: (name) => name === 'configEditor' ? ctx.configEditor : undefined,
    configEditor: {
      async edit(target, change) {
        assert.equal(target, entry)
        if (editorFails) throw new Error('write failed')
        config = change(config)
        if (reapplies) apply(ctx, config)
      },
    },
    connection: { admit: () => ({ peer: { principal: { kind: owner ? 'owner' : 'guest' } } }) },
    effect: (register) => register(),
    webServer: { register: ({ path, handler }) => routes.set(path, handler) },
    llm: {
      listProviders: () => [{ id: 'alternate', name: 'Alternate' }, { id: 'broken', name: 'Broken' }],
      async listModels(provider) {
        if (provider === 'broken') throw new Error('provider unavailable')
        return [{ id: 'quick', name: 'Quick', hiddenField: 'private-metadata' }]
      },
      async prepareCall(route) {
        calls.push(route)
        return {
          config: route,
          async *stream() {
            yield { type: 'text-delta', text: 'add a short example' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      },
    },
    sessions: { get: () => ({ seq: 1, requestHeader: () => ({ config: sessionRoute }), deriveMessages: () => [] }) },
  }
  apply(ctx, config)
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://localhost').pathname)
    if (handler) return handler(req, res)
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  const request = (path, data) => fetch(`http://127.0.0.1:${server.address().port}${path}`, data === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  })
  return { request, calls, readConfig: () => config, setSessionRoute: (route) => { sessionRoute = route } }
}

test('reads a one-second default and lists available model groups without exposing extra metadata', async (t) => {
  const { request } = await launch(t)
  const preferences = await request(settingsPath)
  assert.equal(preferences.status, 200)
  assert.deepEqual(await preferences.json(), { delaySeconds: 1, provider: '', model: '' })
  const models = await request('/composer-prediction/models')
  assert.equal(models.status, 200)
  assert.deepEqual(await models.json(), [{ id: 'alternate', name: 'Alternate', models: [{ id: 'quick', name: 'Quick' }] }])
})

test('saves the selected model and delay, preserves other config, and routes predictions to that model', async (t) => {
  const { request, calls, readConfig } = await launch(t, { maxOutputTokens: 300 })
  const predict = (draft = 'Please ') => request('/composer-prediction', { sessionId: 'session', mode: 'continue', draft })
  assert.equal((await predict()).status, 200)
  const changed = { ...savedModel, delaySeconds: 10 }
  const saved = await request(settingsPath, changed)
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), changed)
  assert.deepEqual(await (await request(settingsPath)).json(), changed)
  assert.equal(readConfig().maxOutputTokens, 300)
  const prediction = await (await predict()).json()
  assert.deepEqual(prediction.suggestions, ['add a short example'])
  assert.equal((await request(settingsPath, { provider: '', model: '' })).status, 200)
  assert.deepEqual(await (await request(settingsPath)).json(), { provider: '', model: '', delaySeconds: 10 })
  const following = await predict('Could you ')
  assert.equal(following.status, 200)
  assert.deepEqual((await following.json()).suggestions, ['add a short example'])
  assert.deepEqual(calls.map(({ provider, model }) => ({ provider, model })), [
    { provider: 'main', model: 'default' }, savedModel, { provider: 'main', model: 'default' },
  ])
})

test('following the conversation uses the new route for the same draft after a model switch', async (t) => {
  const { request, calls, setSessionRoute } = await launch(t)
  const predict = async () => {
    const response = await request('/composer-prediction', { sessionId: 'session', mode: 'continue', draft: 'Please ' })
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.equal((await predict()).cached, false)
  assert.equal((await predict()).cached, true)
  setSessionRoute({ provider: 'alternate', model: 'default' })
  assert.equal((await predict()).cached, false)
  setSessionRoute(savedModel)
  assert.equal((await predict()).cached, false)
  assert.deepEqual(calls.map(({ provider, model }) => ({ provider, model })), [
    { provider: 'main', model: 'default' }, { provider: 'alternate', model: 'default' }, savedModel,
  ])
})

test('rejects invalid delay and models without persisting either change', async (t) => {
  const { request, readConfig } = await launch(t)
  for (const delaySeconds of [0, 61, 2.5, '5']) {
    assert.equal((await request(settingsPath, { delaySeconds })).status, 400)
  }
  assert.equal((await request(settingsPath, { provider: 'alternate' })).status, 400)
  assert.equal((await request(settingsPath, { ...savedModel, model: 'unknown' })).status, 400)
  assert.deepEqual(readConfig(), {})
})

test('configuration and model catalog require owner access', async (t) => {
  const { request, readConfig } = await launch(t, {}, { owner: false })
  assert.equal((await request(settingsPath)).status, 403)
  assert.equal((await request('/composer-prediction/models')).status, 403)
  assert.equal((await request(settingsPath, { delaySeconds: 8 })).status, 403)
  assert.deepEqual(readConfig(), {})
})

test('failed save leaves persisted preferences unchanged', async (t) => {
  const { request, readConfig } = await launch(t, { delaySeconds: 8 }, { editorFails: true })
  assert.equal((await request(settingsPath, { delaySeconds: 10 })).status, 500)
  assert.deepEqual(readConfig(), { delaySeconds: 8 })
})

test('saved settings take effect even when the Harness does not re-apply the plugin', async (t) => {
  const { request, calls } = await launch(t, { maxOutputTokens: 300 }, { reapplies: false })
  const changed = { ...savedModel, delaySeconds: 12 }
  const saved = await request(settingsPath, changed)
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), changed)
  assert.deepEqual(await (await request(settingsPath)).json(), changed)
  const prediction = await request('/composer-prediction', { sessionId: 'session', mode: 'continue', draft: 'Please ' })
  assert.equal(prediction.status, 200)
  assert.deepEqual(calls.map(({ provider, model, maxTokens }) => ({ provider, model, maxTokens })), [
    { ...savedModel, maxTokens: 300 },
  ])
})
