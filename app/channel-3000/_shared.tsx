import type { ReactNode } from "react";

export const link = "font-semibold text-action underline hover:text-action-dark";

export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="font-bold text-ink">{title}</h4>
      <div className="mt-1 leading-7 text-slate-700">{children}</div>
    </div>
  );
}
