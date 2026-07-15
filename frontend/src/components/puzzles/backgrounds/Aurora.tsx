/**
 * Aurora — soft pastel light background. Big blurred colour blobs drifting slowly behind the
 * activity. Light-themed, so dark puzzle content sits on it without any contrast trouble.
 */
export default function Aurora() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
                  background: "linear-gradient(180deg, #ffffff 0%, #f6f8ff 100%)" }}>
      <style>{`
        @keyframes pz-aurora-a { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(6%, 4%) scale(1.12); } }
        @keyframes pz-aurora-b { 0%,100% { transform: translate(0,0) scale(1.05); } 50% { transform: translate(-5%, -6%) scale(1); } }
      `}</style>
      <div style={{
        position: "absolute", top: "-18%", left: "-10%", width: "55%", height: "70%",
        borderRadius: "50%", filter: "blur(70px)", opacity: 0.5,
        background: "radial-gradient(circle, #c7b6ff 0%, rgba(199,182,255,0) 70%)",
        animation: "pz-aurora-a 14s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", top: "10%", right: "-12%", width: "55%", height: "70%",
        borderRadius: "50%", filter: "blur(70px)", opacity: 0.45,
        background: "radial-gradient(circle, #a5e3ff 0%, rgba(165,227,255,0) 70%)",
        animation: "pz-aurora-b 16s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", bottom: "-22%", left: "25%", width: "55%", height: "65%",
        borderRadius: "50%", filter: "blur(70px)", opacity: 0.4,
        background: "radial-gradient(circle, #ffc4e6 0%, rgba(255,196,230,0) 70%)",
        animation: "pz-aurora-a 18s ease-in-out infinite",
      }} />
    </div>
  );
}
