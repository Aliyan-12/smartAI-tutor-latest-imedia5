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

Implementation sketch:

```ts
// frontend/src/hooks/useSessionChannel.ts
const latestSpeakIdRef = useRef<string | null>(null);

const speak = useCallback((text: string) => {
  const t = (text || "").trim();
  if (!t) return;
  const id = String(Date.now());
  latestSpeakIdRef.current = id;
  _send({ type: "speak", text: t, id });
}, []);

// In case "tts_audio":
if (d.id && latestSpeakIdRef.current && d.id !== latestSpeakIdRef.current) {
  break;
}
```

### 2. Segment TTS can arrive after `turn_end`

`backend/app/services/session_agent_service.py` streams text immediately, then starts background TTS tasks for each segment:

- `stream_segment()` sends the text segment first.
- If TTS is enabled, it creates `_tts_segment(...)` as a background task.
- `turn_end` is sent without waiting for all segment-audio tasks.

Impact: this is intentional decoupling, but it means audio can arrive after the visible response has already been finalized.

Recommended fix: keep the decoupled design, but make the client track whether a turn is still audio-open. Ignore `segment_audio` for a `turn_id` after that turn has been ended, stopped, cancelled, or replaced.

Implementation sketch:

```ts
// frontend/src/hooks/useSessionChannel.ts
const closedAudioTurnsRef = useRef<Set<string>>(new Set());

case "turn_start":
  currentTurnIdRef.current = d.turn_id ?? null;
  if (d.turn_id) closedAudioTurnsRef.current.delete(d.turn_id);
  resetTurnPlayback();
  break;

case "segment_audio":
  if (d.turn_id && closedAudioTurnsRef.current.has(d.turn_id)) break;
  if (currentTurnIdRef.current && d.turn_id && d.turn_id !== currentTurnIdRef.current) break;
  audioMapRef.current.set(d.seq, { audio_b64: d.audio_b64 ?? null, duration_ms: d.duration_ms ?? null });
  void pumpAudio();
  break;

case "turn_end":
  if (currentTurnIdRef.current) closedAudioTurnsRef.current.add(currentTurnIdRef.current);
  pendingCommitRef.current = { message_id: d.message_id ?? null, full_text: d.full_text || "" };
  finalizeTurn(false);
  break;
```

### 3. The frontend accepts same-turn audio after finalization

`frontend/src/hooks/useSessionChannel.ts` drops stale audio only when the incoming `turn_id` differs from `currentTurnIdRef.current`.

It does not mark a turn closed on `turn_end`, so late `segment_audio` for the same `turn_id` can still be accepted and played.

Recommended fix: add a `closedTurnIdsRef` or `audioClosedForTurnRef`; set it on `turn_end`, forced finalization, stop, disconnect, and new `turn_start`; reject `segment_audio` for closed turns.

Implementation sketch:

```ts
// Extend reset/stop paths too.
const closeCurrentTurnAudio = () => {
  const turnId = currentTurnIdRef.current;
  if (turnId) closedAudioTurnsRef.current.add(turnId);
  audioMapRef.current.clear();
  if (audioRef.current) {
    try { audioRef.current.pause(); } catch { /* ignore */ }
    audioRef.current = null;
  }
};

const stopTurn = useCallback(() => {
  closeCurrentTurnAudio();
  _send({ type: "stop" });
}, []);
```

### 4. Cancelled or timed-out turns do not cancel background TTS work

`_guard_turn()` sends `turn_end` on timeout or cancellation, but the per-segment background TTS tasks are stored globally in `_bg_tts_tasks` and are not cancelled per turn.

Impact: TTS synthesis from a cancelled or replaced turn can continue and attempt to send audio afterward.

Recommended fix: associate TTS tasks with `turn_id`, and cancel or mark them obsolete when the turn is cancelled, timed out, or replaced. A cheaper alternative is to include an active-turn predicate in the send path and suppress obsolete frames server-side.

Implementation sketch:

```py
# backend/app/services/session_agent_service.py
_bg_tts_tasks_by_turn: dict[str, set[asyncio.Task]] = {}

def _track_tts_task(turn_id: str, task: asyncio.Task) -> None:
    tasks = _bg_tts_tasks_by_turn.setdefault(turn_id, set())
    tasks.add(task)
    task.add_done_callback(lambda t: tasks.discard(t))

def _cancel_tts_for_turn(turn_id: str) -> None:
    for task in list(_bg_tts_tasks_by_turn.pop(turn_id, set())):
        task.cancel()

async def stream_segment(send, seq: int, sentence: str, *, tts: bool, turn_id: str) -> None:
    display = strip_display_markers(sentence)
    await send({"type": "segment", "seq": seq, "turn_id": turn_id, "text": display})
    if tts:
        task = asyncio.create_task(_tts_segment(send, seq, display, turn_id))
        _track_tts_task(turn_id, task)
```

Then call `_cancel_tts_for_turn(turn_id)` from timeout/cancel/replacement paths. Because `_guard_turn()` does not currently know the `turn_id`, pass it in or wrap turn cleanup inside `_run_turn()` with `try/finally`.

### 5. Tool calls can be refused without a frontend UI change

Several tools deliberately return suppressed results when they would not change the screen correctly:

- Slide move guard: `backend/app/tools/session_tools.py` returns `suppressed: true` for extra slide moves in one turn.
- Answer-slide gate: `backend/app/tools/session_tools.py` can suppress advancing onto an answer slide.
- One-visual-per-reply guard: `backend/app/tools/puzzle_tools.py` returns `suppressed: true` if a second visual is attempted in the same reply.
- The WebSocket router does not forward suppressed tool results as UI-changing `tool` frames.

Impact: the model may have attempted a tool, but the student will see no change. The model receives the refusal, but it may still produce wording that implies the visual exists.

Recommended fix: for suppressed view-changing calls, force a short recovery instruction and suppress success-style wording. Also log them with enough structured data to correlate incidents: appointment id, turn id, tool, error, and whether a UI frame was emitted.

Implementation sketch:

```py
# backend/app/services/session_agent_service.py, inside TOOL_RESULT handling
tool_ui_emitted = False

if not _suppressed:
    await send({"type": "tool", "tool": _ws_tool, "data": _data})
    tool_ui_emitted = True

logger.info(
    "TOOL_UI_DECISION appt=%s turn=%s tool=%s action=%s error=%s suppressed=%s emitted=%s render=%s",
    appt_id, turn_id, _tool, _action, _data.get("error"), _suppressed,
    tool_ui_emitted, _data.get("render"),
)

if _suppressed and _action in ("show_resource", "show_puzzle", "clear_puzzle"):
    # Feed a hard correction into the next model round via the existing ToolMessage path,
    # or trigger a single recovery generation after the main consume completes.
    visual_failed_this_turn = True
```

### 6. Errored `show_puzzle` payloads are not rendered

`frontend/src/pages/SessionPage.tsx` logs `show_puzzle` errors and does not render the payload.

Impact: backend/tool output can exist, but no diagram or puzzle appears if the payload has `error` or lacks `render`.

Recommended fix: treat `show_puzzle` errors as a recoverable tool failure. The model should be prompted to either call a fallback visual tool or explicitly say it could not show the diagram. Optionally show a small non-blocking UI notice in development/admin diagnostics.

Implementation sketch:

```py
# backend/app/services/session_agent_service.py
visual_error_this_turn = None

if _action == "show_puzzle" and _data.get("error"):
    visual_error_this_turn = {
        "tool": _tool,
        "error": _data.get("error"),
        "message": _data.get("message"),
    }

# After the first _consume(...), before persisting final text:
if visual_error_this_turn and _claimed_visual("".join(full)):
    recovery = (
        "[SYSTEM - RECOVER NOW] Your previous tool call did NOT show anything on screen: "
        f"{visual_error_this_turn}. Do not say 'look at the diagram'. "
        "Either call a different visual tool that will render, or briefly say you could not "
        "show that diagram and continue in words."
    )
    await _consume(recovery, with_image=False)
```

```ts
// Optional frontend diagnostic notice in SessionPage.tsx
if (tool === "show_puzzle" && data.error) {
  setToolResults((prev) => [...prev, {
    tool: "show_puzzle_error",
    data,
    id: Date.now().toString(),
  }]);
  return;
}
```

### 7. Slide advancement is not deterministically enforced

The prompt tells the LLM to call `advance_lesson_slide()` when the student has engaged with the slide, but there is no deterministic backend path that automatically advances on clear intents like `next`, `ok`, `got it`, or `yes`.

Impact: if the LLM says it moved on but does not call the tool, the slide will not move.

Recommended fix: add either a pre-turn deterministic intent handler for slide advancement, or a post-turn safety net that detects slide-move wording without a successful slide tool call and repairs the mismatch.

Implementation sketch:

```py
# backend/app/services/session_agent_service.py
_NEXT_SLIDE_RE = re.compile(r"^(ok|okay|yes|yep|got it|next|continue|move on|go on)[.! ]*$", re.I)

def _is_clear_next_slide_intent(text: str) -> bool:
    return bool(_NEXT_SLIDE_RE.match((text or "").strip()))

# In _run_turn after ToolContext/current_slide are available and before Gemini call:
if (
    anchor_slides
    and current_slide
    and saved_user_text
    and _is_clear_next_slide_intent(saved_user_text)
    and tool_context is not None
):
    from app.services import session_resource_service as _srs
    moved = await _srs.slide_action(db, appt_id, mode="advance")
    if not moved.get("error"):
        await send({"type": "tool", "tool": "advance_lesson_slide", "data": moved})
        current_slide = moved
        tool_context.slide_moved = True
        tool_context.visual_shown = "slide"
        ai_content = f"{ai_content}\n\n[SYSTEM] You have already advanced to slide {moved.get('slide_index')}. Teach this new slide now."
```

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
