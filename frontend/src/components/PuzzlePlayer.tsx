import { useState } from "react";
import type { PuzzlePayload } from "./puzzles/types";
import { pBtn, pBtnGhost, Feedback, CategoryChip } from "./puzzles/ui";
import IdentifyImage from "./puzzles/IdentifyImage";
import MatchImage from "./puzzles/MatchImage";
import FractionBar from "./puzzles/FractionBar";
import PieFraction from "./puzzles/PieFraction";
import NumberLine from "./puzzles/NumberLine";
import PlaceValue from "./puzzles/PlaceValue";
import ArrayGrid from "./puzzles/ArrayGrid";
import ShapeCount from "./puzzles/ShapeCount";
import AreaGrid from "./puzzles/AreaGrid";
import Clock from "./puzzles/Clock";
import AngleViz from "./puzzles/AngleViz";
import CoordinateGrid from "./puzzles/CoordinateGrid";
import BarChart from "./puzzles/BarChart";
import BalanceScales from "./puzzles/BalanceScales";
import ParticleState from "./puzzles/ParticleState";
import FormulaTriangle from "./puzzles/FormulaTriangle";
import BuildFraction from "./puzzles/BuildFraction";
import LabelDiagram from "./puzzles/LabelDiagram";
import StatesOfMatter from "./puzzles/StatesOfMatter";
import FoodChainOrder from "./puzzles/FoodChainOrder";

// SVG "display" puzzles draw only; PuzzlePlayer collects + checks the answer.
const DISPLAY: Record<string, React.ComponentType<{ params: Record<string, unknown> }>> = {
  fraction_bar: FractionBar, pie_fraction: PieFraction, number_line: NumberLine,
  place_value: PlaceValue, array_grid: ArrayGrid, shape_count: ShapeCount, area_grid: AreaGrid,
  clock: Clock, angle: AngleViz, coordinate_grid: CoordinateGrid, bar_chart: BarChart,
  balance_scales: BalanceScales, particle_state: ParticleState, formula_triangle: FormulaTriangle,
  identify_image: IdentifyImage,
};
// "interactive" puzzles self-evaluate and call onSolved.
const INTERACTIVE: Record<string, React.ComponentType<{ payload: PuzzlePayload; onSolved: (a: unknown, c: boolean) => void; disabled?: boolean }>> = {
  build_fraction: BuildFraction, label_diagram: LabelDiagram, states_of_matter: StatesOfMatter,
  food_chain_order: FoodChainOrder, match_image: MatchImage,
};

const inputStyle: React.CSSProperties = {
  width: 64, padding: "8px 10px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontSize: 18, fontWeight: 700, textAlign: "center", fontFamily: "inherit",
};
const norm = (s: string) => s.trim().toLowerCase().replace(/[()\s]/g, "");

export default function PuzzlePlayer({
  payload, onSolved,
}: { payload: PuzzlePayload; onSolved: (answer: unknown, correct: boolean) => void }) {
  const Display = DISPLAY[payload.render];
  const Interactive = INTERACTIVE[payload.render];

  const [intVal, setIntVal] = useState("");
  const [num, setNum] = useState("");
  const [den, setDen] = useState("");
  const [textVal, setTextVal] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  // Bumping this remounts the interactive (konva) child, fully resetting its
  // internal state. Display (SVG) puzzles reset via the setters below.
  const [interactiveKey, setInteractiveKey] = useState(0);
  const locked = correct === true;

  // Always-available reset: clears this puzzle's answer so the student can redo it
  // (works even after a correct/locked answer).
  const reset = () => {
    setIntVal(""); setNum(""); setDen(""); setTextVal(""); setCorrect(null);
    setInteractiveKey((k) => k + 1);
  };

  const checkInteger = () => {
    const ok = intVal.trim() !== "" && Number(intVal) === Number(payload.solution);
    setCorrect(ok); onSolved(intVal, ok);
  };
  const checkFraction = () => {
    const sol = payload.solution as { numerator: number; denominator: number };
    const n = Number(num), d = Number(den);
    const ok = num.trim() !== "" && den.trim() !== "" && d !== 0 && n * sol.denominator === d * sol.numerator;
    setCorrect(ok); onSolved(`${num}/${den}`, ok);
  };
  const checkText = () => {
    const ok = textVal.trim() !== "" && norm(textVal) === norm(String(payload.solution));
    setCorrect(ok); onSolved(textVal, ok);
  };
  const chooseOption = (opt: string) => {
    if (locked) return;
    const ok = opt === payload.solution;
    setCorrect(ok); onSolved(opt, ok);
  };

  const options = (payload.params.options as string[]) || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#7c3aed", background: "rgba(124,58,237,0.1)", padding: "3px 8px", borderRadius: 6 }}>Puzzle</span>
        <CategoryChip category={payload.category} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{payload.title}</span>
        <button
          onClick={reset}
          title="Reset this puzzle"
          style={{
            marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#475569",
            background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6,
            padding: "4px 10px", cursor: "pointer",
          }}
        >↺ Reset</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <p style={{ fontSize: 14, color: "#334155", textAlign: "center", margin: 0, fontWeight: 600 }}>{payload.prompt}</p>

        {Display && (
          <>
            <Display params={payload.params} />

            {payload.answer_type === "integer" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <input style={inputStyle} value={intVal} onChange={(e) => { setIntVal(e.target.value); setCorrect(null); }} placeholder="?" inputMode="numeric" disabled={locked} />
                <button style={pBtn} onClick={checkInteger} disabled={locked}>Check</button>
              </div>
            )}

            {payload.answer_type === "fraction" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <input style={inputStyle} value={num} onChange={(e) => { setNum(e.target.value); setCorrect(null); }} placeholder="?" inputMode="numeric" disabled={locked} />
                  <div style={{ width: 64, height: 2, background: "#334155", margin: "5px 0" }} />
                  <input style={inputStyle} value={den} onChange={(e) => { setDen(e.target.value); setCorrect(null); }} placeholder="?" inputMode="numeric" disabled={locked} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={pBtnGhost} onClick={() => { setNum(""); setDen(""); setCorrect(null); }} disabled={locked}>Clear</button>
                  <button style={pBtn} onClick={checkFraction} disabled={locked}>Check</button>
                </div>
              </div>
            )}

            {payload.answer_type === "text" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <input style={{ ...inputStyle, width: 120, fontSize: 16 }} value={textVal} onChange={(e) => { setTextVal(e.target.value); setCorrect(null); }} placeholder="Type your answer" disabled={locked} />
                <button style={pBtn} onClick={checkText} disabled={locked}>Check</button>
              </div>
            )}

            {payload.answer_type === "choice" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {options.map((opt) => (
                  <button key={opt} onClick={() => chooseOption(opt)} disabled={locked}
                    style={{ ...pBtnGhost, textTransform: "capitalize", padding: "10px 16px", cursor: locked ? "default" : "pointer" }}>
                    {opt}
                  </button>
                ))}
              </div>
            )}

            <Feedback correct={correct} />
          </>
        )}

        {Interactive && <Interactive key={interactiveKey} payload={payload} onSolved={onSolved} />}

        {!Display && !Interactive && (
          <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
            This puzzle type ("{payload.render || "unknown"}") isn't available in this build.
            <br />Try refreshing the page.
          </p>
        )}
      </div>
    </div>
  );
}
