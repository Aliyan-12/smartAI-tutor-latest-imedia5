import { motion, AnimatePresence } from "framer-motion";

/**
 * Tap-to-answer chips shown just above the chat input.
 *
 * When the tutor asks a short question (or wants a go-ahead) and there's no puzzle/quiz to
 * solve, the backend sends a `quick_replies` frame with 2-5 options. The student TAPS one
 * instead of typing — the whole point for KS1-KS3, who can barely type. The chosen text is
 * sent exactly as if they had typed it, so the AI handles it through the normal flow. The
 * text box stays available underneath ("or reply directly").
 */

const CHIP_COLOURS = ["#2563eb", "#16a34a", "#f97316", "#a855f7", "#ec4899"];

export default function QuickReplies({
  options, onPick, disabled,
}: { options: string[]; onPick: (text: string) => void; disabled?: boolean }) {
  if (!options.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px 4px" }}>
      <AnimatePresence>
        {options.map((opt, i) => {
          const colour = CHIP_COLOURS[i % CHIP_COLOURS.length];
          return (
            <motion.button
              key={opt + i}
              initial={{ scale: 0.8, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 24, delay: i * 0.05 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => !disabled && onPick(opt)}
              disabled={disabled}
              style={{
                padding: "9px 16px", borderRadius: 999, fontFamily: "inherit",
                fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
                color: disabled ? "#94a3b8" : colour,
                background: "#fff",
                border: `2px solid ${disabled ? "#e2e8f0" : colour}`,
                boxShadow: disabled ? "none" : "0 2px 6px rgba(0,0,0,0.08)",
                opacity: disabled ? 0.6 : 1,
                transition: "background .12s, color .12s",
              }}
            >
              {opt}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
