import { useRef, useState } from "react";
import type { PuzzlePayload } from "./types";

/**
 * AnimationPlayer — plays a pre-rendered Manim animation (MP4) on the Learn panel.
 *
 * Display-only: the tutor shows a short animation for an idea that motion explains better than a
 * still (a wave travelling, particles diffusing, a shape being reflected), then teaches from it.
 *
 * The tutor WRITES the Manim scene for the lesson it's teaching; the server validates that code
 * against an AST allow-list and renders it in an isolated process, then caches the MP4 by a hash
 * of the code — so the first showing takes a few seconds and every repeat is instant.
 *
 * Muted + playsInline so it autoplays on iOS Safari (an unmuted autoplay is blocked outright);
 * loops quietly, with a replay button sized as a real touch target.
 */
export default function AnimationPlayer({ payload }: { payload: PuzzlePayload }) {
  const video = (payload.params.video as string) || "";
  const poster = (payload.params.poster as string) || "";
  const caption = (payload.params.caption as string) || payload.prompt || "";
  const ref = useRef<HTMLVideoElement | null>(null);
  const [errored, setErrored] = useState(false);

  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 16px",
      background: "#0b1020",
    }}>
      {video && !errored ? (
        <>
          <video
            ref={ref}
            src={video}
            poster={poster || undefined}
            autoPlay
            loop
            muted
            playsInline
            onError={() => setErrored(true)}
            style={{ maxWidth: "100%", maxHeight: "78%", borderRadius: 12, background: "#000" }}
          />
          <button
            onClick={() => { const v = ref.current; if (v) { v.currentTime = 0; void v.play(); } }}
            style={{
              minHeight: 40, padding: "0 20px", borderRadius: 10, border: "none",
              fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: "#0b1020",
              background: "#e2e8f0", cursor: "pointer",
            }}
          >
            ↺ Replay
          </button>
        </>
      ) : (
        <span style={{ color: "#94a3b8", fontSize: 14 }}>
          {errored ? "The animation couldn't be loaded." : "Preparing the animation…"}
        </span>
      )}
      {caption && (
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#e2e8f0", textAlign: "center" }}>
          {caption}
        </p>
      )}
    </div>
  );
}
