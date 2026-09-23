import { forwardRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

/* ─────────────────────────────  Button  ───────────────────────────── */
type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-md " +
  "transition-colors focus:outline-none focus-visible:shadow-focus disabled:opacity-50 " +
  "disabled:cursor-not-allowed select-none whitespace-nowrap";

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "bg-surface-muted text-ink border border-line hover:bg-surface-hover",
  ghost: "text-ink-soft hover:bg-surface-hover hover:text-ink",
  outline: "border border-line text-ink bg-surface hover:bg-surface-hover",
  danger: "bg-danger text-white hover:brightness-110",
  success: "bg-success text-white hover:brightness-110",
};

const BTN_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, leftIcon, rightIcon, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(BTN_BASE, BTN_VARIANTS[variant], BTN_SIZES[size], fullWidth && "w-full", className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

/* ─────────────────────────────  IconButton  ───────────────────────────── */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "outline" | "solid";
  size?: "sm" | "md";
  "aria-label": string;
}
const IB_SIZES = { sm: "h-8 w-8", md: "h-10 w-10" };
const IB_VARIANTS = {
  ghost: "text-ink-muted hover:bg-surface-hover hover:text-ink",
  outline: "border border-line text-ink-soft hover:bg-surface-hover",
  solid: "bg-brand text-white hover:bg-brand-hover",
};
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", className, children, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:shadow-focus disabled:opacity-50",
        IB_SIZES[size], IB_VARIANTS[variant], className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ─────────────────────────────  Card  ───────────────────────────── */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("bg-surface border border-line rounded-lg shadow-sm", className)} {...rest}>
      {children}
    </div>
  );
}
export function CardHeader({ title, subtitle, actions, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="min-w-0">
        {title && <h3 className="text-[15px] font-bold text-ink leading-tight">{title}</h3>}
        {subtitle && <p className="text-[12.5px] text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...rest}>{children}</div>;
}

/* ─────────────────────────────  StatCard  ───────────────────────────── */
export function StatCard({ label, value, icon, accent = "brand", hint }: {
  label: string; value: ReactNode; icon?: ReactNode; accent?: "brand" | "success" | "warning" | "danger"; hint?: ReactNode;
}) {
  const accentText = { brand: "text-brand", success: "text-success", warning: "text-warning", danger: "text-danger" }[accent];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
          <div className={cn("text-[28px] font-extrabold leading-none mt-2", accentText)}>{value}</div>
          {hint && <div className="text-[12px] text-ink-muted mt-1.5">{hint}</div>}
        </div>
        {icon && <div className="text-ink-muted">{icon}</div>}
      </div>
    </Card>
  );
}

/* ─────────────────────────────  Badge  ───────────────────────────── */
type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-ink-soft",
  brand: "bg-brand-light text-brand",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  danger: "bg-danger-light text-danger",
};
export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold", BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

/* ─────────────────────────────  Alert  ───────────────────────────── */
type AlertTone = "info" | "success" | "warning" | "danger";
const ALERT_TONES: Record<AlertTone, string> = {
  info: "bg-brand-light text-brand border-brand/20",
  success: "bg-success-light text-success border-success/20",
  warning: "bg-warning-light text-warning border-warning/20",
  danger: "bg-danger-light text-danger border-danger/20",
};
export function Alert({ tone = "info", title, className, children }: { tone?: AlertTone; title?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("border rounded-lg px-4 py-3 text-[13px]", ALERT_TONES[tone], className)}>
      {title && <div className="font-bold mb-0.5">{title}</div>}
      {children}
    </div>
  );
}

/* ─────────────────────────────  Skeleton / Spinner  ───────────────────────────── */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-surface-muted", className)} {...rest} />;
}
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-ink-muted", className)} />;
}

/* ─────────────────────────────  EmptyState  ───────────────────────────── */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {icon && <div className="text-ink-muted mb-3">{icon}</div>}
      <div className="text-[15px] font-bold text-ink">{title}</div>
      {description && <div className="text-[13px] text-ink-muted mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
