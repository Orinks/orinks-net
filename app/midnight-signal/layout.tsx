import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AnnouncerProvider } from "./_components/Announcer";
import { MidnightSignalProviders } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "The Midnight Signal",
    template: "%s - The Midnight Signal",
  },
  description:
    "An audio music trivia roguelite for blind and visually impaired players, broadcast from somewhere past channel 99.",
};

export default function MidnightSignalLayout({ children }: { children: ReactNode }) {
  return (
    <MidnightSignalProviders>
      <AnnouncerProvider>
        <div className="rounded-xl border border-amber-700 bg-zinc-950 p-6 text-amber-50 sm:p-8">
          {children}
        </div>
      </AnnouncerProvider>
    </MidnightSignalProviders>
  );
}
