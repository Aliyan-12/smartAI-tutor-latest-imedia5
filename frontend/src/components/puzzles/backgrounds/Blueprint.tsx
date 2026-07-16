/**
 * Blueprint — squared engineering paper: a fine minor/major grid with real draughting details on
 * top (corner registration ticks, a dimension line with arrowheads, a faint construction circle
 * with a crosshair). Light and calm, and it reinforces the idea of a grid — handy for arrays,
 * area and coordinates.
 */
export default function Blueprint() {
  const minor = "rgba(37, 99, 235, 0.06)";
  const major = "rgba(37, 99, 235, 0.12)";
  const ink = "rgba(37, 99, 235, 0.22)";
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
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 600 400"
           style={{ position: "absolute", inset: 0 }}>
        <g stroke={ink} strokeWidth="1.2" fill="none">
          {/* corner registration ticks */}
          <path d="M18,34 H50 M34,18 V50" />
          <path d="M582,34 H550 M566,18 V50" />
          <path d="M18,366 H50 M34,382 V350" />
          <path d="M582,366 H550 M566,382 V350" />
          {/* dimension line with arrowheads + tick marks */}
          <path d="M150,352 H450" />
          <path d="M150,346 V358 M450,346 V358" />
          <path d="M150,352 l10,-4 M150,352 l10,4" />
          <path d="M450,352 l-10,-4 M450,352 l-10,4" />
          {/* construction circle + crosshair */}
          <circle cx="470" cy="120" r="52" strokeDasharray="5 5" />
          <path d="M470,58 V182 M408,120 H532" strokeDasharray="4 6" strokeWidth="0.9" />
          {/* a lightly drawn right-angle detail */}
          <path d="M110,150 H210 V250" />
          <path d="M110,150 L210,250" strokeDasharray="4 5" strokeWidth="0.9" />
        </g>
      </svg>

      {/* a soft vignette so the grid fades at the edges rather than stopping hard */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at center, rgba(255,255,255,0) 55%, rgba(251,253,255,0.9) 100%)",
      }} />
    </div>
  );
}
