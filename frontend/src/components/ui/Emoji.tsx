import { useState } from "react";
import { cn } from "./cn";

/**
 * Emoji wrapper for friendly / educational moments ONLY (never critical controls — those use
 * `Icon`). Renders Microsoft Fluent Emoji (MIT) when the named asset is self-hosted under
 * `public/emoji/<name>.svg`, and degrades gracefully to the native Unicode glyph otherwise — so
 * there is no hard third-party CDN dependency (UK Children's Code friendly).
 *
 * Usage: <Emoji glyph="🎓" name="graduation-cap" label="Graduation" />
 * `label` makes it an announced image; omit for purely decorative emoji.
 */
const BASE = "/emoji"; // self-hosted Fluent Emoji SVGs (see THIRD_PARTY_NOTICES.md)

export function Emoji({ glyph, name, label, size = 20, className }: {
  glyph: string;
  name?: string;
  label?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const a11y = label
    ? ({ role: "img" as const, "aria-label": label })
    : ({ "aria-hidden": true as const });

  if (name && !failed) {
    return (
      <img
        src={`${BASE}/${name}.svg`}
        width={size}
        height={size}
        alt={label ?? ""}
        onError={() => setFailed(true)}
        className={cn("inline-block align-[-0.15em]", className)}
        {...(label ? {} : { "aria-hidden": true })}
      />
    );
  }
  return (
    <span
      {...a11y}
      style={{ fontSize: size, lineHeight: 1, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
      className={cn("inline-block align-[-0.1em] not-italic", className)}
    >
      {glyph}
    </span>
  );
}
