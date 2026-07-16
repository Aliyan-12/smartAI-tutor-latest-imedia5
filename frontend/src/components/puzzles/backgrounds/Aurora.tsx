/**
 * Aurora — soft northern-lights light. Blurred pastel light-curtains sweep across the sky above
 * a gentle glow, undulating slowly. Light-themed, so dark puzzle content sits on it cleanly.
 */
export default function Aurora() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
                  background: "linear-gradient(180deg, #ffffff 0%, #f4f7ff 55%, #eef3ff 100%)" }}>
      <style>{`
        @keyframes pz-aurora-a { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(6%, 4%) scale(1.12); } }
        @keyframes pz-aurora-b { 0%,100% { transform: translate(0,0) scale(1.05); } 50% { transform: translate(-5%, -6%) scale(1); } }
        @keyframes pz-curtain-1 { 0%,100% { transform: translateX(-4%) skewX(-6deg) scaleY(1); } 50% { transform: translateX(5%) skewX(4deg) scaleY(1.1); } }
        @keyframes pz-curtain-2 { 0%,100% { transform: translateX(4%) skewX(5deg) scaleY(1.08); } 50% { transform: translateX(-6%) skewX(-4deg) scaleY(0.95); } }
      `}</style>

      {/* glow blobs (the ambient colour) */}
      <div style={{ position: "absolute", top: "-18%", left: "-10%", width: "55%", height: "70%",
        borderRadius: "50%", filter: "blur(70px)", opacity: 0.5,
        background: "radial-gradient(circle, #c7b6ff 0%, rgba(199,182,255,0) 70%)",
        animation: "pz-aurora-a 14s ease-in-out infinite" }} />
      <div style={{ position: "absolute", bottom: "-22%", left: "25%", width: "55%", height: "65%",
        borderRadius: "50%", filter: "blur(70px)", opacity: 0.4,
        background: "radial-gradient(circle, #ffc4e6 0%, rgba(255,196,230,0) 70%)",
        animation: "pz-aurora-a 18s ease-in-out infinite" }} />

      {/* the light-curtains — tall blurred gradient bands that sway like aurora */}
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 600 400"
           style={{ position: "absolute", inset: 0, filter: "blur(14px)" }}>
        <defs>
          <linearGradient id="pz-au1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(129,230,217,0)" />
            <stop offset="45%" stopColor="rgba(129,230,217,0.55)" />
            <stop offset="100%" stopColor="rgba(96,165,250,0)" />
          </linearGradient>
          <linearGradient id="pz-au2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(196,181,253,0)" />
            <stop offset="50%" stopColor="rgba(196,181,253,0.5)" />
            <stop offset="100%" stopColor="rgba(244,114,182,0)" />
          </linearGradient>
        </defs>
        <g style={{ transformOrigin: "center", animation: "pz-curtain-1 15s ease-in-out infinite" }}>
          <path d="M120,-40 C150,120 90,240 140,440 L210,440 C190,240 240,120 200,-40 Z" fill="url(#pz-au1)" />
        </g>
        <g style={{ transformOrigin: "center", animation: "pz-curtain-2 19s ease-in-out infinite" }}>
          <path d="M360,-40 C400,140 330,260 380,440 L470,440 C450,250 500,120 450,-40 Z" fill="url(#pz-au2)" />
        </g>
        <g style={{ transformOrigin: "center", animation: "pz-curtain-1 22s ease-in-out infinite" }}>
          <path d="M250,-40 C280,150 250,260 290,440 L330,440 C315,250 340,140 310,-40 Z" fill="url(#pz-au1)" />
        </g>
      </svg>
    </div>
  );
}
