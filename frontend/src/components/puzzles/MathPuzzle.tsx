import { useState } from "react";
import { BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import type { InteractivePuzzleProps } from "./types";
import { pBtn } from "./ui";

/** A maths problem shown as crisp LaTeX (equations) or a generated image (visual
 *  concepts like fractions). Student types the answer; the server marks it. */
export default function MathPuzzle({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const mode = (payload.params.mode as string) || "latex";
  const latex = (payload.params.latex as string) || "";
  const image = (payload.params.image as string) || "";
  const [val, setVal] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%" }}>
      {mode === "image" && image ? (
        <img src={image} alt="maths problem"
          style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain", border: "1.5px solid #e2e8f0", borderRadius: 12, background: "#fff", padding: 8 }} />
      ) : latex ? (
        <div style={{ fontSize: 22, padding: "10px 18px", background: "#f8fafc", borderRadius: 12, border: "1.5px solid #e2e8f0", maxWidth: "100%", overflowX: "auto" }}>
          <BlockMath math={latex} />
        </div>
      ) : null}

      <input
        style={{ width: 200, padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 17, fontWeight: 700, textAlign: "center", fontFamily: "inherit" }}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) onSubmit(val.trim()); }}
        placeholder="Your answer"
        autoFocus
        disabled={disabled}
      />
      <button style={pBtn} onClick={() => onSubmit(val.trim())} disabled={disabled || !val.trim()}>
        Check
      </button>
    </div>
  );
}
