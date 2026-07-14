import type { CSSProperties, ReactNode } from "react";

/**
 * Shared chrome for every hands-on manipulative.
 *
 * The seven activities look nothing alike, but they all obey the same rules, and those rules
 * are the point: this is used by children as young as four. Everything is big, everything is
 * tappable, the Check button is impossible to miss, and the activity fills the panel instead
 * of huddling in the middle of it.
 */

export const BAND = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  blue: "#2563eb",
  green: "#16a34a",
  pink: "#ec4899",
  orange: "#f97316",
  purple: "#7c3aed",
};

/** Minimum touch target. Below ~44px a small child misses; we go bigger where we can. */
export const TAP = 48;

export function Stage({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: "8px 16px 0",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The one action bar at the bottom. Always in the same place, always the same shape. */
export function CheckBar({
  onCheck, disabled, label = "Check", hint,
}: { onCheck: () => void; disabled?: boolean; label?: string; hint?: ReactNode }) {
  return (
    <div
      style={{
        flexShrink: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "14px 16px 18px",
      }}
    >
      {hint ? <span style={{ fontSize: 14, color: BAND.muted, fontWeight: 600 }}>{hint}</span> : null}
      <button
        onClick={onCheck}
        disabled={disabled}
        style={{
          minHeight: 56,
          padding: "0 44px",
          fontSize: 19,
          fontWeight: 800,
          fontFamily: "inherit",
          color: "#fff",
          background: disabled ? "#cbd5e1" : BAND.green,
          border: "none",
          borderRadius: 14,
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: disabled ? "none" : "0 4px 0 #15803d",
          transition: "transform .08s, box-shadow .08s",
        }}
        onMouseDown={(e) => {
          if (disabled) return;
          e.currentTarget.style.transform = "translateY(3px)";
          e.currentTarget.style.boxShadow = "0 1px 0 #15803d";
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = "";
          e.currentTarget.style.boxShadow = disabled ? "none" : "0 4px 0 #15803d";
        }}
      >
        {label}
      </button>
    </div>
  );
}

/** A round +/- stepper. Used by any activity where a quantity goes up and down. */
export function Stepper({
  sign, onClick, disabled, colour,
}: { sign: "+" | "−"; onClick: () => void; disabled?: boolean; colour?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={sign === "+" ? "Add one" : "Take one away"}
      style={{
        width: TAP,
        height: TAP,
        borderRadius: "50%",
        border: `2px solid ${disabled ? BAND.line : colour || BAND.blue}`,
        background: disabled ? "#f8fafc" : "#fff",
        color: disabled ? "#cbd5e1" : colour || BAND.blue,
        fontSize: 26,
        fontWeight: 800,
        lineHeight: 1,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {sign}
    </button>
  );
}
