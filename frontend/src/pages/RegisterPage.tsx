import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const HIGHLIGHTS = [
  { icon: "🎓", title: "Personalised Learning", desc: "AI adapts to your pace and learning style" },
  { icon: "📊", title: "Track Your Progress",   desc: "XP, streaks, and detailed session reports" },
  { icon: "🧠", title: "UK Curriculum Aligned", desc: "GCSE, A-Level, Key Stage content built-in" },
  { icon: "🔊", title: "Voice Tutoring",         desc: "Real-time AI voice sessions coming soon" },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await register(name, email, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }

        .rp-root {
          display: flex;
          min-height: 100vh;
          font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f5f5f0;
        }

        /* ══ BRAND PANEL — left ══ */
        .rp-brand {
          flex: 0 0 58%;
          background: #292929;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 48px 56px 40px;
          position: relative;
          overflow: hidden;
        }
        .rp-brand::before {
          content: ""; position: absolute;
          top: -100px; right: -80px;
          width: 380px; height: 380px; border-radius: 50%;
          background: radial-gradient(circle, rgba(26,115,232,0.18) 0%, transparent 70%);
          pointer-events: none;
        }
        .rp-brand::after {
          content: ""; position: absolute;
          bottom: -60px; left: -40px;
          width: 280px; height: 280px; border-radius: 50%;
          background: radial-gradient(circle, rgba(26,115,232,0.1) 0%, transparent 70%);
          pointer-events: none;
        }
        .rp-brand-hdr {
          display: flex; align-items: center; gap: 14px;
          position: relative; z-index: 1;
        }
        .rp-brand-badge {
          width: 50px; height: 50px; border-radius: 13px;
          background: #1a73e8;
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; flex-shrink: 0;
          box-shadow: 0 4px 14px rgba(26,115,232,0.4);
        }
        .rp-brand-hdr h1 { font-size: 19px; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.2px; }
        .rp-brand-hdr p  { font-size: 12px; color: #636363; margin: 2px 0 0; }

        .rp-hero {
          flex: 1; display: flex; flex-direction: column; justify-content: center;
          padding: 36px 0; position: relative; z-index: 1;
        }
        .rp-tagline {
          font-size: 40px; font-weight: 800; color: #fff;
          line-height: 1.18; margin: 0 0 14px; letter-spacing: -0.8px; max-width: 480px;
        }
        .rp-tagline span { color: #1a73e8; }
        .rp-sub { font-size: 16px; color: #b8b8b8; max-width: 400px; line-height: 1.6; margin: 0 0 32px; }

        .rp-highlights {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
          position: relative; z-index: 1;
        }
        .rp-highlight {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 13px 15px;
          display: flex; align-items: flex-start; gap: 10px;
          transition: background 0.2s, border-color 0.2s;
        }
        .rp-highlight:hover { background: rgba(26,115,232,0.12); border-color: rgba(26,115,232,0.3); }
        .rp-hi-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .rp-hi-info h4 { font-size: 13px; font-weight: 700; color: #e2e8f0; margin: 0 0 2px; }
        .rp-hi-info p  { font-size: 11px; color: #636363; margin: 0; line-height: 1.4; }

        /* ══ FORM PANEL — right ══ */
        .rp-form {
          flex: 0 0 42%;
          display: flex; align-items: center; justify-content: center;
          padding: 40px 32px; background: #f5f5f0;
          overflow-y: auto;
        }
        .rp-card { width: 100%; max-width: 380px; }

        /* Desktop logo */
        .rp-logo {
          display: flex; flex-direction: column; align-items: center;
          text-align: center; margin-bottom: 24px;
        }
        .rp-logo img { width: 56px; height: 56px; object-fit: contain; margin-bottom: 10px; }
        .rp-logo h2 { font-size: 21px; font-weight: 800; color: #2c2c2c; margin: 0 0 4px; }
        .rp-logo p  { font-size: 13px; color: #636363; margin: 0; }

        /* Mobile-only elements (hidden on desktop) */
        .rp-m-banner  { display: none; }
        .rp-m-heading { display: none; }

        /* Fields */
        .rp-field { margin-bottom: 13px; }
        .rp-field label {
          display: block; font-size: 12px; font-weight: 700; color: #2c2c2c;
          margin-bottom: 5px; letter-spacing: 0.3px; text-transform: uppercase;
        }
        .rp-field input {
          width: 100%; padding: 11px 13px; background: #fff;
          border: 1.5px solid #d9d9cf; border-radius: 8px; color: #2c2c2c;
          font-size: 14px; font-family: inherit; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .rp-field input:focus {
          border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.1); outline: none;
        }

        .rp-hint { font-size: 11px; color: #999; margin-top: 4px; }

        .rp-error {
          background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626;
          border-radius: 7px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px;
        }

        .rp-terms {
          font-size: 12px; color: #888; line-height: 1.5; margin-bottom: 12px;
          display: flex; align-items: flex-start; gap: 8px;
        }
        .rp-terms input[type="checkbox"] { margin-top: 2px; flex-shrink: 0; accent-color: #1a73e8; }

        .rp-submit {
          width: 100%; padding: 13px; background: #1a73e8; color: #fff;
          border: none; border-radius: 9px; font-size: 15px; font-weight: 700;
          font-family: inherit; cursor: pointer; margin-top: 4px;
          transition: background 0.2s, transform 0.1s;
          box-shadow: 0 4px 12px rgba(26,115,232,0.25);
        }
        .rp-submit:hover:not(:disabled) { background: #1557b0; transform: translateY(-1px); }
        .rp-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .rp-divider {
          display: flex; align-items: center; gap: 10px; margin: 18px 0 14px;
        }
        .rp-divider::before, .rp-divider::after { content: ""; flex: 1; height: 1px; background: #d9d9cf; }
        .rp-divider span { font-size: 11px; color: #999; font-weight: 500; white-space: nowrap; }

        .rp-login-row { text-align: center; font-size: 13px; color: #636363; }
        .rp-login-row a { color: #1a73e8; font-weight: 700; text-decoration: none; }
        .rp-login-row a:hover { text-decoration: underline; }

        /* ══ TABLET  769 – 1024px ══ */
        @media (min-width: 769px) and (max-width: 1024px) {
          .rp-brand  { flex: 0 0 52%; padding: 36px 36px 32px; }
          .rp-form   { flex: 0 0 48%; padding: 32px 24px; }
          .rp-tagline { font-size: 28px; }
          .rp-sub    { font-size: 14px; margin-bottom: 24px; }
          .rp-hero   { padding: 20px 0; }
          .rp-hi-info p { display: none; }
        }

        /* ══ MOBILE  ≤ 768px ══ */
        @media (max-width: 768px) {
          .rp-root { display: block; background: #292929; }

          /* Brand panel hidden */
          .rp-brand { display: none; }

          /* Form panel: full width */
          .rp-form {
            display: block; min-height: 100vh;
            width: 100%; padding: 0; background: transparent; overflow-y: visible;
          }

          .rp-card {
            max-width: 100%; min-height: 100vh;
            display: flex; flex-direction: column;
          }

          /* Desktop logo hidden */
          .rp-logo { display: none; }

          /* Mobile banner */
          .rp-m-banner {
            display: block;
            background: #292929;
            padding: 28px 22px 26px;
            position: relative; overflow: hidden;
            flex-shrink: 0;
          }
          .rp-m-banner::before {
            content: ""; position: absolute;
            top: -50px; right: -50px;
            width: 200px; height: 200px; border-radius: 50%;
            background: radial-gradient(circle, rgba(26,115,232,0.2) 0%, transparent 70%);
            pointer-events: none;
          }
          .rp-m-banner-hdr {
            display: flex; align-items: center; gap: 11px;
            margin-bottom: 16px; position: relative; z-index: 1;
          }
          .rp-m-banner-icon {
            width: 40px; height: 40px; border-radius: 10px;
            background: #1a73e8; display: flex; align-items: center;
            justify-content: center; font-size: 19px; flex-shrink: 0;
            box-shadow: 0 3px 10px rgba(26,115,232,0.4);
          }
          .rp-m-banner-hdr h3 { font-size: 15px; font-weight: 800; color: #fff; margin: 0; }
          .rp-m-banner-hdr p  { font-size: 11px; color: #636363; margin: 2px 0 0; }
          .rp-m-tagline {
            font-size: 21px; font-weight: 800; color: #fff;
            line-height: 1.22; margin: 0 0 5px;
            position: relative; z-index: 1;
          }
          .rp-m-tagline span { color: #1a73e8; }
          .rp-m-sub { font-size: 12px; color: #8a8a8a; margin: 0; position: relative; z-index: 1; }

          /* White form area */
          .rp-m-form-body {
            flex: 1;
            background: #f5f5f0;
            border-radius: 20px 20px 0 0;
            margin-top: -12px;
            padding: 28px 22px 36px;
            position: relative; z-index: 2;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
          }

          /* Mobile heading */
          .rp-m-heading {
            display: block;
            margin-bottom: 20px;
          }
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
        {/* ── Brand panel (desktop/tablet) ── */}
        <div className="rp-brand">
          <div className="rp-brand-hdr">
            <div className="rp-brand-badge">🤖</div>
            <div>
              <h1>AI Tutor 4 Schools</h1>
              <p>Powered by SmartAI Tutor</p>
            </div>
          </div>

          <div className="rp-hero">
            <h2 className="rp-tagline">
              Start your <span>AI learning journey</span> today
            </h2>
            <p className="rp-sub">
              Join thousands of students getting personalised AI tutoring
              aligned to the UK curriculum.
            </p>
          </div>

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

        {/* ── Form panel ── */}
        <div className="rp-form">
          <div className="rp-card">

            {/* Mobile banner (hidden on desktop via CSS) */}
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
              <p className="rp-m-sub">
                Join thousands of UK students learning smarter.
              </p>
            </div>

            {/* Form body wrapper */}
            <div className="rp-m-form-body">
              {/* Desktop logo (hidden on mobile via CSS) */}
              <div className="rp-logo">
                <img src="/Original-Logo.png" alt="SmartAI Tutor" />
                <h2>Create Account</h2>
                <p>Join your school's AI tutoring platform</p>
              </div>

              {/* Mobile heading (hidden on desktop via CSS) */}
              <div className="rp-m-heading">
                <h2>Create Account</h2>
                <p>Join your school's AI tutoring platform</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="rp-field">
                  <label htmlFor="rp-name">Full Name</label>
                  <input
                    id="rp-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Johnson"
                    required
                    minLength={2}
                    autoComplete="name"
                  />
                </div>

                <div className="rp-field">
                  <label htmlFor="rp-email">School Email</label>
                  <input
                    id="rp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.ac.uk"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="rp-field">
                  <label htmlFor="rp-password">Password</label>
                  <input
                    id="rp-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>

                <div className="rp-field">
                  <label htmlFor="rp-confirm">Confirm Password</label>
                  <input
                    id="rp-confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    required
                    minLength={6}
                    autoComplete="new-password"
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
