import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { legalApi, type PendingConsent, type DataRequestT } from "../services/api";
import { PageHeader, Card, CardHeader, CardBody, Button, Badge, Select, Textarea, FormField, Alert, EmptyState } from "../components/ui";

const REQUEST_TYPES: [string, string][] = [
  ["access", "See a copy of my data (access)"],
  ["export", "Export my data"],
  ["correction", "Correct my data"],
  ["deletion", "Delete my data"],
  ["objection", "Object to processing"],
];

function statusTone(s: string) {
  return s === "completed" ? "success" : s === "rejected" ? "danger" : s === "in_progress" ? "brand" : "warning";
}

export default function PrivacyPage() {
  const [pending, setPending] = useState<PendingConsent[]>([]);
  const [accepted, setAccepted] = useState<{ doc_key: string; version: string; accepted_at: string }[]>([]);
  const [requests, setRequests] = useState<DataRequestT[]>([]);
  const [rtype, setRtype] = useState("access");
  const [details, setDetails] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [p, mine, dr] = await Promise.all([
      legalApi.pendingConsents().catch(() => ({ pending: [] })),
      legalApi.myConsents().catch(() => ({ acceptances: [] })),
      legalApi.dataRequests().catch(() => ({ requests: [] })),
    ]);
    setPending(p.pending); setAccepted(mine.acceptances); setRequests(dr.requests);
  }, []);
  useEffect(() => { load(); }, [load]);

  const acceptAll = async () => {
    await legalApi.acceptAll(pending.map((p) => ({ doc_key: p.doc_key, version: p.version })));
    setMsg("Thanks — your acceptance was recorded."); load();
  };
  const submit = async () => {
    await legalApi.createDataRequest(rtype, details || undefined);
    setDetails(""); setMsg("Your request was submitted. We'll update its status here."); load();
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader
            title="Privacy & Data"
            subtitle="Your consents and your data rights."
            actions={<Link to="/legal" className="text-[13px] font-semibold text-brand hover:underline">All policies →</Link>}
          />

          {msg && <div className="mb-4"><Alert tone="success">{msg}</Alert></div>}

          {pending.length > 0 && (
            <Card className="mb-5 border-brand/30">
              <CardBody>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="text-brand mt-0.5" />
                  <div className="flex-1">
                    <div className="t-card-title mb-1">Please review our updated policies</div>
                    <ul className="t-helper list-disc pl-5 mb-3">
                      {pending.map((p) => (
                        <li key={p.doc_key}>
                          <Link to={`/legal/${p.doc_key}`} className="text-brand underline">{p.title}</Link> — {p.summary}
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" onClick={acceptAll}>I've read and accept these</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Make a data request" subtitle="Access, correct, export, delete or object." />
              <CardBody className="pt-0">
                <FormField label="Request type" className="mb-3">
                  <Select value={rtype} onChange={(e) => setRtype(e.target.value)}>
                    {REQUEST_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </FormField>
                <FormField label="Details (optional)" className="mb-3">
                  <Textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Anything that helps us handle your request…" />
                </FormField>
                <Button onClick={submit}>Submit request</Button>
                <p className="t-helper mt-3">Note: we keep records required by law (e.g. billing) even after account deletion.</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Your requests" />
              <CardBody className="pt-0">
                {requests.length === 0 ? (
                  <EmptyState title="No requests yet" description="Requests you make will appear here with their status." />
                ) : requests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2.5 border-b border-line last:border-0">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-ink capitalize">{r.request_type}</div>
                      <div className="t-helper">{new Date(r.created_at).toLocaleDateString()}{r.resolution_note ? ` · ${r.resolution_note}` : ""}</div>
                    </div>
                    <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card className="mt-5">
            <CardHeader title="Consents on record" subtitle="Which policy versions you've accepted." />
            <CardBody className="pt-0">
              {accepted.length === 0 ? (
                <div className="t-helper">No acceptances recorded yet.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {accepted.map((a) => (
                    <span key={`${a.doc_key}-${a.version}`} className="inline-flex items-center gap-1.5 text-[12px] bg-surface-muted rounded-full px-3 py-1">
                      <span className="font-semibold text-ink capitalize">{a.doc_key.replace(/_/g, " ")}</span>
                      <span className="text-ink-muted">v{a.version} · {new Date(a.accepted_at).toLocaleDateString()}</span>
                    </span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
