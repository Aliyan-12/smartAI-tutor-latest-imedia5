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
  floatSpeed: number;
  popScale: number;
  popDecay: number;
}

const ITEMS_CFG = [
  { id: 1,  emoji: "🎓", label: "Learn",   size: 38, xPct: 6,  yPct: 10 },
  { id: 2,  emoji: "✏️", label: "Write",   size: 32, xPct: 52, yPct: 7  },
  { id: 3,  emoji: "📊", label: "Stats",   size: 36, xPct: 76, yPct: 16 },
  { id: 4,  emoji: "⭐", label: "XP",      size: 34, xPct: 25, yPct: 28 },
  { id: 5,  emoji: "🔬", label: "Science", size: 32, xPct: 64, yPct: 40 },
  { id: 6,  emoji: "💡", label: "Idea",    size: 36, xPct: 9,  yPct: 52 },
  { id: 7,  emoji: "📚", label: "Books",   size: 32, xPct: 44, yPct: 62 },
  { id: 8,  emoji: "🏆", label: "Trophy",  size: 40, xPct: 80, yPct: 56 },
  { id: 9,  emoji: "🎯", label: "Goal",    size: 32, xPct: 20, yPct: 76 },
  { id: 10, emoji: "🚀", label: "Launch",  size: 38, xPct: 58, yPct: 80 },
  { id: 11, emoji: "🧠", label: "Brain",   size: 34, xPct: 36, yPct: 44 },
  { id: 12, emoji: "🎨", label: "Create",  size: 32, xPct: 70, yPct: 72 },
];

const HIGHLIGHTS = [
  { icon: "🎓", title: "Personalised Learning", desc: "AI adapts to your pace and learning style" },
  { icon: "📊", title: "Track Your Progress",   desc: "XP, streaks, and detailed session reports" },
  { icon: "🧠", title: "UK Curriculum Aligned", desc: "GCSE, A-Level, Key Stage content built-in" },
  { icon: "🔊", title: "Voice Tutoring",         desc: "Real-time AI voice sessions coming soon" },
];

const FRICTION    = 0.93;
const BOUNCE      = 0.52;
const ANG_FRICTION = 0.90;
const MAX_VEL     = 20;

export default function RegisterPage() {
  const { register } = useAuth();
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const itemDivsRef  = useRef<Map<number, HTMLDivElement>>(new Map());
  const physRef      = useRef<PhysItem[]>([]);
  const rafRef       = useRef<number>(0);
  const consRafRef   = useRef<number>(0);
  const frameRef     = useRef<number>(0);

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

  // ── Apply transforms directly to DOM ─────────────────────────────────────────
  const flushTransforms = () => {
    for (const item of physRef.current) {
      const el = itemDivsRef.current.get(item.id);
      if (!el) continue;
      const speed   = Math.sqrt(item.vx ** 2 + item.vy ** 2);
      const isDrag  = dragRef.current?.id === item.id;
      const sx = isDrag ? 1.0 : Math.max(0.7, 1 - speed * 0.018);
      const sy = isDrag ? 1.0 : Math.min(1.35, 1 + speed * 0.022);
      const glow = Math.min(speed * 2.5, 22);
      const ps   = item.popScale;

      el.style.left      = `${item.x}px`;
      el.style.top       = `${item.y}px`;
      el.style.transform = `rotate(${item.rot}deg) scale(${(isDrag ? 1.38 : sx) * ps}, ${(isDrag ? 1.38 : sy) * ps})`;
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

        item.vx     *= FRICTION;
        item.vy     *= FRICTION;
        item.angVel *= ANG_FRICTION;

        if (item.x < 0)         { item.x = 0;         item.vx =  Math.abs(item.vx) * BOUNCE; item.angVel *= -0.6; }
        if (item.x > W - itemW) { item.x = W - itemW; item.vx = -Math.abs(item.vx) * BOUNCE; item.angVel *= -0.6; }
        if (item.y < 0)         { item.y = 0;         item.vy =  Math.abs(item.vy) * BOUNCE; }
        if (item.y > H - itemH) { item.y = H - itemH; item.vy = -Math.abs(item.vy) * BOUNCE; item.angVel *= -0.7; }

        if (item.popScale !== 1) {
          item.popScale += (1 - item.popScale) * item.popDecay;
          if (Math.abs(item.popScale - 1) < 0.005) item.popScale = 1;
        }
      }

      // Circle collision every 2nd frame
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

    item.x    = nx;
    item.y    = ny;
    item.rot += (vxSamples[vxSamples.length - 1] ?? 0) * 0.35;
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
          background: #f5f5f0;
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
          width: 50px; height: 50px; border-radius: 13px; background: #1a73e8;
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; flex-shrink: 0; box-shadow: 0 4px 14px rgba(26,115,232,0.4);
        }
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
          width: 175px; height: 175px; object-fit: contain;
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
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px; padding: 13px 15px;
          display: flex; align-items: flex-start; gap: 10px;
        }
        .rp-hi-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .rp-hi-info h4 { font-size: 13px; font-weight: 700; color: #e2e8f0; margin: 0 0 2px; }
        .rp-hi-info p  { font-size: 11px; color: #636363; margin: 0; line-height: 1.4; }

        /* ══ PHYSICS ITEMS ══ */
        .rp-drag-item {
          position: absolute;
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          cursor: grab; touch-action: none;
          border-radius: 14px; padding: 6px 8px;
          will-change: transform, left, top, filter;
          z-index: 5;
        }
        .rp-drag-item:hover { filter: drop-shadow(0 0 16px rgba(26,115,232,0.75)) !important; }
        .rp-drag-item:active { cursor: grabbing; }
        .rp-drag-emoji { line-height: 1; display: block; pointer-events: none; transition: transform 0.12s; }
        .rp-drag-item:hover .rp-drag-emoji { transform: scale(1.18); }
        .rp-drag-label {
          font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.6);
          text-transform: uppercase; letter-spacing: 0.6px;
          user-select: none; pointer-events: none; white-space: nowrap;
        }

        /* ══ FORM PANEL ══ */
        .rp-form {
          flex: 0 0 42%; display: flex; align-items: center; justify-content: center;
          padding: 40px 32px; background: #f5f5f0; overflow-y: auto;
        }
        .rp-card { width: 100%; max-width: 380px; }
        .rp-logo { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 24px; }
        .rp-logo img { width: 56px; height: 56px; object-fit: contain; margin-bottom: 10px; }
        .rp-logo h2 { font-size: 21px; font-weight: 800; color: #2c2c2c; margin: 0 0 4px; }
        .rp-logo p  { font-size: 13px; color: #636363; margin: 0; }
        .rp-m-banner  { display: none; }
        .rp-m-heading { display: none; }
        .rp-field { margin-bottom: 13px; }
        .rp-field label { display: block; font-size: 12px; font-weight: 700; color: #2c2c2c; margin-bottom: 5px; letter-spacing: 0.3px; text-transform: uppercase; }
        .rp-field input { width: 100%; padding: 11px 13px; background: #fff; border: 1.5px solid #d9d9cf; border-radius: 8px; color: #2c2c2c; font-size: 14px; font-family: inherit; transition: border-color 0.2s, box-shadow 0.2s; }
        .rp-field input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.1); outline: none; }
        .rp-hint { font-size: 11px; color: #999; margin-top: 4px; }
        .rp-error { background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626; border-radius: 7px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px; }
        .rp-submit { width: 100%; padding: 13px; background: #1a73e8; color: #fff; border: none; border-radius: 9px; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; margin-top: 4px; transition: background 0.2s, transform 0.1s; box-shadow: 0 4px 12px rgba(26,115,232,0.25); }
        .rp-submit:hover:not(:disabled) { background: #1557b0; transform: translateY(-1px); }
        .rp-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .rp-divider { display: flex; align-items: center; gap: 10px; margin: 18px 0 14px; }
        .rp-divider::before, .rp-divider::after { content: ""; flex: 1; height: 1px; background: #d9d9cf; }
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
          .rp-hi-info p { display: none; }
        }

        @media (max-width: 768px) {
          .rp-root { display: block; background: #0a0a15; }
          .rp-brand { display: none; }
          .rp-form { display: block; min-height: 100vh; width: 100%; padding: 0; background: transparent; overflow-y: visible; }
          .rp-card { max-width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
          .rp-logo { display: none; }
          .rp-m-banner { display: block; background: linear-gradient(160deg, #0a0a15, #111127); padding: 28px 22px 26px; position: relative; overflow: hidden; flex-shrink: 0; }
          .rp-m-banner::before { content: ""; position: absolute; top: -50px; right: -50px; width: 200px; height: 200px; border-radius: 50%; background: radial-gradient(circle, rgba(26,115,232,0.2) 0%, transparent 70%); pointer-events: none; }
          .rp-m-banner-hdr { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; position: relative; z-index: 1; }
          .rp-m-banner-icon { width: 40px; height: 40px; border-radius: 10px; background: #1a73e8; display: flex; align-items: center; justify-content: center; font-size: 19px; flex-shrink: 0; box-shadow: 0 3px 10px rgba(26,115,232,0.4); }
          .rp-m-banner-hdr h3 { font-size: 15px; font-weight: 800; color: #fff; margin: 0; }
          .rp-m-banner-hdr p  { font-size: 11px; color: #636363; margin: 2px 0 0; }
          .rp-m-tagline { font-size: 21px; font-weight: 800; color: #fff; line-height: 1.22; margin: 0 0 5px; position: relative; z-index: 1; }
          .rp-m-tagline span { color: #1a73e8; }
          .rp-m-sub { font-size: 12px; color: #8a8a8a; margin: 0; position: relative; z-index: 1; }
          .rp-m-form-body { flex: 1; background: #f5f5f0; border-radius: 20px 20px 0 0; margin-top: -12px; padding: 28px 22px 36px; position: relative; z-index: 2; box-shadow: 0 -4px 20px rgba(0,0,0,0.1); }
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
          onPointerMove={onPointerMove}
          onPointerUp={releaseDrag}
          onPointerLeave={releaseDrag}
        >
          {/* Constellation canvas */}
          <canvas ref={canvasRef} className="rp-constellation" />

          {/* Physics items */}
          {ITEMS_CFG.map((cfg) => (
            <div
              key={cfg.id}
              className="rp-drag-item"
              ref={(el) => {
                if (el) itemDivsRef.current.set(cfg.id, el);
                else itemDivsRef.current.delete(cfg.id);
              }}
              onPointerDown={(e) => onPointerDown(e, cfg.id)}
            >
              <span className="rp-drag-emoji" style={{ fontSize: cfg.size }}>{cfg.emoji}</span>
              <span className="rp-drag-label">{cfg.label}</span>
            </div>
          ))}

          {/* Brand header */}
          <div className="rp-brand-hdr">
            <div className="rp-brand-badge">🤖</div>
            <div>
              <h1>AI Tutor 4 Schools</h1>
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
            </div>

            <div className="rp-hero-robo">
              <div className="rp-robo-rings">
                <div className="rp-robo-ring rp-robo-ring-1" />
                <div className="rp-robo-ring rp-robo-ring-2" />
                <div className="rp-robo-ring rp-robo-ring-3" />
                <div className="rp-robo-orbit" />
              </div>
              <img
                src="/Original-Logo.png"
                alt="AI Tutor Robot"
                className="rp-robo-img"
                draggable={false}
              />
            </div>
          </div>

          {/* Highlights */}
          <div className="rp-highlights">
            {HIGHLIGHTS.map((h) => (
              <div className="rp-highlight" key={h.title}>
                <span className="rp-hi-icon">{h.icon}</span>
                <div className="rp-hi-info">
                  <h4>{h.title}</h4>
                  <p>{h.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Form panel ─────────────────────────────────────────────────────── */}
        <div className="rp-form">
          <div className="rp-card">

            <div className="rp-m-banner">
              <div className="rp-m-banner-hdr">
                <div className="rp-m-banner-icon">🤖</div>
                <div>
                  <h3>AI Tutor 4 Schools</h3>
                  <p>Powered by SmartAI Tutor</p>
                </div>
              </div>
              <h2 className="rp-m-tagline">
                Start your <span>AI learning journey</span>
              </h2>
              <p className="rp-m-sub">Join thousands of UK students learning smarter.</p>
            </div>

            <div className="rp-m-form-body">
              <div className="rp-logo">
                <img src="/Original-Logo.png" alt="SmartAI Tutor" />
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
                  <input
                    id="rp-name" type="text" value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Johnson"
                    required minLength={2} autoComplete="name"
                  />
                </div>
                <div className="rp-field">
                  <label htmlFor="rp-email">School Email</label>
                  <input
                    id="rp-email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.ac.uk"
                    required autoComplete="email"
                  />
                </div>
                <div className="rp-field">
                  <label htmlFor="rp-password">Password</label>
                  <input
                    id="rp-password" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required minLength={6} autoComplete="new-password"
                  />
                </div>
                <div className="rp-field">
                  <label htmlFor="rp-confirm">Confirm Password</label>
                  <input
                    id="rp-confirm" type="password" value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    required minLength={6} autoComplete="new-password"
                  />
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
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
