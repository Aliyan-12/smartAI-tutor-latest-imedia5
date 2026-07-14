import { useState } from "react";
import type { PuzzlePayload } from "./puzzles/types";
import ExplanatoryImage from "./puzzles/ExplanatoryImage";
import LabellingPuzzle from "./puzzles/LabellingPuzzle";
import MatchingPuzzle from "./puzzles/MatchingPuzzle";
import MathPuzzle from "./puzzles/MathPuzzle";
import GraphPuzzle from "./puzzles/GraphPuzzle";
import PlaceValueCounters from "./puzzles/manipulatives/PlaceValueCounters";
import ColumnAddition from "./puzzles/manipulatives/ColumnAddition";
import NumberGridSums from "./puzzles/manipulatives/NumberGridSums";
import TimesTableDash from "./puzzles/manipulatives/TimesTableDash";
import FractionCanvas from "./puzzles/manipulatives/FractionCanvas";
import DotArray from "./puzzles/manipulatives/DotArray";
import CountingBubbles from "./puzzles/manipulatives/CountingBubbles";

/**
 * Renders a puzzle and reports the student's structured answer via onSubmit.
 * Correctness is decided server-side (a `*_evaluator` tool), so the player never marks —
 * it disables the inputs after submit and shows a "checking" note until the tutor replies.
 */
const TYPE_LABEL: Record<string, string> = {
  explanatory: "Diagram", labelling: "Labelling", matching: "Matching",
  math: "Maths", graph: "Graph", manipulative: "Activity",
};

/** The hands-on activities lay themselves out and need the whole panel — no centring, no padding. */
const MANIPULATIVE_RENDERS = new Set([
  "place_value_counters", "column_addition", "number_grid_sums",
  "times_table_dash", "fraction_canvas", "dot_array", "counting_bubbles",
]);

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
  const isManipulative = MANIPULATIVE_RENDERS.has(payload.render);

  const body = () => {
    const p = { payload, onSubmit: handleSubmit, disabled: submitted };
    switch (payload.render) {
      case "explanatory_image":
        return <ExplanatoryImage payload={payload} />;
      case "labelling":
        return <LabellingPuzzle {...p} />;
      case "matching":
        return <MatchingPuzzle {...p} />;
      case "math":
        return <MathPuzzle {...p} />;
      case "graph":
        return <GraphPuzzle {...p} />;
      case "place_value_counters":
        return <PlaceValueCounters {...p} />;
      case "column_addition":
        return <ColumnAddition {...p} />;
      case "number_grid_sums":
        return <NumberGridSums {...p} />;
      case "times_table_dash":
        return <TimesTableDash {...p} />;
      case "fraction_canvas":
        return <FractionCanvas {...p} />;
      case "dot_array":
        return <DotArray {...p} />;
      case "counting_bubbles":
        return <CountingBubbles {...p} />;
      default:
        return (
          <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
            This puzzle type ("{payload.render || "unknown"}") isn't available in this build.
          </p>
        );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "#fff" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#7c3aed", background: "rgba(124,58,237,0.1)", padding: "3px 8px", borderRadius: 6 }}>
          {TYPE_LABEL[payload.puzzle_type] || "Puzzle"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{payload.title}</span>
      </div>

      {/* A manipulative owns the whole body: it sizes itself, and centring + 20px of padding is
          exactly what used to shrink every puzzle down to a postage stamp in the middle. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: isManipulative ? "hidden" : "auto",
          padding: isManipulative ? "12px 0 0" : 20,
          display: "flex",
          flexDirection: "column",
          alignItems: isManipulative ? "stretch" : "center",
          gap: isManipulative ? 0 : 14,
        }}
      >
        <p style={{
          fontSize: isManipulative ? 17 : 14, color: "#334155", textAlign: "center",
          margin: 0, padding: isManipulative ? "0 20px" : 0, fontWeight: 600, flexShrink: 0,
        }}>
          {payload.prompt}
        </p>

        {body()}

        {submitted && !isExplanatory && (
          <div style={{
            margin: isManipulative ? "0 auto 14px" : "6px 0 0",
            padding: "8px 14px", borderRadius: 9, fontWeight: 700, fontSize: 14,
            background: "#eff6ff", color: "#1d4ed8", flexShrink: 0,
          }}>
            Checking your answer…
          </div>
        )}
      </div>
    </div>
  );
}
