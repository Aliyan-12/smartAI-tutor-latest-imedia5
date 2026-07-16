import { useMemo } from "react";
import { motion } from "framer-motion";

/**
 * The Learn panel's idle state — what fills the screen before the tutor puts up a slide or an
 * activity. The old version was a grey "Slides will appear here" on flat white, which read as
 * "nothing is happening / is this broken?". This makes the panel feel alive and signals that
 * this is where the fun (puzzles, activities) will show up.
 *
 * Self-contained: floating maths shapes drift up behind a friendly welcome card. No assets, no
 * network. Purely decorative — pointer-events off, so it never eats a click.
 */

const SHAPES = ["+", "−", "×", "÷", "=", "½", "¼", "π", "△", "○", "□", "★", "7", "3", "%"];
const COLOURS = ["#2563eb", "#16a34a", "#f97316", "#a855f7", "#ec4899", "#0891b2", "#eab308"];

interface Floaty {
  glyph: string; colour: string; left: number; size: number; delay: number; dur: number; drift: number;
}

export default function LearnIdle() {
  // Positions fixed once per mount so the shapes drift smoothly instead of re-randomising.
  const floats = useMemo<Floaty[]>(() => {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    return Array.from({ length: 16 }, (_, i) => ({
      glyph: SHAPES[i % SHAPES.length],
      colour: COLOURS[i % COLOURS.length],
      left: rnd(2, 94),
      size: rnd(26, 58),
      delay: rnd(0, 8),
      dur: rnd(11, 20),
      drift: rnd(-40, 40),
    }));
  }, []);

  return (
    <div style={{
      position: "relative", flex: 1, minHeight: 0, width: "100%", overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(180deg, #ffffff 0%, #f4f7ff 100%)",
    }}>
      {/* drifting maths shapes — animate `top` (relative to THIS panel) so they rise the whole
          height from the bottom edge to above the top. `y: "115%"` was relative to each glyph's
          own font-size, so they barely moved and bunched up in the middle. The opacity uses
          `times` so each shape is already VISIBLE just above the bottom edge (fades in within the
          first 10% of the climb) — otherwise the even-spaced fade left them invisible until the
          middle, which looked like they were spawning from a line across the centre. */}
      {floats.map((f, i) => (
        <motion.span
          key={i}
          initial={{ top: "108%", opacity: 0, rotate: -12 }}
          animate={{ top: "-18%", opacity: [0, 0.55, 0.55, 0], rotate: 12, x: f.drift }}
          transition={{
            duration: f.dur, delay: f.delay, repeat: Infinity, ease: "linear",
            opacity: { duration: f.dur, delay: f.delay, repeat: Infinity, ease: "linear",
                       times: [0, 0.1, 0.85, 1] },
          }}
          style={{
            position: "absolute", left: `${f.left}%`,
            fontSize: f.size, fontWeight: 800, color: f.colour,
            userSelect: "none", pointerEvents: "none",
          }}
        >
          {f.glyph}
        </motion.span>
      ))}

      {/* welcome card */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
        style={{
          position: "relative", zIndex: 1, textAlign: "center", padding: "32px 34px",
          borderRadius: 22, background: "rgba(255,255,255,0.82)",
          border: "1px solid rgba(226,232,240,0.9)", backdropFilter: "blur(6px)",
          boxShadow: "0 20px 50px rgba(37,99,235,0.10)", maxWidth: 420,
        }}
      >
        <motion.div
          animate={{ y: [0, -8, 0], rotate: [0, -6, 6, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          style={{ fontSize: 56, marginBottom: 10 }}
        >
          🧩
        </motion.div>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
          Your activities appear here
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 600, color: "#64748b", lineHeight: 1.5 }}>
          Slides, puzzles and games from your tutor will pop up on this screen —
          get ready to build, tap and solve!
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
          {["🔢", "✏️", "🎯", "⭐"].map((e, i) => (
            <motion.span
              key={e}
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
              style={{ fontSize: 24 }}
            >
              {e}
            </motion.span>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
