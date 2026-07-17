import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * MoneyCoins — tap real UK coins to make an amount; tap a coin in the purse to take it back.
 *
 * Marked on the TOTAL, never on which coins were used, so 50p+20p and 20p×3+10p are both right —
 * that freedom is the whole point of the activity. The running total updates live and turns
 * green the moment it matches.
 */

const COIN_STYLE: Record<number, { label: string; fill: string; ring: string; size: number }> = {
  1:   { label: "1p",  fill: "#c2703f", ring: "#9a5730", size: 46 },
  2:   { label: "2p",  fill: "#b9623a", ring: "#8f4a2b", size: 54 },
  5:   { label: "5p",  fill: "#cbd5e1", ring: "#94a3b8", size: 44 },
  10:  { label: "10p", fill: "#d7dee7", ring: "#94a3b8", size: 52 },
  20:  { label: "20p", fill: "#dde4ec", ring: "#94a3b8", size: 50 },
  50:  { label: "50p", fill: "#e2e8f0", ring: "#94a3b8", size: 58 },
  100: { label: "£1",  fill: "#e5c15d", ring: "#b08d2b", size: 54 },
  200: { label: "£2",  fill: "#e5c15d", ring: "#7c8aa0", size: 60 },
};

const fmt = (p: number) => (p < 100 ? `${p}p` : `£${(p / 100).toFixed(2)}`);

export default function MoneyCoins({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const target = (payload.params.amount_p as number) ?? 0;
  const coins = (payload.params.coins as number[]) || [1, 2, 5, 10, 20, 50];

  const [purse, setPurse] = useState<number[]>([]);
  const total = purse.reduce((a, b) => a + b, 0);
  const exact = total === target;

  const coinFace = (v: number, onClick: () => void, key: string) => {
    const s = COIN_STYLE[v] || { label: `${v}p`, fill: "#cbd5e1", ring: "#94a3b8", size: 48 };
    return (
      <motion.button
        key={key}
        layout
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.4, opacity: 0 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => !disabled && onClick()}
        disabled={disabled}
        style={{
          width: s.size, height: s.size, borderRadius: "50%",
          background: `radial-gradient(circle at 34% 30%, #ffffffcc 0%, ${s.fill} 55%)`,
          border: `3px solid ${s.ring}`,
          color: "#3b2f14", fontFamily: "inherit", fontSize: v >= 100 ? 15 : 13, fontWeight: 800,
          cursor: disabled ? "default" : "pointer", flexShrink: 0,
          boxShadow: "0 3px 0 rgba(0,0,0,0.18)",
        }}
      >
        {s.label}
      </motion.button>
    );
  };

  return (
    <>
      <Stage style={{ gap: 16, justifyContent: "flex-start" }}>
        {/* running total */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 10, padding: "8px 22px", borderRadius: 14,
          background: exact ? "rgba(22,163,74,0.12)" : "#f8fafc",
          border: `2px solid ${exact ? BAND.green : BAND.line}`,
        }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: BAND.muted }}>YOU HAVE</span>
          <motion.span key={total} initial={{ scale: 1.25 }} animate={{ scale: 1 }}
                       style={{ fontSize: 30, fontWeight: 800, color: exact ? BAND.green : BAND.ink }}>
            {fmt(total)}
          </motion.span>
          <span style={{ fontSize: 14, fontWeight: 700, color: BAND.muted }}>/ {fmt(target)}</span>
        </div>

        {/* purse */}
        <div style={{
          width: "100%", maxWidth: 640, minHeight: 84, borderRadius: 16, padding: 10,
          border: `2px dashed ${purse.length ? BAND.orange : BAND.line}`,
          background: purse.length ? "rgba(249,115,22,0.05)" : "#fff",
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center",
        }}>
          <AnimatePresence>
            {purse.length === 0 ? (
              <span style={{ color: BAND.muted, fontWeight: 600, fontSize: 14 }}>
                Tap coins below to add them here
              </span>
            ) : (
              purse.map((v, i) =>
                coinFace(v, () => setPurse((p) => p.filter((_x, j) => j !== i)), `purse-${i}-${v}`)
              )
            )}
          </AnimatePresence>
        </div>

        {/* the coin tray */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          {coins.map((v) => coinFace(v, () => setPurse((p) => [...p, v]), `tray-${v}`))}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ total_p: total, coins: purse })}
        disabled={disabled || purse.length === 0}
      />
    </>
  );
}
