import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.name,
    template: `%s - ${site.name}`,
  },
  description: site.description,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="font-sans">
          <a
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-ink focus:shadow"
            href="#main"
          >
            Skip to main content
          </a>
          <Header />
          <main
            className="mx-auto min-h-screen max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
            id="main"
            tabIndex={-1}
          >
            {children}
          </main>
          <Footer />
        </body>
      </html>
    </ClerkProvider>
  );
}
