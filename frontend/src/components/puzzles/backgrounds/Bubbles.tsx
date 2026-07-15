/**
 * Bubbles — a dark night background with colourful translucent orbs drifting upward. The
 * "dark bg with colourful bubbles" look. DARK-themed: content on it must be light.
 */
const ORBS = [
  { x: 8,  s: 120, c: "#f472b6", d: 22, delay: 0 },
  { x: 24, s: 70,  c: "#38bdf8", d: 18, delay: 3 },
  { x: 40, s: 150, c: "#a855f7", d: 26, delay: 1 },
  { x: 55, s: 60,  c: "#facc15", d: 16, delay: 5 },
  { x: 68, s: 110, c: "#34d399", d: 24, delay: 2 },
  { x: 82, s: 80,  c: "#fb7185", d: 20, delay: 4 },
  { x: 92, s: 130, c: "#60a5fa", d: 28, delay: 6 },
];

export default function Bubbles() {
  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "radial-gradient(ellipse at 50% 40%, #1e2145 0%, #141631 55%, #0b0d20 100%)",
    }}>
      <style>{`@keyframes pz-bubble-rise {
        0%   { transform: translateY(20%) scale(0.9); opacity: 0; }
        15%  { opacity: 0.55; }
        85%  { opacity: 0.55; }
        100% { transform: translateY(-120%) scale(1.1); opacity: 0; }
      }`}</style>
      {ORBS.map((o, i) => (
        <div key={i} style={{
          position: "absolute", bottom: -o.s, left: `${o.x}%`,
          width: o.s, height: o.s, borderRadius: "50%",
          filter: "blur(2px)",
          background: `radial-gradient(circle at 35% 30%, ${o.c}cc 0%, ${o.c}55 45%, ${o.c}00 72%)`,
          animation: `pz-bubble-rise ${o.d}s ease-in ${o.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}
