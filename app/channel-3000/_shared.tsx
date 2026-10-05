import { statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

export const link = "font-semibold text-action underline hover:text-action-dark";

export function megabytes(src: string) {
  return (statSync(join(process.cwd(), "public", src)).size / 1e6).toFixed(1);
}

export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="font-bold text-ink">{title}</h4>
      <div className="mt-1 leading-7 text-slate-700">{children}</div>
    </div>
  );
}
