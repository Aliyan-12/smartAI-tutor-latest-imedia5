import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { appointmentsApi, billingApi } from "../services/api";
import type { Appointment } from "../types";
import LottiePlayer, { LOTTIE_URLS } from "../components/LottiePlayer";
import { Flame, Zap } from "lucide-react";


interface HeroStats { streak: number; xp: number; level: number; xpPct: number; }

export default function DashboardPage() {
  const navigate = useNavigate();
  const { chatList, loadChats, credits, loadCredits } = useChat();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [heroStats, setHeroStats] = useState<HeroStats | null>(null);

  useEffect(() => {
    loadChats();
    loadCredits();
    appointmentsApi.list().then((d) => setAppointments(d as Appointment[])).catch(() => {});
  }, [loadChats, loadCredits]);

  const handlePromptClick = (prompt: string) => {
    navigate("/chat", { state: { prompt } });
  };

  return (
    <div className="main-content">
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* White hero header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 28px", gap: 16, flexWrap: "wrap",
            background: "linear-gradient(120deg, #1a73e8 0%, #4f46e5 100%)",
            color: "#fff", position: "relative", overflow: "hidden",
          }}>
            <style>{`
              @media (max-width: 640px) {
                .db-hero-sub { display: none !important; }
                .db-hero-stats { gap: 6px !important; flex-wrap: wrap; }
              }
              .db-chip { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.28); border-radius: 999px; padding: 6px 13px; }
              .db-chip span { font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; }
            `}</style>
            <div style={{ zIndex: 1 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.01em" }}>
                Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}! 👋
              </h2>
              <p className="db-hero-sub" style={{ fontSize: 13.5, color: "rgba(255,255,255,0.85)", margin: "4px 0 0" }}>
                Ready to learn something amazing today?
              </p>
            </div>
            <div className="db-hero-stats" style={{ display: "flex", alignItems: "center", gap: 8, zIndex: 1 }}>
              {heroStats ? (
                <>
                  <div className="db-chip"><Flame size={15} color="#fff" fill="#fff" strokeWidth={2.2} /><span>{heroStats.streak} Day Streak</span></div>
                  <div className="db-chip"><Zap size={15} color="#fff" fill="#fff" strokeWidth={2.2} /><span>{heroStats.xp.toLocaleString()} XP</span></div>
                  <div className="db-chip" style={{ gap: 8 }}>
                    <span>Level {heroStats.level}</span>
                    <div style={{ width: 56, height: 5, background: "rgba(255,255,255,0.25)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "#fff", borderRadius: 999, width: `${heroStats.xpPct}%`, transition: "width 0.6s ease" }} />
                    </div>
                  </div>
                </>
              ) : (
                <LottiePlayer src={LOTTIE_URLS.trophy} fallback="🏆" style={{ width: 52, height: 52 }} />
              )}
            </div>
          </div>


          <StudentCredits />

          <WelcomeScreen onPromptClick={handlePromptClick} onStatsLoaded={setHeroStats} />
        </div>
    </div>
  );
}

/* ── Student credits: balance + request a top-up (students never self-pay) ── */
// Preset top-up tiers — students pick a bundle instead of typing a raw number.
const CREDIT_TIERS = [
  { credits: 10, price: "£1.99" },
  { credits: 25, price: "£4.99" },
  { credits: 50, price: "£8.99" },
  { credits: 100, price: "£16.99" },
  { credits: 250, price: "£39.99" },
];

function StudentCredits() {
  const [balance, setBalance] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<number>(CREDIT_TIERS[0].credits);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    billingApi.me().then((m) => setBalance(m.balance)).catch(() => setBalance(null));
    billingApi.creditRequests().then((r) => setPending(r.requests.filter((x) => x.status === "pending").length)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const request = async () => {
    const n = Number(tier);
    if (!n || n <= 0) { setMsg("Choose a bundle"); return; }
    try { await billingApi.createCreditRequest(n, ""); setTier(CREDIT_TIERS[0].credits); setOpen(false); setMsg("Request sent to your parent / school"); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    window.setTimeout(() => setMsg(null), 2600);
  };
  if (balance === null) return null;
  return (
    <div style={{ margin: "12px 28px 0", padding: "8px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.4px" }}>Credits</span>
        <span style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{balance.toLocaleString()}</span>
        {pending > 0 && <span style={{ fontSize: 11.5, color: "#ca8a04" }}>· {pending} pending</span>}
      </div>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ marginLeft: "auto", padding: "8px 14px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Request top-up</button>
      ) : (
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={tier}
            onChange={(e) => setTier(Number(e.target.value))}
            aria-label="Choose a credit bundle"
            style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#0f172a", background: "#fff", cursor: "pointer", minWidth: 168 }}
          >
            {CREDIT_TIERS.map((t) => (
              <option key={t.credits} value={t.credits}>{t.credits} credits — {t.price}</option>
            ))}
          </select>
          <button onClick={request} style={{ padding: "8px 14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Send</button>
          <button onClick={() => setOpen(false)} style={{ padding: "8px 12px", background: "none", color: "#64748b", border: "none", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      )}
      {msg && <div style={{ width: "100%", fontSize: 12.5, color: "#16a34a" }}>{msg}</div>}
    </div>
  );
}
