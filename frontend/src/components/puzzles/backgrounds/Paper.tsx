import { useMemo } from "react";

/**
 * Paper — a topographic contour map on warm off-white, like an ordnance-survey sheet. Two "hills"
 * with nested elevation rings (tighter where the ground is steeper), a couple of index contours
 * drawn heavier, and faint grain. Light and unobtrusive — it gives the box a tactile, worksheet
 * feel without competing with the activity.
 */
export default function Paper() {
  const line = "rgba(120, 108, 92, 0.16)";
  const index = "rgba(120, 108, 92, 0.28)";   // heavier "index" contours, every 5th ring

  // Slightly wobble each ring so the contours look surveyed, not like plain ellipses.
  const rings = useMemo(() => {
    const peaks = [
      { cx: 165, cy: 150, base: 26, step: 20, n: 11, rx: 1.0, ry: 0.82, rot: -12 },
      { cx: 452, cy: 268, base: 22, step: 23, n: 10, rx: 1.0, ry: 0.76, rot: 16 },
    ];
    return peaks.map((p) => {
      const paths: { d: string; heavy: boolean }[] = [];
      for (let i = 0; i < p.n; i++) {
        const rx = (p.base + i * p.step) * p.rx;
        const ry = (p.base + i * p.step) * p.ry;
        const wob = 1 + 0.06 * Math.sin(i * 1.7);   // gentle per-ring wobble
        // build a closed path from sampled points so the contour has a hand-surveyed wiggle
        const pts: string[] = [];
        const N = 40;
        for (let k = 0; k <= N; k++) {
          const a = (k / N) * Math.PI * 2;
          const wr = 1 + 0.05 * Math.sin(a * 3 + i);
          const x = p.cx + Math.cos(a) * rx * wob * wr;
          const y = p.cy + Math.sin(a) * ry * wob * wr;
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        paths.push({ d: `M${pts.join(" L")} Z`, heavy: i % 5 === 0 });
      }
      return paths;
    }).flat();
  }, []);

  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "linear-gradient(180deg, #ffffff 0%, #f6f4ef 100%)",
    }}>
      <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
           viewBox="0 0 600 400" style={{ position: "absolute", inset: 0 }}>
        {rings.map((r, i) => (
          <path key={i} d={r.d} fill="none"
                stroke={r.heavy ? index : line} strokeWidth={r.heavy ? 1.6 : 1.1} />
        ))}
        {/* a faint watercourse threading between the hills */}
        <path d="M40,300 C160,270 220,330 300,300 S470,210 560,250" fill="none"
              stroke="rgba(96,142,170,0.20)" strokeWidth="2.2" />
      </svg>
    </div>
  );
}
