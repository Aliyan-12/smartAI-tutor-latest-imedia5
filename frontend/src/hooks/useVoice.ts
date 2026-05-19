import { useState, useRef, useCallback } from "react";
import { voiceApi } from "../services/api";

type VoiceStatus = "idle" | "connecting" | "listening" | "processing" | "speaking";

interface VoiceCallbacks {
  onUserTranscript: (chunk: string) => void;
  onAiTranscriptChunk: (chunk: string) => void;
  onTurnComplete: () => void;
  onTurnSaved?: () => void;
  onCreditsUpdate: (credits: number) => void;
  onSessionCreated: (sessionId: string) => void;
  onError: (msg: string) => void;
  onQuizOffer?: (topic: string) => void;
}

// Strips internal bracket markers from text before it is sent to TTS.
// Handles: complete [MARKER], unclosed [MARKER at end (split mid-token),
// and orphaned ] content at start (e.g. from [QUIZ_OFFER: split on ":").
function _stripMarkersForTTS(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\[[^\]]*$/g, "")
    .replace(/^[^\[]*\]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function useVoice() {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const callbacksRef = useRef<VoiceCallbacks | null>(null);
  const playQueueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Streaming TTS state
  const sentenceBufRef = useRef<string>("");
  const ttsQueueRef = useRef<Array<Promise<Blob>>>([]);
  const ttsActiveRef = useRef(false);
  const ttsProcessingRef = useRef(false);
  const ttsDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connection lifecycle guards
  const intentionalCloseRef = useRef(false);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef = useRef(false);

  const isVoiceActive = voiceStatus !== "idle";

  const clearVoiceError = useCallback(() => setVoiceError(null), []);

  const playNextChunk = useCallback(async () => {
    if (playingRef.current || playQueueRef.current.length === 0) return;
    playingRef.current = true;
    setPlaying(true);

    const ctx = audioContextRef.current;
    if (!ctx) {
      playingRef.current = false;
      setPlaying(false);
      return;
    }

    while (playQueueRef.current.length > 0) {
      const raw = playQueueRef.current.shift()!;
      const samples = new Int16Array(raw);
      const floats = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        floats[i] = samples[i] / 32768;
      }

      const buffer = ctx.createBuffer(1, floats.length, 24000);
      buffer.copyToChannel(floats, 0);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);

      await new Promise<void>((resolve) => {
        src.onended = () => resolve();
        src.start();
      });
    }

    playingRef.current = false;
    setPlaying(false);
  }, []);

  const cleanupAudio = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    playQueueRef.current.length = 0;
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const connectVoice = useCallback(async (sessionId: string | null, callbacks: VoiceCallbacks, appointmentId?: number) => {
    // Prevent concurrent connection attempts
    if (connectingRef.current) return;
    connectingRef.current = true;

    // Cancel any pending auto-reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close any existing WebSocket before opening a new one (prevents dual sessions)
    intentionalCloseRef.current = true;
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: "stop" })); } catch {}
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupAudio();
    intentionalCloseRef.current = false;

    callbacksRef.current = callbacks;
    setVoiceError(null);
    setVoiceStatus("connecting");

    const token = localStorage.getItem("token");
    if (!token) {
      setVoiceError("Not authenticated");
      setVoiceStatus("idle");
      connectingRef.current = false;
      return;
    }

    // Store reconnect closure for use in onclose handler
    reconnectFnRef.current = () => connectVoice(sessionId, callbacks, appointmentId);

    // Create AudioContext for playback and mic processing
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioCtx;

    // Register PCM worklet for mic capture
    const workletCode = `
      class PcmProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (input && input[0]) {
            const samples = input[0];
            const pcm16 = new Int16Array(samples.length);
            for (let i = 0; i < samples.length; i++) {
              const s = Math.max(-1, Math.min(1, samples[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PcmProcessor);
    `;

    const blob = new Blob([workletCode], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);

    try {
      await audioCtx.audioWorklet.addModule(workletUrl);
    } catch {
      setVoiceError("Audio processing setup failed");
      setVoiceStatus("idle");
      connectingRef.current = false;
      return;
    }

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    let wsUrl = `${protocol}//${host}/api/voice/ws?token=${token}`;
    if (sessionId) wsUrl += `&session_id=${sessionId}`;
    if (appointmentId) wsUrl += `&appointment_id=${appointmentId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let connectionEstablished = false;

    ws.onopen = async () => {
      let stream: MediaStream | null = null;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (err: any) {
        const name = err?.name ?? "";
        const msg =
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Microphone permission denied — please allow microphone access in your browser and try again."
            : name === "NotFoundError"
            ? "No microphone found — please connect a microphone and try again."
            : name === "NotReadableError"
            ? "Microphone is already in use by another application."
            : "Microphone access failed — please check your browser settings.";
        setVoiceError(msg);
        ws.close();
        setVoiceStatus("idle");
        connectingRef.current = false;
        return;
      }

      try {
        if (ws.readyState !== WebSocket.OPEN) {
          stream.getTracks().forEach((t) => t.stop());
          connectingRef.current = false;
          return;
        }

        streamRef.current = stream;

        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
        workletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(event.data as ArrayBuffer);
          }
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);

        setVoiceStatus("listening");
        connectingRef.current = false;
      } catch {
        setVoiceError("Audio processing setup failed.");
        ws.close();
        setVoiceStatus("idle");
        connectingRef.current = false;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const cb = callbacksRef.current;

        switch (data.type) {
          case "status":
            if (data.content === "connected") {
              connectionEstablished = true;
              setVoiceStatus("listening");
            }
            break;

          case "session":
            cb?.onSessionCreated(data.content);
            break;

          case "user_transcript":
            cb?.onUserTranscript(data.content);
            break;

          case "ai_transcript":
            cb?.onAiTranscriptChunk(data.content);
            setVoiceStatus("speaking");
            break;

          case "audio":
            if (data.content) {
              const raw = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
              playQueueRef.current.push(raw.buffer);
              playNextChunk();
            }
            break;

          case "turn_complete":
            cb?.onTurnComplete();
            setVoiceStatus("listening");
            break;

          case "interrupted":
            playQueueRef.current.length = 0;
            setVoiceStatus("listening");
            break;

          case "turn_saved":
            cb?.onTurnSaved?.();
            break;

          case "quiz_offer":
            if (data.content) cb?.onQuizOffer?.(data.content);
            break;

          case "credits":
            if (data.content) cb?.onCreditsUpdate(parseFloat(data.content));
            break;

          case "error":
            setVoiceError(data.content);
            break;
        }
      } catch {
        // non-json message
      }
    };

    ws.onerror = () => {
      connectingRef.current = false;
      setVoiceError("Voice connection failed");
      setVoiceStatus("idle");
    };

    ws.onclose = (ev) => {
      // If this close was triggered by disconnectVoice(), do nothing extra
      if (intentionalCloseRef.current) return;

      cleanupAudio();

      // Unexpected close after a live session — auto-reconnect once
      if (connectionEstablished) {
        setVoiceStatus("connecting");
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          reconnectFnRef.current?.();
        }, 1500);
        return;
      }

      setVoiceStatus("idle");
      setVoiceError((prev) => {
        if (prev) return prev;
        if (ev.code === 4002) return "Insufficient credits — please subscribe to continue.";
        if (ev.code === 4003) return "Voice is only available to students.";
        return "Voice server unavailable — please try again or check server logs.";
      });
    };
  }, [cleanupAudio, playNextChunk]);

  const disconnectVoice = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectFnRef.current = null;
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: "stop" })); } catch {}
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupAudio();
    connectingRef.current = false;
    setVoiceStatus("idle");
    intentionalCloseRef.current = false;
  }, [cleanupAudio]);

  // ── Streaming TTS pipeline ──────────────────────────────────────────────────

  // Sequential audio queue processor — one instance runs at a time
  const _processTTSQueue = useCallback(async () => {
    if (ttsProcessingRef.current) return;
    ttsProcessingRef.current = true;

    while (ttsQueueRef.current.length > 0 && ttsActiveRef.current) {
      const blobPromise = ttsQueueRef.current.shift()!;
      try {
        const blob = await blobPromise;
        if (!ttsActiveRef.current) break;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        setPlaying(true);
        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; resolve(); };
          audio.play().catch(() => resolve());
        });
      } catch {
        // skip cancelled or failed chunks silently
      }
    }

    ttsProcessingRef.current = false;
    if (!ttsActiveRef.current || ttsQueueRef.current.length === 0) setPlaying(false);
  }, []);

  // As each token arrives, scan for sentence-boundary punctuation.
  // Every complete phrase is dispatched to TTS immediately so audio
  // starts playing within ~500ms of the first sentence completing.
  const feedStreamTTS = useCallback((chunk: string) => {
    if (!ttsActiveRef.current) return;
    sentenceBufRef.current += chunk;

    let buf = sentenceBufRef.current;
    let dispatched = false;

    while (true) {
      const idx = buf.search(/[!?.,:\n]/);
      if (idx === -1) break;
      const phrase = _stripMarkersForTTS(buf.slice(0, idx + 1));
      buf = buf.slice(idx + 1).trimStart();
      if (phrase.length >= 3) {
        ttsQueueRef.current.push(voiceApi.speak(phrase));
        dispatched = true;
      }
    }

    // Safety valve: flush if no punctuation arrives for a long stretch
    if (buf.length >= 150) {
      const safe = _stripMarkersForTTS(buf);
      buf = "";
      if (safe.length >= 3) {
        ttsQueueRef.current.push(voiceApi.speak(safe));
        dispatched = true;
      }
    }

    sentenceBufRef.current = buf;
    if (dispatched) _processTTSQueue();
  }, [_processTTSQueue]);

  const startStreamTTS = useCallback(() => {
    if (ttsDelayTimerRef.current) {
      clearTimeout(ttsDelayTimerRef.current);
      ttsDelayTimerRef.current = null;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    ttsActiveRef.current = true;
    ttsQueueRef.current = [];
    sentenceBufRef.current = "";
    ttsProcessingRef.current = false;
    setPlaying(false);
  }, []);

  // Flush any trailing text that didn't end with punctuation
  const endStreamTTS = useCallback(() => {
    if (ttsDelayTimerRef.current) {
      clearTimeout(ttsDelayTimerRef.current);
      ttsDelayTimerRef.current = null;
    }
    const remaining = _stripMarkersForTTS(sentenceBufRef.current);
    sentenceBufRef.current = "";
    if (remaining.length >= 3) {
      ttsQueueRef.current.push(voiceApi.speak(remaining));
      _processTTSQueue();
    }
  }, [_processTTSQueue]);

  const cancelStreamTTS = useCallback(() => {
    if (ttsDelayTimerRef.current) {
      clearTimeout(ttsDelayTimerRef.current);
      ttsDelayTimerRef.current = null;
    }
    ttsActiveRef.current = false;
    ttsQueueRef.current = [];
    sentenceBufRef.current = "";
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlaying(false);
  }, []);

  // ── Single-shot TTS (Listen button / quiz) ────────────────────────────────

  const speakText = useCallback(async (text: string) => {
    setVoiceError(null);
    // Cancel streaming TTS and stop any currently playing audio
    ttsActiveRef.current = false;
    ttsQueueRef.current = [];
    sentenceBufRef.current = "";
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlaying(false);
    try {
      setPlaying(true);
      const blobData = await voiceApi.speak(text);
      const url = URL.createObjectURL(blobData);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      audio.onerror = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      await audio.play();
    } catch {
      setPlaying(false);
      setVoiceError("Text-to-speech failed.");
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlaying(false);
  }, []);

  const sendQuizResult = useCallback((
    topic: string,
    score: number,
    strong: string[],
    weak: string[],
  ) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "quiz_result", topic, score, strong, weak }));
    }
  }, []);

  return {
    voiceStatus,
    isVoiceActive,
    playing,
    voiceError,
    clearVoiceError,
    connectVoice,
    disconnectVoice,
    speakText,
    stopSpeaking,
    startStreamTTS,
    feedStreamTTS,
    endStreamTTS,
    cancelStreamTTS,
    sendQuizResult,
  };
}
