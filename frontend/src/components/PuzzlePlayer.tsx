import { useState } from "react";
import type { PuzzlePayload } from "./puzzles/types";
import { pBtn, pBtnGhost, Feedback } from "./puzzles/ui";
import FractionBar from "./puzzles/FractionBar";
import NumberLine from "./puzzles/NumberLine";
import ShapeCount from "./puzzles/ShapeCount";
import AreaGrid from "./puzzles/AreaGrid";
import BuildFraction from "./puzzles/BuildFraction";
import LabelDiagram from "./puzzles/LabelDiagram";
import StatesOfMatter from "./puzzles/StatesOfMatter";
import FoodChainOrder from "./puzzles/FoodChainOrder";

// SVG "display" puzzles draw only; PuzzlePlayer collects + checks the answer.
const DISPLAY: Record<string, React.ComponentType<{ params: Record<string, unknown> }>> = {
  fraction_bar: FractionBar, number_line: NumberLine, shape_count: ShapeCount, area_grid: AreaGrid,
};
// Konva "interactive" puzzles self-evaluate and call onSolved.
const INTERACTIVE: Record<string, React.ComponentType<{ payload: PuzzlePayload; onSolved: (a: unknown, c: boolean) => void; disabled?: boolean }>> = {
  build_fraction: BuildFraction, label_diagram: LabelDiagram, states_of_matter: StatesOfMatter, food_chain_order: FoodChainOrder,
};

const inputStyle: React.CSSProperties = {
  width: 64, padding: "8px 10px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontSize: 18, fontWeight: 700, textAlign: "center", fontFamily: "inherit",
};

export default function PuzzlePlayer({
  payload, onSolved,
}: { payload: PuzzlePayload; onSolved: (answer: unknown, correct: boolean) => void }) {
  const Display = DISPLAY[payload.render];
  const Interactive = INTERACTIVE[payload.render];

  // local answer state for DISPLAY puzzles
  const [intVal, setIntVal] = useState("");
  const [num, setNum] = useState("");
  const [den, setDen] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const locked = correct === true;

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#7c3aed", background: "rgba(124,58,237,0.1)", padding: "3px 8px", borderRadius: 6 }}>Puzzle</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{payload.title}</span>
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
            <Feedback correct={correct} />
          </>
        )}

        {Interactive && <Interactive payload={payload} onSolved={onSolved} />}

        {!Display && !Interactive && (
          <p style={{ color: "#94a3b8", fontSize: 13 }}>This puzzle type isn't supported yet.</p>
        )}
      </div>
    </div>
  );
}
