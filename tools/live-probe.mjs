/**
 * Manual probe for a running Harness Web GUI. Usage:
 *   node tools/live-probe.mjs <sessionId> [next|continue] ["draft text"]
 *
 * Prints SSE frames with elapsed time so streaming and cache hits are visible.
 * Requires the profile to be reloaded after changing the plugin.
 * Set DSH_COOKIE to an authenticated Harness cookie; never commit it.
 */
const endpoint = process.env.DSH_URL ?? 'http://127.0.0.1:53828'
const [, , sessionId, mode = 'next', draft = ''] = process.argv

if (sessionId === undefined || !process.env.DSH_COOKIE) {
  console.error('usage: node tools/live-probe.mjs <sessionId> [next|continue] ["draft text"]')
  console.error('DSH_URL and an authenticated DSH_COOKIE must be set in the environment.')
  process.exit(1)
}

const started = Date.now()
const response = await fetch(`${endpoint}/composer-prediction/v2`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: process.env.DSH_COOKIE },
  body: JSON.stringify({ sessionId, mode, draft }),
})

console.log(`status ${response.status} ${response.headers.get('content-type') ?? ''}`)
if (!response.ok) {
  console.log(await response.text())
  process.exit(1)
}

const reader = response.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  let boundary = buffer.indexOf('\n\n')
  while (boundary >= 0) {
    const frame = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 2)
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '') continue
      console.log(`+${String(Date.now() - started).padStart(5)}ms`, payload)
    }
    boundary = buffer.indexOf('\n\n')
  }
}
