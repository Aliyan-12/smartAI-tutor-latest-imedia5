import { useState, useRef, useEffect, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ROLE_CARDS = [
  { icon: "🎓", role: "Student",  desc: "AI-powered lessons aligned to your curriculum" },
  { icon: "📋", role: "Teacher",  desc: "Upload resources and monitor AI session reports" },
  { icon: "👨‍👩‍👧", role: "Parent",   desc: "Book sessions and track your child's progress" },
  { icon: "🛡️", role: "Admin",    desc: "Manage school settings, users and knowledge base" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

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

      // Lines between nearby stars
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

      // Star dots
      for (const s of stars) {
        // Outer glow
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3);
        g.addColorStop(0, `rgba(130,180,255,${s.opacity})`);
        g.addColorStop(1, "rgba(130,180,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
        ctx.fill();
        // Core dot
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

  // ── Login ─────────────────────────────────────────────────────────────────────
  const handleSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError("");
    setLoading(true);
    try   { await login(email, password); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }

        .lp-root {
          display: flex; min-height: 100vh;
          font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f5f5f0;
        }

        /* ══ BRAND PANEL ══ */
        .lp-brand {
          flex: 0 0 58%;
          background: linear-gradient(160deg, #0a0a15 0%, #111127 50%, #0d1a2e 100%);
          display: flex; flex-direction: column; justify-content: space-between;
          padding: 48px 56px 40px; position: relative; overflow: hidden;
          user-select: none;
        }
        .lp-brand::before {
          content: ""; position: absolute; top: -120px; right: -100px;
          width: 420px; height: 420px; border-radius: 50%;
          background: radial-gradient(circle, rgba(26,115,232,0.18) 0%, transparent 68%);
          pointer-events: none;
        }
        .lp-brand::after {
          content: ""; position: absolute; bottom: -80px; left: -60px;
          width: 320px; height: 320px; border-radius: 50%;
          background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 68%);
          pointer-events: none;
        }

        /* Constellation canvas */
        .lp-constellation {
          position: absolute; inset: 0; width: 100%; height: 100%;
          pointer-events: none; z-index: 1;
        }

        /* Header */
        .lp-brand-hdr { display: flex; align-items: center; gap: 14px; position: relative; z-index: 10; pointer-events: none; }
        .lp-brand-badge {
          width: auto; height: 48px; border-radius: 0; background: none; box-shadow: none;
          display: flex; align-items: center;
        }
        .lp-brand-badge img { height: 48px; width: auto; object-fit: contain; }
        .lp-brand-hdr h1 { font-size: 19px; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.2px; }
        .lp-brand-hdr p  { font-size: 12px; color: #636363; margin: 2px 0 0; }

        /* Hero — text + robot row */
        .lp-hero {
          flex: 1; display: flex; align-items: center;
          padding: 28px 0; position: relative; z-index: 10; pointer-events: none;
          gap: 20px;
        }
        .lp-hero-text { flex: 1; min-width: 0; }
        .lp-tagline { font-size: 36px; font-weight: 800; color: #fff; line-height: 1.18; margin: 0 0 12px; letter-spacing: -0.8px; }
        .lp-tagline span { color: #1a73e8; }
        .lp-sub { font-size: 15px; color: #b0b0c8; max-width: 360px; line-height: 1.6; margin: 0; }

        /* Robot illustration */
        .lp-hero-robo {
          flex-shrink: 0; width: 195px; height: 195px;
          position: relative; display: flex; align-items: center; justify-content: center;
        }
        .lp-robo-img {
          width: 190px; height: 190px; object-fit: contain;
          position: relative; z-index: 2;
          animation: lp-robot-float 3.8s ease-in-out infinite;
          filter: drop-shadow(0 0 28px rgba(26,115,232,0.55)) drop-shadow(0 8px 20px rgba(0,0,0,0.5));
        }
        @keyframes lp-robot-float {
          0%, 100% { transform: translateY(0px)  rotate(-1.5deg); }
          50%       { transform: translateY(-13px) rotate(1.5deg); }
        }
        /* Pulsing rings around robot */
        .lp-robo-rings {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .lp-robo-ring {
          position: absolute; border-radius: 50%;
          border: 1px solid rgba(26,115,232,0.35);
        }
        .lp-robo-ring-1 { width: 160px; height: 160px; animation: lp-ring-pulse 3.2s ease-in-out infinite 0s; }
        .lp-robo-ring-2 { width: 200px; height: 200px; animation: lp-ring-pulse 3.2s ease-in-out infinite 0.7s; border-color: rgba(26,115,232,0.2); }
        .lp-robo-ring-3 { width: 240px; height: 240px; animation: lp-ring-pulse 3.2s ease-in-out infinite 1.4s; border-color: rgba(26,115,232,0.1); }
        @keyframes lp-ring-pulse {
          0%, 100% { transform: scale(0.93); opacity: 0.25; }
          50%       { transform: scale(1.07); opacity: 0.7; }
        }
        /* Orbiting dot */
        .lp-robo-orbit {
          position: absolute; width: 200px; height: 200px;
          animation: lp-orbit-spin 6s linear infinite;
        }
        .lp-robo-orbit::after {
          content: ""; position: absolute; top: 0; left: 50%;
          width: 7px; height: 7px; border-radius: 50%;
          background: #1a73e8; transform: translateX(-50%);
          box-shadow: 0 0 8px 3px rgba(26,115,232,0.6);
        }
        @keyframes lp-orbit-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* Role cards */
        .lp-role-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; position: relative; z-index: 10; pointer-events: none; }
        .lp-role-card {
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
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .lp-role-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .lp-role-info h4 { font-size: 13px; font-weight: 700; color: #f0f4ff; margin: 0 0 3px; }
        .lp-role-info p  { font-size: 11px; color: rgba(200,210,235,0.75); margin: 0; line-height: 1.4; }

        /* ══ FORM PANEL ══ */
        .lp-form { flex: 0 0 42%; display: flex; align-items: center; justify-content: center; padding: 40px 32px; background: #f5f5f0; }
        .lp-card { width: 100%; max-width: 380px; }
        .lp-logo { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 28px; }
        .lp-logo img { height: 70px; width: auto; object-fit: contain; margin-bottom: 12px; }
        .lp-logo h2 { font-size: 22px; font-weight: 800; color: #2c2c2c; margin: 0 0 4px; }
        .lp-logo p  { font-size: 13px; color: #636363; margin: 0; }
        .lp-m-banner  { display: none; }
        .lp-m-heading { display: none; }
        .lp-field { margin-bottom: 14px; }
        .lp-field label { display: block; font-size: 12px; font-weight: 700; color: #2c2c2c; margin-bottom: 5px; letter-spacing: 0.3px; text-transform: uppercase; }
        .lp-field input { width: 100%; padding: 11px 13px; background: #fff; border: 1.5px solid #d9d9cf; border-radius: 8px; color: #2c2c2c; font-size: 14px; font-family: inherit; transition: border-color 0.2s, box-shadow 0.2s; }
        .lp-field input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.1); outline: none; }
        .lp-field-meta { display: flex; justify-content: flex-end; margin-top: 5px; }
        .lp-forgot { font-size: 12px; color: #1a73e8; text-decoration: none; font-weight: 600; }
        .lp-forgot:hover { text-decoration: underline; }
        .lp-error { background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626; border-radius: 7px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px; }
        .lp-submit { width: 100%; padding: 13px; background: #1a73e8; color: #fff; border: none; border-radius: 9px; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; margin-top: 4px; transition: background 0.2s, transform 0.1s; box-shadow: 0 4px 12px rgba(26,115,232,0.25); }
        .lp-submit:hover:not(:disabled) { background: #1557b0; transform: translateY(-1px); }
        .lp-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .lp-divider { display: flex; align-items: center; gap: 10px; margin: 20px 0 16px; }
        .lp-divider::before, .lp-divider::after { content: ""; flex: 1; height: 1px; background: #d9d9cf; }
        .lp-divider span { font-size: 11px; color: #999; font-weight: 500; white-space: nowrap; }
        .lp-register-row { text-align: center; font-size: 13px; color: #636363; margin-bottom: 10px; }
        .lp-register-row a { color: #1a73e8; font-weight: 700; text-decoration: none; }
        .lp-register-row a:hover { text-decoration: underline; }
        .lp-contact { text-align: center; font-size: 12px; color: #999; line-height: 1.5; }

        @media (min-width: 769px) and (max-width: 1100px) {
          .lp-brand { flex: 0 0 54%; padding: 36px 32px 32px; }
          .lp-form  { flex: 0 0 46%; padding: 32px 20px; }
          .lp-tagline { font-size: 26px; }
          .lp-sub { font-size: 13px; }
          .lp-hero { padding: 18px 0; }
          .lp-robo-img { width: 130px; height: 130px; }
          .lp-hero-robo { width: 140px; height: 140px; }
          .lp-robo-ring-1 { width: 120px; height: 120px; }
          .lp-robo-ring-2 { width: 155px; height: 155px; }
          .lp-robo-ring-3 { width: 190px; height: 190px; }
          .lp-robo-orbit  { width: 155px; height: 155px; }
          .lp-role-cards  { gap: 8px; }
        }
        @media (max-width: 768px) {
          .lp-root { display: block; background: #0a0a15; }
          .lp-brand { display: none; }
          .lp-form { display: block; min-height: 100vh; padding: 0; background: transparent; }
          .lp-card { max-width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
          .lp-logo { display: none; }
          .lp-m-banner { display: flex; flex-direction: column; background: linear-gradient(160deg, #0a0a15 0%, #111127 55%, #0d1a2e 100%); padding: 22px 22px 20px; position: relative; overflow: hidden; flex-shrink: 0; }
          .lp-m-constellation { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
          .lp-m-banner-hdr { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; position: relative; z-index: 1; }
          .lp-m-banner-icon { width: 38px; height: 38px; border-radius: 10px; background: none; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: none; }
          .lp-m-banner-hdr h3 { font-size: 15px; font-weight: 800; color: #fff; margin: 0; }
          .lp-m-banner-hdr p  { font-size: 11px; color: #636363; margin: 2px 0 0; }
          /* hero row: text + robot side by side */
          .lp-m-hero-row { display: flex; align-items: center; gap: 10px; position: relative; z-index: 1; margin-bottom: 14px; }
          .lp-m-hero-text { flex: 1; min-width: 0; }
          .lp-m-tagline { font-size: 20px; font-weight: 800; color: #fff; line-height: 1.22; margin: 0 0 5px; }
          .lp-m-tagline span { color: #1a73e8; }
          .lp-m-sub { font-size: 11px; color: #8a8a8a; margin: 0; }
          /* mobile robot */
          .lp-m-robo-wrap { flex-shrink: 0; width: 88px; height: 88px; position: relative; display: flex; align-items: center; justify-content: center; }
          .lp-m-robo-img { width: 72px; height: 72px; object-fit: contain; position: relative; z-index: 2; animation: lp-robot-float 3.8s ease-in-out infinite; filter: drop-shadow(0 0 12px rgba(26,115,232,0.55)) drop-shadow(0 4px 10px rgba(0,0,0,0.5)); }
          .lp-m-robo-rings { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
          .lp-m-robo-ring { position: absolute; border-radius: 50%; border: 1px solid rgba(26,115,232,0.35); }
          .lp-m-robo-ring-1 { width: 66px; height: 66px; animation: lp-ring-pulse 3.2s ease-in-out infinite 0s; }
          .lp-m-robo-ring-2 { width: 88px; height: 88px; animation: lp-ring-pulse 3.2s ease-in-out infinite 0.8s; border-color: rgba(26,115,232,0.18); }
          .lp-m-robo-orbit { position: absolute; width: 88px; height: 88px; animation: lp-orbit-spin 5s linear infinite; }
          .lp-m-robo-orbit::after { content: ""; position: absolute; top: 0; left: 50%; width: 5px; height: 5px; border-radius: 50%; background: #1a73e8; transform: translateX(-50%); box-shadow: 0 0 6px 2px rgba(26,115,232,0.6); }
          .lp-m-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; position: relative; z-index: 1; }
          .lp-m-chip {
            background: linear-gradient(145deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.04) 100%);
            border: 1px solid rgba(255,255,255,0.18);
            border-top-color: rgba(255,255,255,0.28);
            border-bottom-color: rgba(255,255,255,0.06);
            border-radius: 10px; padding: 9px 10px;
            display: flex; align-items: center; gap: 8px;
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            box-shadow: 0 6px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.2);
          }
          .lp-m-chip-icon { font-size: 16px; flex-shrink: 0; }
          .lp-m-chip-title { font-size: 11px; font-weight: 700; color: #f0f4ff; line-height: 1.2; }
          .lp-m-chip-desc { font-size: 10px; color: rgba(200,210,235,0.7); margin-top: 1px; line-height: 1.3; }
          .lp-m-form-body { flex: 1; background: #f5f5f0; border-radius: 20px 20px 0 0; margin-top: -10px; padding: 28px 22px 36px; position: relative; z-index: 2; box-shadow: 0 -4px 20px rgba(0,0,0,0.1); }
          .lp-m-heading { display: block; margin-bottom: 22px; }
          .lp-m-heading h2 { font-size: 20px; font-weight: 800; color: #2c2c2c; margin: 0 0 4px; }
          .lp-m-heading p  { font-size: 13px; color: #636363; margin: 0; }
        }
        @media (max-width: 380px) {
          .lp-m-banner { padding: 22px 18px 20px; }
          .lp-m-form-body { padding: 22px 18px 28px; }
          .lp-m-tagline { font-size: 19px; }
        }
      `}</style>

      <div className="lp-root">

        {/* ── Brand panel ───────────────────────────────────────────────────── */}
        <div
          className="lp-brand"
          ref={containerRef}
        >
          {/* Constellation canvas — z-index 1, behind everything */}
          <canvas ref={canvasRef} className="lp-constellation" />

          {/* Brand header — z-index 10 */}
          <div className="lp-brand-hdr">
            <div className="lp-brand-badge">
              <img src="/images/aitutor 4 schools.png" alt="AI Tutor 4 Schools" />
            </div>
            <div>
              <h1>AI Tutor 4 Schools</h1>
              <p>Powered by SmartAI Tutor</p>
            </div>
          </div>

          {/* Hero: text left, robot right */}
          <div className="lp-hero">
            <div className="lp-hero-text">
              <h2 className="lp-tagline">
                Personalised AI tutoring{" "}
                <span>aligned to the UK curriculum</span>
              </h2>
              <p className="lp-sub">
                Your school's AI-powered learning platform — helping every
                student reach their full potential, at their own pace.
              </p>
            </div>

            {/* Logo illustration */}
            <div className="lp-hero-robo">
              <div className="lp-robo-rings">
                <div className="lp-robo-ring lp-robo-ring-1" />
                <div className="lp-robo-ring lp-robo-ring-2" />
                <div className="lp-robo-ring lp-robo-ring-3" />
                <div className="lp-robo-orbit" />
              </div>
              <img
                src="/images/aitutor 4 schools-robo.png"
                alt="AI Tutor Robot"
                className="lp-robo-img"
                draggable={false}
              />
            </div>
          </div>

          {/* Role cards */}
          <div className="lp-role-cards">
            {ROLE_CARDS.map((card) => (
              <div className="lp-role-card" key={card.role}>
                <span className="lp-role-icon">{card.icon}</span>
                <div className="lp-role-info">
                  <h4>{card.role}</h4>
                  <p>{card.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Form panel ─────────────────────────────────────────────────────── */}
        <div className="lp-form">
          <div className="lp-card">

            <div className="lp-m-banner">
              {/* Mobile constellation */}
              <canvas ref={mobileCanvasRef} className="lp-m-constellation" />

              <div className="lp-m-banner-hdr">
                <div className="lp-m-banner-icon">
                  <img src="/images/aitutor 4 schools.png" alt="AI Tutor 4 Schools" style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 8 }} />
                </div>
                <div>
                  <h3>AI Tutor 4 Schools</h3>
                  <p>Powered by SmartAI Tutor</p>
                </div>
              </div>

              {/* Hero row: tagline + robot */}
              <div className="lp-m-hero-row">
                <div className="lp-m-hero-text">
                  <h2 className="lp-m-tagline">
                    Personalised AI tutoring{" "}
                    <span>for the UK curriculum</span>
                  </h2>
                  <p className="lp-m-sub">AI-powered learning, personalised for every student.</p>
                </div>
                <div className="lp-m-robo-wrap">
                  <div className="lp-m-robo-rings">
                    <div className="lp-m-robo-ring lp-m-robo-ring-1" />
                    <div className="lp-m-robo-ring lp-m-robo-ring-2" />
                    <div className="lp-m-robo-orbit" />
                  </div>
                  <img src="/images/aitutor 4 schools-robo.png" alt="AI Tutor Robot" className="lp-m-robo-img" draggable={false} />
                </div>
              </div>

              <div className="lp-m-chips">
                {ROLE_CARDS.map((c) => (
                  <div className="lp-m-chip" key={c.role}>
                    <span className="lp-m-chip-icon">{c.icon}</span>
                    <div>
                      <div className="lp-m-chip-title">{c.role}</div>
                      <div className="lp-m-chip-desc">{c.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lp-m-form-body">
              <div className="lp-logo">
                <img src="/images/aitutor 4 schools.png" alt="AI Tutor 4 Schools" />
                <h2>Welcome Back!</h2>
                <p>Sign in to your learning platform</p>
              </div>

              <div className="lp-m-heading">
                <h2>Welcome Back!</h2>
                <p>Sign in to your learning platform</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="lp-field">
                  <label htmlFor="lp-email">Email address</label>
                  <input
                    id="lp-email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.ac.uk"
                    required autoComplete="email"
                  />
                </div>
                <div className="lp-field">
                  <label htmlFor="lp-password">Password</label>
                  <input
                    id="lp-password" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    required minLength={6} autoComplete="current-password"
                  />
                  <div className="lp-field-meta">
                    <a href="#" className="lp-forgot">Forgot password?</a>
                  </div>
                </div>

                {error && <div className="lp-error">{error}</div>}

                <button className="lp-submit" type="submit" disabled={loading}>
                  {loading ? "Signing in…" : "Sign In →"}
                </button>
              </form>

              <div className="lp-divider"><span>New to the platform?</span></div>

              <p className="lp-register-row">
                New student? <Link to="/register">Create your account</Link>
              </p>
              <p className="lp-contact">
                Don't have an account?<br />
                Contact your school administrator to get access.
              </p>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
