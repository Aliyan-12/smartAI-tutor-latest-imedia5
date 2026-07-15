/**
 * Paper — soft topographic contour lines on warm off-white, like the "canvas" backdrop in the
 * Synthesis flashcard game. Light and unobtrusive; gives the box a tactile, worksheet feel.
 */
export default function Paper() {
  // Concentric wavy rings, drawn once as SVG and tiled. Very low-contrast grey so it never
  // competes with the activity.
  const stroke = "rgba(100, 116, 139, 0.14)";
  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "linear-gradient(180deg, #ffffff 0%, #f7f6f3 100%)",
    }}>
      <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
           viewBox="0 0 600 400" style={{ position: "absolute", inset: 0 }}>
        <g fill="none" stroke={stroke} strokeWidth="1.4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const r = 30 + i * 34;
            return <ellipse key={`l${i}`} cx="150" cy="150" rx={r} ry={r * 0.82} />;
          })}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const r = 26 + i * 38;
            return <ellipse key={`r${i}`} cx="470" cy="290" rx={r} ry={r * 0.78} />;
          })}
        </g>
      </svg>
    </div>
  );
}
