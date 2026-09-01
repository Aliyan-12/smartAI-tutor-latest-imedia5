/**
 * Accessibility preferences (Feature 05).
 *
 * These are per-viewer display settings — text size, reduced motion, high contrast,
 * captions. They are applied to the <html> element (see the matching rules in
 * styles/index.css) and mirrored to localStorage so they take effect instantly on the
 * next load, before the student's profile has been fetched (no flash of default UI).
 * The authoritative copy lives on the student profile under
 * teaching_preferences.accessibility and is synced down on login.
 */

export type TextSize = "default" | "large" | "larger";

export interface AccessibilityPrefs {
  text_size: TextSize;
  reduced_motion: boolean;
  high_contrast: boolean;
  captions: boolean;
}

export const DEFAULT_A11Y: AccessibilityPrefs = {
  text_size: "default",
  reduced_motion: false,
  high_contrast: false,
  captions: false,
};

const STORAGE_KEY = "smartai:accessibility";

export function readStoredA11y(): AccessibilityPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_A11Y };
    const parsed = JSON.parse(raw) as Partial<AccessibilityPrefs>;
    return { ...DEFAULT_A11Y, ...parsed };
  } catch {
    return { ...DEFAULT_A11Y };
  }
}

/** Normalise anything loaded from the server profile into a clean, bounded shape. */
export function coerceA11y(raw: unknown): AccessibilityPrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const size = r.text_size;
  return {
    text_size: size === "large" || size === "larger" ? size : "default",
    reduced_motion: r.reduced_motion === true,
    high_contrast: r.high_contrast === true,
    captions: r.captions === true,
  };
}

/** Apply to <html> and persist to localStorage. Safe to call repeatedly. */
export function applyAccessibility(a: AccessibilityPrefs): void {
  const el = document.documentElement;
  if (a.text_size === "default") el.removeAttribute("data-text-size");
  else el.setAttribute("data-text-size", a.text_size);
  el.classList.toggle("reduce-motion", a.reduced_motion);
  el.classList.toggle("high-contrast", a.high_contrast);
  el.classList.toggle("captions-on", a.captions);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* private mode / storage disabled — the in-DOM application still holds for this session. */
  }
}

/** Call once at app boot to apply the last-known settings before React mounts. */
export function bootAccessibility(): void {
  applyAccessibility(readStoredA11y());
}
