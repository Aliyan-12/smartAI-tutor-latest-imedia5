import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage } from "./Shell";
import { playStreakSound, playTapSound } from "../../../lib/sounds";

interface Q { a: number; b: number }

/**
 * The times-table race: a flashcard deck, a phone numpad, a countdown bar and a streak counter.
 *
 * The motivation is the whole design. A child will grind twelve multiplication facts for a
 * streak and a shrinking bar in a way they never will for twelve typed questions. The clock
 * running out submits automatically — you're racing it, not it waiting for you.
 */
export default function TimesTableDash({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const questions = (payload.params.questions as Q[]) || [];
  const seconds = (payload.params.seconds as number) ?? 60;

  const [idx, setIdx] = useState(0);
  const [entry, setEntry] = useState("");
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [streak, setStreak] = useState(0);
  const [left, setLeft] = useState(seconds);

  const done = idx >= questions.length;
  const submitted = useRef(false);

  const finish = (final: (number | null)[]) => {
    if (submitted.current || disabled) return;
    submitted.current = true;
    onSubmit(final);
  };

  // The countdown. Time-up submits whatever they've got — that's what makes it a race.
  useEffect(() => {
    if (disabled || done) return;
    if (left <= 0) {
      finish(answers);
      return;
    }
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, disabled, done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (done && !submitted.current) finish(answers);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = questions[idx];

  const press = (d: string) => {
    if (disabled || done) return;
    playTapSound();
    setEntry((e) => (e.length >= 4 ? e : e + d));
  };

  const clear = () => { if (!disabled) { playTapSound(); setEntry(""); } };

  const commit = () => {
    if (disabled || done || !entry) return;
    const val = parseInt(entry, 10);
    const right = val === q.a * q.b;
    const next = [...answers];
    next[idx] = val;
    setAnswers(next);
    if (right) {
      const s = streak + 1;
      setStreak(s);
      playStreakSound(s);
    } else {
      setStreak(0);
    }
    setEntry("");
    setIdx((i) => i + 1);
  };

  const pct = Math.max(0, (left / seconds) * 100);
  const barColour = pct > 50 ? "#eab308" : pct > 20 ? BAND.green : "#dc2626";

  return (
    <>
      <Stage style={{ gap: 14 }}>
        {/* Timer bar — the pressure. */}
        <div style={{ width: "100%", maxWidth: 620, flexShrink: 0 }}>
          <div style={{ height: 18, borderRadius: 99, background: "#e2e8f0", overflow: "hidden" }}>
            <motion.div
              animate={{ width: `${pct}%` }}
              transition={{ ease: "linear", duration: 1 }}
              style={{ height: "100%", background: barColour, borderRadius: 99 }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: BAND.muted }}>
              {questions.length - idx} left
            </span>
            <AnimatePresence>
              {streak >= 3 && (
                <motion.span
                  key={streak}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ fontSize: 15, fontWeight: 800, color: "#d97706" }}
                >
                  🔥 {streak} in a row!
                </motion.span>
              )}
            </AnimatePresence>
            <span style={{ fontSize: 13, fontWeight: 700, color: BAND.muted }}>{left}s</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 34, flexWrap: "wrap", justifyContent: "center" }}>
          {/* The card */}
          <AnimatePresence mode="wait">
            {q && (
              <motion.div
                key={idx}
                initial={{ rotate: -4, x: 40, opacity: 0 }}
                animate={{ rotate: 0, x: 0, opacity: 1 }}
                exit={{ rotate: 5, x: -60, opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
                style={{
                  width: 250, height: 160, borderRadius: 14, background: "#fff",
                  border: `3px solid ${BAND.ink}`, boxShadow: "6px 6px 0 rgba(15,23,42,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 46, fontWeight: 800, color: BAND.ink,
                }}
              >
                {q.a} × {q.b}
              </motion.div>
            )}
          </AnimatePresence>

          {/* The numpad */}
          <div style={{ background: BAND.blue, padding: 12, borderRadius: 18, width: 232 }}>
            <div
              style={{
                background: "#fff", borderRadius: 10, height: 54, marginBottom: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 30, fontWeight: 800, color: BAND.ink, fontVariantNumeric: "tabular-nums",
              }}
            >
              {entry || " "}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <NumKey key={d} onClick={() => press(d)} disabled={disabled || done}>{d}</NumKey>
              ))}
              <NumKey onClick={clear} disabled={disabled || done} bg="#dc2626" fg="#fff">✕</NumKey>
              <NumKey onClick={() => press("0")} disabled={disabled || done}>0</NumKey>
              <NumKey onClick={commit} disabled={disabled || done || !entry} bg={BAND.green} fg="#fff">✓</NumKey>
            </div>
          </div>
        </div>
      </Stage>

      <CheckBar
        onCheck={() => finish(answers)}
        disabled={disabled || done}
        label="I'm done"
        hint="or answer them all"
      />
    </>
  );
}

function NumKey({
  children, onClick, disabled, bg, fg,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; bg?: string; fg?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 52, borderRadius: "50%", border: "none",
        background: disabled ? "#94a3b8" : bg || "#fff",
        color: fg || BAND.ink, fontSize: 22, fontWeight: 800, fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
