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
      {svg && !failed ? (
        <div
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{ maxWidth: "100%", maxHeight: "100%", display: "flex", justifyContent: "center" }}
        />
      ) : failed ? (
        <pre style={{
          maxWidth: "100%", overflow: "auto", fontSize: 13, lineHeight: 1.5, color: "#334155",
          background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10,
          padding: "12px 16px", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace",
        }}>
          {spec}
        </pre>
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
