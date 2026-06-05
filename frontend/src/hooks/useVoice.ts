import { useState, useRef, useCallback } from "react";
import { voiceApi } from "../services/api";

/**
 * useVoice — single-shot text-to-speech ("Read aloud" / Listen buttons).
 *
 * The old real-time Gemini Live socket and the client-side streaming-TTS queue
 * have been removed. Real-time voice now runs through the chat/session WebSocket
 * pipeline (STT in → turn → segment-bundled Kokoro TTS out, played by
 * useSessionChannel). This hook only plays one clip on demand via /api/voice/speak.
 */
export function useVoice() {
  const [playing, setPlaying] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const clearVoiceError = useCallback(() => setVoiceError(null), []);

  const speakText = useCallback(async (text: string) => {
    setVoiceError(null);
    // Stop any clip currently playing.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    try {
      setPlaying(true);
      const blobData = await voiceApi.speak(text);
      const url = URL.createObjectURL(blobData);
      const audio = new Audio(url);
      audioRef.current = audio;
      const done = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      audio.onended = done;
      audio.onerror = done;
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

  return { playing, voiceError, clearVoiceError, speakText, stopSpeaking };
}
