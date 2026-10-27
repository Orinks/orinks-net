"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type ReactNode } from "react";
import { Section } from "@/components/Section";

// As FreightFateOnlineProviders: Clerk's identity bridged to Convex, or a
// notice when the build has no Convex URL.
export function GamesProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexReactClient(url) : null;
  });

  if (!client) {
    return (
      <Section title="Connecting games is unavailable">
        <p>Games cannot be connected here.</p>
      </Section>
    );
  }

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
