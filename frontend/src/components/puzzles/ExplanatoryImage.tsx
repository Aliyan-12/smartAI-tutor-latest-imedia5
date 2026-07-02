import type { PuzzlePayload } from "./types";

/** Display-only: a generated diagram that explains the concept. No answer to submit. */
export default function ExplanatoryImage({ payload }: { payload: PuzzlePayload }) {
  const image = payload.params.image as string | undefined;
  const caption = (payload.params.caption as string) || payload.prompt || "";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%" }}>
      {image ? (
        <img
          src={image}
          alt={caption || "diagram"}
          style={{ maxWidth: "100%", maxHeight: 460, objectFit: "contain", borderRadius: 12, border: "1.5px solid #e2e8f0", background: "#fff" }}
        />
      ) : (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>The diagram couldn't be loaded.</p>
      )}
      {caption && (
        <p style={{ fontSize: 13, color: "#475569", textAlign: "center", margin: 0, maxWidth: 560 }}>{caption}</p>
      )}
    </div>
  );
}
