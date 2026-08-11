import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('PWA install caches built assets and activation only removes Aurora caches', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  const listeners = {}
  const added = []
  const deleted = []
  const indexHtml = '<link rel="stylesheet" href="./assets/index-test.css"><script type="module" src="./assets/index-test.js"></script>'
  const mainBundleUrl = 'https://example.test/aurora-gomoku/assets/index-test.js'
  const cache = {
    async addAll(entries) { added.push(...entries) },
    async match(request) {
      if (String(request).endsWith('index.html')) return new Response(indexHtml)
      if (String(request) === mainBundleUrl) return new Response('new URL("ai.worker-test123.js",import.meta.url)')
      return undefined
    },
    async put() {},
  }
  const context = vm.createContext({
    self: {
      registration: { scope: 'https://example.test/aurora-gomoku/' },
      location: { origin: 'https://example.test' },
      clients: { claim() {} },
      skipWaiting() {},
      addEventListener(type, listener) { listeners[type] = listener },
    },
    caches: {
      async open() { return cache },
      async keys() { return ['other-project-v9', 'aurora-gomoku-v2.0.0', 'aurora-gomoku-v2.1.0'] },
      async delete(key) { deleted.push(key); return true },
      async match() { return undefined },
    },
    fetch: async () => new Response('ok'),
    Response,
    URL,
    Set,
    Error,
  })
  vm.runInContext(source, context, { filename: 'sw.js' })

  let installPromise
  listeners.install({ waitUntil(promise) { installPromise = promise } })
  await installPromise
  assert.equal(added.includes('https://example.test/aurora-gomoku/assets/index-test.js'), true)
  assert.equal(added.includes('https://example.test/aurora-gomoku/assets/index-test.css'), true)
  assert.equal(added.includes('https://example.test/aurora-gomoku/assets/ai.worker-test123.js'), true)

  let activatePromise
  listeners.activate({ waitUntil(promise) { activatePromise = promise } })
  await activatePromise
  assert.deepEqual(deleted, ['aurora-gomoku-v2.0.0'])
})
