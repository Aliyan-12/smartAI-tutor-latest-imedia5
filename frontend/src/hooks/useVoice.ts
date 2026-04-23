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

  const connectVoice = useCallback(async (sessionId: string | null, callbacks: VoiceCallbacks, appointmentId?: number) => {
    callbacksRef.current = callbacks;
    setVoiceError(null);
    setVoiceStatus("connecting");

    const token = localStorage.getItem("token");
    if (!token) {
      setVoiceError("Not authenticated");
      setVoiceStatus("idle");
      return;
    }

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
    } catch (e) {
      setVoiceError("Audio processing setup failed");
      setVoiceStatus("idle");
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
        // Try with preferred constraints first; fall back to basic audio if browser rejects them
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
        // Guard: backend may have closed the WS while getUserMedia was pending
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
      cleanupAudio();
      setVoiceStatus("idle");
      if (!connectionEstablished) {
        setVoiceError((prev) => {
          if (prev) return prev;
          if (ev.code === 4002) return "Insufficient credits — please subscribe to continue.";
          if (ev.code === 4003) return "Voice is only available to students.";
          return "Voice server unavailable — please try again or check server logs.";
        });
      }
    };
  }, [playNextChunk]);

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

  const disconnectVoice = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      } catch {}
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupAudio();
    setVoiceStatus("idle");
  }, [cleanupAudio]);

  const speakText = useCallback(async (text: string) => {
    setVoiceError(null);
    try {
      setPlaying(true);
      const blobData = await voiceApi.speak(text);
      const url = URL.createObjectURL(blobData);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPlaying(false); URL.revokeObjectURL(url); };
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
  };
}
