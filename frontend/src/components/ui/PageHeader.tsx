import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "./cn";

/** Standard page header: optional back action, title + subtitle, and right-aligned actions. */
export function PageHeader({ title, subtitle, onBack, actions, className }: {
  title: ReactNode; subtitle?: ReactNode; onBack?: () => void; actions?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-6", className)}>
      <div className="flex items-start gap-3 min-w-0">
        {onBack && (
          <button
            onClick={onBack} aria-label="Back"
            className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink focus:outline-none focus-visible:shadow-focus"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold text-ink leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-[13px] text-ink-muted mt-1">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
