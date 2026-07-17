import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * SortingBins — tap a card, then tap the group it belongs in.
 *
 * The most reusable science activity in the set: living/non-living, materials, conductors,
 * acids/alkalis, elements vs compounds… one component, many topics. The items and the right
 * answers come from a server-owned bank (manipulative_service._SORTING_SETS), so the tutor
 * can't mislabel the science.
 *
 * Tap-to-place rather than drag-and-drop on purpose — a five-year-old on a trackpad can tap.
 */

const BIN_COLOURS = [BAND.blue, BAND.green, BAND.purple, BAND.orange];

interface Item { id: string; label: string }

export default function SortingBins({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const bins = (payload.params.bins as string[]) || [];
  const items = (payload.params.items as Item[]) || [];

  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);

  const unplaced = items.filter((i) => !placed[i.id]);
  const allPlaced = unplaced.length === 0;

  const place = (binName: string) => {
    if (disabled || !picked) return;
    setPlaced((p) => ({ ...p, [picked]: binName }));
    setPicked(null);
  };

  const takeBack = (id: string) => {
    if (disabled) return;
    setPlaced((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  };

  return (
    <>
      <Stage style={{ justifyContent: "flex-start", gap: 14, overflowY: "auto" }}>
        {/* the cards still to sort */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center",
          minHeight: 62, alignItems: "center",
        }}>
          <AnimatePresence>
            {unplaced.map((it) => {
              const isPicked = picked === it.id;
              return (
                <motion.button
                  key={it.id}
                  layout
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => !disabled && setPicked(isPicked ? null : it.id)}
                  disabled={disabled}
                  style={{
                    minHeight: 50, padding: "0 18px", borderRadius: 12,
                    fontFamily: "inherit", fontSize: 16, fontWeight: 700,
                    cursor: disabled ? "default" : "pointer",
                    color: isPicked ? "#fff" : BAND.ink,
                    background: isPicked ? BAND.ink : "#fff",
                    border: `2px solid ${isPicked ? BAND.ink : BAND.line}`,
                    boxShadow: isPicked ? "0 6px 16px rgba(15,23,42,0.28)" : "0 2px 0 rgba(0,0,0,0.08)",
                  }}
                >
                  {it.label}
                </motion.button>
              );
            })}
          </AnimatePresence>
          {allPlaced && (
            <span style={{ color: BAND.muted, fontWeight: 600, fontSize: 14 }}>
              All sorted — press Check!
            </span>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: BAND.muted }}>
          {picked ? "Now tap its group ↓" : "Tap a card to pick it up"}
        </p>

        {/* the groups */}
        <div style={{
          display: "grid", gap: 12, width: "100%", maxWidth: 720,
          gridTemplateColumns: `repeat(${Math.min(bins.length, 3)}, minmax(0, 1fr))`,
        }}>
          {bins.map((b, i) => {
            const colour = BIN_COLOURS[i % BIN_COLOURS.length];
            const mine = items.filter((it) => placed[it.id] === b);
            return (
              <motion.div
                key={b}
                onClick={() => place(b)}
                whileTap={picked ? { scale: 0.98 } : undefined}
                style={{
                  borderRadius: 16, padding: "10px 10px 12px", minHeight: 132,
                  border: `3px ${picked ? "solid" : "dashed"} ${colour}`,
                  background: picked ? `${colour}14` : "#fff",
                  cursor: picked && !disabled ? "pointer" : "default",
                  transition: "background .15s, border-color .15s",
                }}
              >
                <div style={{
                  fontSize: 14, fontWeight: 800, color: colour, textAlign: "center",
                  marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.03em",
                }}>
                  {b}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  <AnimatePresence>
                    {mine.map((it) => (
                      <motion.button
                        key={it.id}
                        layout
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        onClick={(e) => { e.stopPropagation(); takeBack(it.id); }}
                        disabled={disabled}
                        title="Tap to take it back"
                        style={{
                          padding: "7px 12px", borderRadius: 9, fontFamily: "inherit",
                          fontSize: 14, fontWeight: 700, color: "#fff", background: colour,
                          border: "none", cursor: disabled ? "default" : "pointer",
                        }}
                      >
                        {it.label}
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ placements: placed })}
        disabled={disabled || !allPlaced}
        hint={allPlaced ? undefined : `${unplaced.length} still to sort`}
      />
    </>
  );
}
