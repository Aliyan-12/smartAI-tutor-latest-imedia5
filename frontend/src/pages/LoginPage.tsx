import { useState, useRef, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// ── Draggable item config ─────────────────────────────────────────────────────
interface DragItem {
  id: number;
  emoji: string;
  label: string;
  x: number;    // % of container width
  y: number;    // % of container height
  rot: number;  // initial rotation
  size: number; // font-size in px
}

const DRAG_ITEMS: DragItem[] = [
  { id: 1,  emoji: "📚", label: "Books",    x: 7,  y: 12, rot: -8,  size: 38 },
  { id: 2,  emoji: "✏️", label: "Write",    x: 54, y: 8,  rot: 14,  size: 32 },
  { id: 3,  emoji: "🧠", label: "Brain",    x: 78, y: 18, rot: -5,  size: 42 },
  { id: 4,  emoji: "⭐", label: "Star",     x: 28, y: 30, rot: 20,  size: 36 },
  { id: 5,  emoji: "🎯", label: "Goal",     x: 66, y: 42, rot: -12, size: 32 },
  { id: 6,  emoji: "💡", label: "Idea",     x: 10, y: 55, rot: 8,   size: 36 },
  { id: 7,  emoji: "🔬", label: "Science",  x: 46, y: 64, rot: -18, size: 32 },
  { id: 8,  emoji: "🏆", label: "Trophy",   x: 82, y: 60, rot: 10,  size: 40 },
  { id: 9,  emoji: "🎲", label: "Play",     x: 22, y: 78, rot: -6,  size: 32 },
  { id: 10, emoji: "🚀", label: "Launch",   x: 60, y: 82, rot: 22,  size: 38 },
  { id: 11, emoji: "🧮", label: "Maths",    x: 38, y: 47, rot: -10, size: 34 },
  { id: 12, emoji: "🎨", label: "Art",      x: 72, y: 74, rot: 16,  size: 32 },
];

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

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [items,       setItems]       = useState<DragItem[]>(DRAG_ITEMS);
  const [draggingId,  setDraggingId]  = useState<number | null>(null);
  const [droppedId,   setDroppedId]   = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef      = useRef<{
    id: number;
    startCX: number; startCY: number;
    itemXpx: number; itemYpx: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: number) => {
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const container = containerRef.current;
    if (!container) return;
    const rect   = container.getBoundingClientRect();
    const item   = items.find((it) => it.id === id)!;
    dragRef.current = {
      id,
      startCX:  e.clientX,
      startCY:  e.clientY,
      itemXpx: (item.x / 100) * rect.width,
      itemYpx: (item.y / 100) * rect.height,
    };
    setDraggingId(id);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !containerRef.current) return;
    const rect  = containerRef.current.getBoundingClientRect();
    const { id, startCX, startCY, itemXpx, itemYpx } = dragRef.current;
    const ITEM_SIZE = (items.find((it) => it.id === id)?.size ?? 36) + 20;
    const nx = Math.max(0, Math.min(rect.width  - ITEM_SIZE, itemXpx + (e.clientX - startCX)));
    const ny = Math.max(0, Math.min(rect.height - ITEM_SIZE, itemYpx + (e.clientY - startCY)));
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, x: (nx / rect.width) * 100, y: (ny / rect.height) * 100 }
          : it
      )
    );
  };

  const onPointerUp = () => {
    if (dragRef.current) {
      const id = dragRef.current.id;
      setDroppedId(id);
      setTimeout(() => setDroppedId(null), 600);
    }
    dragRef.current = null;
    setDraggingId(null);
  };

  // ── Login submit ────────────────────────────────────────────────────────────
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
          background: linear-gradient(160deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%);
          display: flex; flex-direction: column; justify-content: space-between;
          padding: 48px 56px 40px; position: relative; overflow: hidden;
          user-select: none;
        }
        .lp-brand::before {
          content: ""; position: absolute; top: -120px; right: -100px;
          width: 420px; height: 420px; border-radius: 50%;
          background: radial-gradient(circle, rgba(26,115,232,0.25) 0%, transparent 68%);
          pointer-events: none;
        }
        .lp-brand::after {
          content: ""; position: absolute; bottom: -80px; left: -60px;
          width: 320px; height: 320px; border-radius: 50%;
          background: radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 68%);
          pointer-events: none;
        }

        /* Header */
        .lp-brand-hdr { display: flex; align-items: center; gap: 14px; position: relative; z-index: 10; }
        .lp-brand-badge {
          width: 50px; height: 50px; border-radius: 13px; background: #1a73e8;
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; flex-shrink: 0; box-shadow: 0 4px 18px rgba(26,115,232,0.45);
        }
        .lp-brand-hdr h1 { font-size: 19px; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.2px; }
        .lp-brand-hdr p  { font-size: 12px; color: #636363; margin: 2px 0 0; }

        /* Hero */
        .lp-hero {
          flex: 1; display: flex; flex-direction: column; justify-content: center;
          padding: 36px 0; position: relative; z-index: 10; pointer-events: none;
        }
        .lp-tagline { font-size: 40px; font-weight: 800; color: #fff; line-height: 1.18; margin: 0 0 14px; letter-spacing: -0.8px; max-width: 480px; }
        .lp-tagline span { color: #1a73e8; }
        .lp-sub { font-size: 16px; color: #b8b8b8; max-width: 400px; line-height: 1.6; margin: 0; }

        /* Hint */
        .lp-hint {
          margin-top: 16px; display: flex; align-items: center; gap: 7px;
          font-size: 12px; color: rgba(255,255,255,0.38); pointer-events: none;
        }
        .lp-hint-dot {
          width: 7px; height: 7px; border-radius: 50%; background: #1a73e8; flex-shrink: 0;
          animation: lp-pulse 1.6s ease-in-out infinite;
        }

        /* Role cards */
        .lp-role-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; position: relative; z-index: 10; }
        .lp-role-card {
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 13px 15px;
          display: flex; align-items: flex-start; gap: 10px;
          transition: background 0.2s, border-color 0.2s;
        }
        .lp-role-card:hover { background: rgba(26,115,232,0.13); border-color: rgba(26,115,232,0.32); }
        .lp-role-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .lp-role-info h4 { font-size: 13px; font-weight: 700; color: #e2e8f0; margin: 0 0 2px; }
        .lp-role-info p  { font-size: 11px; color: #636363; margin: 0; line-height: 1.4; }

        /* ══ DRAGGABLE ITEMS ══ */
        .lp-drag-item {
          position: absolute;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          cursor: grab; touch-action: none;
          border-radius: 12px; padding: 5px 7px;
          transition: filter 0.18s, box-shadow 0.18s;
          will-change: transform;
        }
        .lp-drag-item:hover {
          filter: drop-shadow(0 0 14px rgba(26,115,232,0.7));
        }
        .lp-drag-item.is-dragging {
          cursor: grabbing;
          filter: drop-shadow(0 10px 24px rgba(26,115,232,0.9)) brightness(1.25);
          z-index: 100 !important;
        }
        .lp-drag-item.is-dropped {
          animation: lp-drop-bounce 0.55s cubic-bezier(0.34,1.56,0.64,1) both;
        }
        .lp-drag-emoji { line-height: 1; display: block; transition: transform 0.15s; }
        .lp-drag-item:hover .lp-drag-emoji { transform: scale(1.2); }
        .lp-drag-label {
          font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.55);
          text-transform: uppercase; letter-spacing: 0.6px;
          opacity: 0; transition: opacity 0.18s; white-space: nowrap;
        }
        .lp-drag-item:hover .lp-drag-label { opacity: 1; }

        @keyframes lp-item-entrance {
          from { opacity: 0; transform: scale(0.2) rotate(var(--ir)); }
          to   { opacity: 1; transform: scale(1)   rotate(var(--ir)); }
        }
        @keyframes lp-drop-bounce {
          0%   { transform: scale(1.5) rotate(var(--ir)); }
          45%  { transform: scale(0.8) rotate(calc(var(--ir) - 5deg)); }
          75%  { transform: scale(1.1) rotate(var(--ir)); }
          100% { transform: scale(1)   rotate(var(--ir)); }
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

        @media (min-width: 769px) and (max-width: 1024px) {
          .lp-brand { flex: 0 0 52%; padding: 36px 36px 32px; }
          .lp-form  { flex: 0 0 48%; padding: 32px 24px; }
          .lp-tagline { font-size: 28px; }
          .lp-sub { font-size: 14px; }
          .lp-hero { padding: 20px 0; }
          .lp-role-cards { gap: 8px; }
          .lp-role-info p { display: none; }
        }
        @media (max-width: 768px) {
          .lp-root { display: block; background: #0f0f1a; }
          .lp-brand { display: none; }
          .lp-form { display: block; min-height: 100vh; padding: 0; background: transparent; }
          .lp-card { max-width: 100%; min-height: 100vh; display: flex; flex-direction: column; }
          .lp-logo { display: none; }
          .lp-m-banner { display: block; background: linear-gradient(160deg, #0f0f1a, #1a1a2e); padding: 28px 22px 26px; position: relative; overflow: hidden; flex-shrink: 0; }
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

        {/* ── Brand panel: draggable playground ─────────────────────────────── */}
        <div
          className="lp-brand"
          ref={containerRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* 12 draggable learning items */}
          {items.map((item, idx) => {
            const isDragging = draggingId === item.id;
            const isDropped  = droppedId  === item.id;
            return (
              <div
                key={item.id}
                className={`lp-drag-item${isDragging ? " is-dragging" : ""}${isDropped ? " is-dropped" : ""}`}
                style={{
                  left:   `${item.x}%`,
                  top:    `${item.y}%`,
                  zIndex: isDragging ? 100 : 5,
                  transform: `rotate(${isDragging ? item.rot * 0.5 : item.rot}deg) scale(${isDragging ? 1.35 : 1})`,
                  // CSS custom property for animation
                  ["--ir" as string]: `${item.rot}deg`,
                  animation: isDropped
                    ? undefined
                    : `lp-item-entrance 0.55s cubic-bezier(0.34,1.56,0.64,1) ${idx * 0.06}s both`,
                  transition: isDragging ? "none" : "filter 0.18s, box-shadow 0.18s, transform 0.22s",
                }}
                onPointerDown={(e) => onPointerDown(e, item.id)}
              >
                <span className="lp-drag-emoji" style={{ fontSize: item.size }}>{item.emoji}</span>
                <span className="lp-drag-label">{item.label}</span>
              </div>
            );
          })}

          {/* Brand header — z-index above items */}
          <div className="lp-brand-hdr">
            <div className="lp-brand-badge">🤖</div>
            <div>
              <h1>AI Tutor 4 Schools</h1>
              <p>Powered by SmartAI Tutor</p>
            </div>
          </div>

          {/* Hero text */}
          <div className="lp-hero">
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
              Grab and drag the items to explore!
            </p>
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

            {/* Mobile banner (shown only on mobile via CSS) */}
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
              {/* Desktop logo */}
              <div className="lp-logo">
                <img src="/Original-Logo.png" alt="SmartAI Tutor" />
                <h2>Welcome Back!</h2>
                <p>Sign in to your learning platform</p>
              </div>

              {/* Mobile heading */}
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
