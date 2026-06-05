import { useEffect, useRef } from "react";

/**
 * useVoiceCapture — hands-free mic capture for the custom voice-to-voice loop.
 *
 * Listens on the mic with a simple energy (RMS) VAD: when the student starts
 * speaking it records, and when they go silent for SILENCE_MS it sends the
 * recorded utterance via `onUtterance(audioB64, mime)`. The caller forwards that
 * to the session WebSocket (`channel.sendAudio`), which transcribes (STT) and
 * runs the normal turn pipeline; the reply comes back as audio segments.
 *
 * Half-duplex: while `paused` is true (the AI is thinking/speaking) the mic does
 * not record, so the tutor's own voice is never captured.
 */
export type MicState = "idle" | "listening" | "recording";

interface VoiceCaptureOpts {
  active: boolean;   // voice mode on
  paused: boolean;   // true while a turn is running (AI thinking/speaking)
  onUtterance: (audioB64: string, mime: string) => void;
  onState?: (s: MicState) => void;
  onError?: (msg: string) => void;
}

const SILENCE_MS = 1100;    // end the utterance after this much trailing silence
const MIN_SPEECH_MS = 350;  // ignore blips shorter than this
const RMS_THRESHOLD = 0.014; // speech vs silence energy threshold

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export function useVoiceCapture(opts: VoiceCaptureOpts) {
  const pausedRef = useRef(opts.paused);
  pausedRef.current = opts.paused;
  const onUttRef = useRef(opts.onUtterance);
  onUttRef.current = opts.onUtterance;
  const onStateRef = useRef(opts.onState);
  onStateRef.current = opts.onState;
  const onErrRef = useRef(opts.onError);
  onErrRef.current = opts.onError;

  useEffect(() => {
    if (!opts.active) return;
    let cancelled = false;

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf: number | null = null;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let speaking = false;
    let speechStart = 0;
    let lastVoice = 0;

    const setState = (s: MicState) => onStateRef.current?.(s);

    const startRecording = () => {
      if (!stream) return;
      chunks = [];
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
      const mime = preferred.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start();
    };

    const stopRecording = (discard: boolean) => {
      speaking = false;
      setState("listening");
      const rec = recorder;
      recorder = null;
      if (!rec) return;
      const mime = rec.mimeType || "audio/webm";
      rec.onstop = () => {
        const parts = chunks;
        chunks = [];
        if (discard || cancelled || parts.length === 0) return;
        new Blob(parts, { type: mime }).arrayBuffer().then((buf) => {
          if (!cancelled) onUttRef.current(bufToB64(buf), mime);
        });
      };
      try { rec.stop(); } catch { /* ignore */ }
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        onErrRef.current?.("Microphone access denied — allow it to use voice mode.");
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      setState("listening");

      const tick = () => {
        if (cancelled) return;
        raf = requestAnimationFrame(tick);

        // While the AI is responding, never record (avoids capturing its TTS).
        if (pausedRef.current) {
          if (speaking) stopRecording(true);
          return;
        }

        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();

        if (rms > RMS_THRESHOLD) {
          if (!speaking) {
            speaking = true;
            speechStart = now;
            startRecording();
            setState("recording");
          }
          lastVoice = now;
        } else if (speaking && now - lastVoice > SILENCE_MS) {
          stopRecording(now - speechStart < MIN_SPEECH_MS); // discard if too short
        }
      };
      tick();
    };

    start();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (recorder) { try { recorder.stop(); } catch { /* ignore */ } recorder = null; }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      if (ctx && ctx.state !== "closed") { ctx.close().catch(() => {}); ctx = null; }
      onStateRef.current?.("idle");
    };
  }, [opts.active]); // eslint-disable-line react-hooks/exhaustive-deps
}
