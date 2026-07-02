import { useState } from "react";
import type { InteractivePuzzleProps } from "./types";
import { pBtn, pBtnGhost } from "./ui";

interface Img { id: string; image: string }

/** Tap-to-pair matcher: tap a picture, then tap a name to link them (mobile-friendly, no
 *  drag). Each name is used once. "Submit" reports {imageId: name} for server marking. */
export default function MatchingPuzzle({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const images = (payload.params.images as Img[]) || [];
  const labels = (payload.params.labels as string[]) || [];
  const [pairs, setPairs] = useState<Record<string, string>>({}); // imageId -> label
  const [activeImg, setActiveImg] = useState<string | null>(null);

  const usedLabels = new Set(Object.values(pairs));
  const labelOf = (imgId: string) => pairs[imgId];

  const tapImage = (id: string) => {
    if (disabled) return;
    // Tapping a paired image unpairs it; otherwise select it as the active image.
    if (pairs[id]) {
      const { [id]: _drop, ...rest } = pairs;
      setPairs(rest);
      setActiveImg(id);
      return;
    }
    setActiveImg((cur) => (cur === id ? null : id));
  };

  const tapLabel = (label: string) => {
    if (disabled || activeImg == null || usedLabels.has(label)) return;
    setPairs((p) => ({ ...p, [activeImg]: label }));
    setActiveImg(null);
  };

  const allPaired = Object.keys(pairs).length === images.length && images.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 460 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
        {images.map((im) => {
          const paired = labelOf(im.id);
          const active = activeImg === im.id;
          return (
            <button
              key={im.id}
              onClick={() => tapImage(im.id)}
              disabled={disabled}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 6,
                background: "#fff", cursor: disabled ? "default" : "pointer",
                border: `2px solid ${active ? "#1a73e8" : paired ? "#16a34a" : "#e2e8f0"}`,
                borderRadius: 12,
              }}
            >
              <img src={im.image} alt="" style={{ width: "100%", height: 90, objectFit: "contain" }} />
              {paired && <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>{paired}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {labels.map((lb) => {
          const used = usedLabels.has(lb);
          return (
            <button
              key={lb}
              onClick={() => tapLabel(lb)}
              disabled={disabled || used || activeImg == null}
              style={{
                ...pBtnGhost, padding: "8px 14px",
                opacity: used ? 0.4 : 1,
                borderColor: activeImg != null && !used ? "#1a73e8" : "#e2e8f0",
                cursor: used || activeImg == null ? "default" : "pointer",
              }}
            >
              {lb}
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", margin: 0 }}>
        {activeImg ? "Now tap the matching name." : "Tap a picture, then tap its name."}
      </p>
      <button style={{ ...pBtn, alignSelf: "center", opacity: allPaired ? 1 : 0.5 }}
        onClick={() => onSubmit(pairs)} disabled={disabled || !allPaired}>
        Submit
      </button>
    </div>
  );
}
