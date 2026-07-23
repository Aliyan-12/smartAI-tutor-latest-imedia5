import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import type { PuzzlePayload } from "./types";

/**
 * MermaidDiagram — renders a Mermaid spec to crisp SVG live in the browser.
 *
 * Display-only: the tutor puts a flowchart / cycle / sequence / timeline / mind-map on the Learn
 * panel to EXPLAIN a concept, then teaches from it. Rendering is instant and exact (no image
 * generation, no GPU), so unlike a generated picture it can never misdraw the diagram.
 *
 * The model occasionally emits a slightly invalid spec; rather than showing a red parser error we
 * fall back to the caption plus the raw spec, so a lesson never breaks on a bad diagram.
 */

let _initialised = false;
function ensureInit() {
  if (_initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",   // the spec is model-authored — no click handlers, no scripts
    flowchart: { htmlLabels: true, curve: "basis" },
    fontFamily: "inherit",
    // REQUIRED, not cosmetic. mermaid renders into a temp container attached to <body>; when a
    // spec fails to parse it draws its built-in "error" diagram — a cartoon BOMB with "Syntax
    // error in text" — and skips removeTempElements(), so the bomb is orphaned in the DOM
    // OUTSIDE our React tree and survives navigation. A student saw two bombs stuck to the
    // bottom-left of the lesson page. With this on, mermaid cleans up and rethrows instead, so
    // the `.catch()` below is the only failure path and our own fallback card is what shows.
    suppressErrorRendering: true,
  });
  _initialised = true;
}

let _seq = 0;

export default function MermaidDiagram({ payload }: { payload: PuzzlePayload }) {
  const spec = (payload.params.mermaid as string) || "";
  const caption = (payload.params.caption as string) || payload.prompt || "";
  const [svg, setSvg] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`pz-mmd-${++_seq}`);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setFailed(false);
    if (!spec.trim()) { setFailed(true); return; }
    ensureInit();
    mermaid
      .render(idRef.current, spec)
      .then(({ svg }) => { if (!cancelled) setSvg(svg); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [spec]);

  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14, padding: "8px 16px",
      overflow: "auto", background: "#fff",
    }}>
      {/* FIT the diagram to the panel — bound BOTH dimensions, never force either.
          Mermaid stamps a pixel `max-width` on the <svg> it emits, sized for whatever it was
          measured in, which overflowed on narrow screens. The first fix set `width: 100%`, and
          that was worse for the common case: a tall `graph TD` stretched to the full panel width
          became enormously tall, so a 5-step flowchart needed scrolling and one node filled the
          screen. Capping max-width AND max-height with `width/height: auto` lets the browser
          scale it down on whichever axis binds first, preserving the aspect ratio from the
          viewBox. Inline styles can't reach a child injected via dangerouslySetInnerHTML, hence
          the scoped rule. Uses `vh` (not `svh`): an unsupported unit inside min() invalidates the whole
          declaration, which would silently restore the bug. */}
      <style>{`
        .pz-mmd-fit > svg {
          width: auto !important;
          height: auto !important;
          max-width: 100% !important;
          max-height: min(70vh, 100%) !important;
        }
      `}</style>
      {svg && !failed ? (
        <div
          className="pz-mmd-fit"
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{
            flex: "1 1 auto", minHeight: 0, width: "100%", maxWidth: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        />
      ) : failed ? (
        // A spec the browser can't draw. Showing the raw source dumped a wall of `graph TD ...`
        // code onto a child's screen while the tutor said "I've put a flowchart up for you", so
        // the fallback now reads as a missing picture, not as broken code. (The server repairs
        // the common syntax breaks in `_quote_mermaid_labels` before it ever gets here.)
        <div style={{
          maxWidth: 420, textAlign: "center", color: "#64748b", fontSize: 14,
          background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 12,
          padding: "20px 24px", lineHeight: 1.5,
        }}>
          <div style={{ fontSize: 26, marginBottom: 6 }} aria-hidden>🗺️</div>
          {caption
            ? <span><strong style={{ color: "#334155" }}>{caption}</strong><br />
                Ask your tutor to explain this one in words.</span>
            : "This diagram couldn't be drawn — ask your tutor to explain it in words."}
        </div>
      ) : (
        <span style={{ color: "#94a3b8", fontSize: 14 }}>Drawing the diagram…</span>
      )}

      {caption && (
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#334155", textAlign: "center" }}>
          {caption}
        </p>
      )}
    </div>
  );
}
