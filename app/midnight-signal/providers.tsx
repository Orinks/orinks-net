"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type ReactNode } from "react";

// NEXT_PUBLIC_CONVEX_URL is inlined at build time (set in Vercel env). When
// it's absent — local builds without a pulled value — render a static notice
// instead of crashing prerender.
export function MidnightSignalProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexReactClient(url) : null;
  });
  if (!client) {
    return (
      <div className="rounded-xl border border-amber-700 bg-zinc-950 p-6 text-amber-50 sm:p-8">
        <h1 className="text-2xl font-bold text-amber-200">The Midnight Signal</h1>
        <p className="mt-3 leading-7">
          The signal is off the air in this environment (no Convex deployment configured).
        </p>
      </div>
    );
  }
  // ConvexProviderWithClerk bridges the site-wide Clerk identity (from the root
  // ClerkProvider) to this game's own Convex deployment.
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
