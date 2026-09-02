import { useEffect, useState } from "react";
import { Check, History, Save, AlertTriangle } from "lucide-react";
import Sidebar from "../components/Sidebar";
import {
  adminSettingsApi, type SettingItem, type SettingSection, type SettingChangeRow,
} from "../services/api";
import {
  PageHeader, Card, CardBody, CardHeader, Button, Badge, Alert, Spinner, EmptyState,
  Input, Select, Switch, Tabs,
} from "../components/ui";

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="fixed bottom-5 right-5 z-30 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-white shadow-lg text-[13px] font-semibold"><Check size={15} /> {msg}</div>;
}

/** One editable setting row. Local draft; commits on Save (dangerous ones confirm first). */
function SettingRow({ s, onSaved, flash }: { s: SettingItem; onSaved: (v: unknown) => void; flash: (m: string) => void }) {
  const [val, setVal] = useState<unknown>(s.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(val) !== JSON.stringify(s.value);

  const commit = async (next: unknown, reason?: string) => {
    setSaving(true); setError(null);
    try { const r = await adminSettingsApi.update(s.key, next, reason); onSaved(r.value); flash(`${s.label} saved`); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed"); setVal(s.value); }
    finally { setSaving(false); }
  };
  const save = () => {
    if (s.dangerous) {
      const ok = window.confirm(`"${s.label}" is a sensitive change. Continue?`);
      if (!ok) { setVal(s.value); return; }
      const reason = window.prompt("Reason for this change (recorded in the audit log):") || "";
      return commit(val, reason);
    }
    commit(val);
  };

  // Booleans commit immediately on toggle.
  if (s.type === "bool") {
    return (
      <div className="flex items-center justify-between gap-4 py-3 border-b border-line last:border-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><span className="t-body font-semibold text-ink">{s.label}</span>
            {s.dangerous && <Badge tone="warning">sensitive</Badge>}
            {s.scope_type === "school" && <Badge tone="neutral">school</Badge>}
          </div>
          {s.help && <div className="t-helper mt-0.5">{s.help}</div>}
          {error && <div className="t-helper text-danger mt-0.5">{error}</div>}
        </div>
        <Switch label={s.label} checked={Boolean(val)} disabled={!s.editable || saving}
          onChange={(v) => { setVal(v); if (s.dangerous) { if (window.confirm(`"${s.label}" is a sensitive change. Continue?`)) commit(v, window.prompt("Reason (audit log):") || ""); else setVal(s.value); } else commit(v); }} />
      </div>
    );
  }

  const control = (() => {
    if (s.sensitive) return <Input value="••••••••" disabled />;
    if (s.type === "enum") return (
      <Select value={String(val ?? "")} disabled={!s.editable} onChange={(e) => setVal(e.target.value)}>
        {(s.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
    if (s.type === "list") return (
      <Input value={Array.isArray(val) ? (val as string[]).join(", ") : ""} disabled={!s.editable}
        onChange={(e) => setVal(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="Comma separated" />
    );
    if (s.type === "text") return (
      <textarea value={String(val ?? "")} disabled={!s.editable} onChange={(e) => setVal(e.target.value)}
        className="w-full min-h-[70px] p-2.5 rounded-lg border border-line bg-surface text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-y disabled:opacity-60" />
    );
    if (s.type === "int" || s.type === "float") return (
      <Input type="number" value={String(val ?? "")} disabled={!s.editable}
        min={s.min ?? undefined} max={s.max ?? undefined}
        onChange={(e) => setVal(s.type === "int" ? parseInt(e.target.value || "0", 10) : parseFloat(e.target.value || "0"))} />
    );
    return <Input value={String(val ?? "")} disabled={!s.editable} onChange={(e) => setVal(e.target.value)} />;
  })();

  return (
    <div className="py-3 border-b border-line last:border-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="t-body font-semibold text-ink">{s.label}</span>
        {s.dangerous && <Badge tone="warning">sensitive</Badge>}
        {s.scope_type === "school" && <Badge tone="neutral">school</Badge>}
        {!s.editable && <Badge tone="neutral">read-only</Badge>}
      </div>
      {s.help && <div className="t-helper mb-2">{s.help}</div>}
      <div className="flex items-end gap-2">
        <div className="flex-1 max-w-md">{control}</div>
        {s.editable && !s.sensitive && (
          <Button size="sm" variant={dirty ? "primary" : "ghost"} disabled={!dirty || saving} loading={saving}
            leftIcon={<Save size={14} />} onClick={save}>Save</Button>
        )}
      </div>
      {error && <div className="t-helper text-danger mt-1">{error}</div>}
    </div>
  );
}

export default function AdminSettingsPage() {
  const [sections, setSections] = useState<SettingSection[] | null>(null);
  const [active, setActive] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [audit, setAudit] = useState<SettingChangeRow[] | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2400); };

  const load = async () => {
    const r = await adminSettingsApi.getSchema();
    setSections(r.sections);
    setActive((a) => a || r.sections[0]?.key || "");
  };
  useEffect(() => { load().catch(() => setSections([])); }, []);
  useEffect(() => { if (active === "audit") adminSettingsApi.auditLog().then((r) => setAudit(r.changes)).catch(() => setAudit([])); }, [active]);

  const patchValue = (sectionKey: string, settingKey: string, v: unknown) => {
    setSections((prev) => prev?.map((sec) => sec.key !== sectionKey ? sec : {
      ...sec, settings: sec.settings.map((s) => s.key === settingKey ? { ...s, value: v } : s),
    }) ?? prev);
  };

  if (!sections) return <div className="app-layout"><Sidebar /><div className="main-content"><div className="dashboard-content flex justify-center py-16"><Spinner /></div></div></div>;

  const tabs = [...sections.map((s) => ({ key: s.key, label: s.label })), { key: "audit", label: "Audit log" }];
  const current = sections.find((s) => s.key === active);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="Platform settings" subtitle="Global configuration and school policies. Every change is audited." />
          <div className="mb-5"><Tabs items={tabs} active={active} onChange={setActive} /></div>

          {active === "audit" ? (
            <Card>
              <CardHeader title="Recent changes" />
              <CardBody className="pt-0">
                {!audit ? <Spinner /> : audit.length === 0 ? <EmptyState icon={<History size={32} />} title="No changes yet" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead><tr className="text-left t-eyebrow border-b border-line">
                        <th className="py-2">When</th><th>Setting</th><th>Old → New</th><th>Reason</th>
                      </tr></thead>
                      <tbody>
                        {audit.map((c, i) => (
                          <tr key={i} className="border-b border-line last:border-0">
                            <td className="py-2 text-ink-muted whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</td>
                            <td className="text-ink font-medium">{c.label}</td>
                            <td className="text-ink-muted">{String(c.old_value)} → <span className="text-ink">{String(c.new_value)}</span></td>
                            <td className="text-ink-muted">{c.reason || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : current && (
            <Card className="max-w-3xl">
              <CardHeader title={current.label} />
              <CardBody className="pt-0">
                {current.key === "billing" && (
                  <Alert tone="info" className="mb-3"><span className="flex items-center gap-2"><AlertTriangle size={15} className="shrink-0" /> Provider API keys are configured via environment secrets, never here.</span></Alert>
                )}
                {current.settings.map((s) => (
                  <SettingRow key={s.key} s={s} flash={flash} onSaved={(v) => patchValue(current.key, s.key, v)} />
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}
