import { useState } from "react";
import type { InteractivePuzzleProps } from "./types";
import { pBtn } from "./ui";

/** A real matplotlib graph + a question about it. Student types the answer; server marks. */
export default function GraphPuzzle({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const image = (payload.params.image as string) || "";
  const [val, setVal] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%" }}>
      {image ? (
        <img src={image} alt="graph"
          style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain", border: "1.5px solid #e2e8f0", borderRadius: 12, background: "#fff", padding: 8 }} />
      ) : (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>The graph couldn't be loaded.</p>
      )}
      <input
        style={{ width: 200, padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 16, fontWeight: 700, textAlign: "center", fontFamily: "inherit" }}
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
