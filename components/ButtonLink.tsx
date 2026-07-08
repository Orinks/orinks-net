import Link from "next/link";
import type { ReactNode } from "react";

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
};

export function ButtonLink({ href, children, variant = "primary" }: ButtonLinkProps) {
  const className =
    variant === "primary"
      ? "inline-flex items-center justify-center rounded-md bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark focus:outline-none focus:ring-4 focus:ring-sky-600 focus:ring-offset-2"
      : "inline-flex items-center justify-center rounded-md border border-action px-4 py-2 font-semibold text-action hover:bg-sky-50 focus:outline-none focus:ring-4 focus:ring-sky-600";

  const isExternal = href.startsWith("http");

  if (isExternal) {
    return (
      <a className={className} href={href}>
        {children}
      </a>
    );
  }

  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}
