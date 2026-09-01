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
import BookSessionPage from "./pages/BookSessionPage";
import SessionPage from "./pages/SessionPage";
import SessionsPage from "./pages/SessionsPage";
import ProgressPage from "./pages/ProgressPage";
import AssignmentsPage from "./pages/AssignmentsPage";
import SettingsPage from "./pages/SettingsPage";
import LessonSetupPage from "./pages/LessonSetupPage";
import ParentReportsPage from "./pages/ParentReportsPage";
import ParentSettingsPage from "./pages/ParentSettingsPage";
import TeacherReportsPage from "./pages/TeacherReportsPage";
import TeacherSettingsPage from "./pages/TeacherSettingsPage";
import SessionReportPage from "./pages/SessionReportPage";
import DashboardPage from "./pages/DashboardPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import OnboardingPage from "./pages/OnboardingPage";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import LegalPage from "./pages/LegalPage";
import PrivacyPage from "./pages/PrivacyPage";
import SchoolVerificationPage from "./pages/SchoolVerificationPage";
import AdminSchoolReviewPage from "./pages/AdminSchoolReviewPage";
import { CookieConsent } from "./components/CookieConsent";
import type { ReactNode } from "react";

const Loading = () => (
  <div className="auth-page">
    <div style={{ color: "var(--text-secondary)" }}>Loading...</div>
  </div>
);

// Auth only — does NOT enforce verification/onboarding (used by /onboarding so we
// don't create a redirect loop).
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles?: string[] }) {
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;

  // Gate the app behind email verification + onboarding completion.
  if (user.is_verified === false) return <Navigate to="/verify-email" replace />;
  if (user.onboarding_completed === false) return <Navigate to="/onboarding" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

function RoleRouter() {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (user.is_verified === false) return <Navigate to="/verify-email" replace />;
  if (user.onboarding_completed === false) return <Navigate to="/onboarding" replace />;

  switch (user.role) {
    case "administrator":
      // Platform administrator — same admin dashboard, but unscoped (all schools).
      return <Navigate to="/admin/dashboard" replace />;
    case "admin":
      // Each admin is a school admin — same dashboard, scoped to their school.
      return <Navigate to="/admin/dashboard" replace />;
    case "teacher":
      return <Navigate to="/teacher/dashboard" replace />;
    case "student":
      return <Navigate to="/student/dashboard" replace />;
    case "parent":
      return <Navigate to="/parent/dashboard" replace />;
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
          <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={["admin", "administrator"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute allowedRoles={["admin", "administrator"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/approvals" element={<ProtectedRoute allowedRoles={["administrator"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/chats" element={<ProtectedRoute allowedRoles={["admin", "administrator"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/teacher/dashboard" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/teacher/students" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/teacher/activity" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherDashboard /></ProtectedRoute>} />
          <Route path="/teacher/reports" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherReportsPage /></ProtectedRoute>} />
          <Route path="/teacher/settings" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><TeacherSettingsPage /></ProtectedRoute>} />
          <Route path="/admin/knowledge" element={<ProtectedRoute allowedRoles={["admin", "administrator"]}><KnowledgeBasePage /></ProtectedRoute>} />
          <Route path="/teacher/knowledge" element={<ProtectedRoute allowedRoles={["admin", "teacher"]}><KnowledgeBasePage /></ProtectedRoute>} />
          <Route path="/parent/dashboard" element={<ProtectedRoute allowedRoles={["parent"]}><ParentDashboard /></ProtectedRoute>} />
          <Route path="/parent/students" element={<ProtectedRoute allowedRoles={["parent"]}><ParentDashboard /></ProtectedRoute>} />
          <Route path="/parent/appointments" element={<ProtectedRoute allowedRoles={["parent"]}><ParentDashboard /></ProtectedRoute>} />
          <Route path="/parent/reports" element={<ProtectedRoute allowedRoles={["parent"]}><ParentReportsPage /></ProtectedRoute>} />
          <Route path="/parent/settings" element={<ProtectedRoute allowedRoles={["parent"]}><ParentSettingsPage /></ProtectedRoute>} />
          <Route path="/appointments" element={<ProtectedRoute allowedRoles={["admin", "teacher", "parent"]}><AppointmentsPage /></ProtectedRoute>} />
          <Route path="/appointments/new" element={<ProtectedRoute allowedRoles={["teacher", "parent"]}><BookSessionPage /></ProtectedRoute>} />
          <Route path="/admin/assessments" element={<ProtectedRoute allowedRoles={["admin", "administrator"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/dashboard" element={<Navigate to="/student/dashboard" replace />} />
          <Route
            path="/student/dashboard"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
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
            path="/session/:appointmentId/report"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <SessionReportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sessions"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <SessionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/progress"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <ProgressPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/assignments"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <AssignmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lesson/setup"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <LessonSetupPage />
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
          {/* Email verification + OAuth callback are reachable without a session. */}
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          {/* Onboarding requires auth but not completed-onboarding (avoids a loop). */}
          <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          {/* Public legal surface — readable without a session. */}
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/legal/:docKey" element={<LegalPage />} />
          <Route path="/privacy" element={<ProtectedRoute><PrivacyPage /></ProtectedRoute>} />
          <Route path="/school/verification" element={<ProtectedRoute allowedRoles={["admin"]}><SchoolVerificationPage /></ProtectedRoute>} />
          <Route path="/admin/school-verification" element={<ProtectedRoute allowedRoles={["administrator"]}><AdminSchoolReviewPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <CookieConsent />
      </AuthProvider>
    </BrowserRouter>
  );
}
