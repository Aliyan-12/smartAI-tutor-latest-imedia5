import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
}

/** Underline tab strip. Controlled — pass `active` + `onChange`. */
export function Tabs({ items, active, onChange, className }: {
  items: TabItem[]; active: string; onChange: (key: string) => void; className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 flex-wrap border-b border-line", className)}>
      {items.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key} role="tab" aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold -mb-px border-b-2 transition-colors focus:outline-none focus-visible:shadow-focus",
              on ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.icon}{t.label}
          </button>
        );
      })}
    </div>
  );
}
