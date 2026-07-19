self.addEventListener('push', (event) => {
  let payload = {}

  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'Nanopaquete'
  const options = {
    body: payload.body || 'Tienes una actualizacion pendiente.',
    icon: '/icnano.png',
    badge: '/icnano.png',
    tag: 'nanopaquete-negotiation',
    data: {
      url: payload.url || '/',
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existingClient = clients.find((client) => client.url === targetUrl)
        if (existingClient) return existingClient.focus()
        return self.clients.openWindow(targetUrl)
      }),
  )
})
