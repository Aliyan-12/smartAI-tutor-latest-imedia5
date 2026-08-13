import { curriculumApi } from "../services/api";

// A single shared <audio> so previews never overlap across pickers/components.
let current: HTMLAudioElement | null = null;

export function stopTutorPreview() {
  if (current) {
    current.pause();
    current.src = "";
    current = null;
  }
}

/**
 * Play a short spoken sample in the given tutor's voice ("Hi, I'm Aria…").
 * Stops any preview already playing. `onEnd` fires when this clip ends, errors,
 * or is superseded — so callers can clear their "playing" UI state.
 */
export function playTutorPreview(tutorId: string, onEnd?: () => void): void {
  stopTutorPreview();
  const audio = new Audio(curriculumApi.tutorPreviewUrl(tutorId));
  current = audio;
  const cleanup = () => {
    if (current === audio) current = null;
    onEnd?.();
  };
  audio.addEventListener("ended", cleanup);
  audio.addEventListener("error", cleanup);
  audio.play().catch(cleanup);
}
