import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { appointmentsApi } from "../services/api";
import type { Appointment } from "../types";
import LottiePlayer, { LOTTIE_URLS } from "../components/LottiePlayer";

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
          {/* Playful hero banner */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "18px 28px", marginBottom: 4,
            background: "linear-gradient(135deg, rgba(26,115,232,0.08) 0%, rgba(99,102,241,0.06) 100%)",
            borderBottom: "1px solid var(--border-color)",
          }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
                Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}! 👋
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
                Ready to learn something amazing today?
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Floating trophy Lottie */}
              <LottiePlayer
                src={LOTTIE_URLS.trophy}
                fallback="🏆"
                style={{ width: 64, height: 64 }}
              />
              {/* Stars animation */}
              <LottiePlayer
                src={LOTTIE_URLS.stars}
                fallback="⭐"
                style={{ width: 56, height: 56 }}
              />
            </div>
          </div>

          {/* Quick-start card with drag hint */}
          <div style={{
            display: "flex", gap: 12, padding: "16px 28px", flexWrap: "wrap",
          }}>
            {[
              { emoji: "🚀", label: "Start a Lesson", sub: "AI-powered tutoring", color: "#1a73e8", path: "/lesson/setup" },
              { emoji: "📊", label: "My Progress",    sub: "See your scores",     color: "#10b981", path: "/progress" },
              { emoji: "📅", label: "My Sessions",    sub: "Upcoming bookings",   color: "#6366f1", path: "/sessions" },
              { emoji: "📝", label: "Assignments",    sub: "Tasks from teacher",  color: "#f59e0b", path: "/assignments" },
            ].map((card) => (
              <div
                key={card.label}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text", card.label)}
                onClick={() => navigate(card.path)}
                style={{
                  flex: "1 1 160px", minWidth: 140, padding: "16px 14px",
                  background: "var(--bg-secondary)",
                  border: `1.5px solid ${card.color}22`,
                  borderRadius: 12, cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
                  transition: "transform 0.15s, box-shadow 0.15s",
                  animation: "lp-slide-up 0.4s ease both",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 24px ${card.color}22`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = "";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "";
                }}
              >
                <span style={{ fontSize: 28, animation: "lp-float 3s ease-in-out infinite" }}>{card.emoji}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{card.label}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{card.sub}</span>
                <span style={{ fontSize: 10, color: card.color, fontWeight: 600, marginTop: 2 }}>Drag me ↔</span>
              </div>
            ))}
          </div>

          <WelcomeScreen onPromptClick={handlePromptClick} />
        </div>
      </div>
    </div>
  );
}
