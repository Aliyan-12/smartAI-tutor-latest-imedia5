/**
 * Mesh — a dark "space-time" perspective grid receding to a horizon, glowing teal. This is the
 * backdrop from the Synthesis multiplication game. DARK-themed: content placed on it must use
 * light colours (the math puzzle does).
 */
export default function Mesh() {
  const line = "rgba(56, 189, 248, 0.28)";
  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "radial-gradient(ellipse at 50% 32%, #0b2b3a 0%, #071a26 55%, #04121a 100%)",
    }}>
      <style>{`@keyframes pz-mesh-drift { from { transform: translateY(0); } to { transform: translateY(40px); } }`}</style>
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 600 400"
           style={{ position: "absolute", inset: 0 }}>
        {/* radial "rails" fanning out from a vanishing point near the top-centre */}
        <g stroke={line} strokeWidth="1">
          {Array.from({ length: 17 }, (_, i) => {
            const vx = 300, vy = 130;
            const bx = (i / 16) * 900 - 150;   // spread wide so the fan fills the floor
            return <line key={`v${i}`} x1={vx} y1={vy} x2={bx} y2={400} />;
          })}
        </g>
        {/* horizontal rings, closer together near the horizon → perspective floor */}
        <g stroke={line} strokeWidth="1" style={{ animation: "pz-mesh-drift 6s linear infinite" }}>
          {Array.from({ length: 12 }, (_, i) => {
            const t = i / 11;
            const y = 130 + t * t * 320;       // quadratic spacing = depth
            return <line key={`h${i}`} x1={-150} y1={y} x2={750} y2={y} />;
          })}
        </g>
      </svg>
      {/* a glow at the vanishing point */}
      <div style={{
        position: "absolute", top: "22%", left: "50%", width: 260, height: 160,
        transform: "translate(-50%,-50%)", filter: "blur(50px)", opacity: 0.5,
        background: "radial-gradient(circle, rgba(56,189,248,0.5) 0%, rgba(56,189,248,0) 70%)",
      }} />
    </div>
  );
}
