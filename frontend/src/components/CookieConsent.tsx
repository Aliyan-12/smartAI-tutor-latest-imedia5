import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "./ui";

const KEY = "cookie-consent-v1";

/** Minimal, honest cookie banner. Essential cookies (auth/security) are always on; non-essential
 *  (analytics) stay OFF until the user opts in — privacy-by-default, no dark patterns. */
export function CookieConsent() {
  const [choice, setChoice] = useState<string | null>(() => {
    try { return localStorage.getItem(KEY); } catch { return "dismissed"; }
  });
  if (choice) return null;
  const set = (v: string) => {
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
    setChoice(v);
  };
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] w-[min(560px,calc(100%-24px))] bg-surface border border-line rounded-xl shadow-lg p-4 animate-fade-in">
      <div className="t-card-title mb-1">Cookies</div>
      <p className="t-helper mb-3">
        We use essential cookies to keep you signed in and secure. Non‑essential (analytics)
        cookies stay off unless you allow them. See our{" "}
        <Link to="/legal/cookie_policy" className="text-brand underline">Cookie Policy</Link>.
      </p>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={() => set("essential")}>Essential only</Button>
        <Button size="sm" onClick={() => set("all")}>Allow all</Button>
      </div>
    </div>
  );
}
