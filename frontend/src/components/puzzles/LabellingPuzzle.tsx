import { useState } from "react";
import type { InteractivePuzzleProps } from "./types";
import { pBtn, pBtnGhost } from "./ui";

interface Img { id: string; image: string }

/** Show generated pictures ONE AT A TIME; the student types the name of each, then the
 *  next appears. On the last, "Submit" reports {id: typed name} for server-side marking. */
export default function LabellingPuzzle({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const images = (payload.params.images as Img[]) || [];
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [val, setVal] = useState("");

  if (images.length === 0) {
    return <p style={{ color: "#94a3b8", fontSize: 13 }}>No images to label.</p>;
  }

  const cur = images[idx];
  const isLast = idx === images.length - 1;

  const next = () => {
    const merged = { ...answers, [cur.id]: val.trim() };
    setAnswers(merged);
    if (isLast) {
      onSubmit(merged);
      return;
    }
    setIdx((i) => i + 1);
    setVal("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%" }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
        Picture {idx + 1} of {images.length}
      </div>
      <img
        src={cur.image}
        alt="name this"
        style={{ width: "100%", maxWidth: 320, height: 240, objectFit: "contain", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: 8 }}
      />
      <input
        style={{ width: 220, padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 15, fontWeight: 600, textAlign: "center", fontFamily: "inherit" }}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) next(); }}
        placeholder="What is this?"
        autoFocus
        disabled={disabled}
      />
      <button style={val.trim() ? pBtn : pBtnGhost} onClick={next} disabled={disabled || !val.trim()}>
        {isLast ? "Submit" : "Next picture"}
      </button>
    </div>
  );
}
