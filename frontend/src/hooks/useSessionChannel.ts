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
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Audio pump (plays segment_audio in seq order, independent of text).
  const audioMapRef = useRef<Map<number, AudioSeg>>(new Map());
  const nextAudioSeqRef = useRef(0);
  const audioPumpingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The turn whose frames we currently accept — so late audio from a previous turn
  // (seq numbering restarts each turn) is dropped instead of bleeding into this one.
  const currentTurnIdRef = useRef<string | null>(null);
  const pendingCommitRef = useRef<{ message_id: number | null; full_text: string } | null>(null);
  // A puzzle the student solved while a turn was still streaming — sent the moment
  // we're free, so their solve is never silently dropped.
  const pendingPuzzleRef = useRef<{ puzzleId: string; prompt: string; answer: unknown; correct: boolean } | null>(null);
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
    liveTextRef.current = "";
    setLiveText("");
    pendingCommitRef.current = null;
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
      const base = liveTextRef.current;

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
        liveTextRef.current = base + text.slice(0, ends[i]);
        setLiveText(liveTextRef.current);
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
    finalizeTurn(false);
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
      const done = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; resolve(); };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done; // resolves at once if muted-stop pauses it
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
    // Audio may still be narrating in the background — that's fine; the committed
    // bubble stays put and a new turn_start will stop any leftover playback.
    setStatus("idle");
    setBusy(false);
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
        }
        break;
      case "segment":
        // Text only — revealed immediately (no wait for TTS). Ignore stale-turn frames.
        if (currentTurnIdRef.current && d.turn_id && d.turn_id !== currentTurnIdRef.current) break;
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
      case "lesson_ended":
        optsRef.current.onEnded?.(d.data || {});
        break;
      case "credits":
        if (typeof d.value === "number") optsRef.current.onCredits?.(d.value);
        break;
      case "turn_end":
        pendingCommitRef.current = { message_id: d.message_id ?? null, full_text: d.full_text || "" };
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

  /** Send the student's puzzle attempt — the AI reacts (praise/advance or hint). */
  const sendPuzzleResult = useCallback((
    puzzleId: string, prompt: string, answer: unknown, correct: boolean,
  ) => {
    if (busyAt.current) {
      // A turn is mid-flight — buffer the solve and flush it when the turn ends
      // (see the effect below). Keep the latest only.
      pendingPuzzleRef.current = { puzzleId, prompt, answer, correct };
      return;
    }
    const ok = _send({
      type: "puzzle_result",
      puzzle_id: puzzleId, prompt, answer: String(answer), correct,
      tts: ttsEnabledRef.current,
    });
    if (!ok) return;
    busyAt.current = true;
    // The server echoes + persists the "🧩 Puzzle …" event bubble (role:"event"),
    // so we don't add an optimistic one here.
    setBusy(true);
    setStatus("waiting");
    armWatchdog();
  }, []);

  // Flush a buffered puzzle solve once the in-flight turn finishes.
  useEffect(() => {
    if (!busy && pendingPuzzleRef.current) {
      const p = pendingPuzzleRef.current;
      pendingPuzzleRef.current = null;
      sendPuzzleResult(p.puzzleId, p.prompt, p.answer, p.correct);
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
    const ok = _send({ type: "user_audio", audio_b64: audioB64, mime, stt: true, tts: ttsEnabledRef.current });
    if (!ok) return;
    busyAt.current = true;
    setBusy(true);
    setStatus("waiting");
    armWatchdog();
  }, []);

  /** Cancel the in-flight turn server-side without closing the socket. */
  const stopTurn = useCallback(() => { _send({ type: "stop" }); }, []);

  const hydrate = useCallback((msgs: ChatMessage[]) => { setMessages(msgs); }, []);
  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount.
  useEffect(() => () => { _closeIntentional(); }, [_closeIntentional]);

  return {
    connected, status, messages, liveText, thinkingSteps, busy, error,
    connect, disconnect, pause, resume,
    sendMessage, sendQuizResult, sendPuzzleResult, sendAudio, sendEvent, stopTurn,
    hydrate, setMessages, clearError,
  };
}
