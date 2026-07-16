import { useMemo } from "react";

/**
 * Bubbles — a deep night sky with luminous soda-pop orbs drifting upward through it. Each orb
 * has a real glass highlight and a soft rim, near orbs are big and blurred (out of focus, close
 * to camera) while far ones are small and crisp, so the field has depth rather than looking like
 * flat stickers. A faint star dust sits behind. DARK-themed: content on it must be light.
 */

const ORBS = [
  { x: 8,  s: 132, c: "#f472b6", d: 24, delay: 0,   blur: 3 },
  { x: 20, s: 60,  c: "#38bdf8", d: 17, delay: 3,   blur: 0.6 },
  { x: 33, s: 158, c: "#a855f7", d: 28, delay: 1.5, blur: 4 },
  { x: 46, s: 52,  c: "#facc15", d: 15, delay: 5,   blur: 0.5 },
  { x: 57, s: 116, c: "#34d399", d: 25, delay: 2.4, blur: 2.5 },
  { x: 69, s: 74,  c: "#fb7185", d: 20, delay: 4.2, blur: 1 },
  { x: 80, s: 142, c: "#60a5fa", d: 29, delay: 6,   blur: 3.5 },
  { x: 90, s: 66,  c: "#c084fc", d: 18, delay: 1,   blur: 0.7 },
];

export default function Bubbles() {
  const stars = useMemo(() => {
    let seed = 42;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    return Array.from({ length: 46 }, () => ({
      x: rnd() * 100, y: rnd() * 100, r: 0.4 + rnd() * 1.1, o: 0.15 + rnd() * 0.5, d: 2 + rnd() * 4,
    }));
  }, []);

  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "radial-gradient(ellipse at 50% 35%, #241a4d 0%, #171733 52%, #0b0d20 100%)",
    }}>
      <style>{`
        @keyframes pz-bubble-rise {
          0%   { transform: translateY(22%) scale(0.88); opacity: 0; }
          14%  { opacity: 0.6; }
          86%  { opacity: 0.6; }
          100% { transform: translateY(-128%) scale(1.12); opacity: 0; }
        }
        @keyframes pz-bubble-tw { 0%,100%{opacity:.15} 50%{opacity:.7} }
      `}</style>

      {/* star dust behind the orbs */}
      {stars.map((s, i) => (
        <div key={`st${i}`} style={{
          position: "absolute", left: `${s.x}%`, top: `${s.y}%`,
          width: s.r * 2, height: s.r * 2, borderRadius: "50%", background: "#dbe4ff",
          opacity: s.o, animation: `pz-bubble-tw ${s.d}s ease-in-out ${(i % 5) * 0.5}s infinite`,
        }} />
      ))}

      {ORBS.map((o, i) => (
        <div key={i} style={{
          position: "absolute", bottom: -o.s, left: `${o.x}%`,
          width: o.s, height: o.s, borderRadius: "50%",
          filter: `blur(${o.blur}px)`,
          background: `radial-gradient(circle at 34% 28%, #ffffffcc 0%, ${o.c}dd 16%, ${o.c}66 46%, ${o.c}00 72%)`,
          boxShadow: `0 0 ${o.s * 0.5}px ${o.c}44, inset -6px -8px ${o.s * 0.3}px ${o.c}55`,
          animation: `pz-bubble-rise ${o.d}s ease-in ${o.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}
