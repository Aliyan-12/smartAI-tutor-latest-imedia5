import type { PuzzlePayload } from "./types";

/** Display-only: a generated diagram that explains the concept. No answer to submit. */
export default function ExplanatoryImage({ payload }: { payload: PuzzlePayload }) {
  const image = payload.params.image as string | undefined;
  const caption = (payload.params.caption as string) || payload.prompt || "";
  return (
    // Sized to FILL the Learn panel. These used to be capped at 460px tall with a 13px caption,
    // which left a teaching diagram floating in a small box with unreadable labels — the student
    // has to read the labels ON the picture, so the picture is the content, not a thumbnail.
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 14, width: "100%", height: "100%",
    }}>
      {image ? (
        <img
          src={image}
          alt={caption || "diagram"}
          style={{
            width: "100%", maxWidth: 900, maxHeight: "min(72vh, 100%)",
            objectFit: "contain", borderRadius: 14,
            border: "1.5px solid #e2e8f0", background: "#fff",
          }}
        />
      ) : (
        <p style={{ color: "#94a3b8", fontSize: 15 }}>The diagram couldn't be loaded.</p>
      )}
      {caption && (
        <p style={{
          fontSize: 16, fontWeight: 600, color: "#334155", textAlign: "center",
          margin: 0, maxWidth: 720, lineHeight: 1.45,
        }}>{caption}</p>
      )}
    </div>
  );
}
