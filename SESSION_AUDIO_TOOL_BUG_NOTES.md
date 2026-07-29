# Session Audio And Tool-Call Bug Notes

This note records the static-code findings for two reported symptoms:

- Audio responses sometimes play more than once, or replay after the response has finished.
- The tutor sometimes says it showed a slide, diagram, or puzzle, but nothing appears.

No dependencies were installed and the app was not run. Findings below are based on code inspection only.

## High-Certainty Findings

### 1. Stale one-shot TTS frames can be played

`frontend/src/hooks/useSessionChannel.ts` sends one-shot TTS requests with an id:

- `speak()` sends `{ type: "speak", text, id }`.
- The `tts_audio` handler plays every returned frame.
- The handler does not compare `d.id` against the latest requested id.

Impact: if two `speak()` requests are close together and the older response arrives late, the old clip can still play. This can sound like repeated audio.

Recommended fix: track the latest one-shot TTS request id in a ref and ignore any `tts_audio` frame whose id does not match it.

### 2. Segment TTS can arrive after `turn_end`

`backend/app/services/session_agent_service.py` streams text immediately, then starts background TTS tasks for each segment:

- `stream_segment()` sends the text segment first.
- If TTS is enabled, it creates `_tts_segment(...)` as a background task.
- `turn_end` is sent without waiting for all segment-audio tasks.

Impact: this is intentional decoupling, but it means audio can arrive after the visible response has already been finalized.

Recommended fix: keep the decoupled design, but make the client track whether a turn is still audio-open. Ignore `segment_audio` for a `turn_id` after that turn has been ended, stopped, cancelled, or replaced.

### 3. The frontend accepts same-turn audio after finalization

`frontend/src/hooks/useSessionChannel.ts` drops stale audio only when the incoming `turn_id` differs from `currentTurnIdRef.current`.

It does not mark a turn closed on `turn_end`, so late `segment_audio` for the same `turn_id` can still be accepted and played.

Recommended fix: add a `closedTurnIdsRef` or `audioClosedForTurnRef`; set it on `turn_end`, forced finalization, stop, disconnect, and new `turn_start`; reject `segment_audio` for closed turns.

### 4. Cancelled or timed-out turns do not cancel background TTS work

`_guard_turn()` sends `turn_end` on timeout or cancellation, but the per-segment background TTS tasks are stored globally in `_bg_tts_tasks` and are not cancelled per turn.

Impact: TTS synthesis from a cancelled or replaced turn can continue and attempt to send audio afterward.

Recommended fix: associate TTS tasks with `turn_id`, and cancel or mark them obsolete when the turn is cancelled, timed out, or replaced. A cheaper alternative is to include an active-turn predicate in the send path and suppress obsolete frames server-side.

### 5. Tool calls can be refused without a frontend UI change

Several tools deliberately return suppressed results when they would not change the screen correctly:

- Slide move guard: `backend/app/tools/session_tools.py` returns `suppressed: true` for extra slide moves in one turn.
- Answer-slide gate: `backend/app/tools/session_tools.py` can suppress advancing onto an answer slide.
- One-visual-per-reply guard: `backend/app/tools/puzzle_tools.py` returns `suppressed: true` if a second visual is attempted in the same reply.
- The WebSocket router does not forward suppressed tool results as UI-changing `tool` frames.

Impact: the model may have attempted a tool, but the student will see no change. The model receives the refusal, but it may still produce wording that implies the visual exists.

Recommended fix: for suppressed view-changing calls, force a short recovery instruction and suppress success-style wording. Also log them with enough structured data to correlate incidents: appointment id, turn id, tool, error, and whether a UI frame was emitted.

### 6. Errored `show_puzzle` payloads are not rendered

`frontend/src/pages/SessionPage.tsx` logs `show_puzzle` errors and does not render the payload.

Impact: backend/tool output can exist, but no diagram or puzzle appears if the payload has `error` or lacks `render`.

Recommended fix: treat `show_puzzle` errors as a recoverable tool failure. The model should be prompted to either call a fallback visual tool or explicitly say it could not show the diagram. Optionally show a small non-blocking UI notice in development/admin diagnostics.

### 7. Slide advancement is not deterministically enforced

The prompt tells the LLM to call `advance_lesson_slide()` when the student has engaged with the slide, but there is no deterministic backend path that automatically advances on clear intents like `next`, `ok`, `got it`, or `yes`.

Impact: if the LLM says it moved on but does not call the tool, the slide will not move.

Recommended fix: add either a pre-turn deterministic intent handler for slide advancement, or a post-turn safety net that detects slide-move wording without a successful slide tool call and repairs the mismatch.

## Strongly Supported But Needs Runtime Logs

### 1. Late/stale TTS is probably the main audio-repeat cause

The code definitely allows stale one-shot TTS and late same-turn segment audio. Confirm by logging:

- `tts_audio.id`, latest requested speak id, and whether the frame was played or dropped.
- `segment_audio.turn_id`, `seq`, whether the turn had ended, and whether it was played or dropped.

### 2. Hidden tool refusals/errors are probably behind many missing visual reports

The code definitely allows suppressed or errored tool calls to result in no UI update. Confirm by logging:

- Tool name.
- Tool result `action`, `error`, `suppressed`, `render`.
- Whether the WebSocket emitted a frontend `tool` frame.
- Whether the model's final text contained phrases such as `look at`, `on your screen`, `shown`, or `diagram`.

## Lower-Certainty Possibilities

### 1. Quiz auto-read may duplicate audio in some flows

`SessionPage.tsx` auto-calls `channel.speak()` for quiz question, feedback, and result. This may overlap with streamed tutor TTS if the same content is also produced as part of an assistant turn.

Recommended fix: ensure quiz auto-read and streamed turn TTS are mutually exclusive for the same content, or tag one-shot TTS with ids and drop stale frames.

### 2. Reconnect races may contribute, but are less directly supported

The backend tries to close an existing WebSocket when a new one connects. Race conditions are possible, but this is less directly supported than the stale/late TTS paths above.

## Suggested Fix Order

1. Add stale-id rejection for one-shot `tts_audio` on the frontend.
2. Mark turns audio-closed on `turn_end` and ignore late `segment_audio` frames for closed turns.
3. Add per-turn TTS task cancellation or server-side obsolete-turn suppression.
4. Add structured logging around TTS frame play/drop decisions and tool UI emission decisions.
5. Add deterministic or post-turn recovery for slide advancement claims without successful slide tool calls.
6. Add equivalent recovery for diagram/puzzle claims when tool output was errored or suppressed.
