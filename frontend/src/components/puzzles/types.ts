export interface PuzzlePayload {
  puzzle_id: string;
  render: string;
  title: string;
  prompt: string;
  answer_type: "fraction" | "integer" | "choice" | "drag" | "text";
  params: Record<string, unknown>;
  solution: unknown;
}

/** Interactive (konva) puzzles evaluate themselves and report via onSolved. */
export interface InteractivePuzzleProps {
  payload: PuzzlePayload;
  onSolved: (answer: unknown, correct: boolean) => void;
  disabled?: boolean;
}

/** Display (SVG) puzzles just draw; PuzzlePlayer collects + checks the answer. */
export interface DisplayPuzzleProps {
  params: Record<string, unknown>;
}
