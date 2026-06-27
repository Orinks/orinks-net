self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "New build available";
  const body = data.body || "A new software build is ready to download.";
  const url = data.url || "/projects";
  const tagSource = data.product || url || title;
  const tagId = data.sentAt || Date.now();
  const options = {
    body,
    data: {
      url,
    },
    silent: false,
    tag: `build:${String(tagSource).toLowerCase().replace(/[^a-z0-9:-]+/g, "-")}:${tagId}`,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/projects";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.endsWith(url)) {
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    }),
  );
});
