import { useState } from "react";
import type { PuzzlePayload } from "./puzzles/types";
import ExplanatoryImage from "./puzzles/ExplanatoryImage";
import SvgDiagram from "./puzzles/SvgDiagram";
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
import { getQuizTheme } from "../lib/quizTheme";

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
  payload, onSubmit, locked = false, keyStage,
}: { payload: PuzzlePayload; onSubmit: (answer: unknown) => void; locked?: boolean; keyStage?: string }) {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (answer: unknown) => {
    if (submitted) return;
    setSubmitted(true);
    onSubmit(answer);
  };

  // The maths question (MCQ / typed answer) gets a purpose-built centred question-card layout.
  const isThemedQuestion = payload.render === "math";

  // Display-only teaching visuals — nothing to submit, so no "checking your answer" note.
  const isExplanatory = payload.render === "explanatory_image"
    || payload.render === "svg_diagram" || payload.render === "mermaid"
    || payload.render === "animation";
  const isManipulative = MANIPULATIVE_RENDERS.has(payload.render);
  // A plain interactive puzzle (math / graph): short content that should sit CENTRED in the panel.
  const isInteractive = !isManipulative && !isExplanatory;

  // EVERY puzzle shares ONE age-appropriate theme (KS1–2 bright/playful, KS3 → GCSE focused/cosmic)
  // and fills the WHOLE panel — so the practice area looks consistent for a given Key Stage.
  const t = getQuizTheme(keyStage);
  const dark = !t.isJunior;
  const promptColour = t.qText;
  const panelBg = t.wrap;

  const body = () => {
    const p = { payload, onSubmit: handleSubmit, disabled: submitted, keyStage };
    switch (payload.render) {
      case "explanatory_image":
        return <ExplanatoryImage payload={payload} />;
      case "svg_diagram":
        return <SvgDiagram payload={payload} />;
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
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", flex: 1, minHeight: 0, background: panelBg }}>
      <PuzzleDecor junior={t.isJunior} />
      {/* Loading veil: the puzzle is on screen but blurred + non-interactive until the tutor has
          FINISHED SPEAKING this turn (TTS completion). Being on top, it also swallows clicks so
          the student can't answer before it clears. Only shown when Read Aloud is on. */}
      {locked && (
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0, zIndex: 30,
            backdropFilter: "blur(7px)", WebkitBackdropFilter: "blur(7px)",
            background: dark ? "rgba(6,21,33,0.35)" : "rgba(255,255,255,0.4)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 12, cursor: "wait",
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            border: "3px solid rgba(124,58,237,0.25)", borderTopColor: "#7c3aed",
            animation: "puzzleGateSpin 0.8s linear infinite",
          }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: dark ? "rgba(255,255,255,0.9)" : "#475569" }}>
            Loading…
          </span>
          <style>{"@keyframes puzzleGateSpin { to { transform: rotate(360deg); } }"}</style>
        </div>
      )}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: "#fff" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#7c3aed", background: "rgba(124,58,237,0.1)", padding: "3px 8px", borderRadius: 6 }}>
          {TYPE_LABEL[payload.puzzle_type] || "Puzzle"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{payload.title}</span>
      </div>

      {isThemedQuestion ? (
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <MathPuzzle payload={payload} keyStage={keyStage} onSubmit={handleSubmit} disabled={submitted} />
        </div>
      ) : (
      /* A manipulative owns the whole body: it sizes itself, and centring + 20px of padding is
          exactly what used to shrink every puzzle down to a postage stamp in the middle.
          `position: relative` so the backdrop can sit behind the content. */
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          // A display-only visual (diagram / image / animation / flowchart) must FIT the panel,
          // never scroll: the student can't tell the difference between "scrolled past it" and
          // "nothing there", and one reported an empty white panel while a flowchart sat below
          // the fold — they asked the tutor to re-show a diagram that was already up.
          overflow: isManipulative || isExplanatory ? "hidden" : "auto",
          padding: isManipulative ? "12px 0 0" : isExplanatory ? "10px 14px" : 20,
          display: "flex",
          flexDirection: "column",
          alignItems: isManipulative ? "stretch" : "center",
          justifyContent: isInteractive ? "center" : "flex-start",
          gap: isManipulative ? 0 : 14,
          background: "transparent",
        }}
      >
        {/* Everything real sits ABOVE the shared themed panel + decorations. */}
        <p style={{
          position: "relative", zIndex: 1,
          fontSize: isManipulative ? 17 : 14, color: promptColour, textAlign: "center",
          margin: 0, padding: isManipulative ? "0 20px" : 0, fontWeight: 600, flexShrink: 0,
          textShadow: dark ? "0 1px 3px rgba(0,0,0,0.5)" : "none",
        }}>
          {payload.prompt}
        </p>

        {/* Explanatory visuals get `flex: 1` like manipulatives do. With `0 0 auto` the wrapper
            had no definite height, so the child's `height: 100%` was indefinite and the diagram
            centred itself inside a box taller than the panel — pushed below the fold. */}
        <div style={{ position: "relative", zIndex: 1,
                      flex: isManipulative || isExplanatory ? 1 : "0 0 auto",
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
      )}
    </div>
  );
}

/** Shared age-appropriate decorations behind EVERY puzzle (hidden on narrow panels). */
function PuzzleDecor({ junior }: { junior: boolean }) {
  return (
    <>
      <style>{`@media (max-width: 900px){ .pz-deco{ display:none !important; } }`}</style>
      {junior ? (
        <>
          <div className="pz-deco" style={{ position: "absolute", top: 58, left: 16, background: "#fde68a", color: "#78350f", fontFamily: '"Segoe Print","Comic Sans MS",cursive', fontWeight: 800, fontSize: 14, padding: "10px 12px", borderRadius: 6, transform: "rotate(-6deg)", boxShadow: "0 4px 10px rgba(0,0,0,0.12)", lineHeight: 1.2, zIndex: 0 }}>
            YOU<br />GOT THIS! 🙂
          </div>
          <div className="pz-deco" style={{ position: "absolute", top: 62, right: 20, fontFamily: '"Segoe Print","Comic Sans MS",cursive', color: "#2563eb", fontSize: 15, fontWeight: 700, textAlign: "right", lineHeight: 1.2, zIndex: 0 }}>
            Small steps<br />Big progress ⭐
          </div>
          <div className="pz-deco" style={{ position: "absolute", bottom: 18, left: 18, display: "flex", flexDirection: "column", gap: 4, zIndex: 0 }}>
            {["Explore", "Practice", "Improve", "Succeed"].map((s) => (
              <span key={s} style={{ background: "#b45309", color: "#fff7ed", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 4, boxShadow: "0 2px 4px rgba(0,0,0,0.15)" }}>{s}</span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(circle at 85% 20%, rgba(99,102,241,0.26), transparent 42%), radial-gradient(circle at 8% 82%, rgba(56,189,248,0.2), transparent 46%)" }} />
          <div className="pz-deco" style={{ position: "absolute", top: "40%", left: 22, color: "rgba(255,255,255,0.32)", fontSize: 13, fontWeight: 800, letterSpacing: "1px", lineHeight: 1.5, zIndex: 0 }}>
            SMALL<br />STEPS<br />BIG<br />PROGRESS
          </div>
          <div className="pz-deco" style={{ position: "absolute", top: "34%", right: 22, color: "rgba(255,255,255,0.28)", fontSize: 14, textAlign: "right", lineHeight: 1.7, zIndex: 0 }}>
            Powers<br />Indices<br />Standard Form
          </div>
        </>
      )}
    </>
  );
}
