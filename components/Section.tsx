import type { ReactNode } from "react";

type SectionProps = {
  title?: string;
  children: ReactNode;
};

export function Section({ title, children }: SectionProps) {
  return (
    <section className="py-8">
      {title ? <h2 className="mb-4 text-2xl font-bold text-ink">{title}</h2> : null}
      <div className="prose prose-slate max-w-none prose-a:text-action prose-a:font-semibold prose-li:my-1">
        {children}
      </div>
    </section>
  );
}
