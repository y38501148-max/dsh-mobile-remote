// Business data, authorization cookies, application JS and API responses are
// never cached by this worker. Only the generic offline page is retained.
const CACHE = 'dsh-remote-offline-v1'
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.add('/remote/offline'))); self.skipWaiting() })
self.addEventListener('activate', event => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('dsh-remote-offline-') && k !== CACHE).map(k => caches.delete(k))))])))
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(async () => (await caches.match('/remote/offline')) || Response.error()))
})
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch {}
  event.waitUntil(self.registration.showNotification('DeepSeek Harness', { body: data.kind === 'attention' ? '电脑任务需要你的处理。' : '电脑任务状态已更新。', tag: 'dsh-remote-task', data: { url: '/' } }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(c => new URL(c.url).origin === self.location.origin)
    if (client) { await client.focus(); return client.navigate('/') }
    return self.clients.openWindow('/')
  }))
})
