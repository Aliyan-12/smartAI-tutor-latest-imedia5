import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { appointmentsApi } from "../services/api";
import type { Appointment } from "../types";
import LottiePlayer, { LOTTIE_URLS } from "../components/LottiePlayer";

const QUICK_ACTIONS = [
  {
    emoji: "🚀",
    label: "Start a Lesson",
    sub: "AI-powered tutoring",
    color: "#1a73e8",
    bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
    border: "#93c5fd",
    path: "/lesson/setup",
  },
  {
    emoji: "📊",
    label: "My Progress",
    sub: "See your scores",
    color: "#10b981",
    bg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
    border: "#6ee7b7",
    path: "/progress",
  },
  {
    emoji: "📅",
    label: "My Sessions",
    sub: "Upcoming bookings",
    color: "#6366f1",
    bg: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
    border: "#a5b4fc",
    path: "/sessions",
  },
  {
    emoji: "📝",
    label: "Assignments",
    sub: "Tasks from teacher",
    color: "#f59e0b",
    bg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
    border: "#fcd34d",
    path: "/assignments",
  },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { chatList, loadChats, credits, loadCredits } = useChat();
  const [appointments, setAppointments] = useState<Appointment[]>([]);

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
      <style>{`
        .db-quick-card {
          flex: 1 1 155px;
          min-width: 140px;
          padding: 18px 16px;
          border-radius: 14px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 7px;
          transition: transform 0.18s, box-shadow 0.18s;
          animation: lp-slide-up 0.4s ease both;
          border: 1.5px solid transparent;
          position: relative;
          overflow: hidden;
        }
        .db-quick-card:hover {
          transform: translateY(-4px);
        }
        .db-quick-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          border-radius: 14px 14px 0 0;
          background: var(--card-accent, #1a73e8);
        }
        .db-quick-emoji {
          font-size: 30px;
          line-height: 1;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.12));
        }
        .db-quick-label {
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
          margin: 0;
        }
        .db-quick-sub {
          font-size: 11px;
          color: #64748b;
          margin: 0;
        }
        .db-quick-arrow {
          font-size: 11px;
          font-weight: 700;
          margin-top: 4px;
          padding: 3px 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(0,0,0,0.08);
        }
      `}</style>
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
          {/* Vibrant hero banner */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "20px 28px", marginBottom: 4,
            background: "linear-gradient(135deg, #1a73e8 0%, #6366f1 60%, #8b5cf6 100%)",
            position: "relative",
            overflow: "hidden",
          }}>
            {/* Decorative circles */}
            <div style={{ position: "absolute", top: -20, right: 80, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.08)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", bottom: -30, right: 30, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.06)", pointerEvents: "none" }} />
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0 }}>
                Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}! 👋
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: "6px 0 0" }}>
                Ready to learn something amazing today?
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, zIndex: 1 }}>
              <LottiePlayer
                src={LOTTIE_URLS.trophy}
                fallback="🏆"
                style={{ width: 62, height: 62 }}
              />
              <LottiePlayer
                src={LOTTIE_URLS.stars}
                fallback="⭐"
                style={{ width: 54, height: 54 }}
              />
              <img
                src="/images/robotAI.png"
                alt="AI tutor robot"
                draggable={false}
                style={{
                  width: 120,
                  height: "auto",
                  position: "absolute",
                  right: 20,
                  bottom: 0,
                  pointerEvents: "none",
                  objectFit: "contain",
                }}
              />
            </div>
          </div>

          {/* Quick-action cards — colorful + accent top bar */}
          <div style={{ display: "flex", gap: 12, padding: "18px 28px", flexWrap: "wrap" }}>
            {QUICK_ACTIONS.map((card, idx) => (
              <div
                key={card.label}
                className="db-quick-card"
                style={{
                  background: card.bg,
                  borderColor: card.border,
                  // stagger the animation
                  animationDelay: `${idx * 0.07}s`,
                  // CSS variable for the ::after accent bar
                  ["--card-accent" as string]: card.color,
                }}
                onClick={() => navigate(card.path)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `0 10px 28px ${card.color}33`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "";
                }}
              >
                <span className="db-quick-emoji">{card.emoji}</span>
                <span className="db-quick-label">{card.label}</span>
                <span className="db-quick-sub">{card.sub}</span>
                <span className="db-quick-arrow" style={{ color: card.color }}>Go →</span>
              </div>
            ))}
          </div>

          <WelcomeScreen onPromptClick={handlePromptClick} />
        </div>
      </div>
    </div>
  );
}
