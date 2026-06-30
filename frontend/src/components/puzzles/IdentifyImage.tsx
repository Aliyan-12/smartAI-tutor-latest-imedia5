import { useState } from "react";
import type { DisplayPuzzleProps } from "./types";

/**
 * IdentifyImage — a DISPLAY puzzle: shows one real topic image. PuzzlePlayer renders
 * the `choice` answer_type buttons + checks the answer, so this component only draws
 * the image (with a graceful loading / unavailable state).
 */
export default function IdentifyImage({ params }: DisplayPuzzleProps) {
  const url = String(params.image || "");
  const [failed, setFailed] = useState(false);

  return (
    <div
      style={{
        width: 300, maxWidth: "100%", minHeight: 220, display: "flex",
        alignItems: "center", justifyContent: "center", background: "#fff",
        border: "1.5px solid #e2e8f0", borderRadius: 14, padding: 10,
      }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt="What is this?"
          onError={() => setFailed(true)}
          style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 8 }}
        />
      ) : (
        <span style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
          Image unavailable — answer from what we just covered.
        </span>
      )}
    </div>
  );
}
