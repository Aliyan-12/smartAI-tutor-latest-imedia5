import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { playCorrectSound, playWrongSound } from "../../lib/sounds";

/**
 * The reward moment. Fires when the server marks an answer — confetti + a chime for a correct
 * one, a soft buzz and nothing else for a wrong one (a wrong answer should never feel punished,
 * but it shouldn't feel like a party either).
 *
 * Driven by `trigger`, which the parent bumps on each new verdict. A plain boolean wouldn't
 * work: two correct answers in a row wouldn't change it, so the second would fire nothing.
 */
export default function Celebration({
  trigger, correct,
}: { trigger: number; correct: boolean }) {
  const seen = useRef(0);

  useEffect(() => {
    if (trigger === 0 || trigger === seen.current) return;
    seen.current = trigger;

    if (!correct) {
      playWrongSound();
      return;
    }

    playCorrectSound();
    // Two bursts angled in from the sides — a single centre burst reads as a pop-up, two
    // reads as party poppers.
    const common = { particleCount: 70, spread: 65, startVelocity: 45, ticks: 180, zIndex: 9999 };
    confetti({ ...common, origin: { x: 0.15, y: 0.75 }, angle: 60 });
    confetti({ ...common, origin: { x: 0.85, y: 0.75 }, angle: 120 });
    // …and a little shower over the middle a beat later, so it keeps going just long enough
    // for a 6-year-old to notice it.
    const t = window.setTimeout(() => {
      confetti({
        particleCount: 50, spread: 100, startVelocity: 30, ticks: 200,
        origin: { x: 0.5, y: 0.4 }, zIndex: 9999, scalar: 0.9,
      });
    }, 220);
    return () => window.clearTimeout(t);
  }, [trigger, correct]);

  return null;
}
