import { useState, useRef, useCallback, useEffect } from "react";
import { sessionWsUrl } from "../services/api";
import type { ChatMessage } from "../types";

/**
 * useSessionChannel — the unified session chat pipeline (one WebSocket).
 *
 * The backend streams each assistant turn as ordered *segments* (a sentence +
 * its bundled Kokoro audio). This hook plays each segment's audio while
 * revealing its words over the clip's exact duration → true TTS↔text sync.
 * Messages are committed only on `turn_end` via the authoritative DB id, so
 * there are no optimistic-id collisions, duplicates, or freezes.
 */
export type SessionStatus = "idle" | "connecting" | "waiting" | "speaking";

interface Segment {
  seq: number;
  text: string;
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
  const [fillerText, setFillerText] = useState<string | null>(null);

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
  const segQueueRef = useRef<Segment[]>([]);
  const playingRef = useRef(false);
  const liveTextRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fillerAudioRef = useRef<HTMLAudioElement | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<{ message_id: number | null; full_text: string } | null>(null);
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
    if (fillerAudioRef.current) { try { fillerAudioRef.current.pause(); } catch { /* ignore */ } fillerAudioRef.current = null; }
    segQueueRef.current = [];
    playingRef.current = false;
    liveTextRef.current = "";
    setLiveText("");
    setFillerText(null);
    pendingCommitRef.current = null;
  };

  // ── per-segment reveal + audio (the sync core) ──
  const revealSegment = (seg: Segment): Promise<void> =>
    new Promise((resolve) => {
      const words = seg.text.split(/\s+/).filter(Boolean);
      if (words.length === 0) { resolve(); return; }
      const total = seg.duration_ms && seg.duration_ms > 0
        ? seg.duration_ms
        : words.length * DEFAULT_MS_PER_WORD;
      const per = Math.max(25, total / words.length);
      let i = 0;
      const tick = () => {
        const sep = liveTextRef.current ? " " : "";
        liveTextRef.current += sep + words[i];
        setLiveText(liveTextRef.current);
        i++;
        if (i >= words.length) { resolve(); return; }
        revealTimerRef.current = setTimeout(tick, per);
      };
      tick();
    });

  const playAudio = (seg: Segment): Promise<void> =>
    new Promise((resolve) => {
      if (!seg.audio_b64 || !ttsEnabledRef.current) { resolve(); return; }
      let url: string;
      try {
        const bytes = Uint8Array.from(atob(seg.audio_b64), (c) => c.charCodeAt(0));
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

  // Neutral filler bridge: shown + (optionally) played until the first real segment.
  const stopFiller = () => {
    if (fillerAudioRef.current) { try { fillerAudioRef.current.pause(); } catch { /* ignore */ } fillerAudioRef.current = null; }
    setFillerText(null);
  };
  const playFiller = (text: string, audioB64: string | null) => {
    setFillerText(text);
    if (!audioB64 || !ttsEnabledRef.current) return;
    try {
      const bytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const audio = new Audio(url);
      fillerAudioRef.current = audio;
      const done = () => { URL.revokeObjectURL(url); if (fillerAudioRef.current === audio) fillerAudioRef.current = null; };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    } catch { /* ignore */ }
  };

  const finalizeTurn = (forced: boolean) => {
    if (playingRef.current) return;            // still speaking — will be called again
    if (segQueueRef.current.length > 0) return; // more segments queued
    const pc = pendingCommitRef.current;
    if (!pc && !forced) return;
    pendingCommitRef.current = null;
    clearWatchdog();

    if (pc && pc.full_text) {
      const id = pc.message_id;
      setMessages((prev) => {
        if (id != null && prev.some((m) => m.id === id)) return prev; // no dupes
        return [...prev, {
          id: id ?? -Date.now(),
          chat_id: 0,
          role: "assistant" as const,
          content: pc.full_text,
          timestamp: new Date().toISOString(),
        }];
      });
    }
    liveTextRef.current = "";
    setLiveText("");
    setFillerText(null);
    setStatus("idle");
    setBusy(false);
  };

  const pumpPlayer = async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    setStatus("speaking");
    stopFiller(); // first real segment takes over from the neutral bridge
    while (segQueueRef.current.length > 0) {
      const seg = segQueueRef.current.shift()!;
      await Promise.all([revealSegment(seg), playAudio(seg)]);
    }
    playingRef.current = false;
    finalizeTurn(false);
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
        setStatus("waiting");
        armWatchdog();
        break;
      case "filler":
        playFiller(d.text || "", d.audio_b64 ?? null);
        break;
      case "segment":
        segQueueRef.current.push({
          seq: d.seq, text: d.text || "", audio_b64: d.audio_b64 ?? null, duration_ms: d.duration_ms ?? null,
        });
        void pumpPlayer();
        break;
      case "tool":
        optsRef.current.onTool?.(d.tool, d.data || {});
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
  /** Resume: reopen the socket; onReady will re-hydrate authoritative history. */
  const resume = useCallback((sessionId: string | null) => {
    reconnectAttemptsRef.current = 0;
    connect(sessionId ?? lastSessionIdRef.current);
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
    setMessages((prev) => [...prev, {
      id: -Date.now(), chat_id: 0, role: "quiz_result" as const,
      content: `Quiz completed: ${Math.round(score)}% on "${topic}"`,
      timestamp: new Date().toISOString(),
    }]);
    setBusy(true);
    setStatus("waiting");
    armWatchdog();
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
    connected, status, messages, liveText, fillerText, busy, error,
    connect, disconnect, pause, resume,
    sendMessage, sendQuizResult, sendAudio, stopTurn,
    hydrate, setMessages, clearError,
  };
}
