export const pBtn: React.CSSProperties = {
  padding: "9px 20px", background: "#1a73e8", color: "#fff", border: "none",
  borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer",
};
export const pBtnGhost: React.CSSProperties = {
  ...pBtn, background: "#fff", color: "#475569", border: "1.5px solid #e2e8f0",
};

/** Friendly label + accent colour for a puzzle category chip. */
const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  labelling: { label: "Labelling", color: "#0369a1", bg: "rgba(2,132,199,0.1)" },
  matching: { label: "Matching", color: "#7c3aed", bg: "rgba(124,58,237,0.1)" },
  recognition: { label: "Recognition", color: "#b45309", bg: "rgba(217,119,6,0.12)" },
  sorting: { label: "Sorting", color: "#0f766e", bg: "rgba(13,148,136,0.12)" },
  sequencing: { label: "Sequencing", color: "#9333ea", bg: "rgba(147,51,234,0.1)" },
  counting: { label: "Counting", color: "#16a34a", bg: "rgba(22,163,74,0.12)" },
  fractions: { label: "Fractions", color: "#dc2626", bg: "rgba(220,38,38,0.1)" },
  number: { label: "Number", color: "#2563eb", bg: "rgba(37,99,235,0.1)" },
  geometry: { label: "Geometry", color: "#ea580c", bg: "rgba(234,88,12,0.1)" },
  data: { label: "Data", color: "#0891b2", bg: "rgba(8,145,178,0.12)" },
  algebra: { label: "Algebra", color: "#4f46e5", bg: "rgba(79,70,229,0.1)" },
};

export function CategoryChip({ category }: { category?: string }) {
  if (!category) return null;
  const m = CATEGORY_META[category] || { label: category, color: "#475569", bg: "#f1f5f9" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
      color: m.color, background: m.bg, padding: "3px 8px", borderRadius: 6,
    }}>{m.label}</span>
  );
}

/** Shared image card used by the image puzzles (match / identify). */
export const imgCard: React.CSSProperties = {
  width: "100%", height: 120, objectFit: "contain", background: "#fff",
  border: "1.5px solid #e2e8f0", borderRadius: 12, padding: 6,
};

export function Feedback({ correct }: { correct: boolean | null }) {
  if (correct === null) return null;
  return (
    <div style={{
      marginTop: 10, padding: "8px 14px", borderRadius: 9, fontWeight: 700, fontSize: 14,
      background: correct ? "#dcfce7" : "#fef3c7", color: correct ? "#15803d" : "#b45309",
    }}>
      {correct ? "Correct! 🎉" : "Not quite — have another look, then try again."}
    </div>
  );
}
