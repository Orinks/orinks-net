import Link from "next/link";
import Image from "next/image";
import { gameModNav, navItems, projectNav, site } from "@/lib/site";

const disclosureNav = {
  "/game-mods": {
    overviewLabel: "Game Mods Overview",
    links: gameModNav,
  },
  "/projects": {
    overviewLabel: "Project Overview",
    links: projectNav,
  },
};

export function Header() {
  return (
    <header className="border-b border-line bg-white">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-action focus:ring-4 focus:ring-sky-300"
        href="#main"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <Image
            alt="Joshua Tubbs"
            className="h-14 w-14 rounded-md border border-line bg-slate-100 object-cover"
            height="56"
            src="https://github.com/Orinks.png"
            width="56"
          />
          <div>
            <Link className="text-xl font-bold text-ink hover:text-action" href="/">
              {site.name}
            </Link>
            <p className="text-sm leading-6 text-slate-700">{site.description}</p>
          </div>
        </div>
        <nav aria-label="Primary navigation" className="flex flex-wrap items-start gap-2">
          {navItems.map((item) => {
            const disclosure = disclosureNav[item.href as keyof typeof disclosureNav];

            return disclosure ? (
              <details className="group rounded-md" key={item.href}>
                <summary className="cursor-pointer list-none rounded-md px-3 py-2 font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-300 [&::-webkit-details-marker]:hidden">
                  {item.label}
                </summary>
                <div className="mt-2 flex min-w-52 flex-col rounded-md border border-line bg-white p-2 shadow-sm">
                  <Link
                    className="rounded-md px-3 py-2 font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-300"
                    href={item.href}
                  >
                    {disclosure.overviewLabel}
                  </Link>
                  {disclosure.links.map((link) => (
                    <Link
                      className="rounded-md px-3 py-2 text-sm font-semibold text-action hover:bg-sky-50 hover:text-action-dark focus:outline-none focus:ring-4 focus:ring-sky-300"
                      href={link.href}
                      key={link.href}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </details>
            ) : (
              <Link
                className="rounded-md px-3 py-2 font-semibold text-slate-800 hover:bg-sky-50 hover:text-action focus:outline-none focus:ring-4 focus:ring-sky-300"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
