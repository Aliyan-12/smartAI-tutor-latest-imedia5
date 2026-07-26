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
  20: { recap: 5, teach: 0,  practice: 5,  quiz: 5,  review: 5 },
  40: { recap: 5, teach: 15, practice: 5,  quiz: 10, review: 5 },
  60: { recap: 5, teach: 20, practice: 15, quiz: 10, review: 10 },
  90: { recap: 5, teach: 35, practice: 25, quiz: 15, review: 10 },
};

const ORDER: PhaseKey[] = ["recap", "teach", "practice", "quiz", "review"];

/** Nearest bookable length — the server does the same, so previews never disagree. */
export function budgetKey(mins: number): number {
  return mins <= 22 ? 20 : mins <= 45 ? 40 : mins <= 70 ? 60 : 90;
}

/** Phases with minutes, omitting any the budget gives zero (e.g. teaching at 20 min). */
export function phasesFor(mins: number): { key: PhaseKey; mins: number }[] {
  const b = PHASE_BUDGET[budgetKey(mins)];
  return ORDER.filter((k) => b[k] > 0).map((k) => ({ key: k, mins: b[k] }));
}

/** Same, with cumulative end times — used by the in-session strip to highlight by elapsed. */
export function phaseTimeline(mins: number): { label: string; end: number }[] {
  const labels: Record<PhaseKey, string> = {
    recap: "Recap", teach: "Teaching", practice: "Practice", quiz: "Quiz", review: "Summary",
  };
  let acc = 0;
  return phasesFor(mins).map((p) => {
    acc += p.mins;
    return { label: labels[p.key], end: acc };
  });
}
