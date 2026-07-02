import { useState } from "react";
import type { PuzzlePayload } from "./puzzles/types";
import ExplanatoryImage from "./puzzles/ExplanatoryImage";
import LabellingPuzzle from "./puzzles/LabellingPuzzle";
import MatchingPuzzle from "./puzzles/MatchingPuzzle";
import MathPuzzle from "./puzzles/MathPuzzle";
import GraphPuzzle from "./puzzles/GraphPuzzle";

/**
 * Renders a GENERATED puzzle and reports the student's structured answer via onSubmit.
 * Correctness is decided server-side (a `*_evaluator` tool), so the player never marks —
 * it disables the inputs after submit and shows a "checking" note until the tutor replies.
 */
const TYPE_LABEL: Record<string, string> = {
  explanatory: "Diagram", labelling: "Labelling", matching: "Matching",
  math: "Maths", graph: "Graph",
};

export default function PuzzlePlayer({
  payload, onSubmit,
}: { payload: PuzzlePayload; onSubmit: (answer: unknown) => void }) {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (answer: unknown) => {
    if (submitted) return;
    setSubmitted(true);
    onSubmit(answer);
  };

  const isExplanatory = payload.render === "explanatory_image";

  const body = () => {
    switch (payload.render) {
      case "explanatory_image":
        return <ExplanatoryImage payload={payload} />;
      case "labelling":
        return <LabellingPuzzle payload={payload} onSubmit={handleSubmit} disabled={submitted} />;
      case "matching":
        return <MatchingPuzzle payload={payload} onSubmit={handleSubmit} disabled={submitted} />;
      case "math":
        return <MathPuzzle payload={payload} onSubmit={handleSubmit} disabled={submitted} />;
      case "graph":
        return <GraphPuzzle payload={payload} onSubmit={handleSubmit} disabled={submitted} />;
      default:
        return (
          <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
            This puzzle type ("{payload.render || "unknown"}") isn't available in this build.
          </p>
        );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#7c3aed", background: "rgba(124,58,237,0.1)", padding: "3px 8px", borderRadius: 6 }}>
          {TYPE_LABEL[payload.puzzle_type] || "Puzzle"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{payload.title}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <p style={{ fontSize: 14, color: "#334155", textAlign: "center", margin: 0, fontWeight: 600 }}>{payload.prompt}</p>
        {body()}
        {submitted && !isExplanatory && (
          <div style={{ marginTop: 6, padding: "8px 14px", borderRadius: 9, fontWeight: 700, fontSize: 14, background: "#eff6ff", color: "#1d4ed8" }}>
            Checking your answer…
          </div>
        )}
      </div>
    </div>
  );
}
