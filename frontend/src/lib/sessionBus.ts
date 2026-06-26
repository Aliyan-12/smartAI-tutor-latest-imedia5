/**
 * sessionBus — a tiny app-wide event bus (mitt) for the live session.
 *
 * Any component (PuzzlePlayer, the End modal, quick-prompt buttons, the timer) can
 * `sessionBus.emit("session", { type, data })` WITHOUT having the WebSocket channel
 * prop-drilled into it. `SessionPage` subscribes once and forwards every bus event
 * to `channel.sendEvent(...)`, which is what reaches the backend → the AI.
 *
 * `type` matches the backend inbound event types (see schemas/session_events.py):
 *   "lesson_pause" | "lesson_resume" | "lesson_end_request" | "student_idle" | ...
 */
import mitt from "mitt";

export interface SessionBusEvent {
  type: string;
  data?: Record<string, unknown>;
}

type Events = {
  session: SessionBusEvent;
};

export const sessionBus = mitt<Events>();

/** Convenience emitter so callers don't import the event shape. */
export function emitSessionEvent(type: string, data?: Record<string, unknown>) {
  sessionBus.emit("session", { type, data });
}
