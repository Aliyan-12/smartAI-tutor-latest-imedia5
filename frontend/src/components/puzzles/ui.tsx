export const pBtn: React.CSSProperties = {
  padding: "9px 20px", background: "#1a73e8", color: "#fff", border: "none",
  borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer",
};
export const pBtnGhost: React.CSSProperties = {
  ...pBtn, background: "#fff", color: "#475569", border: "1.5px solid #e2e8f0",
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
