import { useState } from "react";
import type { InteractivePuzzleProps } from "./types";
import { pBtn, pBtnGhost, imgCard, Feedback } from "./ui";

interface ImgItem { id: number; image: string; }

/**
 * MatchImage — interactive (self-evaluating) matching puzzle: real topic images on the
 * left, jumbled names on the right. Tap an image then a name (or vice-versa) to pair
 * them; tap a paired image to unpair. Mobile-friendly (no drag). Checks against
 * payload.solution = { imageId: correctName }.
 */
export default function MatchImage({ payload, onSolved, disabled }: InteractivePuzzleProps) {
  const images = (payload.params.images as ImgItem[]) || [];
  const labels = (payload.params.labels as string[]) || [];
  const solution = (payload.solution as Record<string, string>) || {};

  const [pairs, setPairs] = useState<Record<number, string>>({}); // imageId → label
  const [selImg, setSelImg] = useState<number | null>(null);
  const [selLabel, setSelLabel] = useState<string | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const locked = disabled || correct === true;

  const usedLabels = new Set(Object.values(pairs));

  const commit = (imgId: number | null, label: string | null) => {
    if (imgId == null || label == null) return;
    setPairs((p) => {
      // a label can only be on one image — drop it from any other image first
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(p)) if (v !== label) next[Number(k)] = v;
      next[imgId] = label;
      return next;
    });
    setSelImg(null);
    setSelLabel(null);
    setCorrect(null);
  };

  const clickImg = (id: number) => {
    if (locked) return;
    if (pairs[id]) { // unpair
      setPairs((p) => { const n = { ...p }; delete n[id]; return n; });
      setCorrect(null);
      return;
    }
    const ni = selImg === id ? null : id;
    setSelImg(ni);
    if (ni != null && selLabel != null) commit(ni, selLabel);
  };

  const clickLabel = (l: string) => {
    if (locked || usedLabels.has(l)) return;
    const nl = selLabel === l ? null : l;
    setSelLabel(nl);
    if (nl != null && selImg != null) commit(selImg, nl);
  };

  const check = () => {
    const ok = images.length > 0 && images.every((im) => pairs[im.id] === solution[String(im.id)]);
    setCorrect(ok);
    onSolved(pairs, ok);
  };
  const reset = () => { setPairs({}); setSelImg(null); setSelLabel(null); setCorrect(null); };

  const allPaired = images.length > 0 && images.every((im) => pairs[im.id]);

  return (
    <div style={{ width: "100%", maxWidth: 460 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Image column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {images.map((im) => {
            const sel = selImg === im.id;
            const label = pairs[im.id];
            return (
              <button
                key={im.id}
                onClick={() => clickImg(im.id)}
                disabled={locked}
                style={{
                  display: "flex", flexDirection: "column", gap: 4, padding: 0,
                  border: sel ? "2px solid #7c3aed" : "2px solid transparent",
                  borderRadius: 14, background: "transparent", cursor: locked ? "default" : "pointer",
                }}
              >
                {failed[im.id] ? (
                  <div style={{ ...imgCard, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 11 }}>
                    image unavailable
                  </div>
                ) : (
                  <img src={im.image} alt="" style={imgCard} onError={() => setFailed((f) => ({ ...f, [im.id]: true }))} />
                )}
                <span style={{
                  minHeight: 20, fontSize: 12, fontWeight: 700, textAlign: "center",
                  color: label ? "#1a73e8" : "#cbd5e1",
                }}>
                  {label || "tap to match"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Label column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
          {labels.map((l) => {
            const used = usedLabels.has(l);
            const sel = selLabel === l;
            return (
              <button
                key={l}
                onClick={() => clickLabel(l)}
                disabled={locked || used}
                style={{
                  padding: "10px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  textAlign: "center", cursor: locked || used ? "default" : "pointer",
                  border: sel ? "2px solid #7c3aed" : "1.5px solid #e2e8f0",
                  background: used ? "#f1f5f9" : "#fff",
                  color: used ? "#cbd5e1" : "#334155",
                  textDecoration: used ? "line-through" : "none",
                }}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
        <button style={pBtnGhost} onClick={reset} disabled={locked}>Reset</button>
        <button style={pBtn} onClick={check} disabled={locked || !allPaired}>Check</button>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Feedback correct={correct} />
      </div>
    </div>
  );
}
