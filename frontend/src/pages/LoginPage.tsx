import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// ── Physics item ───────────────────────────────────────────────────────────────
interface PhysItem {
  id: number;
  emoji: string;
  label: string;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  angVel: number;
  floatPhase: number;
  floatAmp: number;
  floatSpeed: number;
  popScale: number;
  popDecay: number;
}

const ITEMS_CFG = [
  { id: 1,  emoji: "📚", label: "Books",   size: 38, xPct: 7,  yPct: 12 },
  { id: 2,  emoji: "✏️", label: "Write",   size: 32, xPct: 54, yPct: 8  },
  { id: 3,  emoji: "🧠", label: "Brain",   size: 42, xPct: 78, yPct: 18 },
  { id: 4,  emoji: "⭐", label: "Star",    size: 36, xPct: 28, yPct: 30 },
  { id: 5,  emoji: "🎯", label: "Goal",    size: 32, xPct: 66, yPct: 42 },
  { id: 6,  emoji: "💡", label: "Idea",    size: 36, xPct: 10, yPct: 55 },
  { id: 7,  emoji: "🔬", label: "Science", size: 32, xPct: 46, yPct: 64 },
  { id: 8,  emoji: "🏆", label: "Trophy",  size: 40, xPct: 82, yPct: 60 },
  { id: 9,  emoji: "🎲", label: "Play",    size: 32, xPct: 22, yPct: 78 },
  { id: 10, emoji: "🚀", label: "Launch",  size: 38, xPct: 60, yPct: 82 },
  { id: 11, emoji: "🧮", label: "Maths",   size: 34, xPct: 38, yPct: 47 },
  { id: 12, emoji: "🎨", label: "Art",     size: 32, xPct: 72, yPct: 74 },
];

const ROLE_CARDS = [
  { icon: "🎓", role: "Student",  desc: "AI-powered lessons aligned to your curriculum" },
  { icon: "📋", role: "Teacher",  desc: "Upload resources and monitor AI session reports" },
  { icon: "👨‍👩‍👧", role: "Parent",   desc: "Book sessions and track your child's progress" },
  { icon: "🛡️", role: "Admin",    desc: "Manage school settings, users and knowledge base" },
];

const FRICTION = 0.93;
const BOUNCE   = 0.52;
const ANG_FRICTION = 0.90;
const MAX_VEL = 20;

export default function LoginPage() {
  const { login } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const containerRef  = useRef<HTMLDivElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const itemDivsRef   = useRef<Map<number, HTMLDivElement>>(new Map());
  const physRef       = useRef<PhysItem[]>([]);
  const rafRef        = useRef<number>(0);
  const consRafRef    = useRef<number>(0);
  const frameRef      = useRef<number>(0);

  const dragRef = useRef<{
    id: number;
    offsetX: number;
    offsetY: number;
    vxSamples: number[];
    vySamples: number[];
    lastX: number;
    lastY: number;
  } | null>(null);

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

  // ── Apply transforms directly to DOM ─────────────────────────────────────────
  const flushTransforms = () => {
    for (const item of physRef.current) {
      const el = itemDivsRef.current.get(item.id);
      if (!el) continue;
      const speed   = Math.sqrt(item.vx ** 2 + item.vy ** 2);
      const isDrag  = dragRef.current?.id === item.id;
      const stretchX = isDrag ? 1.0 : Math.max(0.7, 1 - speed * 0.018);
      const stretchY = isDrag ? 1.0 : Math.min(1.35, 1 + speed * 0.022);
      const glow     = Math.min(speed * 2.5, 22);
      const ps       = item.popScale;

      el.style.left      = `${item.x}px`;
      el.style.top       = `${item.y}px`;
      el.style.transform = `rotate(${item.rot}deg) scale(${(isDrag ? 1.38 : stretchX) * ps}, ${(isDrag ? 1.38 : stretchY) * ps})`;
      el.style.filter    = speed > 1.2
        ? `drop-shadow(0 0 ${glow}px rgba(26,115,232,0.85))`
        : isDrag
          ? "drop-shadow(0 10px 24px rgba(26,115,232,0.9)) brightness(1.3)"
          : "";
    }
  };

  // ── Physics loop ─────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const tick = () => {
      frameRef.current++;
      const container = containerRef.current;
      if (!container) { rafRef.current = requestAnimationFrame(tick); return; }
      const W = container.clientWidth;
      const H = container.clientHeight;

      const items = physRef.current;
      for (const item of items) {
        if (dragRef.current?.id === item.id) continue;

        const itemW = item.size + 28;
        const itemH = item.size + 40;
        const speed = Math.sqrt(item.vx ** 2 + item.vy ** 2);

        if (speed < 0.6) {
          item.floatPhase += item.floatSpeed;
          item.vx += Math.cos(item.floatPhase * 0.73) * 0.014;
          item.vy += Math.sin(item.floatPhase) * 0.018;
          item.angVel += Math.sin(item.floatPhase * 1.4) * 0.012;
        }

        item.x   += item.vx;
        item.y   += item.vy;
        item.rot += item.angVel;

        item.vx    *= FRICTION;
        item.vy    *= FRICTION;
        item.angVel *= ANG_FRICTION;

        if (item.x < 0)           { item.x = 0;           item.vx =  Math.abs(item.vx) * BOUNCE; item.angVel *= -0.6; }
        if (item.x > W - itemW)   { item.x = W - itemW;   item.vx = -Math.abs(item.vx) * BOUNCE; item.angVel *= -0.6; }
        if (item.y < 0)           { item.y = 0;           item.vy =  Math.abs(item.vy) * BOUNCE; }
        if (item.y > H - itemH)   { item.y = H - itemH;   item.vy = -Math.abs(item.vy) * BOUNCE; item.angVel *= -0.7; }

        if (item.popScale !== 1) {
          item.popScale += (1 - item.popScale) * item.popDecay;
          if (Math.abs(item.popScale - 1) < 0.005) item.popScale = 1;
        }
      }

      if (frameRef.current % 2 === 0) {
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            const ra = (a.size / 2) + 14;
            const rb = (b.size / 2) + 14;
            const ax = a.x + ra, ay = a.y + ra;
            const bx = b.x + rb, by = b.y + rb;
            const dx = bx - ax, dy = by - ay;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minD = ra + rb;
            if (dist < minD && dist > 0.01) {
              const nx = dx / dist, ny = dy / dist;
              const overlap = (minD - dist) * 0.55;
              a.x -= nx * overlap; a.y -= ny * overlap;
              b.x += nx * overlap; b.y += ny * overlap;
              const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
              const dot = dvx * nx + dvy * ny;
              if (dot > 0) {
                const imp = dot * 0.65;
                a.vx -= imp * nx; a.vy -= imp * ny;
                b.vx += imp * nx; b.vy += imp * ny;
                a.angVel += (dvy * nx - dvx * ny) * 0.55;
                b.angVel -= (dvy * nx - dvx * ny) * 0.55;
                a.popScale = 1.22; a.popDecay = 0.18;
                b.popScale = 1.22; b.popDecay = 0.18;
              }
            }
          }
        }
      }

      flushTransforms();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Init ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const W = container.clientWidth;
    const H = container.clientHeight;

    physRef.current = ITEMS_CFG.map((cfg) => ({
      ...cfg,
      x: (cfg.xPct / 100) * W,
      y: (cfg.yPct / 100) * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      rot: (Math.random() - 0.5) * 28,
      angVel: (Math.random() - 0.5) * 0.4,
      floatPhase: Math.random() * Math.PI * 2,
      floatAmp:   2 + Math.random() * 3,
      floatSpeed: 0.007 + Math.random() * 0.007,
      popScale:   0.1,
      popDecay:   0.12,
    }));

    physRef.current.forEach((item, idx) => {
      setTimeout(() => { item.popScale = 1.55; item.popDecay = 0.15; }, idx * 60);
    });

    flushTransforms();
    startLoop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [startLoop]);

  // ── Pointer handlers ──────────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: number) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const item = physRef.current.find((it) => it.id === id)!;
    dragRef.current = {
      id,
      offsetX: (e.clientX - rect.left) - item.x,
      offsetY: (e.clientY - rect.top)  - item.y,
      vxSamples: [],
      vySamples: [],
      lastX: e.clientX,
      lastY: e.clientY,
    };
    item.popScale = 1.18;
    item.popDecay = 0.2;
    const el = itemDivsRef.current.get(id);
    if (el) el.style.zIndex = "100";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const { id, offsetX, offsetY, vxSamples, vySamples, lastX, lastY } = dragRef.current;
    const item = physRef.current.find((it) => it.id === id)!;
    const itemW = item.size + 28;
    const itemH = item.size + 40;

    const nx = Math.max(0, Math.min(rect.width  - itemW, (e.clientX - rect.left) - offsetX));
    const ny = Math.max(0, Math.min(rect.height - itemH, (e.clientY - rect.top)  - offsetY));

    vxSamples.push(e.clientX - lastX);
    vySamples.push(e.clientY - lastY);
    if (vxSamples.length > 7) vxSamples.shift();
    if (vySamples.length > 7) vySamples.shift();
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;

    const latestVx = vxSamples[vxSamples.length - 1] ?? 0;
    item.x    = nx;
    item.y    = ny;
    item.rot += latestVx * 0.35;
  };

  const releaseDrag = () => {
    if (!dragRef.current) return;
    const { id, vxSamples, vySamples } = dragRef.current;
    const item = physRef.current.find((it) => it.id === id)!;

    const avgVx = vxSamples.length ? vxSamples.reduce((a, b) => a + b, 0) / vxSamples.length : 0;
    const avgVy = vySamples.length ? vySamples.reduce((a, b) => a + b, 0) / vySamples.length : 0;

    item.vx     = Math.max(-MAX_VEL, Math.min(MAX_VEL, avgVx * 1.6));
    item.vy     = Math.max(-MAX_VEL, Math.min(MAX_VEL, avgVy * 1.6));
    item.angVel = avgVx * 0.85;
    item.popScale = 1.15;
    item.popDecay = 0.17;

    const el = itemDivsRef.current.get(id);
    if (el) el.style.zIndex = "5";
    dragRef.current = null;
  };

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
          width: 50px; height: 50px; border-radius: 13px; background: #1a73e8;
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; flex-shrink: 0; box-shadow: 0 4px 18px rgba(26,115,232,0.45);
        }
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
        .lp-hint {
          margin-top: 14px; display: flex; align-items: center; gap: 7px;
          font-size: 12px; color: rgba(255,255,255,0.35);
        }
        .lp-hint-dot {
          width: 7px; height: 7px; border-radius: 50%; background: #1a73e8; flex-shrink: 0;
          animation: lp-pulse 1.6s ease-in-out infinite;
        }
        @keyframes lp-pulse { 0%,100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.5); } }

        /* Robot illustration */
        .lp-hero-robo {
          flex-shrink: 0; width: 195px; height: 195px;
          position: relative; display: flex; align-items: center; justify-content: center;
        }
        .lp-robo-img {
          width: 175px; height: 175px; object-fit: contain;
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
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px; padding: 13px 15px;
          display: flex; align-items: flex-start; gap: 10px;
          transition: background 0.2s, border-color 0.2s;
        }
        .lp-role-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .lp-role-info h4 { font-size: 13px; font-weight: 700; color: #e2e8f0; margin: 0 0 2px; }
        .lp-role-info p  { font-size: 11px; color: #636363; margin: 0; line-height: 1.4; }

        /* ══ PHYSICS ITEMS ══ */
        .lp-drag-item {
          position: absolute;
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          cursor: grab; touch-action: none;
          border-radius: 14px; padding: 6px 8px;
          will-change: transform, left, top, filter;
          z-index: 5;
        }
        .lp-drag-item:hover { filter: drop-shadow(0 0 16px rgba(26,115,232,0.75)) !important; }
        .lp-drag-item:active { cursor: grabbing; }
        .lp-drag-emoji { line-height: 1; display: block; pointer-events: none; transition: transform 0.12s; }
        .lp-drag-item:hover .lp-drag-emoji { transform: scale(1.18); }
        .lp-drag-label {
          font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.6);
          text-transform: uppercase; letter-spacing: 0.6px;
          user-select: none; pointer-events: none; white-space: nowrap;
        }

        /* ══ FORM PANEL ══ */
        .lp-form { flex: 0 0 42%; display: flex; align-items: center; justify-content: center; padding: 40px 32px; background: #f5f5f0; }
        .lp-card { width: 100%; max-width: 380px; }
        .lp-logo { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 28px; }
        .lp-logo img { width: 60px; height: 60px; object-fit: contain; margin-bottom: 12px; }
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
          .lp-role-info p { display: none; }
        }
        @media (max-width: 768px) {
          .lp-root { display: block; background: #0a0a15; }
          .lp-brand { display: none; }
          .lp-form { display: block; min-height: 100vh; padding: 0; background: transparent; }
          .lp-card { max-width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
          .lp-logo { display: none; }
          .lp-m-banner { display: block; background: linear-gradient(160deg, #0a0a15, #111127); padding: 28px 22px 26px; position: relative; overflow: hidden; flex-shrink: 0; }
          .lp-m-banner::before { content: ""; position: absolute; top: -50px; right: -50px; width: 200px; height: 200px; border-radius: 50%; background: radial-gradient(circle, rgba(26,115,232,0.2) 0%, transparent 70%); pointer-events: none; }
          .lp-m-banner-hdr { display: flex; align-items: center; gap: 11px; margin-bottom: 18px; position: relative; z-index: 1; }
          .lp-m-banner-icon { width: 40px; height: 40px; border-radius: 10px; background: #1a73e8; display: flex; align-items: center; justify-content: center; font-size: 19px; flex-shrink: 0; box-shadow: 0 3px 10px rgba(26,115,232,0.4); }
          .lp-m-banner-hdr h3 { font-size: 15px; font-weight: 800; color: #fff; margin: 0; }
          .lp-m-banner-hdr p  { font-size: 11px; color: #636363; margin: 2px 0 0; }
          .lp-m-tagline { font-size: 22px; font-weight: 800; color: #fff; line-height: 1.22; margin: 0 0 6px; position: relative; z-index: 1; }
          .lp-m-tagline span { color: #1a73e8; }
          .lp-m-sub { font-size: 12px; color: #8a8a8a; margin: 0 0 16px; position: relative; z-index: 1; }
          .lp-m-chips { display: flex; flex-wrap: wrap; gap: 6px; position: relative; z-index: 1; }
          .lp-m-chip { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 600; color: #b8b8b8; display: flex; align-items: center; gap: 4px; }
          .lp-m-form-body { flex: 1; background: #f5f5f0; border-radius: 20px 20px 0 0; margin-top: -12px; padding: 28px 22px 36px; position: relative; z-index: 2; box-shadow: 0 -4px 20px rgba(0,0,0,0.1); }
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
          onPointerMove={onPointerMove}
          onPointerUp={releaseDrag}
          onPointerLeave={releaseDrag}
        >
          {/* Constellation canvas — z-index 1, behind everything */}
          <canvas ref={canvasRef} className="lp-constellation" />

          {/* Physics draggable items — z-index 5 */}
          {ITEMS_CFG.map((cfg) => (
            <div
              key={cfg.id}
              className="lp-drag-item"
              ref={(el) => {
                if (el) itemDivsRef.current.set(cfg.id, el);
                else itemDivsRef.current.delete(cfg.id);
              }}
              onPointerDown={(e) => onPointerDown(e, cfg.id)}
            >
              <span className="lp-drag-emoji" style={{ fontSize: cfg.size }}>{cfg.emoji}</span>
              <span className="lp-drag-label">{cfg.label}</span>
            </div>
          ))}

          {/* Brand header — z-index 10 */}
          <div className="lp-brand-hdr">
            <div className="lp-brand-badge">🤖</div>
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
              <p className="lp-hint">
                <span className="lp-hint-dot" />
                Throw the items — they bounce!
              </p>
            </div>

            {/* Robot illustration */}
            <div className="lp-hero-robo">
              <div className="lp-robo-rings">
                <div className="lp-robo-ring lp-robo-ring-1" />
                <div className="lp-robo-ring lp-robo-ring-2" />
                <div className="lp-robo-ring lp-robo-ring-3" />
                <div className="lp-robo-orbit" />
              </div>
              <img
                src="/Original-Logo.png"
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
              <div className="lp-m-banner-hdr">
                <div className="lp-m-banner-icon">🤖</div>
                <div>
                  <h3>AI Tutor 4 Schools</h3>
                  <p>Powered by SmartAI Tutor</p>
                </div>
              </div>
              <h2 className="lp-m-tagline">
                Personalised AI tutoring{" "}
                <span>for the UK curriculum</span>
              </h2>
              <p className="lp-m-sub">AI-powered learning, personalised for every student.</p>
              <div className="lp-m-chips">
                {ROLE_CARDS.map((c) => (
                  <span className="lp-m-chip" key={c.role}>{c.icon} {c.role}</span>
                ))}
              </div>
            </div>

            <div className="lp-m-form-body">
              <div className="lp-logo">
                <img src="/Original-Logo.png" alt="SmartAI Tutor" />
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
