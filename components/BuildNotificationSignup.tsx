"use client";

import { useId, useState } from "react";

type BuildNotificationSignupProps = {
  productName: string;
};

type Status = "idle" | "busy" | "error" | "ready" | "unsupported";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);

  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

async function getPublicKey() {
  const response = await fetch("/api/notifications/vapid-public-key");

  if (!response.ok) {
    throw new Error("Build notifications are not configured yet.");
  }

  const data = (await response.json()) as { publicKey?: string };

  if (!data.publicKey) {
    throw new Error("Build notifications are not configured yet.");
  }

  return data.publicKey;
}

export function BuildNotificationSignup({ productName }: BuildNotificationSignupProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState(
    "Get a browser notification when a new build is published.",
  );
  const statusId = useId();

  async function getRegistration() {
    await navigator.serviceWorker.register("/sw.js");
    return navigator.serviceWorker.ready;
  }

  async function subscribe() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus("unsupported");
      setMessage("This browser does not support build notifications.");
      return;
    }

    setStatus("busy");
    setMessage("Preparing browser notifications...");

    try {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setStatus("idle");
        setMessage("Notifications were not enabled. You can try again whenever you like.");
        return;
      }

      const publicKey = await getPublicKey();
      const registration = await getRegistration();
      let existingSubscription = await registration.pushManager.getSubscription();

      if (existingSubscription) {
        const existing = existingSubscription.toJSON();

        if (!existing.endpoint || !existing.keys?.auth || !existing.keys?.p256dh) {
          await existingSubscription.unsubscribe();
          existingSubscription = null;
        }
      }

      const subscription =
        existingSubscription ??
        (await registration.pushManager.subscribe({
          applicationServerKey: urlBase64ToUint8Array(publicKey),
          userVisibleOnly: true,
        }));
      const serialized = subscription.toJSON();
      const response = await fetch("/api/notifications/subscribe", {
        body: JSON.stringify({
          endpoint: serialized.endpoint,
          expirationTime: serialized.expirationTime ?? null,
          keys: serialized.keys,
          product: productName,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("The subscription could not be saved.");
      }

      setStatus("ready");
      setMessage(`Build notifications are on for ${productName}.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Build notifications could not be enabled.");
    }
  }

  async function unsubscribe() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      setMessage("This browser does not support build notifications.");
      return;
    }

    setStatus("busy");
    setMessage("Turning off build notifications...");

    try {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      const serialized = subscription?.toJSON();

      if (!serialized?.endpoint) {
        setStatus("idle");
        setMessage(`Build notifications are off for ${productName}.`);
        return;
      }

      const response = await fetch("/api/notifications/subscribe", {
        body: JSON.stringify({
          endpoint: serialized.endpoint,
          product: productName,
        }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("The subscription could not be removed.");
      }

      setStatus("idle");
      setMessage(`Build notifications are off for ${productName}.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Build notifications could not be turned off.");
    }
  }

  return (
    <section
      aria-labelledby={`${statusId}-heading`}
      className="rounded-lg border border-line bg-white p-5"
    >
      <h3 id={`${statusId}-heading`} className="text-xl font-bold text-ink">
        Build notifications
      </h3>
      <p className="mt-2 max-w-3xl text-slate-700" id={statusId}>
        {message}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          aria-describedby={statusId}
          className="rounded-md bg-action px-4 py-3 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-300 disabled:cursor-not-allowed disabled:bg-slate-500"
          disabled={status === "busy" || status === "ready" || status === "unsupported"}
          onClick={subscribe}
          type="button"
        >
          {status === "busy" ? "Working..." : "Notify me about new builds"}
        </button>
        <button
          aria-describedby={statusId}
          className="rounded-md border border-line bg-white px-4 py-3 font-semibold text-action hover:border-action hover:bg-sky-50 focus:outline-none focus:ring-4 focus:ring-sky-300 disabled:cursor-not-allowed disabled:text-slate-500"
          disabled={status === "busy" || status === "unsupported"}
          onClick={unsubscribe}
          type="button"
        >
          Turn off build notifications
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
