"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";

/** On the player's own page, signed in: a switch to hide it. Nothing for
 * anyone else. */
export function HidePage({ name }: { name: string }) {
  const me = useQuery(api.games.getMyGamesPlayer);
  const setHidden = useMutation(api.games.setProfileHidden);
  const router = useRouter();
  // Held here so the box does not flip back while the save is on its way.
  const [hidden, setLocal] = useState<boolean | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  if (!me || me.displayName.toLowerCase() !== name.toLowerCase()) return null;
  const shown = hidden ?? me.profileHidden;

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setLocal(next);
    try {
      const done = await setHidden({ hidden: next });
      if (done.ok) {
        router.refresh();
      } else {
        setLocal(!next);
        setStatus("Sign in again, then try again.");
      }
    } catch {
      setLocal(!next);
      setStatus("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Your page">
      <p>
        <input
          aria-disabled={busy || undefined}
          checked={shown}
          className="mr-2"
          id={id}
          onChange={(event) => toggle(event.target.checked)}
          type="checkbox"
        />
        <label htmlFor={id}>Hide my page</label>
      </p>
      <p aria-atomic="true" aria-live="polite" role="status">
        {status}
      </p>
    </Section>
  );
}
