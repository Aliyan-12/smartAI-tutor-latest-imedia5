import { useMemo, useState } from "react";
import { Stage, Layer, Rect, Text, Group } from "react-konva";
import type Konva from "konva";
import type { InteractivePuzzleProps } from "./types";
import { pBtn, pBtnGhost, Feedback } from "./ui";

const BIN_COLORS: Record<string, string> = { solid: "#3b82f6", liquid: "#06b6d4", gas: "#f59e0b" };
const W = 420, BIN_TOP = 28, BIN_H = 150, TRAY_Y = 210, STAGE_H = 300;

export default function StatesOfMatter({ payload, onSolved, disabled }: InteractivePuzzleProps) {
  const bins = (payload.params.bins as string[]) || ["solid", "liquid", "gas"];
  const items = useMemo(
    () => ((payload.params.items as { name: string }[]) || []).map((i) => i.name),
    [payload.params.items]
  );
  const solution = (payload.solution as Record<string, string>) || {};
  const binW = W / bins.length;

  const homes = useMemo(() => {
    const gap = W / (items.length + 1);
    const m: Record<string, { x: number; y: number }> = {};
    items.forEach((n, i) => { m[n] = { x: gap * (i + 1), y: TRAY_Y + 20 }; });
    return m;
  }, [items]);

  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>(() => ({ ...homes }));
  const [assign, setAssign] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(items.map((n) => [n, null]))
  );
  const [correct, setCorrect] = useState<boolean | null>(null);
  const locked = disabled || correct === true;

  const onDragEnd = (name: string, e: Konva.KonvaEventObject<DragEvent>) => {
    if (locked) return;
    const cx = e.target.x(), cy = e.target.y();
    if (cy < BIN_TOP + BIN_H + 6) {
      const bi = Math.max(0, Math.min(bins.length - 1, Math.floor(cx / binW)));
      const bin = bins[bi];
      const inBin = Object.entries(assign).filter(([n, b]) => b === bin && n !== name).length;
      setPos((p) => ({ ...p, [name]: { x: bi * binW + binW / 2, y: BIN_TOP + 46 + inBin * 30 } }));
      setAssign((a) => ({ ...a, [name]: bin }));
    } else {
      setPos((p) => ({ ...p, [name]: homes[name] }));
      setAssign((a) => ({ ...a, [name]: null }));
    }
    setCorrect(null);
  };

  const check = () => {
    const ok = items.every((n) => assign[n] && assign[n] === solution[n]);
    setCorrect(ok);
    onSolved(assign, ok);
  };
  const reset = () => { setPos({ ...homes }); setAssign(Object.fromEntries(items.map((n) => [n, null]))); setCorrect(null); };

  return (
    <div style={{ textAlign: "center" }}>
      <Stage width={W} height={STAGE_H} style={{ margin: "0 auto" }}>
        <Layer>
          {bins.map((b, i) => (
            <Group key={b}>
              <Rect x={i * binW + 4} y={BIN_TOP} width={binW - 8} height={BIN_H}
                fill={`${BIN_COLORS[b] || "#94a3b8"}14`} stroke={BIN_COLORS[b] || "#94a3b8"} strokeWidth={2} cornerRadius={10} dash={[6, 4]} />
              <Text x={i * binW} y={BIN_TOP - 20} width={binW} align="center"
                text={b.toUpperCase()} fontSize={13} fontStyle="700" fill={BIN_COLORS[b] || "#475569"} />
            </Group>
          ))}
          {items.map((name) => {
            const w = name.length * 7.2 + 18;
            return (
              <Group key={name} x={pos[name].x} y={pos[name].y} draggable={!locked} onDragEnd={(e) => onDragEnd(name, e)}>
                <Rect width={w} height={26} offsetX={w / 2} offsetY={13} fill="#1e293b" cornerRadius={13} />
                <Text text={name} fontSize={12.5} fill="#fff" width={w} offsetX={w / 2} offsetY={6.5} align="center" />
              </Group>
            );
          })}
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
