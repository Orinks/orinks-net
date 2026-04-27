import { socialLinks } from "@/lib/site";
import { HomeStatusPanel } from "@/components/HomeStatusPanel";

export function Footer() {
  return (
    <footer aria-labelledby="site-footer-heading" className="border-t border-line bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h2 className="sr-only" id="site-footer-heading">
          Site footer
        </h2>
        <HomeStatusPanel variant="footer" />
        <nav aria-label="Social links" className="mb-5 flex flex-wrap gap-3">
          {socialLinks.map((link) => (
            <a className="font-semibold text-action hover:text-action-dark" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <p className="text-sm text-slate-700">Copyright 2026 Josh&apos;s Domain.</p>
      </div>
    </footer>
  );
}
