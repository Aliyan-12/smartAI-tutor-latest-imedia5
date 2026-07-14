/**
 * Payload for a GENERATED puzzle (Nano Banana image / matplotlib graph / KaTeX maths).
 * The backend supplies media URLs + prompt; the solution is kept server-side and marked
 * by a `*_evaluator` tool, so the client never computes correctness — it just collects
 * the student's structured answer and sends it back.
 */
export type PuzzleRender =
  // ── Generated media: the AI writes the question and hands over the answer ──
  | "explanatory_image"   // display-only diagram that explains a concept
  | "labelling"           // name each generated image in turn
  | "matching"            // match generated images to their names
  | "math"                // a maths problem shown as LaTeX or an image
  | "graph"               // a matplotlib graph + a question
  // ── Deterministic manipulatives: the AI passes params only; the SERVER derives the
  //    question AND the answer from them, and marks by exact comparison. The render key IS
  //    the kind (see backend manipulative_service.MANIPULATIVES). ──
  | "place_value_counters"
  | "column_addition"
  | "number_grid_sums"
  | "times_table_dash"
  | "fraction_canvas"
  | "dot_array"
  | "counting_bubbles";

export interface PuzzlePayload {
  render: PuzzleRender;
  puzzle_type: string;
  title: string;
  prompt: string;
  answer_type: string;
  params: Record<string, unknown>;
  /** Unique per generation — used as a React key so each fresh puzzle fully remounts. */
  instance_id?: string;
  /** Backend confirms the puzzle was built + persisted. */
  rendered?: boolean;
}

/** Interactive puzzles collect a structured answer and report it (no client marking). */
export interface InteractivePuzzleProps {
  payload: PuzzlePayload;
  onSubmit: (answer: unknown) => void;
  disabled?: boolean;
}
