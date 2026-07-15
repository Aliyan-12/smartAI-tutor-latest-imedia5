/**
 * Blueprint — fine graph-paper grid on a cool white base, like squared maths paper. Light,
 * calm, and it quietly reinforces the idea of a grid (handy for arrays, area, coordinates).
 */
export default function Blueprint() {
  const minor = "rgba(37, 99, 235, 0.06)";
  const major = "rgba(37, 99, 235, 0.12)";
  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "#fbfdff",
      backgroundImage: `
        linear-gradient(${minor} 1px, transparent 1px),
        linear-gradient(90deg, ${minor} 1px, transparent 1px),
        linear-gradient(${major} 1.4px, transparent 1.4px),
        linear-gradient(90deg, ${major} 1.4px, transparent 1.4px)`,
      backgroundSize: "24px 24px, 24px 24px, 120px 120px, 120px 120px",
    }}>
      {/* a soft vignette so the grid fades at the edges rather than stopping hard */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at center, rgba(255,255,255,0) 55%, rgba(251,253,255,0.9) 100%)",
      }} />
    </div>
  );
}
