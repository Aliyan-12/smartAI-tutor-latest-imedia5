import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import { useChat } from "../hooks/useChat";
import { appointmentsApi } from "../services/api";
import type { Appointment } from "../types";

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
          <WelcomeScreen onPromptClick={handlePromptClick} />
        </div>
      </div>
    </div>
  );
}
