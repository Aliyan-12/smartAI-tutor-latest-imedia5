import { useState, useRef, useCallback, useEffect } from "react";
import { sessionWsUrl } from "../services/api";
import type { ChatMessage } from "../types";

/**
 * useSessionChannel — the unified session chat pipeline (one WebSocket).
 *
 * The backend streams each assistant turn as two INDEPENDENT streams: text
 * `segment` frames (revealed immediately at a reading cadence — GPT-style, never
 * waiting on TTS) and, when voice is on, `segment_audio` frames that arrive a beat
 * later and play in seq order in the background. Decoupling them is what makes the
 * text fast even when Kokoro is slow. Messages are committed only on `turn_end` via
 * the authoritative DB id, so there are no optimistic-id collisions or duplicates.
 */
export type SessionStatus = "idle" | "connecting" | "waiting" | "speaking";

interface TextSeg {
  seq: number;
  text: string;
}
interface AudioSeg {
  audio_b64: string | null;
  duration_ms: number | null;
}
// One ordered piece of the in-flight turn: a "think" row (thought/tool step) or a
// "text" chunk. Captured in arrival order so the live reply reads
// think → act → speak → act → speak (Claude-style interleaving), rather than lumping
// all thinking above the answer.
export type LivePart = { kind: "think" | "text"; text: string };

export interface SessionChannelOpts {
  /** Session pipeline: the appointment to attach to. Omit for the standalone /chat. */
  appointmentId?: number;
  /**
   * Override the WebSocket URL. When omitted, the unified *session* URL is used
   * (`sessionWsUrl(appointmentId, sessionId)`). The simple /chat passes
   * `buildUrl: chatWsUrl` to point at `/api/chat/ws` instead. Same protocol either way.
   */
  buildUrl?: (sessionId: string | null) => string;
  ttsEnabled: boolean;
  onTool?: (tool: string, data: Record<string, unknown>) => void;
  onCredits?: (value: number) => void;
  onUserTranscript?: (text: string) => void;
  onReady?: (sessionId: string) => void;
  /** The lesson ended server-side (end_lesson tool or end-request fallback) → navigate to the report. */
  onEnded?: (data: Record<string, unknown>) => void;
}

const HEARTBEAT_MS = 25_000;
const WATCHDOG_MS = 165_000; // > backend per-turn timeout (150s) — freeze recovery
const DEFAULT_MS_PER_WORD = 220; // reveal cadence when a segment has no audio (muted)
const MAX_RECONNECT_DELAY = 8_000;

export function useSessionChannel(opts: SessionChannelOpts) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [liveText, setLiveText] = useState("");
  const [busy, setBusy] = useState(false); // a turn is in flight → disable input
  const [error, setError] = useState<string | null>(null);
  // Live "thinking" steps for the in-flight turn (tool labels + brief thought lines).
  // Cleared on turn_start; the persisted role="thinking" message drives after-refresh.
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  // Ordered parts (thinking rows + text) of the in-flight turn, interleaved in arrival
  // order — this is what the live reply renders so it reads think → act → speak.
  const [liveParts, setLiveParts] = useState<LivePart[]>([]);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const ttsEnabledRef = useRef(opts.ttsEnabled);
  useEffect(() => { ttsEnabledRef.current = opts.ttsEnabled; }, [opts.ttsEnabled]);
  const busyAt = useRef(false);
  busyAt.current = busy;

  // ── connection ──
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);
  const connectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── playback / turn ──
  // Text pump (reveals immediately, independent of audio).
  const textQueueRef = useRef<TextSeg[]>([]);
  const textPumpingRef = useRef(false);
  const liveTextRef = useRef("");
  // Mirror of thinkingSteps so finalizeTurn can commit them as a local role="thinking"
  // message (kept in sync with the persisted DB row that loads on refresh).
  const thinkingStepsRef = useRef<string[]>([]);
  // Ordered live parts (think + text) for interleaved rendering of the in-flight turn.
  const livePartsRef = useRef<LivePart[]>([]);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Audio pump (plays segment_audio in seq order, independent of text).
  const audioMapRef = useRef<Map<number, AudioSeg>>(new Map());
  const nextAudioSeqRef = useRef(0);
  const audioPumpingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // One-shot TTS ("Listen"/quiz read-aloud) audio — a `tts_audio` reply to a `speak`
  // request. Separate from the turn's segment-audio pump so the two never fight.
  const oneShotAudioRef = useRef<HTMLAudioElement | null>(null);
  // Whether the tutor is currently SPEAKING (any TTS clip playing) — stays true for a
  // short tail after the last clip. The voice-capture mic is muted while this is true so
  // it never records the tutor's own voice (which caused an endless self-talk loop).
  const [audioActive, setAudioActive] = useState(false);
  // Unlike `audioActive` (which drops in the gap between clips so the mic can un-mute), this
  // stays TRUE across inter-chunk gaps and only clears once the WHOLE turn's speech has drained.
  // It's what the puzzle/tap-option gate waits on so buttons don't flicker enabled between chunks.
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const turnTextMaxSeqRef = useRef(-1);  // highest text-segment seq this turn (audio mirrors it)
  const turnEndedRef = useRef(false);    // turn_end frame received for the current turn
  const audioPlayingCountRef = useRef(0);
  const audioTailTimerRef = useRef<number | null>(null);
  // The turn's speech is fully delivered once: the turn has ended AND nothing is playing AND the
  // audio pump has advanced past the last segment (every clip, incl. null ones, has been consumed).
  const maybeSpeechDone = () => {
    if (turnEndedRef.current
        && audioPlayingCountRef.current === 0
        && nextAudioSeqRef.current > turnTextMaxSeqRef.current) {
      setTtsSpeaking(false);
    }
  };
  const markAudioStart = () => {
    audioPlayingCountRef.current += 1;
    if (audioTailTimerRef.current) { clearTimeout(audioTailTimerRef.current); audioTailTimerRef.current = null; }
    setAudioActive(true);
  };
  const markAudioEnd = () => {
    audioPlayingCountRef.current = Math.max(0, audioPlayingCountRef.current - 1);
    if (audioPlayingCountRef.current > 0) return;
    if (audioTailTimerRef.current) clearTimeout(audioTailTimerRef.current);
    // Keep the mic muted a beat after the voice stops so the tail/echo isn't captured.
    audioTailTimerRef.current = window.setTimeout(() => {
      audioTailTimerRef.current = null;
      if (audioPlayingCountRef.current === 0) setAudioActive(false);
    }, 700);
  };
  // The turn whose frames we currently accept — so late audio from a previous turn
  // (seq numbering restarts each turn) is dropped instead of bleeding into this one.
  const currentTurnIdRef = useRef<string | null>(null);
  const pendingCommitRef = useRef<{ message_id: number | null; full_text: string } | null>(null);
  // A `lesson_ended` that arrived while the closing message was still revealing — we hold
  // it and navigate to the report only after the text finishes, so the report never opens
  // mid-sentence.
  const pendingEndedRef = useRef<any | null>(null);
  // A puzzle the student solved while a turn was still streaming — sent the moment
  // we're free, so their solve is never silently dropped.
  const pendingPuzzleRef = useRef<{ puzzleType: string; prompt: string; answer: unknown } | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgHandlerRef = useRef<(d: any) => void>(() => {});

  // Stop audio immediately if the user mutes mid-segment.
  useEffect(() => {
    if (!opts.ttsEnabled && audioRef.current) {
      try { audioRef.current.pause(); } catch { /* ignore */ }
    }
  }, [opts.ttsEnabled]);

  // ── turn timers / watchdog ──
  const clearWatchdog = () => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  };
  const armWatchdog = () => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => finalizeTurn(true), WATCHDOG_MS);
  };

  const resetTurnPlayback = () => {
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } audioRef.current = null; }
    textQueueRef.current = [];
    textPumpingRef.current = false;
    audioMapRef.current.clear();
    nextAudioSeqRef.current = 0;
    audioPumpingRef.current = false;
    turnTextMaxSeqRef.current = -1;
    turnEndedRef.current = false;
    setTtsSpeaking(false);
    liveTextRef.current = "";
    setLiveText("");
    livePartsRef.current = [];
    setLiveParts([]);
    pendingCommitRef.current = null;
  };

  // Mirror the interleaved parts to state + keep liveText (concat of text parts) in sync
  // for read-aloud + activity detection.
  const syncLiveParts = () => {
    setLiveParts([...livePartsRef.current]);
    liveTextRef.current = livePartsRef.current
      .filter((p) => p.kind === "text").map((p) => p.text).join("");
    setLiveText(liveTextRef.current);
  };

  // ── TEXT pump (fast reveal, no audio dependency) ──
  // Reveal the segment's RAW text (newlines/markdown preserved) in phrase-sized
  // chunks at a reading cadence — never word-by-word, and never flattening whitespace,
  // so the live stream renders as proper markdown. Segments already carry their own
  // trailing separator, so we just append (no manual spacing).
  const CHUNK_WORDS = 5;
  const revealSegment = (seg: TextSeg): Promise<void> =>
    new Promise((resolve) => {
      const text = seg.text;
      if (!text) { resolve(); return; }
      // Reveal into the CURRENT text part. A thinking row since the last text starts a
      // NEW text part, so text and thinking interleave in arrival order. (Appending a
      // think row later never shifts an earlier index, so partIdx stays valid.)
      const parts = livePartsRef.current;
      if (parts.length === 0 || parts[parts.length - 1].kind !== "text") {
        parts.push({ kind: "text", text: "" });
      }
      const partIdx = parts.length - 1;
      const base = parts[partIdx].text;

      const ends: number[] = [];
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      let words = 0;
      while ((m = re.exec(text)) !== null) {
        words++;
        if (words % CHUNK_WORDS === 0) ends.push(m.index + m[0].length);
      }
      if (ends.length === 0 || ends[ends.length - 1] !== text.length) ends.push(text.length);

      // Reading cadence only — text never waits on TTS (Kokoro plays in the background).
      const total = (words || 1) * DEFAULT_MS_PER_WORD;
      const per = Math.max(40, total / ends.length);
      let i = 0;
      const tick = () => {
        livePartsRef.current[partIdx].text = base + text.slice(0, ends[i]);
        syncLiveParts();
        i++;
        if (i >= ends.length) { resolve(); return; }
        revealTimerRef.current = setTimeout(tick, per);
      };
      tick();
    });

  const pumpText = async () => {
    if (textPumpingRef.current) return;
    textPumpingRef.current = true;
    setStatus("speaking");
    while (textQueueRef.current.length > 0) {
      const seg = textQueueRef.current.shift()!;
      await revealSegment(seg);
    }
    textPumpingRef.current = false;
    finalizeTurn(false);  // fires any deferred lesson_ended once text is fully revealed
  };

  // ── AUDIO pump (in-order playback, independent of text) ──
  // segment_audio frames may arrive out of order (concurrent Kokoro), so we buffer by
  // seq and play strictly in order. The backend emits exactly one frame per seq (a null
  // clip for short/failed segments), so the queue never stalls on a missing seq.
  const playAudioClip = (audio_b64: string | null): Promise<void> =>
    new Promise((resolve) => {
      if (!audio_b64 || !ttsEnabledRef.current) { resolve(); return; }
      let url: string;
      try {
        const bytes = Uint8Array.from(atob(audio_b64), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      } catch { resolve(); return; }
      const audio = new Audio(url);
      audioRef.current = audio;
      let ended = false;
      const done = () => {
        if (!ended) { ended = true; markAudioEnd(); }
        URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done; // resolves at once if muted-stop pauses it
      markAudioStart();
      setTtsSpeaking(true); // a real clip is playing → speech is in progress for this turn
      audio.play().catch(done);
    });

  const pumpAudio = async () => {
    if (audioPumpingRef.current) return;
    audioPumpingRef.current = true;
    while (true) {
      const seq = nextAudioSeqRef.current;
      const seg = audioMapRef.current.get(seq);
      if (!seg) break; // wait — the next arriving frame restarts the pump
      audioMapRef.current.delete(seq);
      nextAudioSeqRef.current = seq + 1;
      await playAudioClip(seg.audio_b64);
    }
    audioPumpingRef.current = false;
    // Pump idled — if the turn has ended and this was the last clip, speech is fully delivered.
    maybeSpeechDone();
  };

  const finalizeTurn = (forced: boolean) => {
    if (textPumpingRef.current) return;          // still revealing — will be called again
    if (textQueueRef.current.length > 0) return; // more text queued
    const pc = pendingCommitRef.current;
    if (!pc && !forced) return;
    pendingCommitRef.current = null;
    clearWatchdog();

    if (pc && pc.full_text) {
      const id = pc.message_id;
      const steps = thinkingStepsRef.current;
      const ts = new Date().toISOString();
      setMessages((prev) => {
        if (id != null && prev.some((m) => m.id === id)) return prev; // no dupes
        const additions: ChatMessage[] = [];
        // Local mirror of the persisted role="thinking" row so the strip stays visible
        // after the turn (not just after a refresh). Lower id → renders above the answer.
        if (steps.length > 0) {
          additions.push({
            id: -Date.now() - 1, chat_id: 0, role: "thinking" as const,
            content: steps.join("\n"), timestamp: ts,
          });
        }
        additions.push({
          id: id ?? -Date.now(), chat_id: 0, role: "assistant" as const,
          content: pc.full_text, timestamp: ts,
        });
        return [...prev, ...additions];
      });
    }
    thinkingStepsRef.current = [];
    liveTextRef.current = "";
    setLiveText("");
    livePartsRef.current = [];
    setLiveParts([]);
    // Audio may still be narrating in the background — that's fine; the committed
    // bubble stays put and a new turn_start will stop any leftover playback.
    setStatus("idle");
    setBusy(false);
    // Turn fully finalised — if a lesson_ended was waiting on the closing message, open
    // the report now. (Cleared on first fire, so it never double-navigates.)
    if (pendingEndedRef.current) {
      const data = pendingEndedRef.current;
      pendingEndedRef.current = null;
      optsRef.current.onEnded?.(data);
    }
  };

  // ── server → client dispatch ──
  const handleMessage = (d: any) => {
    if (busyAt.current) armWatchdog();
    switch (d?.type) {
      case "ready":
        sessionIdRef.current = d.session_id;
        lastSessionIdRef.current = d.session_id;
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        setError(null);
        // Reconnect mid-turn safety: drop any half-played turn.
        resetTurnPlayback();
        setStatus("idle");
        setBusy(false);
        optsRef.current.onReady?.(d.session_id);
        break;
      case "user_transcript":
        // voice loop: the transcript IS the user message
        setMessages((prev) => [...prev, {
          id: -Date.now(), chat_id: 0, role: "user" as const,
          content: d.text, timestamp: new Date().toISOString(),
        }]);
        optsRef.current.onUserTranscript?.(d.text);
        break;
      case "turn_start":
        currentTurnIdRef.current = d.turn_id ?? null;
        resetTurnPlayback();       // drop any leftover audio/text from a previous turn
        thinkingStepsRef.current = [];
        setThinkingSteps([]);      // fresh thinking strip for this turn
        setStatus("waiting");
        armWatchdog();
        break;
      case "thinking":
        if (d.text) {
          const step = String(d.text);
          thinkingStepsRef.current = [...thinkingStepsRef.current, step];
          setThinkingSteps((prev) => [...prev, step]);
          // Interleave it into the live parts (a think row after text → the next text
          // segment opens a fresh text part → think/text render in order).
          livePartsRef.current = [...livePartsRef.current, { kind: "think", text: step }];
          syncLiveParts();
        }
        break;
      case "segment":
        // Text only — revealed immediately (no wait for TTS). Ignore stale-turn frames.
        if (currentTurnIdRef.current && d.turn_id && d.turn_id !== currentTurnIdRef.current) break;
        // Text segments all arrive before turn_end (not gated on TTS), so this becomes the
        // definitive count of clips the audio pump must play before the turn is fully spoken.
        if (typeof d.seq === "number") turnTextMaxSeqRef.current = Math.max(turnTextMaxSeqRef.current, d.seq);
        // With Read Aloud on, this turn WILL be spoken — mark speech in-progress NOW (before the
        // first audio clip). Crucial: the first sentence is often too short for TTS (a null clip),
        // so waiting for a clip to actually play would leave `ttsSpeaking` false during the gap
        // before the real audio arrives — and the gate would open early. It clears only via
        // maybeSpeechDone once every chunk (incl. null ones) has been consumed.
        if (ttsEnabledRef.current) setTtsSpeaking(true);
        textQueueRef.current.push({ seq: d.seq, text: d.text || "" });
        void pumpText();
        break;
      case "segment_audio":
        // Background audio for a text segment — play in seq order. Drop stale turns.
        if (currentTurnIdRef.current && d.turn_id && d.turn_id !== currentTurnIdRef.current) break;
        audioMapRef.current.set(d.seq, { audio_b64: d.audio_b64 ?? null, duration_ms: d.duration_ms ?? null });
        void pumpAudio();
        break;
      case "tool":
        optsRef.current.onTool?.(d.tool, d.data || {});
        break;
      case "tts_audio": {
        // One-shot TTS reply to a `speak` request (quiz read-aloud / "Listen"). The caller
        // already decided it wants audio, so just play it. Stop any previous one-shot clip.
        if (oneShotAudioRef.current) {
          try { oneShotAudioRef.current.pause(); } catch { /* ignore */ }
          oneShotAudioRef.current = null;
        }
        if (!d.audio_b64) break;
        try {
          const bytes = Uint8Array.from(atob(d.audio_b64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: d.mime || "audio/wav" }));
          const audio = new Audio(url);
          oneShotAudioRef.current = audio;
          let ended = false;
          const done = () => {
            if (!ended) { ended = true; markAudioEnd(); }
            URL.revokeObjectURL(url); if (oneShotAudioRef.current === audio) oneShotAudioRef.current = null;
          };
          audio.onended = done;
          audio.onerror = done;
          markAudioStart();
          audio.play().catch(done);
        } catch { /* ignore playback errors */ }
        break;
      }
      case "event":
        // Lifecycle / interactive event → render a centered pill in the chat.
        setMessages((prev) => [...prev, {
          id: -Date.now(), chat_id: 0, role: "event" as const,
          content: d.text || "", timestamp: new Date().toISOString(),
        }]);
        break;
      case "lesson_timeout":
        // Soft notice — the paired `event` frame already renders the pill.
        break;
      case "lesson_ended": {
        // Wait for the AI's closing message to finish revealing before opening the report.
        const stillRevealing = textPumpingRef.current || textQueueRef.current.length > 0;
        if (stillRevealing) {
          pendingEndedRef.current = d.data || {};
        } else {
          optsRef.current.onEnded?.(d.data || {});
        }
        break;
      }
      case "credits":
        if (typeof d.value === "number") optsRef.current.onCredits?.(d.value);
        break;
      case "turn_end":
        pendingCommitRef.current = { message_id: d.message_id ?? null, full_text: d.full_text || "" };
        // No more segments will be generated — audio (if any) may still be draining in the
        // background. Mark the turn ended and check whether speech has already finished.
        turnEndedRef.current = true;
        maybeSpeechDone();
        finalizeTurn(false);
        break;
      case "error":
        setError(d.message || "Something went wrong.");
        break;
      case "pong":
      default:
        break;
    }
  };
  msgHandlerRef.current = handleMessage;

  // ── connection management ──
  const startHeartbeat = () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try { wsRef.current.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
      }
    }, HEARTBEAT_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  };

  const connect = useCallback((sessionId: string | null) => {
    if (connectingRef.current) return;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    connectingRef.current = true;
    lastSessionIdRef.current = sessionId ?? lastSessionIdRef.current;
    intentionalCloseRef.current = false;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }

    setStatus("connecting");
    const url = optsRef.current.buildUrl
      ? optsRef.current.buildUrl(lastSessionIdRef.current)
      : sessionWsUrl(optsRef.current.appointmentId ?? null, lastSessionIdRef.current);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => { connectingRef.current = false; startHeartbeat(); };
    ws.onmessage = (e) => {
      try { msgHandlerRef.current(JSON.parse(e.data)); } catch { /* non-json */ }
    };
    ws.onerror = () => { connectingRef.current = false; };
    ws.onclose = () => {
      connectingRef.current = false;
      stopHeartbeat();
      setConnected(false);
      if (wsRef.current === ws) wsRef.current = null;
      if (intentionalCloseRef.current) return;
      // Unexpected drop → reconnect with backoff.
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(1500 * (attempt + 1), MAX_RECONNECT_DELAY);
      reconnectTimerRef.current = setTimeout(() => connect(lastSessionIdRef.current), delay);
    };
  }, []);

  const _closeIntentional = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    stopHeartbeat();
    resetTurnPlayback();
    clearWatchdog();
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: "stop" })); } catch { /* ignore */ }
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    connectingRef.current = false;
    setConnected(false);
    setStatus("idle");
    setBusy(false);
  }, []);

  /** Pause: close the socket (lesson clock pauses independently). Keeps sessionId. */
  const pause = useCallback(() => { _closeIntentional(); }, [_closeIntentional]);
  /**
   * Resume / open the socket for an EXPLICIT target.
   * The passed value is authoritative: `null` means a fresh chat (no session_id),
   * so it must NOT fall back to the previous chat's id — otherwise "New Chat"
   * would reconnect to the last chat. (Drop-reconnect still reuses lastSessionId
   * via the onclose handler, which calls connect() directly.)
   */
  const resume = useCallback((sessionId: string | null) => {
    reconnectAttemptsRef.current = 0;
    lastSessionIdRef.current = sessionId;
    connect(sessionId);
  }, [connect]);
  /** End the lesson: close permanently, no reconnect. */
  const disconnect = useCallback(() => { _closeIntentional(); }, [_closeIntentional]);

  // ── sending ──
  const _send = (payload: object): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    try { wsRef.current.send(JSON.stringify(payload)); return true; } catch { return false; }
  };

  const sendMessage = useCallback((
    text: string,
    sendOpts?: { imageData?: string; imageMime?: string; fileName?: string; research?: boolean },
  ) => {
    if (busyAt.current) return;
    const trimmed = (text || "").trim();
    if (!trimmed && !sendOpts?.imageData) return;
    const ok = _send({
      type: "user_message",
      text: trimmed,
      image_b64: sendOpts?.imageData,
      image_mime: sendOpts?.imageMime,
      research: !!sendOpts?.research,
      tts: ttsEnabledRef.current,
    });
    if (!ok) { setError("Not connected — reconnecting…"); return; }
    busyAt.current = true; // block rapid double-sends before the re-render
    // optimistic user bubble — render the attachment inline (DB is authoritative on re-hydrate)
    const isImage = !!sendOpts?.imageMime?.startsWith("image/");
    setMessages((prev) => [...prev, {
      id: -Date.now(), chat_id: 0, role: "user" as const,
      content: trimmed,
      imageUrl: isImage && sendOpts?.imageData ? `data:${sendOpts.imageMime};base64,${sendOpts.imageData}` : undefined,
      fileName: !isImage && sendOpts?.imageData ? sendOpts?.fileName : undefined,
      timestamp: new Date().toISOString(),
    }]);
    setBusy(true);
    setStatus("waiting");
    setError(null);
    armWatchdog();
  }, []);

  const sendQuizResult = useCallback((topic: string, score: number, strong: string[], weak: string[]) => {
    if (busyAt.current) return;
    const ok = _send({ type: "quiz_result", topic, score, strong, weak, tts: ttsEnabledRef.current });
    if (!ok) return;
    busyAt.current = true;
    // The server echoes + persists the "📊 Quiz …" event bubble (role:"event"),
    // so we don't add an optimistic one here (avoids a duplicate that vanishes on refresh).
    setBusy(true);
    setStatus("waiting");
    armWatchdog();
  }, []);

  /** Send the student's puzzle answer — the AI marks it with the matching evaluator, then
   *  gives feedback. `answer` is the structured submission (labels dict / pairs / text);
   *  correctness is decided server-side, so we send no `correct` flag. */
  const sendPuzzleResult = useCallback((
    puzzleType: string, prompt: string, answer: unknown,
  ) => {
    if (busyAt.current) {
      // A turn is mid-flight — buffer the submission and flush it when the turn ends.
      pendingPuzzleRef.current = { puzzleType, prompt, answer };
      return;
    }
    const ok = _send({
      type: "puzzle_result",
      puzzle_type: puzzleType, prompt, answer,
      tts: ttsEnabledRef.current,
    });
    if (!ok) return;
    busyAt.current = true;
    // The server echoes + persists the "🧩 Answer submitted" event bubble (role:"event").
    setBusy(true);
    setStatus("waiting");
    armWatchdog();
  }, []);

  // Flush a buffered puzzle submission once the in-flight turn finishes.
  useEffect(() => {
    if (!busy && pendingPuzzleRef.current) {
      const p = pendingPuzzleRef.current;
      pendingPuzzleRef.current = null;
      sendPuzzleResult(p.puzzleType, p.prompt, p.answer);
    }
  }, [busy, sendPuzzleResult]);

  /**
   * Generic typed event → server (lesson_pause / lesson_resume / lesson_end_request /
   * student_idle …). `triggersReply` marks the turn busy because the AI will respond
   * (e.g. the end-request closing summary).
   */
  const sendEvent = useCallback((
    type: string, data?: Record<string, unknown>, triggersReply = false,
  ) => {
    const ok = _send({ type, tts: ttsEnabledRef.current, ...(data || {}) });
    if (!ok) { setError("Not connected — reconnecting…"); return; }
    if (triggersReply) {
      busyAt.current = true;
      setBusy(true);
      setStatus("waiting");
      armWatchdog();
    }
  }, []);

  /**
   * Send a recorded utterance for the custom voice loop.
   * `stt: true` — transcribe this audio to text first; `tts` — speak the reply.
   */
  const sendAudio = useCallback((audioB64: string, mime: string) => {
    if (busyAt.current) return;
    // A spoken utterance means the student is in voice-to-voice mode, so ALWAYS speak the
    // reply back (true voice loop) — don't gate it on the "Read aloud" toggle, which only
    // governs typed turns. Everything else (thinking, puzzles, tools) is already identical.
    const ok = _send({ type: "user_audio", audio_b64: audioB64, mime, stt: true, tts: true });
    if (!ok) return;
    busyAt.current = true;
    setBusy(true);
    setStatus("waiting");
    armWatchdog();
  }, []);

  /**
   * One-shot text-to-speech over the socket (replaces the old /voice/speak REST call).
   * Backend synthesises Kokoro audio and returns a `tts_audio` frame we play. Used by the
   * "Listen"/"Read aloud" buttons and the quiz auto-read. ALL TTS goes through the WS now.
   */
  const speak = useCallback((text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    _send({ type: "speak", text: t, id: String(Date.now()) });
  }, []);

  /**
   * "Student is active" heartbeat (no AI turn) — sent on each quiz answer so a student
   * working through a quiz is never flagged idle by the server's inactivity watchdog.
   */
  const sendActivity = useCallback(() => { _send({ type: "activity" }); }, []);

  /** Cancel the in-flight turn server-side without closing the socket. */
  const stopTurn = useCallback(() => { _send({ type: "stop" }); }, []);

  const hydrate = useCallback((msgs: ChatMessage[]) => { setMessages(msgs); }, []);
  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount.
  useEffect(() => () => { _closeIntentional(); }, [_closeIntentional]);

  return {
    connected, status, messages, liveText, thinkingSteps, liveParts, busy, error,
    audioActive, ttsSpeaking,
    connect, disconnect, pause, resume,
    sendMessage, sendQuizResult, sendPuzzleResult, sendAudio, sendEvent, stopTurn,
    speak, sendActivity,
    hydrate, setMessages, clearError,
  };
}
