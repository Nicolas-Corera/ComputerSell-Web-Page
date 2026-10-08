// Service worker de la tienda: solo notificaciones push (no cachea nada).
// Lo registra assets/js/core/notifications.js. Cada push trae
// {title, body, url, tag} (api/notify-mail.js -> api/_lib/push.js).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || "ComputerSell", {
      body: data.body || "",
      icon: "/assets/images/favicon-192x192.png",
      badge: "/assets/images/favicon-32x32.png",
      tag: data.tag || undefined,
      lang: "es-AR",
      data: { url: data.url || "/perfil.html#avisos" },
    }),
  );
});

// Al tocarla: si la tienda ya está abierta se usa esa pestaña, si no se abre una
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const tab = list.find((c) => new URL(c.url).origin === url.origin && "focus" in c);
      if (tab && "navigate" in tab) {
        // navigate() solo anda en pestañas controladas por este worker
        return tab
          .navigate(url.href)
          .then((c) => (c || tab).focus())
          .catch(() => self.clients.openWindow(url.href));
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
