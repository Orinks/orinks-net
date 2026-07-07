"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type ReactNode } from "react";
import { Section } from "@/components/Section";

// NEXT_PUBLIC_CONVEX_URL is inlined at build time (set in Vercel env). When
// it's absent — local builds without a pulled value — render a static notice
// instead of crashing prerender. The page's PageHeader still owns the single
// <h1>, so this fallback is a sibling <h2> Section, not a second heading.
export function FreightFateOnlineProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexReactClient(url) : null;
  });

  if (!client) {
    return (
      <Section title="Online sharing is unavailable">
        <p>
          Freight Fate online sharing is not configured on this Orinks deployment, so driver setup
          is off the air here. It works on the live site.
        </p>
      </Section>
    );
  }

  // ConvexProviderWithClerk bridges the site-wide Clerk identity (from the root
  // ClerkProvider) to the site's shared Convex deployment.
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
