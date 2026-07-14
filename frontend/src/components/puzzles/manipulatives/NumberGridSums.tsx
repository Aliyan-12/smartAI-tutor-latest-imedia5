import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

/**
 * A grid whose rows and columns must each hit their total. Some cells are blank; the missing
 * numbers sit in a tray below.
 *
 * Tap-to-place rather than drag-and-drop: pick up a tile, tap a hole. Drag is a nightmare on a
 * touchscreen for small hands, and it's how MatchingPuzzle already works here — so this is the
 * interaction children on this platform have already learned.
 *
 * Each row/column total turns green the moment it's satisfied, which turns the whole thing into
 * a self-checking puzzle rather than a guess-then-submit.
 */
export default function NumberGridSums({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const size = (payload.params.size as number) ?? 3;
  const grid = (payload.params.grid as (number | null)[][]) || [];
  const blanks = (payload.params.blanks as [number, number][]) || [];
  const rowTargets = (payload.params.row_targets as number[]) || [];
  const colTargets = (payload.params.col_targets as number[]) || [];
  const tiles = (payload.params.tiles as number[]) || [];

  // placed[cellKey] = index into `tiles` (so duplicate values stay distinguishable)
  const [placed, setPlaced] = useState<Record<string, number>>({});
  const [held, setHeld] = useState<number | null>(null);

  const usedTiles = new Set(Object.values(placed));
  const cellOf = (ti: number) => Object.keys(placed).find((k) => placed[k] === ti);

  const valueAt = (r: number, c: number): number | null => {
    const fixed = grid[r]?.[c];
    if (fixed !== null && fixed !== undefined) return fixed;
    const ti = placed[`${r},${c}`];
    return ti === undefined ? null : tiles[ti];
  };

  const rowSum = (r: number) => {
    let s = 0;
    for (let c = 0; c < size; c++) s += valueAt(r, c) ?? 0;
    return s;
  };
  const colSum = (c: number) => {
    let s = 0;
    for (let r = 0; r < size; r++) s += valueAt(r, c) ?? 0;
    return s;
  };
  const rowFull = (r: number) => Array.from({ length: size }, (_, c) => valueAt(r, c)).every((v) => v !== null);
  const colFull = (c: number) => Array.from({ length: size }, (_, r) => valueAt(r, c)).every((v) => v !== null);

  const isBlank = (r: number, c: number) => blanks.some(([br, bc]) => br === r && bc === c);

  const tapCell = (r: number, c: number) => {
    if (disabled || !isBlank(r, c)) return;
    const key = `${r},${c}`;
    playTapSound();
    setPlaced((prev) => {
      const next = { ...prev };
      if (held === null) {
        delete next[key];              // tap a filled hole with empty hands → take the tile back
        return next;
      }
      const previous = cellOf(held);
      if (previous) delete next[previous];
      next[key] = held;
      return next;
    });
    if (held !== null) setHeld(null);
  };

  const tapTile = (ti: number) => {
    if (disabled || usedTiles.has(ti)) return;
    playTapSound();
    setHeld((h) => (h === ti ? null : ti));
  };

  const allPlaced = blanks.every(([r, c]) => placed[`${r},${c}`] !== undefined);

  const answer = () =>
    Object.fromEntries(Object.entries(placed).map(([k, ti]) => [k, tiles[ti]]));

  const cellPx = size <= 3 ? 86 : 72;

  return (
    <>
      <Stage style={{ gap: 20 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div>
            {Array.from({ length: size }, (_, r) => (
              <div key={r} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                {Array.from({ length: size }, (_, c) => {
                  const v = valueAt(r, c);
                  const blank = isBlank(r, c);
                  return (
                    <motion.button
                      key={c}
                      layout
                      onClick={() => tapCell(r, c)}
                      disabled={disabled || !blank}
                      whileTap={blank ? { scale: 0.94 } : undefined}
                      style={{
                        width: cellPx, height: cellPx, borderRadius: 12,
                        fontSize: 30, fontWeight: 800, fontFamily: "inherit",
                        color: blank ? BAND.purple : BAND.ink,
                        background: blank ? (v === null ? "#fed7aa" : "#fff") : "#fff",
                        border: blank
                          ? `3px dashed ${held !== null && v === null ? BAND.green : "#fb923c"}`
                          : `2px solid ${BAND.line}`,
                        cursor: blank && !disabled ? "pointer" : "default",
                      }}
                    >
                      {v ?? ""}
                    </motion.button>
                  );
                })}
                <Total value={rowSum(r)} target={rowTargets[r]} full={rowFull(r)} />
              </div>
            ))}

            {/* Column totals */}
            <div style={{ display: "flex", gap: 8 }}>
              {Array.from({ length: size }, (_, c) => (
                <div key={c} style={{ width: cellPx, display: "flex", justifyContent: "center" }}>
                  <Total value={colSum(c)} target={colTargets[c]} full={colFull(c)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tile tray */}
        <div style={{ display: "flex", gap: 10, padding: "12px 16px", background: "#f8fafc", borderRadius: 14, border: `2px solid ${BAND.line}` }}>
          {tiles.map((t, ti) => {
            const used = usedTiles.has(ti);
            return (
              <motion.button
                key={ti}
                onClick={() => tapTile(ti)}
                disabled={disabled || used}
                animate={{ scale: held === ti ? 1.12 : 1, opacity: used ? 0.25 : 1 }}
                whileTap={{ scale: 0.94 }}
                style={{
                  width: 60, height: 68, borderRadius: 10,
                  fontSize: 28, fontWeight: 800, fontFamily: "inherit",
                  background: "#fff", color: BAND.ink,
                  border: held === ti ? `3px solid ${BAND.green}` : `2px solid ${BAND.line}`,
                  cursor: used || disabled ? "default" : "pointer",
                  boxShadow: held === ti ? "0 6px 14px rgba(22,163,74,.25)" : "0 2px 0 #cbd5e1",
                }}
              >
                {t}
              </motion.button>
            );
          })}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit(answer())}
        disabled={disabled || !allPlaced}
        hint={held !== null ? "Now tap an orange square" : allPlaced ? undefined : "Tap a tile, then a square"}
      />
    </>
  );
}

/** A row/column total that goes green the moment it's satisfied — self-checking. */
function Total({ value, target, full }: { value: number; target: number; full: boolean }) {
  const ok = full && value === target;
  const bad = full && value !== target;
  return (
    <div
      style={{
        minWidth: 52, height: 40, borderRadius: 10, padding: "0 8px",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums",
        color: ok ? "#fff" : bad ? "#dc2626" : BAND.muted,
        background: ok ? BAND.green : bad ? "#fee2e2" : "transparent",
      }}
    >
      {target}
    </div>
  );
}
