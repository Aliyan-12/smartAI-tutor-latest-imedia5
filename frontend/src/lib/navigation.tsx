/**
 * Central, typed navigation registry (Branch 01 — Information Architecture).
 *
 * This is the SINGLE SOURCE OF TRUTH for role-specific sidebar navigation. The Sidebar
 * component is now a renderer over this registry rather than 1,000 lines of hand-coded,
 * role-specific JSX.
 *
 * Grounding rule (from the guide): the repository is the source of truth. Every entry here
 * points at a route that ACTUALLY EXISTS in App.tsx for that role. Aspirational destinations
 * with no implemented route (e.g. Analytics, Security, Activity-Log pages that were only ever
 * "Soon") are deliberately omitted rather than advertised — they can be added by the branch
 * that implements them.
 *
 * Route protection stays enforced by App.tsx <ProtectedRoute allowedRoles> + backend RBAC.
 * This registry only controls DISCOVERABILITY, so it must never be treated as a security
 * boundary.
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, BookOpen, Calendar, CalendarPlus, BarChart2, BarChart, ClipboardList,
  MessageCircle, Sparkles, Settings, Users, FileText, CreditCard, Bell,
  Database, ShieldCheck, ClipboardCheck,
} from "lucide-react";

export type Role = "student" | "parent" | "teacher" | "admin" | "administrator";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Match the active state by path prefix (for nested routes like /session/:id). */
  activePrefix?: boolean;
  /** Key into the runtime badges map (e.g. a pending-approvals count). */
  badgeKey?: "pendingApprovals" | "activeUsers";
}

export interface NavSection {
  /** Subtle section heading; omit for an unlabelled top group. */
  label?: string;
  items: NavItem[];
}

const STUDENT: NavSection[] = [
  { label: "Home", items: [
    { id: "s-dash", label: "Dashboard", path: "/student/dashboard", icon: LayoutDashboard },
  ] },
  { label: "Learn", items: [
    { id: "s-lesson", label: "Start a Lesson", path: "/lesson/setup", icon: BookOpen },
    { id: "s-sessions", label: "My Sessions", path: "/sessions", icon: Calendar, activePrefix: true },
    { id: "s-progress", label: "My Progress", path: "/progress", icon: BarChart2 },
    { id: "s-assign", label: "Assignments", path: "/assignments", icon: ClipboardList },
  ] },
  { label: "Chat", items: [
    { id: "s-chat", label: "Chats", path: "/chat", icon: MessageCircle, activePrefix: true },
  ] },
  { label: "Account", items: [
    { id: "s-prefs", label: "Preferences", path: "/preferences", icon: Sparkles },
    { id: "s-settings", label: "Settings", path: "/settings", icon: Settings },
  ] },
];

const PARENT: NavSection[] = [
  { label: "Overview", items: [
    { id: "p-dash", label: "Dashboard", path: "/parent/dashboard", icon: LayoutDashboard },
    { id: "p-children", label: "My Children", path: "/parent/students", icon: Users },
  ] },
  { label: "Learning", items: [
    { id: "p-book", label: "Book a session", path: "/appointments/new", icon: CalendarPlus },
    { id: "p-sessions", label: "Sessions", path: "/parent/appointments", icon: Calendar },
    { id: "p-progress", label: "Progress", path: "/parent/progress", icon: BarChart2 },
    { id: "p-reports", label: "Reports", path: "/parent/reports", icon: FileText },
  ] },
  { label: "Account", items: [
    { id: "p-billing", label: "Billing", path: "/billing", icon: CreditCard },
    { id: "p-notif", label: "Notifications", path: "/notifications", icon: Bell },
    { id: "p-settings", label: "Settings", path: "/parent/settings", icon: Settings },
  ] },
];

const TEACHER: NavSection[] = [
  { label: "Overview", items: [
    { id: "t-dash", label: "Dashboard", path: "/teacher/dashboard", icon: LayoutDashboard },
    { id: "t-students", label: "Students", path: "/teacher/students", icon: Users },
    { id: "t-classprog", label: "Class Progress", path: "/teacher/progress", icon: BarChart },
  ] },
  { label: "Teaching", items: [
    { id: "t-book", label: "Book a session", path: "/appointments/new", icon: CalendarPlus },
    { id: "t-sessions", label: "Sessions", path: "/appointments", icon: Calendar, activePrefix: true },
    { id: "t-kb", label: "Knowledge Base", path: "/teacher/knowledge", icon: Database },
    { id: "t-reports", label: "Reports", path: "/teacher/reports", icon: FileText },
  ] },
  { label: "Account", items: [
    { id: "t-billing", label: "Billing", path: "/billing", icon: CreditCard },
    { id: "t-notif", label: "Notifications", path: "/notifications", icon: Bell },
    { id: "t-settings", label: "Settings", path: "/teacher/settings", icon: Settings },
  ] },
];

// School admin — scoped to their own school. Distinct from the platform administrator.
const SCHOOL_ADMIN: NavSection[] = [
  { label: "Overview", items: [
    { id: "a-dash", label: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
    { id: "a-users", label: "Users", path: "/admin/users", icon: Users, badgeKey: "activeUsers" },
    { id: "a-classprog", label: "School Progress", path: "/teacher/progress", icon: BarChart },
  ] },
  { label: "School operations", items: [
    { id: "a-verif", label: "Verification", path: "/school/verification", icon: ShieldCheck },
    { id: "a-kb", label: "Knowledge Base", path: "/admin/knowledge", icon: Database },
    { id: "a-sessions", label: "Sessions", path: "/appointments", icon: Calendar, activePrefix: true },
  ] },
  { label: "Administration", items: [
    { id: "a-billing", label: "Billing", path: "/school/billing", icon: CreditCard },
    { id: "a-settings", label: "Settings", path: "/admin/settings", icon: Settings },
  ] },
];

// Platform administrator — cross-school governance. Clearly NOT operating inside one school.
const ADMINISTRATOR: NavSection[] = [
  { label: "Platform", items: [
    { id: "pa-dash", label: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
    { id: "pa-users", label: "Users", path: "/admin/users", icon: Users },
    { id: "pa-approvals", label: "Approvals", path: "/admin/approvals", icon: ClipboardCheck, badgeKey: "pendingApprovals" },
    { id: "pa-verif", label: "School Verification", path: "/admin/school-verification", icon: ShieldCheck },
  ] },
  { label: "Operations", items: [
    { id: "pa-kb", label: "Knowledge Base", path: "/admin/knowledge", icon: Database },
    { id: "pa-chats", label: "Chats", path: "/admin/chats", icon: MessageCircle },
  ] },
  { label: "Governance", items: [
    { id: "pa-billing", label: "Billing operations", path: "/school/billing", icon: CreditCard },
    { id: "pa-settings", label: "Platform Settings", path: "/admin/settings", icon: Settings },
  ] },
];

const REGISTRY: Record<Role, NavSection[]> = {
  student: STUDENT,
  parent: PARENT,
  teacher: TEACHER,
  admin: SCHOOL_ADMIN,
  administrator: ADMINISTRATOR,
};

export function getNavForRole(role: string | undefined): NavSection[] {
  if (!role) return [];
  return REGISTRY[role as Role] ?? [];
}

/** Short role label for the sidebar footer. */
export function roleLabel(role: string | undefined): string {
  switch (role) {
    case "student": return "Student";
    case "parent": return "Parent";
    case "teacher": return "Teacher";
    case "admin": return "School Admin";
    case "administrator": return "Platform Administrator";
    default: return "User";
  }
}
