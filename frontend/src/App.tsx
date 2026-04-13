import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ChatPage from "./pages/ChatPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import AdminDashboard from "./pages/AdminDashboard";
import TeacherDashboard from "./pages/TeacherDashboard";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import ParentDashboard from "./pages/ParentDashboard";
import AppointmentsPage from "./pages/AppointmentsPage";
import SessionPage from "./pages/SessionPage";
import type { ReactNode } from "react";

function ProtectedRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles?: string[] }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div style={{ color: "var(--text-secondary)" }}>Loading...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div style={{ color: "var(--text-secondary)" }}>Loading...</div>
      </div>
    );
  }

  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

function RoleRouter() {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  switch (user.role) {
    case "admin":
      return <Navigate to="/admin" replace />;
    case "teacher":
      return <Navigate to="/teacher" replace />;
    case "student":
      return <Navigate to="/chat" replace />;
    case "parent":
      return <Navigate to="/parent" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RoleRouter />
              </ProtectedRoute>
            }
          />
          <Route path="/admin" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/chats" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/teacher" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/teacher/students" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/teacher/activity" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/admin/knowledge" element={<ProtectedRoute allowedRoles={["admin"]}><KnowledgeBasePage /></ProtectedRoute>} />
          <Route path="/teacher/knowledge" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><KnowledgeBasePage /></ProtectedRoute>} />
          <Route path="/parent" element={<ProtectedRoute allowedRoles={["parent"]}><ParentDashboard /></ProtectedRoute>} />
          <Route path="/parent/students" element={<ProtectedRoute allowedRoles={["parent"]}><ParentDashboard /></ProtectedRoute>} />
          <Route path="/parent/appointments" element={<ProtectedRoute allowedRoles={["parent"]}><ParentDashboard /></ProtectedRoute>} />
          <Route path="/appointments" element={<ProtectedRoute allowedRoles={["admin", "teacher", "parent"]}><AppointmentsPage /></ProtectedRoute>} />
          <Route path="/admin/assessments" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
          <Route
            path="/chat"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat/:sessionId"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:appointmentId"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <SessionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicRoute>
                <RegisterPage />
              </PublicRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
