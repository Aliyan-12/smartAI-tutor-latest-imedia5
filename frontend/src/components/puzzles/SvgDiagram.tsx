import type { PuzzlePayload } from "./types";

/**
 * SvgDiagram — a teaching diagram inlined as SVG.
 *
 * Display-only: the tutor puts a labelled structure on the Learn panel (a cell, a circuit, a
 * wave, the solar system) and teaches from it. It renders instantly, scales crisply, and can't
 * mislabel the way a generated image does.
 *
 * The markup comes from one of two places, and BOTH are safe before they reach this component:
 *   - `svg_diagram`, drawn by `svg_diagram_service` from validated params, or
 *   - `draw_svg`, written by the model for topics the template set doesn't cover.
 *
 * Model-authored markup is hostile input into an XSS sink, so it is put through
 * `svg_diagram_service.sanitize_svg` on the server first — an allow-list parser that rebuilds
 * the SVG from scratch, dropping every element/attribute it doesn't explicitly permit (scripts,
 * foreignObject, on* handlers, external URLs). Never bypass that and inline raw model output here.
 */
export default function SvgDiagram({ payload }: { payload: PuzzlePayload }) {
  const svg = (payload.params.svg as string) || "";
  const caption = (payload.params.caption as string) || payload.prompt || "";

  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 16px",
      overflow: "auto", background: "#fff",
    }}>
      {/* The markup is sanitised server-side (see the note above). Templates carry a viewBox and
          model-authored SVG is guaranteed one, so forcing width:100% here makes every diagram
          scale to the panel instead of overflowing on a phone — an <svg> with a fixed pixel
          width would otherwise be clipped rather than shrunk. */}
      <style>{`.pz-svg-fit > svg { width: 100%; height: auto; max-width: 100%; }`}</style>
      {svg ? (
        <div
          className="pz-svg-fit"
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{ width: "100%", maxWidth: 720, maxHeight: "100%", display: "flex", justifyContent: "center" }}
        />
      ) : (
        <span style={{ color: "#94a3b8", fontSize: 14 }}>The diagram couldn't be drawn.</span>
      )}
      {caption && (
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#334155", textAlign: "center" }}>
          {caption}
        </p>
      )}
    </div>
  );
}
