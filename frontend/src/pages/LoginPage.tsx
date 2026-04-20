import { useState, type FormEvent } from "react";
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
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }

        .lp-root {
          display: flex;
          min-height: 100vh;
          font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f5f5f0;
        }

        /* ══ BRAND PANEL — left, desktop/tablet ══ */
        .lp-brand {
          flex: 0 0 58%;
          background: #292929;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 48px 56px 40px;
          position: relative;
          overflow: hidden;
        }
        .lp-brand::before {
          content: ""; position: absolute;
          top: -100px; right: -80px;
          width: 380px; height: 380px; border-radius: 50%;
          background: radial-gradient(circle, rgba(26,115,232,0.18) 0%, transparent 70%);
          pointer-events: none;
        }
        .lp-brand::after {
          content: ""; position: absolute;
          bottom: -60px; left: -40px;
          width: 280px; height: 280px; border-radius: 50%;
          background: radial-gradient(circle, rgba(26,115,232,0.1) 0%, transparent 70%);
          pointer-events: none;
        }
        .lp-brand-hdr {
          display: flex; align-items: center; gap: 14px;
          position: relative; z-index: 1;
        }
        .lp-brand-badge {
          width: 50px; height: 50px; border-radius: 13px;
          background: #1a73e8;
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; flex-shrink: 0;
          box-shadow: 0 4px 14px rgba(26,115,232,0.4);
        }
        .lp-brand-hdr h1 { font-size: 19px; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.2px; }
        .lp-brand-hdr p  { font-size: 12px; color: #636363; margin: 2px 0 0; }
        .lp-hero {
          flex: 1; display: flex; flex-direction: column; justify-content: center;
          padding: 36px 0; position: relative; z-index: 1;
        }
        .lp-tagline {
          font-size: 40px; font-weight: 800; color: #fff;
          line-height: 1.18; margin: 0 0 14px; letter-spacing: -0.8px; max-width: 480px;
        }
        .lp-tagline span { color: #1a73e8; }
        .lp-sub { font-size: 16px; color: #b8b8b8; max-width: 400px; line-height: 1.6; margin: 0; }
        .lp-role-cards {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
          position: relative; z-index: 1;
        }
        .lp-role-card {
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 13px 15px;
          display: flex; align-items: flex-start; gap: 10px;
          transition: background 0.2s, border-color 0.2s;
        }
        .lp-role-card:hover { background: rgba(26,115,232,0.12); border-color: rgba(26,115,232,0.3); }
        .lp-role-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .lp-role-info h4 { font-size: 13px; font-weight: 700; color: #e2e8f0; margin: 0 0 2px; }
        .lp-role-info p  { font-size: 11px; color: #636363; margin: 0; line-height: 1.4; }

        /* ══ FORM PANEL — right, desktop/tablet ══ */
        .lp-form {
          flex: 0 0 42%;
          display: flex; align-items: center; justify-content: center;
          padding: 40px 32px; background: #f5f5f0;
        }
        .lp-card { width: 100%; max-width: 380px; }

        /* Desktop logo block */
        .lp-logo {
          display: flex; flex-direction: column; align-items: center;
          text-align: center; margin-bottom: 28px;
        }
        .lp-logo img { width: 60px; height: 60px; object-fit: contain; margin-bottom: 12px; }
        .lp-logo h2 { font-size: 22px; font-weight: 800; color: #2c2c2c; margin: 0 0 4px; }
        .lp-logo p  { font-size: 13px; color: #636363; margin: 0; }

        /* Mobile-only banner (hidden on desktop) */
        .lp-m-banner { display: none; }

        /* Mobile-only heading (hidden on desktop) */
        .lp-m-heading { display: none; }

        /* Field styles */
        .lp-field { margin-bottom: 14px; }
        .lp-field label {
          display: block; font-size: 12px; font-weight: 700; color: #2c2c2c;
          margin-bottom: 5px; letter-spacing: 0.3px; text-transform: uppercase;
        }
        .lp-field input {
          width: 100%; padding: 11px 13px; background: #fff;
          border: 1.5px solid #d9d9cf; border-radius: 8px; color: #2c2c2c;
          font-size: 14px; font-family: inherit; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .lp-field input:focus {
          border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.1); outline: none;
        }
        .lp-field-meta { display: flex; justify-content: flex-end; margin-top: 5px; }
        .lp-forgot { font-size: 12px; color: #1a73e8; text-decoration: none; font-weight: 600; }
        .lp-forgot:hover { text-decoration: underline; }

        .lp-error {
          background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626;
          border-radius: 7px; padding: 10px 12px; font-size: 13px; margin-bottom: 12px;
        }

        .lp-submit {
          width: 100%; padding: 13px; background: #1a73e8; color: #fff;
          border: none; border-radius: 9px; font-size: 15px; font-weight: 700;
          font-family: inherit; cursor: pointer; margin-top: 4px;
          transition: background 0.2s, transform 0.1s;
          box-shadow: 0 4px 12px rgba(26,115,232,0.25);
        }
        .lp-submit:hover:not(:disabled) { background: #1557b0; transform: translateY(-1px); }
        .lp-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .lp-divider {
          display: flex; align-items: center; gap: 10px; margin: 20px 0 16px;
        }
        .lp-divider::before, .lp-divider::after { content: ""; flex: 1; height: 1px; background: #d9d9cf; }
        .lp-divider span { font-size: 11px; color: #999; font-weight: 500; white-space: nowrap; }
        .lp-register-row { text-align: center; font-size: 13px; color: #636363; margin-bottom: 10px; }
        .lp-register-row a { color: #1a73e8; font-weight: 700; text-decoration: none; }
        .lp-register-row a:hover { text-decoration: underline; }
        .lp-contact { text-align: center; font-size: 12px; color: #999; line-height: 1.5; }

        /* ══ TABLET  769 – 1024px ══ */
        @media (min-width: 769px) and (max-width: 1024px) {
          .lp-brand  { flex: 0 0 52%; padding: 36px 36px 32px; }
          .lp-form   { flex: 0 0 48%; padding: 32px 24px; }
          .lp-tagline { font-size: 28px; }
          .lp-sub    { font-size: 14px; }
          .lp-hero   { padding: 20px 0; }
          .lp-role-cards { gap: 8px; }
          .lp-role-info p { display: none; }
        }

        /* ══ MOBILE  ≤ 768px ══ */
        @media (max-width: 768px) {
          /* Root: single column */
          .lp-root { display: block; background: #292929; }

          /* Brand panel: hidden, replaced by inline banner */
          .lp-brand { display: none; }

          /* Form panel: full width */
          .lp-form {
            display: block;
            min-height: 100vh;
            padding: 0;
            background: transparent;
          }

          .lp-card {
            max-width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }

          /* Desktop logo: hidden on mobile */
          .lp-logo { display: none; }

          /* Mobile banner: visible, dark top section */
          .lp-m-banner {
            display: block;
            background: #292929;
            padding: 28px 22px 26px;
            position: relative;
            overflow: hidden;
            flex-shrink: 0;
          }
          .lp-m-banner::before {
            content: ""; position: absolute;
            top: -50px; right: -50px;
            width: 200px; height: 200px; border-radius: 50%;
            background: radial-gradient(circle, rgba(26,115,232,0.2) 0%, transparent 70%);
            pointer-events: none;
          }
          .lp-m-banner-hdr {
            display: flex; align-items: center; gap: 11px;
            margin-bottom: 18px; position: relative; z-index: 1;
          }
          .lp-m-banner-icon {
            width: 40px; height: 40px; border-radius: 10px;
            background: #1a73e8; display: flex; align-items: center;
            justify-content: center; font-size: 19px; flex-shrink: 0;
            box-shadow: 0 3px 10px rgba(26,115,232,0.4);
          }
          .lp-m-banner-hdr h3 { font-size: 15px; font-weight: 800; color: #fff; margin: 0; }
          .lp-m-banner-hdr p  { font-size: 11px; color: #636363; margin: 2px 0 0; }
          .lp-m-tagline {
            font-size: 22px; font-weight: 800; color: #fff;
            line-height: 1.22; margin: 0 0 6px;
            position: relative; z-index: 1;
          }
          .lp-m-tagline span { color: #1a73e8; }
          .lp-m-sub { font-size: 12px; color: #8a8a8a; margin: 0 0 16px; position: relative; z-index: 1; }
          .lp-m-chips {
            display: flex; flex-wrap: wrap; gap: 6px;
            position: relative; z-index: 1;
          }
          .lp-m-chip {
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 999px; padding: 4px 10px;
            font-size: 11px; font-weight: 600; color: #b8b8b8;
            display: flex; align-items: center; gap: 4px;
          }

          /* White form area below banner */
          .lp-m-form-body {
            flex: 1;
            background: #f5f5f0;
            border-radius: 20px 20px 0 0;
            margin-top: -12px;
            padding: 28px 22px 36px;
            position: relative;
            z-index: 2;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
          }

          /* Mobile heading: visible */
          .lp-m-heading {
            display: block;
            margin-bottom: 22px;
          }
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
        {/* ── Desktop/Tablet: Brand panel ── */}
        <div className="lp-brand">
          <div className="lp-brand-hdr">
            <div className="lp-brand-badge">🤖</div>
            <div>
              <h1>AI Tutor 4 Schools</h1>
              <p>Powered by SmartAI Tutor</p>
            </div>
          </div>
          <div className="lp-hero">
            <h2 className="lp-tagline">
              Personalised AI tutoring{" "}
              <span>aligned to the UK curriculum</span>
            </h2>
            <p className="lp-sub">
              Your school's AI-powered learning platform — helping every
              student reach their full potential, at their own pace.
            </p>
          </div>
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

        {/* ── Form panel ── */}
        <div className="lp-form">
          <div className="lp-card">

            {/* Mobile banner (CSS: hidden on desktop) */}
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
              <p className="lp-m-sub">
                AI-powered learning, personalised for every student.
              </p>
              <div className="lp-m-chips">
                {ROLE_CARDS.map((c) => (
                  <span className="lp-m-chip" key={c.role}>
                    {c.icon} {c.role}
                  </span>
                ))}
              </div>
            </div>

            {/* Mobile form body wrapper (CSS: plain passthrough on desktop) */}
            <div className="lp-m-form-body">
              {/* Desktop logo (CSS: hidden on mobile) */}
              <div className="lp-logo">
                <img src="/Original-Logo.png" alt="SmartAI Tutor" />
                <h2>Welcome Back!</h2>
                <p>Sign in to your learning platform</p>
              </div>

              {/* Mobile heading (CSS: hidden on desktop) */}
              <div className="lp-m-heading">
                <h2>Welcome Back!</h2>
                <p>Sign in to your learning platform</p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="lp-field">
                  <label htmlFor="lp-email">Email address</label>
                  <input
                    id="lp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.ac.uk"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="lp-field">
                  <label htmlFor="lp-password">Password</label>
                  <input
                    id="lp-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    required
                    minLength={6}
                    autoComplete="current-password"
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
