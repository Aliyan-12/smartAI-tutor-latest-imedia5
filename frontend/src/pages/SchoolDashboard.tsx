import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { schoolApi, type SchoolStats, type SchoolUser } from "../services/api";

const page: React.CSSProperties = { minHeight: "100vh", background: "#f8fafc", fontFamily: "DM Sans, -apple-system, sans-serif" };
const bar: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "14px 24px", background: "#fff", borderBottom: "1px solid #e2e8f0" };
const wrap: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: 24 };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 18 };
const statBox: React.CSSProperties = { flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "16px 18px", textAlign: "center" };
const input: React.CSSProperties = { padding: "9px 11px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const btn: React.CSSProperties = { padding: "9px 16px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748b", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" };
const td: React.CSSProperties = { padding: "10px", fontSize: 13, color: "#1e293b", borderBottom: "1px solid #f1f5f9" };

export default function SchoolDashboard() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<SchoolStats | null>(null);
  const [users, setUsers] = useState<SchoolUser[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "student" });

  const reload = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([schoolApi.getMySchool(), schoolApi.listUsers()]);
      setStats(s); setUsers(u.users);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const addUser = async () => {
    if (!form.name || !form.email || form.password.length < 6) { setError("Fill all fields (password 6+ chars)"); return; }
    setAdding(true); setError("");
    try {
      await schoolApi.addUser(form);
      setForm({ name: "", email: "", password: "", role: "student" });
      await reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to add user"); }
    finally { setAdding(false); }
  };

  const toggleActive = async (u: SchoolUser) => {
    try { await schoolApi.setUserActive(u.id, !u.is_active); await reload(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div style={page}>
      <div style={bar}>
        <img src="/images/aitutor 4 schools-robo.png" alt="logo" style={{ height: 34 }} />
        <strong style={{ color: "#1e293b" }}>{stats?.school.name || "School Dashboard"}</strong>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "#64748b" }}>{user?.name} · Superadmin</span>
        <button onClick={logout} style={{ ...btn, background: "#fff", color: "#475569", border: "1px solid #e2e8f0" }}>Sign out</button>
      </div>

      <div style={wrap}>
        {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
          <div style={statBox}><div style={{ fontSize: 26, fontWeight: 800, color: "#1a73e8" }}>{stats?.teachers ?? "–"}</div><div style={{ fontSize: 12, color: "#64748b" }}>Teachers</div></div>
          <div style={statBox}><div style={{ fontSize: 26, fontWeight: 800, color: "#10b981" }}>{stats?.students ?? "–"}</div><div style={{ fontSize: 12, color: "#64748b" }}>Students</div></div>
          <div style={statBox}><div style={{ fontSize: 26, fontWeight: 800, color: "#f97316" }}>{stats?.parents ?? "–"}</div><div style={{ fontSize: 12, color: "#64748b" }}>Parents</div></div>
          <div style={statBox}><div style={{ fontSize: 26, fontWeight: 800, color: "#7c3aed" }}>{stats?.total ?? "–"}</div><div style={{ fontSize: 12, color: "#64748b" }}>Total</div></div>
        </div>

        <div style={card}>
          <h3 style={{ margin: "0 0 12px", color: "#1e293b" }}>Add a member</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 160px" }} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input style={{ ...input, flex: "1 1 200px" }} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input style={{ ...input, flex: "1 1 140px" }} placeholder="Temp password" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select style={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent</option>
            </select>
            <button style={btn} onClick={addUser} disabled={adding}>{adding ? "Adding…" : "Add"}</button>
          </div>
        </div>

        <div style={card}>
          <h3 style={{ margin: "0 0 12px", color: "#1e293b" }}>School members ({users.length})</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Status</th><th style={th}></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={td}>{u.name}</td>
                  <td style={td}>{u.email}</td>
                  <td style={{ ...td, textTransform: "capitalize" }}>{u.role}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: u.is_active ? "#dcfce7" : "#fee2e2", color: u.is_active ? "#15803d" : "#b91c1c" }}>
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={td}>
                    <button onClick={() => toggleActive(u)} style={{ ...btn, background: "#fff", color: "#475569", border: "1px solid #e2e8f0", padding: "5px 10px" }}>
                      {u.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td style={td} colSpan={5}>No members yet — add your first teacher or student above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
