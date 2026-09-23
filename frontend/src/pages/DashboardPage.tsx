import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { appointmentsApi, billingApi } from "../services/api";
import type { Appointment } from "../types";
import LottiePlayer, { LOTTIE_URLS } from "../components/LottiePlayer";


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
    <div className="app-layout">
      <Sidebar
        chatList={chatList}
        credits={credits}
        appointments={appointments}
        onLoadChats={loadChats}
        onSelectChat={(id) => navigate(`/chat/${id}`)}
        onNewChat={() => navigate("/chat")}
      />
      <div className="main-content">
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* White hero header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "20px 28px 18px",
            background: "#fff",
            borderBottom: "1px solid #e2e8f0",
            position: "relative",
          }}>
            <style>{`
              @media (max-width: 640px) {
                .db-hero-sub { display: none !important; }
                .db-hero-stats { gap: 6px !important; flex-wrap: wrap; }
              }
            `}</style>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}! 👋
              </h2>
              <p className="db-hero-sub" style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
                Ready to learn something amazing today?
              </p>
            </div>
            <div className="db-hero-stats" style={{ display: "flex", alignItems: "center", gap: 8, zIndex: 1 }}>
              {heroStats ? (
                <>
                  {/* Streak pill */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "#fff7ed", border: "1.5px solid #fed7aa",
                    borderRadius: 999, padding: "7px 14px",
                  }}>
                    <span style={{ fontSize: 15 }}>🔥</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#ea580c", whiteSpace: "nowrap" }}>{heroStats.streak} Day Streak</span>
                  </div>

                  {/* XP pill */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "#fefce8", border: "1.5px solid #fde68a",
                    borderRadius: 999, padding: "7px 14px",
                  }}>
                    <span style={{ fontSize: 15 }}>⭐</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#ca8a04", whiteSpace: "nowrap" }}>{heroStats.xp.toLocaleString()} XP</span>
                  </div>

                  {/* Level pill with inline progress bar */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "#eff6ff", border: "1.5px solid #bfdbfe",
                    borderRadius: 999, padding: "7px 14px",
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>Level {heroStats.level}</span>
                    <div style={{ width: 60, height: 5, background: "#dbeafe", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "#1a73e8", borderRadius: 999, width: `${heroStats.xpPct}%`, transition: "width 0.6s ease" }} />
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
    </div>
  );
}

/* ── Student credits: balance + request a top-up (students never self-pay) ── */
function StudentCredits() {
  const [balance, setBalance] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    billingApi.me().then((m) => setBalance(m.balance)).catch(() => setBalance(null));
    billingApi.creditRequests().then((r) => setPending(r.requests.filter((x) => x.status === "pending").length)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const request = async () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) { setMsg("Enter an amount"); return; }
    try { await billingApi.createCreditRequest(n, ""); setAmount(""); setOpen(false); setMsg("Request sent to your parent / school"); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
    window.setTimeout(() => setMsg(null), 2600);
  };
  if (balance === null) return null;
  return (
    <div style={{ margin: "16px 0", padding: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.4px" }}>Your credits</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{balance.toLocaleString()}</div>
        {pending > 0 && <div style={{ fontSize: 12, color: "#ca8a04" }}>{pending} request{pending > 1 ? "s" : ""} pending</div>}
      </div>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ marginLeft: "auto", padding: "8px 14px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Request top-up</button>
      ) : (
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Credits" style={{ width: 100, padding: "7px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
          <button onClick={request} style={{ padding: "8px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Send</button>
          <button onClick={() => setOpen(false)} style={{ padding: "8px 12px", background: "none", color: "#64748b", border: "none", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      )}
      {msg && <div style={{ width: "100%", fontSize: 12.5, color: "#16a34a" }}>{msg}</div>}
    </div>
  );
}
