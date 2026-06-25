self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "New build available";
  const options = {
    body: data.body || "A new software build is ready to download.",
    data: {
      url: data.url || "/projects",
    },
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
