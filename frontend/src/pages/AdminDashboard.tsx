import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Users, MessageSquare, BookOpen, Plus, Trash2, Edit3, Coins } from "lucide-react";
import { adminApi } from "../services/api";
import Sidebar from "../components/Sidebar";
import type { User, DashboardStats } from "../types";

function DashboardView({ stats }: { stats: DashboardStats | null }) {
  if (!stats) return null;
  return (
    <div className="stats-grid">
      <div className="stat-card">
        <Users size={20} />
        <div className="stat-value">{stats.total_users}</div>
        <div className="stat-label">Total Users</div>
      </div>
      <div className="stat-card">
        <BookOpen size={20} />
        <div className="stat-value">{stats.total_students}</div>
        <div className="stat-label">Students</div>
      </div>
      <div className="stat-card">
        <Users size={20} />
        <div className="stat-value">{stats.total_teachers}</div>
        <div className="stat-label">Teachers</div>
      </div>
      <div className="stat-card">
        <MessageSquare size={20} />
        <div className="stat-value">{stats.total_chats}</div>
        <div className="stat-label">Chats</div>
      </div>
    </div>
  );
}

function UsersView({
  users,
  roleFilter,
  setRoleFilter,
  onReload,
}: {
  users: User[];
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  onReload: () => void;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [creditUserId, setCreditUserId] = useState<number | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDesc, setCreditDesc] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "student", credits: 100 });
  const [error, setError] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await adminApi.createUser(form);
      setShowCreateForm(false);
      setForm({ name: "", email: "", password: "", role: "student", credits: 100 });
      onReload();
    } catch (err: any) { setError(err.message); }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError("");
    try {
      const updates: Record<string, unknown> = {};
      if (form.name && form.name !== editingUser.name) updates.name = form.name;
      if (form.email && form.email !== editingUser.email) updates.email = form.email;
      if (form.role && form.role !== editingUser.role) updates.role = form.role;
      await adminApi.updateUser(editingUser.id, updates);
      setEditingUser(null);
      onReload();
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      await adminApi.deleteUser(userId);
      onReload();
    } catch (err: any) { setError(err.message); }
  };

  const handleCreditAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditUserId) return;
    try {
      await adminApi.adjustCredits(creditUserId, parseFloat(creditAmount), creditDesc);
      setCreditUserId(null);
      setCreditAmount("");
      setCreditDesc("");
      onReload();
    } catch (err: any) { setError(err.message); }
  };

  const startEdit = (user: User) => {
    setEditingUser(user);
    setForm({ name: user.name, email: user.email, password: "", role: user.role, credits: user.credits });
    setShowCreateForm(false);
  };

  return (
    <>
      {error && <div className="dashboard-error">{error}</div>}
      <div className="dashboard-section">
        <div className="section-header">
          <h2>User Management</h2>
          <div className="section-actions">
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="filter-select">
              <option value="">All Roles</option>
              <option value="admin">Admin</option>
              <option value="teacher">Teacher</option>
              <option value="student">Student</option>
            </select>
            <button className="btn-primary" onClick={() => { setShowCreateForm(true); setEditingUser(null); }}>
              <Plus size={14} /> Add User
            </button>
          </div>
        </div>

        {(showCreateForm || editingUser) && (
          <form className="inline-form" onSubmit={editingUser ? handleUpdate : handleCreate}>
            <h3>{editingUser ? "Edit User" : "Create User"}</h3>
            <div className="form-row">
              <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required={!editingUser} />
              <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required={!editingUser} />
              {!editingUser && <input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />}
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
              </select>
              {!editingUser && <input placeholder="Credits" type="number" value={form.credits} onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })} />}
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">{editingUser ? "Update" : "Create"}</button>
              <button type="button" className="btn-secondary" onClick={() => { setShowCreateForm(false); setEditingUser(null); }}>Cancel</button>
            </div>
          </form>
        )}

        {creditUserId && (
          <form className="inline-form" onSubmit={handleCreditAdjust}>
            <h3>Adjust Credits (User #{creditUserId})</h3>
            <div className="form-row">
              <input placeholder="Amount (+/-)" type="number" step="0.01" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} required />
              <input placeholder="Description" value={creditDesc} onChange={(e) => setCreditDesc(e.target.value)} />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">Apply</button>
              <button type="button" className="btn-secondary" onClick={() => setCreditUserId(null)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="users-table">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Credits</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td><span className={`role-tag role-${u.role}`}>{u.role}</span></td>
                  <td>{Number(u.credits).toFixed(0)}</td>
                  <td><span className={`status-dot ${u.is_active ? "active" : "inactive"}`}>{u.is_active ? "Active" : "Inactive"}</span></td>
                  <td className="action-cell">
                    <button onClick={() => startEdit(u)} title="Edit"><Edit3 size={14} /></button>
                    <button onClick={() => setCreditUserId(u.id)} title="Adjust Credits"><Coins size={14} /></button>
                    <button onClick={() => handleDelete(u.id)} title="Delete" className="danger"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function AdminDashboard() {
  const location = useLocation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [error, setError] = useState("");

  const currentView = location.pathname === "/admin/users"
    ? "users"
    : location.pathname === "/admin/chats"
    ? "chats"
    : "dashboard";

  const loadData = useCallback(async () => {
    try {
      const [dashData, userData] = await Promise.all([
        adminApi.getDashboard() as Promise<DashboardStats>,
        adminApi.getUsers(roleFilter ? { role: roleFilter } : undefined) as Promise<User[]>,
      ]);
      setStats(dashData);
      setUsers(userData);
    } catch (err: any) {
      setError(err.message);
    }
  }, [roleFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          <div className="dashboard-page-header">
            <h1>
              {currentView === "users" ? "User Management" : currentView === "chats" ? "All Chats" : "Admin Dashboard"}
            </h1>
          </div>

          {error && <div className="dashboard-error">{error}</div>}

          {currentView === "dashboard" && (
            <>
              <DashboardView stats={stats} />
              <UsersView users={users} roleFilter={roleFilter} setRoleFilter={setRoleFilter} onReload={loadData} />
            </>
          )}

          {currentView === "users" && (
            <UsersView users={users} roleFilter={roleFilter} setRoleFilter={setRoleFilter} onReload={loadData} />
          )}

          {currentView === "chats" && (
            <AllChatsView />
          )}
        </div>
      </div>
    </div>
  );
}

function AllChatsView() {
  const [allChats, setAllChats] = useState<any[]>([]);
  const [viewingChat, setViewingChat] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.getAllChats()
      .then((data) => setAllChats(data as any[]))
      .catch((err: any) => setError(err.message));
  }, []);

  const viewChat = async (sessionId: string) => {
    try {
      const chat = await adminApi.viewChat(sessionId);
      setViewingChat(chat);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <div className="dashboard-error">{error}</div>}
      <div className="dashboard-section">
        <div className="teacher-columns" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="chat-list-panel" style={{ maxHeight: 600 }}>
            <h3>All Student Chats</h3>
            {allChats.map((c: any) => (
              <div key={c.session_id} className="chat-row" onClick={() => viewChat(c.session_id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{c.student_name}</div>
                </div>
                <span className="chat-date">{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
            ))}
            {allChats.length === 0 && <p className="empty-text">No chats found</p>}
          </div>

          <div className="chat-view-panel" style={{ maxHeight: 600 }}>
            {viewingChat ? (
              <>
                <h3>{viewingChat.title}</h3>
                <div className="chat-messages-view">
                  {viewingChat.messages.map((m: any) => (
                    <div key={m.id} className={`view-message ${m.role}`}>
                      <span className="view-role">{m.role === "user" ? "Student" : "AI"}</span>
                      <p>{m.content}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="empty-text">Select a chat to view messages</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
