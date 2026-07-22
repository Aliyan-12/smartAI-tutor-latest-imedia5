import { useState } from "react";
import type { PuzzlePayload } from "./puzzles/types";
import ExplanatoryImage from "./puzzles/ExplanatoryImage";
import MermaidDiagram from "./puzzles/MermaidDiagram";
import AnimationPlayer from "./puzzles/AnimationPlayer";
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
import CompareNumbers from "./puzzles/manipulatives/CompareNumbers";
import OrderNumbers from "./puzzles/manipulatives/OrderNumbers";
import ClockHands from "./puzzles/manipulatives/ClockHands";
import MoneyCoins from "./puzzles/manipulatives/MoneyCoins";
import NumberLineJump from "./puzzles/manipulatives/NumberLineJump";
import CoordinatePlot from "./puzzles/manipulatives/CoordinatePlot";
import EquationBalance from "./puzzles/manipulatives/EquationBalance";
import AlgebraTiles from "./puzzles/manipulatives/AlgebraTiles";
import SortingBins from "./puzzles/manipulatives/SortingBins";
import SequenceOrder from "./puzzles/manipulatives/SequenceOrder";
import AtomBuilder from "./puzzles/manipulatives/AtomBuilder";
import BalanceEquation from "./puzzles/manipulatives/BalanceEquation";
import PhScale from "./puzzles/manipulatives/PhScale";
import ForceArrows from "./puzzles/manipulatives/ForceArrows";
import PunnettSquare from "./puzzles/manipulatives/PunnettSquare";
import PuzzleBackground, { bgTheme } from "./puzzles/backgrounds";

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
  // maths — foundational
  "place_value_counters", "column_addition", "number_grid_sums",
  "times_table_dash", "fraction_canvas", "dot_array", "counting_bubbles",
  "compare_numbers", "order_numbers", "clock_hands", "money_coins",
  "number_line_jump", "coordinate_plot",
  // maths — advanced
  "equation_balance", "algebra_tiles",
  // science
  "sorting_bins", "sequence_order", "atom_builder", "balance_equation",
  "ph_scale", "force_arrows", "punnett_square",
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

  // Display-only teaching visuals — nothing to submit, so no puzzle backdrop and no
  // "checking your answer" note. (Name kept: everywhere it already meant "display-only".)
  const isExplanatory = payload.render === "explanatory_image"
    || payload.render === "mermaid" || payload.render === "animation";
  const isManipulative = MANIPULATIVE_RENDERS.has(payload.render);
  // A plain interactive puzzle (math / graph): short content that should sit CENTRED in the
  // panel, so the backdrop fills evenly top-and-bottom instead of leaving white space below.
  const isInteractive = !isManipulative && !isExplanatory;

  // The server picks a backdrop per puzzle. Explanatory images (often a science photo/diagram)
  // stay on plain white so nothing competes with the picture; everything else gets its backdrop.
  const bgVariant = isExplanatory ? "plain" : ((payload.params.background as string) || "plain");
  const dark = bgTheme(bgVariant) === "dark";
  const promptColour = dark ? "rgba(255,255,255,0.92)" : "#334155";
  // The whole panel takes the puzzle's base colour, so even if the backdrop SVG doesn't reach the
  // very bottom the area is never bare white under a dark puzzle (the reported white strip).
  const baseBg = dark ? "#061521" : "#fff";

  const body = () => {
    const p = { payload, onSubmit: handleSubmit, disabled: submitted };
    switch (payload.render) {
      case "explanatory_image":
        return <ExplanatoryImage payload={payload} />;
      case "mermaid":
        return <MermaidDiagram payload={payload} />;
      case "animation":
        return <AnimationPlayer payload={payload} />;
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
      case "compare_numbers":
        return <CompareNumbers {...p} />;
      case "order_numbers":
        return <OrderNumbers {...p} />;
      case "clock_hands":
        return <ClockHands {...p} />;
      case "money_coins":
        return <MoneyCoins {...p} />;
      case "number_line_jump":
        return <NumberLineJump {...p} />;
      case "coordinate_plot":
        return <CoordinatePlot {...p} />;
      case "equation_balance":
        return <EquationBalance {...p} />;
      case "algebra_tiles":
        return <AlgebraTiles {...p} />;
      case "sorting_bins":
        return <SortingBins {...p} />;
      case "sequence_order":
        return <SequenceOrder {...p} />;
      case "atom_builder":
        return <AtomBuilder {...p} />;
      case "balance_equation":
        return <BalanceEquation {...p} />;
      case "ph_scale":
        return <PhScale {...p} />;
      case "force_arrows":
        return <ForceArrows {...p} />;
      case "punnett_square":
        return <PunnettSquare {...p} />;
      default:
        return (
          <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
            This puzzle type ("{payload.render || "unknown"}") isn't available in this build.
          </p>
        );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", flex: 1, minHeight: 0, background: baseBg }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: "#fff" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#7c3aed", background: "rgba(124,58,237,0.1)", padding: "3px 8px", borderRadius: 6 }}>
          {TYPE_LABEL[payload.puzzle_type] || "Puzzle"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{payload.title}</span>
      </div>

      {/* A manipulative owns the whole body: it sizes itself, and centring + 20px of padding is
          exactly what used to shrink every puzzle down to a postage stamp in the middle.
          `position: relative` so the backdrop can sit behind the content. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: isManipulative ? "hidden" : "auto",
          padding: isManipulative ? "12px 0 0" : 20,
          display: "flex",
          flexDirection: "column",
          alignItems: isManipulative ? "stretch" : "center",
          justifyContent: isInteractive ? "center" : "flex-start",
          gap: isManipulative ? 0 : 14,
          background: baseBg,
        }}
      >
        <PuzzleBackground variant={bgVariant} />

        {/* Everything real sits ABOVE the backdrop. */}
        <p style={{
          position: "relative", zIndex: 1,
          fontSize: isManipulative ? 17 : 14, color: promptColour, textAlign: "center",
          margin: 0, padding: isManipulative ? "0 20px" : 0, fontWeight: 600, flexShrink: 0,
          textShadow: dark ? "0 1px 3px rgba(0,0,0,0.5)" : "none",
        }}>
          {payload.prompt}
        </p>

        <div style={{ position: "relative", zIndex: 1, flex: isManipulative ? 1 : "0 0 auto",
                      minHeight: 0, width: "100%", display: "flex", flexDirection: "column",
                      alignItems: isManipulative ? "stretch" : "center", gap: isManipulative ? 0 : 14 }}>
          {body()}
        </div>

        {submitted && !isExplanatory && (
          <div style={{
            position: "relative", zIndex: 1,
            margin: isManipulative ? "0 auto 14px" : "6px 0 0",
            padding: "8px 14px", borderRadius: 9, fontWeight: 700, fontSize: 14,
            background: dark ? "rgba(255,255,255,0.92)" : "#eff6ff", color: "#1d4ed8", flexShrink: 0,
          }}>
            Checking your answer…
          </div>
        )}
      </div>
    </div>
  );
}
