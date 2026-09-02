/**
 * Composite loading skeletons (Branch 02 — Premium UI/UX).
 *
 * A small set of Tailwind, token-bound skeletons so every data screen shows a shaped
 * placeholder that mirrors its real layout instead of a bare centred spinner. They inherit the
 * base `Skeleton` (animate-pulse) and therefore automatically freeze under
 * `html.reduce-motion` / prefers-reduced-motion.
 */
import { Skeleton } from "./primitives";
import { cn } from "./cn";

/** A run of text-line bars of gently varying width. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${[100, 92, 78, 85, 70][i % 5]}%` }} />
      ))}
    </div>
  );
}

/** A card-shaped block: a title bar + a few text lines. */
export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface p-5", className)}>
      <Skeleton className="h-4 w-1/3 mb-4" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** A row of KPI stat-card placeholders. */
export function SkeletonStats({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-4">
          <Skeleton className="h-3 w-1/2 mb-3" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** A table skeleton with a header row + body rows (mirrors the data-table pattern). */
export function SkeletonTable({ rows = 6, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface overflow-hidden", className)}>
      <div className="flex gap-4 px-4 py-3 border-b border-line">
        {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className="h-3 flex-1" />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3.5 border-b border-line last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3.5 flex-1" style={{ opacity: 1 - r * 0.06 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A list skeleton with a leading avatar/marker + text (mirrors notification / member lists). */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface divide-y divide-line", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3.5">
          <Skeleton className="w-9 h-9 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-3.5 w-1/3 mb-2" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A generic page skeleton: header + KPIs + a card. Good default for dashboards. */
export function SkeletonPage({ stats = 4, className }: { stats?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div>
        <Skeleton className="h-6 w-52 mb-2" />
        <Skeleton className="h-3.5 w-80" />
      </div>
      {stats > 0 && <SkeletonStats count={stats} />}
      <SkeletonCard lines={4} />
    </div>
  );
}
