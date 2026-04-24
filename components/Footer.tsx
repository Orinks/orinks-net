import Link from "next/link";
import { socialLinks } from "@/lib/site";

export function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <nav aria-label="Social links" className="mb-5 flex flex-wrap gap-3">
          {socialLinks.map((link) => (
            <a className="font-semibold text-action hover:text-action-dark" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <p className="text-sm text-slate-700">
          Copyright 2026 Josh&apos;s Domain. Built with Next.js, React, Tailwind CSS, Neon, and
          DigitalOcean App Platform.
        </p>
        <p className="mt-2 text-sm">
          <Link className="font-semibold text-action hover:text-action-dark" href="/api/health">
            System health
          </Link>
        </p>
      </div>
    </footer>
  );
}
