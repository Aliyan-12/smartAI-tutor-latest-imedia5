import { useMemo } from "react";

/**
 * Mesh — a curved SPACE-TIME grid. A gravity well dips the grid sheet into a funnel around a
 * glowing mass, over a deep-space star field with a nebula haze and an accretion ring. This is
 * the iconic "mass warping the fabric of space" picture — the fabric actually curves, rather
 * than a flat perspective floor. DARK-themed: content placed on it must use light colours.
 */

const W = 600, H = 400;
const WELL_X = 300, WELL_Y = 205, WELL_R = 145, WELL_DEPTH = 106;

// Displace a flat grid point into the gravity well: pulled inward (lensing) and sunk downward
// (the sheet dips), strongest at the centre and easing to nothing far away — a smooth funnel.
function warp(x: number, y: number): [number, number] {
  const dx = x - WELL_X, dy = y - WELL_Y;
  const d = Math.hypot(dx, dy);
  const f = WELL_DEPTH / (1 + (d / WELL_R) ** 2);
  const ux = d > 0.001 ? dx / d : 0;
  const uy = d > 0.001 ? dy / d : 0;
  return [x - ux * f * 0.5, y - uy * f * 0.5 + f * 0.92];
}

function polyline(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export default function Mesh() {
  const { verticals, horizontals, stars } = useMemo(() => {
    const SAMPLES = 46;
    const vs: string[] = [];
    for (let gx = -60; gx <= 660; gx += 36) {
      const pts: [number, number][] = [];
      for (let s = 0; s <= SAMPLES; s++) pts.push(warp(gx, -60 + (520 * s) / SAMPLES));
      vs.push(polyline(pts));
    }
    const hs: string[] = [];
    for (let gy = -40; gy <= 460; gy += 30) {
      const pts: [number, number][] = [];
      for (let s = 0; s <= SAMPLES; s++) pts.push(warp(-60 + (720 * s) / SAMPLES, gy));
      hs.push(polyline(pts));
    }
    // deterministic star field (a tiny LCG so it looks the same each render, no assets)
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const st = Array.from({ length: 74 }, () => ({
      x: rnd() * W, y: rnd() * H, r: 0.4 + rnd() * 1.5, o: 0.2 + rnd() * 0.7, d: 2 + rnd() * 4,
    }));
    return { verticals: vs, horizontals: hs, stars: st };
  }, []);

  const line = "rgba(94, 234, 212, 0.28)";
  const lineBright = "rgba(125, 246, 255, 0.65)";

  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "radial-gradient(ellipse at 50% 44%, #11263c 0%, #0a1628 46%, #050b16 100%)",
    }}>
      <style>{`
        @keyframes pz-star-tw { 0%,100%{opacity:.2} 50%{opacity:1} }
        @keyframes pz-core-pulse { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.85} 50%{transform:translate(-50%,-50%) scale(1.14);opacity:1} }
      `}</style>
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 600 400"
           style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="pz-neb" cx="50%" cy="52%" r="60%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.28)" />
            <stop offset="55%" stopColor="rgba(37,99,235,0.09)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width="600" height="400" fill="url(#pz-neb)" />

        {stars.map((s, i) => (
          <circle key={`s${i}`} cx={s.x} cy={s.y} r={s.r} fill="#e0ecff"
                  style={{ opacity: s.o, animation: `pz-star-tw ${s.d}s ease-in-out ${(i % 6) * 0.4}s infinite` }} />
        ))}

        {/* the warped fabric of space */}
        <g fill="none" stroke={line} strokeWidth="0.8" strokeLinecap="round">
          {horizontals.map((p, i) => <polyline key={`h${i}`} points={p} />)}
          {verticals.map((p, i) => <polyline key={`v${i}`} points={p} />)}
        </g>

        {/* accretion ring hugging the throat of the well */}
        <ellipse cx={WELL_X} cy={WELL_Y + 48} rx="82" ry="24" fill="none"
                 stroke={lineBright} strokeWidth="1.4" style={{ opacity: 0.5 }} />
      </svg>

      {/* the mass at the bottom of the well */}
      <div style={{
        position: "absolute", left: "50%", top: `${((WELL_Y + 46) / H) * 100}%`,
        width: 118, height: 118, borderRadius: "50%",
        transform: "translate(-50%,-50%)", filter: "blur(5px)",
        background: "radial-gradient(circle at 50% 45%, #ffffff 0%, #a5f3fc 22%, rgba(56,189,248,0.5) 55%, rgba(56,189,248,0) 78%)",
        animation: "pz-core-pulse 5s ease-in-out infinite",
      }} />
    </div>
  );
}
