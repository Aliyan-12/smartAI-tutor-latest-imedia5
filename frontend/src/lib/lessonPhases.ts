/**
 * lessonPhases — the single source of truth for lesson phase timings on the client.
 *
 * MIRRORS `lesson_service._PHASE_BUDGET` on the server, which generates the real `plan_blocks`
 * the AI actually teaches from. Both pages that show a lesson's shape (the setup page preview
 * and the in-session phase strip) read from here, so the student is never promised a structure
 * the tutor doesn't follow.
 *
 * Before this existed the three drifted badly: the session strip showed a "Quiz" phase no plan
 * has ever contained and a "Brain Break" that doesn't exist, the setup page promised a 20-minute
 * lesson 5 minutes of teaching, and the server gave that lesson no teaching phase at all while
 * allocating 25 minutes of content into a 20-minute slot.
 *
 * A 20-minute Quick Boost deliberately has NO teaching phase: there isn't time to introduce new
 * material and practise it, so it recaps → practises → quizzes → reviews.
 */

export type PhaseKey = "recap" | "teach" | "practice" | "quiz" | "review";

export const PHASE_BUDGET: Record<number, Record<PhaseKey, number>> = {
  20: { recap: 0, teach: 0,  practice: 10, quiz: 5,  review: 5 },
  40: { recap: 5, teach: 15, practice: 5,  quiz: 10, review: 5 },
  60: { recap: 5, teach: 20, practice: 15, quiz: 10, review: 10 },
  90: { recap: 5, teach: 35, practice: 25, quiz: 15, review: 10 },
};

const ORDER: PhaseKey[] = ["recap", "teach", "practice", "quiz", "review"];

/** Goals that are PRACTICE-ONLY (mirrors the server's _PRACTICE_ONLY_GOALS): "Practice & Improve"/
 *  homework has NO recap or teaching phase at ANY length — those minutes fold into practice. */
const PRACTICE_ONLY_GOALS = ["homework"];

/** Nearest bookable length — the server does the same, so previews never disagree. */
export function budgetKey(mins: number): number {
  return mins <= 22 ? 20 : mins <= 45 ? 40 : mins <= 70 ? 60 : 90;
}

/** The phase budget for this length AND goal. Practice-only goals drop recap+teach into practice. */
function budgetFor(mins: number, goal?: string): Record<PhaseKey, number> {
  const b = { ...PHASE_BUDGET[budgetKey(mins)] };
  if (goal && PRACTICE_ONLY_GOALS.includes(goal)) {
    b.practice += b.recap + b.teach;
    b.recap = 0;
    b.teach = 0;
  }
  return b;
}

/** Map a lesson's "Session type: …" description line to its goal id (for the phase shape). */
export function goalFromDescription(description?: string): string | undefined {
  const m = /Session type:\s*(.+)/i.exec(description || "");
  const st = (m?.[1]?.split("\n")[0] || "").trim().toLowerCase();
  if (!st) return undefined;
  if (st.includes("homework")) return "homework";
  if (st.includes("catch")) return "catch_up";
  if (st.includes("revision")) return "revision";
  if (st.includes("scratch")) return "learn_scratch";
  return undefined;
}

/** Phases with minutes, omitting any the budget gives zero (teaching at 20 min / any homework). */
export function phasesFor(mins: number, goal?: string): { key: PhaseKey; mins: number }[] {
  const b = budgetFor(mins, goal);
  return ORDER.filter((k) => b[k] > 0).map((k) => ({ key: k, mins: b[k] }));
}

/** Same, with cumulative end times — used by the in-session strip to highlight by elapsed. */
export function phaseTimeline(mins: number, goal?: string): { label: string; end: number }[] {
  const labels: Record<PhaseKey, string> = {
    recap: "Recap", teach: "Teaching", practice: "Practice", quiz: "Quiz", review: "Summary",
  };
  let acc = 0;
  return phasesFor(mins, goal).map((p) => {
    acc += p.mins;
    return { label: labels[p.key], end: acc };
  });
}
