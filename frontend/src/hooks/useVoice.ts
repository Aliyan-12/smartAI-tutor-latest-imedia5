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
  const ttsQueueRef = useRef<string[]>([]);
  const ttsActiveRef = useRef(false);
  const ttsProcessingRef = useRef(false);

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
    connectingRef.current = false;
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
        return;
      }

      try {
        if (ws.readyState !== WebSocket.OPEN) {
          stream.getTracks().forEach((t) => t.stop());
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
      } catch {
        setVoiceError("Audio processing setup failed.");
        ws.close();
        setVoiceStatus("idle");
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
      const sentence = ttsQueueRef.current.shift()!;
      try {
        const blob = await voiceApi.speak(sentence);
        if (!ttsActiveRef.current) { break; }
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
        // skip failed chunks silently
      }
    }

    ttsProcessingRef.current = false;
    if (!ttsActiveRef.current || ttsQueueRef.current.length === 0) setPlaying(false);
  }, []);

  // Buffer incoming text tokens and flush in large paragraph-sized chunks
  // to avoid gaps and ensure Gemini TTS gets enough context per call.
  const feedStreamTTS = useCallback((chunk: string) => {
    if (!ttsActiveRef.current) return;
    sentenceBufRef.current += chunk;

    const buf = sentenceBufRef.current;

    // Flush on paragraph break (\n\n)
    const paraIdx = buf.indexOf("\n\n");
    if (paraIdx !== -1) {
      const paragraph = buf.slice(0, paraIdx).trim();
      if (paragraph.length >= 40) {
        ttsQueueRef.current.push(paragraph);
        _processTTSQueue();
      }
      sentenceBufRef.current = buf.slice(paraIdx + 2).trimStart();
      return;
    }

    // Flush when buffer reaches ~350 chars — cut at last sentence boundary
    if (buf.length >= 350) {
      let cutAt = -1;
      for (let i = buf.length - 1; i >= 150; i--) {
        const ch = buf[i];
        if ((ch === "." || ch === "!" || ch === "?") &&
            (buf[i + 1] === " " || buf[i + 1] === "\n" || i + 1 === buf.length)) {
          cutAt = i + 1;
          break;
        }
      }
      if (cutAt > 100) {
        const paragraph = buf.slice(0, cutAt).trim();
        ttsQueueRef.current.push(paragraph);
        _processTTSQueue();
        sentenceBufRef.current = buf.slice(cutAt).trimStart();
      }
    }
  }, [_processTTSQueue]);

  const startStreamTTS = useCallback(() => {
    // Stop any existing audio and reset all streaming TTS state
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    ttsActiveRef.current = true;
    ttsQueueRef.current = [];
    sentenceBufRef.current = "";
    ttsProcessingRef.current = false;
    setPlaying(false);
  }, []);

  const endStreamTTS = useCallback(() => {
    const remaining = sentenceBufRef.current.trim();
    sentenceBufRef.current = "";
    if (remaining.length >= 20) {
      ttsQueueRef.current.push(remaining);
      _processTTSQueue();
    }
  }, [_processTTSQueue]);

  const cancelStreamTTS = useCallback(() => {
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
  };
}
