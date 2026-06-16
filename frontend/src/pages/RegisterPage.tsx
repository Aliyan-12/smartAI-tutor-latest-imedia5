import { useState, useRef, useEffect, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const UKFlag = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="22" height="14" style={{borderRadius:2,flexShrink:0,display:"inline-block"}}>
    <rect width="60" height="30" fill="#012169"/>
    <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="9"/>
    <path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" strokeWidth="5"/>
    <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="11"/>
    <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="7"/>
  </svg>
);

const HIGHLIGHTS = [
  { icon: "🎓", title: "Personalised Learning", desc: "AI adapts to your pace and learning style",  color: "#1a73e8" },
  { icon: "📊", title: "Track Your Progress",   desc: "XP, streaks, and detailed session reports",  color: "#f97316" },
  { icon: "🧠", title: "UK Curriculum Aligned", desc: "GCSE, A-Level, Key Stage content built-in",  color: "#10b981" },
  { icon: "🔊", title: "Voice Tutoring",         desc: "Real-time AI voice sessions coming soon",    color: "#7c3aed" },
];

const TRUST_BADGES: { icon: ReactNode; title: string; desc: string }[] = [
  { icon: "🛡️",        title: "Secure & Safe",   desc: "Your data is protected and never shared." },
  { icon: <UKFlag />,  title: "UK Curriculum",   desc: "Aligned to national standards." },
  { icon: "🤖",        title: "AI-Powered",      desc: "Smart. Personalised. Always improving." },
  { icon: "📈",        title: "Better Outcomes", desc: "Track progress and achieve more." },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [error,       setError]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [showPw,      setShowPw]      = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const containerRef     = useRef<HTMLDivElement>(null);
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const mobileCanvasRef  = useRef<HTMLCanvasElement>(null);
  const consRafRef       = useRef<number>(0);
  const mobileConsRafRef = useRef<number>(0);

  // ── Constellation canvas ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    interface Star { x: number; y: number; vx: number; vy: number; r: number; opacity: number; }

    let W = container.clientWidth;
    let H = container.clientHeight;

    const resize = () => {
      W = container.clientWidth;
      H = container.clientHeight;
      canvas.width  = W;
      canvas.height = H;
    };
    resize();

    const N = 45;
    const stars: Star[] = Array.from({ length: N }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r:  1.2 + Math.random() * 1.8,
      opacity: 0.35 + Math.random() * 0.55,
    }));

    const drawTick = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      for (const s of stars) {
        s.x = (s.x + s.vx + W) % W;
        s.y = (s.y + s.vy + H) % H;
      }

      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const a = stars[i], b = stars[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 155) {
            const alpha = (1 - d / 155) * 0.28;
            ctx.strokeStyle = `rgba(100,160,255,${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const s of stars) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3);
        g.addColorStop(0, `rgba(130,180,255,${s.opacity})`);
        g.addColorStop(1, "rgba(130,180,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(200,225,255,${s.opacity * 1.2})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      consRafRef.current = requestAnimationFrame(drawTick);
    };

    consRafRef.current = requestAnimationFrame(drawTick);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(consRafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ── Mobile constellation canvas ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = mobileCanvasRef.current;
    if (!canvas) return;
    interface Star { x: number; y: number; vx: number; vy: number; r: number; opacity: number; }
    let W = 0, H = 0, stars: Star[] = [];

    const init = () => {
      W = canvas.offsetWidth; H = canvas.offsetHeight;
      if (!W || !H) return;
      canvas.width = W; canvas.height = H;
      stars = Array.from({ length: 30 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
        r: 1.0 + Math.random() * 1.5, opacity: 0.3 + Math.random() * 0.5,
      }));
    };
    init();

    const drawTick = () => {
      if (!W || !H) { init(); mobileConsRafRef.current = requestAnimationFrame(drawTick); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        s.x = (s.x + s.vx + W) % W;
        s.y = (s.y + s.vy + H) % H;
      }
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const a = stars[i], b = stars[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 120) {
            ctx.strokeStyle = `rgba(100,160,255,${(1 - d / 120) * 0.25})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const s of stars) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3);
        g.addColorStop(0, `rgba(130,180,255,${s.opacity})`);
        g.addColorStop(1, "rgba(130,180,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(200,225,255,${s.opacity * 1.2})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      mobileConsRafRef.current = requestAnimationFrame(drawTick);
    };

    mobileConsRafRef.current = requestAnimationFrame(drawTick);
    return () => cancelAnimationFrame(mobileConsRafRef.current);
  }, []);

  // ── Register submit ───────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setError("");
    setLoading(true);
    try   { await register(name, email, password); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Registration failed"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }

        .rp-root {
          display: flex; min-height: 100vh;
          font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f8fafc;
        }

        /* ══ BRAND PANEL ══ */
        .rp-brand {
          flex: 0 0 58%;
          background: linear-gradient(160deg, #0a0a15 0%, #111127 50%, #0d1a2e 100%);
          display: flex; flex-direction: column; justify-content: space-between;
          padding: 48px 56px 40px; position: relative; overflow: hidden;
          user-select: none;
        }
        .rp-brand::before {
          content: ""; position: absolute; top: -100px; right: -80px;
          width: 380px; height: 380px; border-radius: 50%;
          background: radial-gradient(circle, rgba(26,115,232,0.18) 0%, transparent 70%);
          pointer-events: none;
        }
        .rp-brand::after {
          content: ""; position: absolute; bottom: -60px; left: -40px;
          width: 280px; height: 280px; border-radius: 50%;
          background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);
          pointer-events: none;
        }

        /* Constellation canvas */
        .rp-constellation {
          position: absolute; inset: 0; width: 100%; height: 100%;
          pointer-events: none; z-index: 1;
        }

        .rp-brand-hdr {
          display: flex; align-items: center; gap: 14px;
          position: relative; z-index: 10; pointer-events: none;
        }
        .rp-brand-badge {
          width: auto; height: 48px; border-radius: 0; background: none; box-shadow: none;
          display: flex; align-items: center;
        }
        .rp-brand-badge img { height: 48px; width: auto; object-fit: contain; }
        .rp-brand-hdr h1 { font-size: 19px; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.2px; }
        .rp-brand-hdr p  { font-size: 12px; color: #636363; margin: 2px 0 0; }

        /* Hero — text + robot row */
        .rp-hero {
          flex: 1; display: flex; align-items: center;
          padding: 28px 0; position: relative; z-index: 10; pointer-events: none;
          gap: 20px;
        }
        .rp-hero-text { flex: 1; min-width: 0; }
        .rp-tagline {
          font-size: 36px; font-weight: 800; color: #fff;
          line-height: 1.18; margin: 0 0 12px; letter-spacing: -0.8px;
        }
        .rp-tagline span { color: #1a73e8; }
        .rp-sub { font-size: 15px; color: #b0b0c8; max-width: 360px; line-height: 1.6; margin: 0; }

        /* Robot */
        .rp-hero-robo {
          flex-shrink: 0; width: 195px; height: 195px;
          position: relative; display: flex; align-items: center; justify-content: center;
        }
        .rp-robo-img {
          width: 190px; height: 190px; object-fit: contain;
          position: relative; z-index: 2;
          animation: rp-robot-float 3.8s ease-in-out infinite;
          filter: drop-shadow(0 0 28px rgba(26,115,232,0.55)) drop-shadow(0 8px 20px rgba(0,0,0,0.5));
        }
        @keyframes rp-robot-float {
          0%, 100% { transform: translateY(0px)  rotate(-1.5deg); }
          50%       { transform: translateY(-13px) rotate(1.5deg); }
        }
        .rp-robo-rings {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .rp-robo-ring {
          position: absolute; border-radius: 50%;
          border: 1px solid rgba(26,115,232,0.35);
        }
        .rp-robo-ring-1 { width: 160px; height: 160px; animation: rp-ring-pulse 3.2s ease-in-out infinite 0s; }
        .rp-robo-ring-2 { width: 200px; height: 200px; animation: rp-ring-pulse 3.2s ease-in-out infinite 0.7s; border-color: rgba(26,115,232,0.2); }
        .rp-robo-ring-3 { width: 240px; height: 240px; animation: rp-ring-pulse 3.2s ease-in-out infinite 1.4s; border-color: rgba(26,115,232,0.1); }
        @keyframes rp-ring-pulse {
          0%, 100% { transform: scale(0.93); opacity: 0.25; }
          50%       { transform: scale(1.07); opacity: 0.7; }
        }
        .rp-robo-orbit {
          position: absolute; width: 200px; height: 200px;
          animation: rp-orbit-spin 6s linear infinite;
        }
        .rp-robo-orbit::after {
          content: ""; position: absolute; top: 0; left: 50%;
          width: 7px; height: 7px; border-radius: 50%;
          background: #1a73e8; transform: translateX(-50%);
          box-shadow: 0 0 8px 3px rgba(26,115,232,0.6);
        }
        @keyframes rp-orbit-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* Highlights */
        .rp-highlights {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
          position: relative; z-index: 10; pointer-events: none;
        }
        .rp-highlight {
          background: linear-gradient(145deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.04) 100%);
          border: 1px solid rgba(255,255,255,0.18);
          border-top-color: rgba(255,255,255,0.3);
          border-bottom-color: rgba(255,255,255,0.06);
          border-radius: 12px; padding: 13px 15px;
          display: flex; align-items: flex-start; gap: 10px;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow:
            0 8px 24px rgba(0,0,0,0.45),
            0 2px 6px rgba(0,0,0,0.3),
            inset 0 1px 0 rgba(255,255,255,0.18),
            inset 0 -1px 0 rgba(0,0,0,0.25);
          transform: translateY(0);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .rp-hi-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .rp-hi-info h4 { font-size: 13px; font-weight: 700; color: #f0f4ff; margin: 0 0 3px; }
        .rp-hi-info p  { font-size: 11px; color: rgba(200,210,235,0.75); margin: 0; line-height: 1.4; }

        /* ══ FORM PANEL ══ */
        .rp-form {
          flex: 0 0 42%; display: flex; align-items: center; justify-content: center;
          padding: 40px 32px; background: #f8fafc; overflow-y: auto;
        }
        .rp-card { width: 100%; max-width: 380px; }
        .rp-logo { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 24px; }
        .rp-logo img { height: 70px; width: auto; object-fit: contain; margin-bottom: 10px; }
        .rp-logo h2 { font-size: 21px; font-weight: 800; color: #2c2c2c; margin: 0 0 4px; }
        .rp-logo p  { font-size: 13px; color: #636363; margin: 0; }
        .rp-m-banner  { display: none; }
        .rp-m-heading { display: none; }
        .rp-field { margin-bottom: 13px; }
        .rp-field label { display: block; font-size: 12px; font-weight: 700; color: #2c2c2c; margin-bottom: 5px; letter-spacing: 0.3px; text-transform: uppercase; }
        .rp-field input { width: 100%; padding: 11px 13px; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 8px; color: #2c2c2c; font-size: 14px; font-family: inherit; transition: border-color 0.2s, box-shadow 0.2s; }
        .rp-field input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.1); outline: none; }
        .rp-hint { font-size: 11px; color: #999; margin-top: 4px; }
        .rp-error { background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626; border-radius: 7px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px; }
        .rp-submit { width: 100%; padding: 13px; background: #1a73e8; color: #fff; border: none; border-radius: 9px; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; margin-top: 4px; transition: background 0.2s, transform 0.1s; box-shadow: 0 4px 12px rgba(26,115,232,0.25); }
        .rp-submit:hover:not(:disabled) { background: #1557b0; transform: translateY(-1px); }
        .rp-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .rp-divider { display: flex; align-items: center; gap: 10px; margin: 18px 0 14px; }
        .rp-divider::before, .rp-divider::after { content: ""; flex: 1; height: 1px; background: #e2e8f0; }
        .rp-divider span { font-size: 11px; color: #999; font-weight: 500; white-space: nowrap; }
        .rp-login-row { text-align: center; font-size: 13px; color: #636363; }
        .rp-login-row a { color: #1a73e8; font-weight: 700; text-decoration: none; }
        .rp-login-row a:hover { text-decoration: underline; }

        @media (min-width: 769px) and (max-width: 1100px) {
          .rp-brand  { flex: 0 0 54%; padding: 36px 32px 32px; }
          .rp-form   { flex: 0 0 46%; padding: 32px 20px; }
          .rp-tagline { font-size: 26px; }
          .rp-sub    { font-size: 13px; }
          .rp-hero   { padding: 18px 0; }
          .rp-robo-img { width: 130px; height: 130px; }
          .rp-hero-robo { width: 140px; height: 140px; }
          .rp-robo-ring-1 { width: 120px; height: 120px; }
          .rp-robo-ring-2 { width: 155px; height: 155px; }
          .rp-robo-ring-3 { width: 190px; height: 190px; }
          .rp-robo-orbit  { width: 155px; height: 155px; }
        }

        @media (max-width: 768px) {
          .rp-root { display: block; background: #0a0a15; }
          .rp-brand { display: none; }
          .rp-form { display: block; min-height: 100vh; width: 100%; padding: 0; background: transparent; overflow-y: visible; }
          .rp-card { max-width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
          .rp-logo { display: none; }
          .rp-m-banner { display: block; background: linear-gradient(160deg, #0a0a15, #111127); padding: 22px 22px 20px; position: relative; overflow: hidden; flex-shrink: 0; }
          .rp-m-constellation { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
          .rp-m-banner-hdr { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; position: relative; z-index: 1; }
          .rp-m-banner-icon { width: 38px; height: 38px; border-radius: 10px; background: none; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: none; }
          .rp-m-banner-hdr h3 { font-size: 15px; font-weight: 800; color: #fff; margin: 0; }
          .rp-m-banner-hdr p  { font-size: 11px; color: #636363; margin: 2px 0 0; }
          /* hero row: text + robot */
          .rp-m-hero-row { display: flex; align-items: center; gap: 10px; position: relative; z-index: 1; margin-bottom: 14px; }
          .rp-m-hero-text { flex: 1; min-width: 0; }
          .rp-m-tagline { font-size: 20px; font-weight: 800; color: #fff; line-height: 1.22; margin: 0 0 5px; }
          .rp-m-tagline span { color: #1a73e8; }
          .rp-m-sub { font-size: 11px; color: #8a8a8a; margin: 0; }
          /* mobile robot */
          .rp-m-robo-wrap { flex-shrink: 0; width: 88px; height: 88px; position: relative; display: flex; align-items: center; justify-content: center; }
          .rp-m-robo-img { width: 72px; height: 72px; object-fit: contain; position: relative; z-index: 2; animation: rp-robot-float 3.8s ease-in-out infinite; filter: drop-shadow(0 0 12px rgba(26,115,232,0.55)) drop-shadow(0 4px 10px rgba(0,0,0,0.5)); }
          .rp-m-robo-rings { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
          .rp-m-robo-ring { position: absolute; border-radius: 50%; border: 1px solid rgba(26,115,232,0.35); }
          .rp-m-robo-ring-1 { width: 66px; height: 66px; animation: rp-ring-pulse 3.2s ease-in-out infinite 0s; }
          .rp-m-robo-ring-2 { width: 88px; height: 88px; animation: rp-ring-pulse 3.2s ease-in-out infinite 0.8s; border-color: rgba(26,115,232,0.18); }
          .rp-m-robo-orbit { position: absolute; width: 88px; height: 88px; animation: rp-orbit-spin 5s linear infinite; }
          .rp-m-robo-orbit::after { content: ""; position: absolute; top: 0; left: 50%; width: 5px; height: 5px; border-radius: 50%; background: #1a73e8; transform: translateX(-50%); box-shadow: 0 0 6px 2px rgba(26,115,232,0.6); }
          .rp-m-highlights { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; position: relative; z-index: 1; margin-top: 0; }
          .rp-m-highlight {
            background: linear-gradient(145deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.04) 100%);
            border: 1px solid rgba(255,255,255,0.18);
            border-top-color: rgba(255,255,255,0.28);
            border-bottom-color: rgba(255,255,255,0.06);
            border-radius: 10px; padding: 9px 10px;
            display: flex; align-items: center; gap: 8px;
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            box-shadow: 0 6px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.2);
          }
          .rp-m-hi-icon { font-size: 16px; flex-shrink: 0; }
          .rp-m-hi-title { font-size: 11px; font-weight: 700; color: #f0f4ff; line-height: 1.2; }
          .rp-m-hi-desc { font-size: 10px; color: rgba(200,210,235,0.7); margin-top: 1px; line-height: 1.3; }
          .rp-m-form-body { flex: 1; background: #f8fafc; border-radius: 20px 20px 0 0; margin-top: -10px; padding: 28px 22px 36px; position: relative; z-index: 2; box-shadow: 0 -4px 20px rgba(0,0,0,0.1); }
          .rp-m-heading { display: block; margin-bottom: 20px; }
          .rp-m-heading h2 { font-size: 20px; font-weight: 800; color: #2c2c2c; margin: 0 0 4px; }
          .rp-m-heading p  { font-size: 13px; color: #636363; margin: 0; }
        }
        @media (max-width: 380px) {
          .rp-m-banner { padding: 22px 18px 20px; }
          .rp-m-form-body { padding: 22px 18px 28px; }
          .rp-m-tagline { font-size: 18px; }
        }
      `}</style>

      <div className="rp-root">

        {/* ── Brand panel ───────────────────────────────────────────────────── */}
        <div
          className="rp-brand"
          ref={containerRef}
        >
          {/* Constellation canvas */}
          <canvas ref={canvasRef} className="rp-constellation" />

          {/* Brand header */}
          <div className="rp-brand-hdr">
            <div className="rp-brand-badge">
              <img src="/images/aitutor 4 schools-dark-bg-cropped.png" alt="AI Tutor 4 Schools" />
            </div>
            <div>
              <h1>AI Tutor <span style={{color:"#f97316"}}>4</span> Schools</h1>
              <p>Powered by SmartAI Tutor</p>
            </div>
          </div>

          {/* Hero: text + robot */}
          <div className="rp-hero">
            <div className="rp-hero-text">
              <h2 className="rp-tagline">
                Start your <span>AI learning journey</span> today
              </h2>
              <p className="rp-sub">
                Join thousands of students getting personalised AI tutoring
                aligned to the UK curriculum.
              </p>
              <div style={{width:52,height:4,borderRadius:3,background:"linear-gradient(90deg,#f97316,#fb923c)",margin:"10px 0 0"}} />
            </div>

            <div className="rp-hero-robo">
              <div className="rp-robo-rings">
                <div className="rp-robo-ring rp-robo-ring-1" />
                <div className="rp-robo-ring rp-robo-ring-2" />
                <div className="rp-robo-ring rp-robo-ring-3" />
                <div className="rp-robo-orbit" />
              </div>
              <img
                src="/images/aitutor 4 schools-dark-bg.png"
                alt="AI Tutor Robot"
                className="rp-robo-img"
                draggable={false}
              />
            </div>
          </div>

          {/* Highlights */}
          <div className="rp-highlights">
            {HIGHLIGHTS.map((h) => (
              <div className="rp-highlight" key={h.title} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"13px 15px"}}>
                <div style={{width:34,height:34,borderRadius:9,background:`${h.color}22`,border:`1px solid ${h.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>
                  {h.icon}
                </div>
                <div className="rp-hi-info" style={{flex:1}}>
                  <h4>{h.title}</h4>
                  <p>{h.desc}</p>
                </div>
                <span style={{fontSize:14,color:"rgba(255,255,255,0.4)",alignSelf:"center",flexShrink:0}}>›</span>
              </div>
            ))}
          </div>

          {/* Brand panel bottom footer bar */}
          <div style={{position:"relative",zIndex:10,display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:"1px solid rgba(255,255,255,0.1)",paddingTop:14,marginTop:8,flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"rgba(255,255,255,0.5)"}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Trusted by schools. Built for students. Backed by AI.
            </div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",display:"flex",alignItems:"center",gap:5}}>
              Proudly supporting schools across the UK <UKFlag />
            </div>
          </div>
        </div>

        {/* ── Form panel ─────────────────────────────────────────────────────── */}
        <div className="rp-form">
          <div className="rp-card">

            <div className="rp-m-banner">
              {/* Mobile constellation */}
              <canvas ref={mobileCanvasRef} className="rp-m-constellation" />

              <div className="rp-m-banner-hdr">
                <div className="rp-m-banner-icon">
                  <img src="/images/aitutor 4 schools-robo.png" alt="AI Tutor 4 Schools" style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 8 }} />
                </div>
                <div>
                  <h3>AI Tutor <span style={{color:"#f97316"}}>4</span> Schools</h3>
                  <p>Powered by SmartAI Tutor</p>
                </div>
              </div>

              {/* Hero row: tagline + robot */}
              <div className="rp-m-hero-row">
                <div className="rp-m-hero-text">
                  <h2 className="rp-m-tagline">
                    Start your <span>AI learning journey</span> today
                  </h2>
                  <p className="rp-m-sub">Join thousands of UK students learning smarter.</p>
                  <div style={{width:52,height:4,borderRadius:3,background:"linear-gradient(90deg,#f97316,#fb923c)",margin:"10px 0 0"}} />
                </div>
                <div className="rp-m-robo-wrap">
                  <div className="rp-m-robo-rings">
                    <div className="rp-m-robo-ring rp-m-robo-ring-1" />
                    <div className="rp-m-robo-ring rp-m-robo-ring-2" />
                    <div className="rp-m-robo-orbit" />
                  </div>
                  <img src="/images/aitutor 4 schools-robo.png" alt="AI Tutor Robot" className="rp-m-robo-img" draggable={false} />
                </div>
              </div>

              {/* Mobile highlights grid */}
              <div className="rp-m-highlights">
                {HIGHLIGHTS.map((h) => (
                  <div className="rp-m-highlight" key={h.title}>
                    <span className="rp-m-hi-icon">{h.icon}</span>
                    <div>
                      <div className="rp-m-hi-title">{h.title}</div>
                      <div className="rp-m-hi-desc">{h.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rp-m-form-body">
              <div className="rp-logo">
                <img src="/images/aitutor 4 schools.png" alt="AI Tutor 4 Schools" />
                <h2>Create Account</h2>
                <p>Join your school's AI tutoring platform</p>
              </div>

              <div className="rp-m-heading">
                <h2>Create Account</h2>
                <p>Join your school's AI tutoring platform</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="rp-field">
                  <label htmlFor="rp-name">Full Name</label>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#94a3b8",display:"flex",alignItems:"center",pointerEvents:"none"}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </span>
                    <input
                      id="rp-name" type="text" value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Johnson"
                      required minLength={2} autoComplete="name"
                      style={{paddingLeft:38}}
                    />
                  </div>
                </div>
                <div className="rp-field">
                  <label htmlFor="rp-email">School Email</label>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#94a3b8",display:"flex",alignItems:"center",pointerEvents:"none"}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    </span>
                    <input
                      id="rp-email" type="email" value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@school.ac.uk"
                      required autoComplete="email"
                      style={{paddingLeft:38}}
                    />
                    {email && email.includes("@") && (
                      <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"#10b981",fontSize:15}}>✓</span>
                    )}
                  </div>
                </div>
                <div className="rp-field">
                  <label htmlFor="rp-password">Password</label>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#94a3b8",display:"flex",alignItems:"center",pointerEvents:"none"}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    <input
                      id="rp-password" type={showPw ? "text" : "password"} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      required minLength={6} autoComplete="new-password"
                      style={{paddingLeft:38,paddingRight:38}}
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#94a3b8",padding:2,display:"flex",alignItems:"center"}}>
                      {showPw
                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                </div>
                <div className="rp-field">
                  <label htmlFor="rp-confirm">Confirm Password</label>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#94a3b8",display:"flex",alignItems:"center",pointerEvents:"none"}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    <input
                      id="rp-confirm" type={showConfirm ? "text" : "password"} value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Repeat your password"
                      required minLength={6} autoComplete="new-password"
                      style={{paddingLeft:38,paddingRight:38}}
                    />
                    <button type="button" onClick={() => setShowConfirm(p => !p)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#94a3b8",padding:2,display:"flex",alignItems:"center"}}>
                      {showConfirm
                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                </div>

                {error && <div className="rp-error">{error}</div>}

                <button className="rp-submit" type="submit" disabled={loading}>
                  {loading ? "Creating account…" : "Create Account →"}
                </button>
              </form>

              <div className="rp-divider"><span>Already have an account?</span></div>

              <p className="rp-login-row">
                <Link to="/login">Sign in to your account →</Link>
              </p>

              <div style={{display:"flex",alignItems:"center",gap:12,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 14px",margin:"14px 0"}}>
                <span style={{fontSize:22,flexShrink:0}}>🎧</span>
                <div style={{fontSize:12,lineHeight:1.5,color:"#475569"}}>
                  <strong style={{color:"#1e293b",fontSize:13,display:"block",marginBottom:2}}>Need help?</strong>
                  Contact your school administrator to get access.
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,margin:"4px 0 10px"}}>
                {TRUST_BADGES.map(b => (
                  <div key={b.title} style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:4,padding:"10px 4px 8px",background:"#fff",border:"1px solid #e2e8f0",borderRadius:10}}>
                    <span style={{fontSize:20}}>{b.icon}</span>
                    <span style={{fontSize:10,fontWeight:700,color:"#1e293b",lineHeight:1.2}}>{b.title}</span>
                    <span style={{fontSize:9,color:"#94a3b8",lineHeight:1.3}}>{b.desc}</span>
                  </div>
                ))}
              </div>

              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"9px 12px",fontSize:11,color:"#166534",fontWeight:600,textAlign:"center",marginTop:4}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Ofsted-ready. GDPR compliant. Used and trusted by schools across the UK
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
