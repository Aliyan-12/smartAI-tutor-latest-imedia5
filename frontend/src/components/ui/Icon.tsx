import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

/**
 * Consistent wrapper for interface icons. The app standardises on ONE icon family — Lucide
 * (ISC licensed) — so sizing/stroke stay uniform. Decorative by default (aria-hidden); pass a
 * `label` to expose an accessible name (e.g. an icon-only control).
 */
export function Icon({ icon: LucideCmp, size = 18, label, className }: {
  icon: LucideIcon;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <LucideCmp
      size={size}
      className={cn("shrink-0", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
