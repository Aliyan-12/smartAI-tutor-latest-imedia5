import { useMemo, useState } from "react";
import { Stage, Layer, Rect, Text, Circle, Line, Ellipse, Group } from "react-konva";
import type Konva from "konva";
import type { InteractivePuzzleProps } from "./types";
import { pBtn, pBtnGhost, Feedback } from "./ui";

interface Slot { id: string; x: number; y: number; }

function DiagramBg({ kind }: { kind: string }) {
  if (kind === "animal_cell") {
    return (
      <>
        <Circle x={180} y={150} radius={120} fill="#fde68a" stroke="#d97706" strokeWidth={2} />
        <Circle x={180} y={150} radius={34} fill="#a855f7" />
        <Ellipse x={230} y={220} radiusX={22} radiusY={11} fill="#ef4444" />
        <Ellipse x={120} y={95} radiusX={20} radiusY={10} fill="#f97316" />
      </>
    );
  }
  if (kind === "leaf") {
    return (
      <>
        <Ellipse x={180} y={150} radiusX={95} radiusY={120} fill="#22c55e" stroke="#15803d" strokeWidth={2} />
        <Line points={[180, 50, 180, 255]} stroke="#15803d" strokeWidth={4} />
        {[90, 130, 170, 210].map((y, i) => (
          <Line key={i} points={[180, y, 180 + (i % 2 ? 55 : -55), y + 22]} stroke="#15803d" strokeWidth={2} />
        ))}
        <Line points={[180, 255, 180, 290]} stroke="#15803d" strokeWidth={5} />
      </>
    );
  }
  if (kind === "simple_circuit") {
    return (
      <>
        <Line points={[70, 80, 290, 80, 290, 250, 70, 250, 70, 80]} stroke="#1e293b" strokeWidth={3} closed={false} />
        {/* bulb top */}
        <Circle x={180} y={80} radius={16} fill="#fde68a" stroke="#1e293b" strokeWidth={2} />
        {/* cell bottom (two plates) */}
        <Line points={[168, 250, 168, 232]} stroke="#1e293b" strokeWidth={3} />
        <Line points={[192, 250, 192, 240]} stroke="#1e293b" strokeWidth={6} />
        {/* switch right */}
        <Line points={[290, 150, 312, 132]} stroke="#1e293b" strokeWidth={3} />
        <Circle x={290} y={150} radius={3} fill="#1e293b" />
      </>
    );
  }
  if (kind === "human_body") {
    return (
      <>
        <Circle x={180} y={45} radius={26} fill="#fed7aa" stroke="#c2410c" strokeWidth={2} />
        <Rect x={150} y={75} width={60} height={120} cornerRadius={14} fill="#93c5fd" stroke="#1d4ed8" strokeWidth={2} />
        <Line points={[150, 90, 95, 160]} stroke="#1d4ed8" strokeWidth={8} lineCap="round" />
        <Line points={[210, 90, 265, 160]} stroke="#1d4ed8" strokeWidth={8} lineCap="round" />
        <Line points={[165, 195, 150, 290]} stroke="#1e3a8a" strokeWidth={9} lineCap="round" />
        <Line points={[195, 195, 210, 290]} stroke="#1e3a8a" strokeWidth={9} lineCap="round" />
      </>
    );
  }
  if (kind === "atom") {
    return (
      <>
        <Ellipse x={180} y={150} radiusX={130} radiusY={70} stroke="#94a3b8" strokeWidth={2} />
        <Circle x={180} y={150} radius={26} fill="#7c3aed" />
        <Circle x={180} y={40} radius={8} fill="#1a73e8" stroke="#fff" strokeWidth={1.5} />
      </>
    );
  }
  if (kind === "wave") {
    // one sine cycle: crest near x80, trough near x170
    const pts: number[] = [];
    for (let x = 20; x <= 340; x += 4) {
      const y = 105 - 55 * Math.sin(((x - 20) / 90) * Math.PI);
      pts.push(x, y);
    }
    return (
      <>
        <Line points={[20, 105, 340, 105]} stroke="#cbd5e1" strokeWidth={1} dash={[4, 4]} />
        <Line points={pts} stroke="#1a73e8" strokeWidth={3} lineCap="round" tension={0.1} />
      </>
    );
  }
  // plant (default)
  return (
    <>
      <Line points={[180, 70, 180, 260]} stroke="#16a34a" strokeWidth={8} />
      <Circle x={180} y={45} radius={26} fill="#f97316" />
      <Ellipse x={245} y={150} radiusX={34} radiusY={16} fill="#22c55e" rotation={-20} />
      <Line points={[180, 260, 160, 285]} stroke="#92400e" strokeWidth={4} />
      <Line points={[180, 260, 200, 285]} stroke="#92400e" strokeWidth={4} />
      <Line points={[180, 260, 180, 288]} stroke="#92400e" strokeWidth={4} />
    </>
  );
}

export default function LabelDiagram({ payload, onSolved, disabled }: InteractivePuzzleProps) {
  const slots = (payload.params.slots as Slot[]) || [];
  const labels = (payload.params.labels as string[]) || [];
  const solution = (payload.solution as Record<string, string>) || {};
  const diagram = String(payload.params.diagram || "plant");
  const W = Math.max(360, Number(payload.params.width) || 360);
  const diagH = Number(payload.params.height) || 300;
  const stageH = diagH + 70;

  const homes = useMemo(() => {
    const gap = W / (labels.length + 1);
    const m: Record<string, { x: number; y: number }> = {};
    labels.forEach((l, i) => { m[l] = { x: gap * (i + 1), y: diagH + 32 }; });
    return m;
  }, [labels, W, diagH]);

  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>(() => ({ ...homes }));
  const [placed, setPlaced] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(labels.map((l) => [l, null]))
  );
  const [correct, setCorrect] = useState<boolean | null>(null);
  const locked = disabled || correct === true;

  const onDragEnd = (label: string, e: Konva.KonvaEventObject<DragEvent>) => {
    if (locked) return;
    const cx = e.target.x(), cy = e.target.y();
    let near: Slot | null = null, best = 40;
    for (const s of slots) {
      const d = Math.hypot(s.x - cx, s.y - cy);
      const taken = Object.entries(placed).some(([l, sid]) => sid === s.id && l !== label);
      if (d < best && !taken) { best = d; near = s; }
    }
    if (near) {
      setPos((p) => ({ ...p, [label]: { x: near!.x, y: near!.y } }));
      setPlaced((pl) => ({ ...pl, [label]: near!.id }));
    } else {
      setPos((p) => ({ ...p, [label]: homes[label] }));
      setPlaced((pl) => ({ ...pl, [label]: null }));
    }
    setCorrect(null);
  };

  const check = () => {
    const ok = slots.every((s) => {
      const lbl = Object.entries(placed).find(([, sid]) => sid === s.id)?.[0];
      return lbl && solution[s.id] === lbl;
    });
    setCorrect(ok);
    onSolved(placed, ok);
  };
  const reset = () => { setPos({ ...homes }); setPlaced(Object.fromEntries(labels.map((l) => [l, null]))); setCorrect(null); };

  return (
    <div style={{ textAlign: "center" }}>
      <Stage width={W} height={stageH} style={{ margin: "0 auto" }}>
        <Layer>
          <DiagramBg kind={diagram} />
          {slots.map((s) => (
            <Circle key={s.id} x={s.x} y={s.y} radius={9} fill="#fff" stroke="#1a73e8" strokeWidth={2} dash={[3, 3]} />
          ))}
          {labels.map((label) => (
            <Group
              key={label} x={pos[label].x} y={pos[label].y} draggable={!locked}
              onDragEnd={(e) => onDragEnd(label, e)}
            >
              <Rect
                width={label.length * 7.4 + 18} height={26} offsetX={(label.length * 7.4 + 18) / 2} offsetY={13}
                fill="#1a73e8" cornerRadius={13} shadowBlur={3} shadowColor="#94a3b8"
              />
              <Text
                text={label} fontSize={13} fill="#fff" fontStyle="600"
                width={label.length * 7.4 + 18} offsetX={(label.length * 7.4 + 18) / 2} offsetY={7}
                align="center"
              />
            </Group>
          ))}
        </Layer>
      </Stage>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
        <button style={pBtnGhost} onClick={reset} disabled={locked}>Reset</button>
        <button style={pBtn} onClick={check} disabled={locked}>Check</button>
      </div>
      <Feedback correct={correct} />
    </div>
  );
}
