// Service Worker for Web Push Notifications
// This file must be served from the root scope.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const isCall = data.tag === 'call';

  const options = {
    body: data.body,
    icon: '/assets/images/zchat.png',
    badge: '/assets/images/zchat.png',
    tag: data.tag,
    data: { url: data.url },
    vibrate: isCall ? [200, 100, 200, 100, 200] : [100],
    actions: isCall
      ? [
          { action: 'answer', title: 'Answer' },
          { action: 'decline', title: 'Decline' },
        ]
      : [],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  if (event.action === 'decline') {
    return;
  }

  // 'answer' action or default click — open/focus the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
