import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * PunnettSquare — tap a box, then tap the two alleles that belong in it.
 *
 * The grid shows one parent's alleles across the top and the other's down the side, so the
 * "take one from the top, one from the side" rule is visible in the layout itself. The cross is
 * derived server-side from the two parent genotypes, so it cannot disagree with the biology.
 */
export default function PunnettSquare({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const cols = (payload.params.cols as string[]) || [];
  const rows = (payload.params.rows as string[]) || [];
  const alleles = (payload.params.alleles as string[]) || [];
  const trait = (payload.params.trait as string) || "";

  const [cells, setCells] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);

  const total = rows.length * cols.length;
  const filled = Object.values(cells).filter((v) => v && v.length === 2).length;

  const tapAllele = (a: string) => {
    if (disabled || !active) return;
    setCells((c) => {
      const cur = c[active] || "";
      const next = cur.length >= 2 ? a : cur + a;   // 3rd tap starts over
      return { ...c, [active]: next };
    });
  };

  const isDominant = (g: string) => g && g[0] === g[0].toUpperCase();

  return (
    <>
      <Stage style={{ gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: `44px repeat(${cols.length}, 76px)`, gap: 6 }}>
          <div />
          {cols.map((c) => (
            <div key={`h${c}`} style={{
              textAlign: "center", fontSize: 20, fontWeight: 800, color: BAND.blue,
            }}>{c}</div>
          ))}
          {rows.map((r, ri) => (
            <div key={`row${ri}`} style={{ display: "contents" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, fontWeight: 800, color: BAND.pink,
              }}>{r}</div>
              {cols.map((_c, ci) => {
                const key = `${ri}${ci}`;
                const val = cells[key] || "";
                const isActive = active === key;
                const complete = val.length === 2;
                return (
                  <motion.button
                    key={key}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => !disabled && setActive(isActive ? null : key)}
                    disabled={disabled}
                    style={{
                      height: 76, borderRadius: 12, fontFamily: "inherit",
                      fontSize: 24, fontWeight: 800,
                      color: complete ? (isDominant(val) ? BAND.purple : BAND.ink) : "#cbd5e1",
                      background: isActive ? "rgba(37,99,235,0.10)" : "#fff",
                      border: `3px solid ${isActive ? BAND.blue : complete ? BAND.green : BAND.line}`,
                      cursor: disabled ? "default" : "pointer",
                    }}
                  >
                    {val || "?"}
                  </motion.button>
                );
              })}
            </div>
          ))}
        </div>

        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: BAND.muted }}>
          {active ? "Now tap two alleles ↓" : "Tap a box to fill it in"}
          {trait ? ` · ${trait}` : ""}
        </p>

        <div style={{ display: "flex", gap: 12 }}>
          {alleles.map((a) => (
            <motion.button
              key={a}
              whileTap={{ scale: 0.92 }}
              onClick={() => tapAllele(a)}
              disabled={disabled || !active}
              style={{
                width: 66, height: 58, borderRadius: 13, fontFamily: "inherit",
                fontSize: 26, fontWeight: 800,
                color: active ? "#fff" : "#cbd5e1",
                background: active ? (isDominant(a) ? BAND.purple : BAND.ink) : "#f1f5f9",
                border: "none", cursor: active && !disabled ? "pointer" : "not-allowed",
              }}
            >
              {a}
            </motion.button>
          ))}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ cells })}
        disabled={disabled || filled < total}
        hint={filled < total ? `${total - filled} box${total - filled === 1 ? "" : "es"} left` : undefined}
      />
    </>
  );
}
