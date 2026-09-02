import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, Upload, FileText, Clock } from "lucide-react";
import Sidebar from "../components/Sidebar";
import PageLoading from "../components/PageLoading";
import { schoolVerificationApi, type SchoolVerification, type VerificationEvent, type EvidenceDoc } from "../services/api";
import { PageHeader, Card, CardHeader, CardBody, Button, Badge, Input, Textarea, Select, FormField, Alert, Spinner } from "../components/ui";

const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  draft: "neutral", submitted: "brand", under_review: "brand", verified: "success",
  rejected: "danger", changes_requested: "warning", suspended: "danger",
};

const FIELDS: [keyof SchoolVerification, string, string][] = [
  ["name", "Public school name", "text"],
  ["legal_name", "Legal / institution name", "text"],
  ["country", "Country", "text"],
  ["school_type", "School type", "select"],
  ["identifier", "Official identifier (URN / UKPRN)", "text"],
  ["website", "Website", "text"],
  ["domain", "Email domain", "text"],
  ["contact_email", "Contact email", "text"],
  ["contact_phone", "Contact phone", "text"],
  ["address", "Address", "textarea"],
];

export default function SchoolVerificationPage() {
  const [data, setData] = useState<{ school: SchoolVerification; events: VerificationEvent[]; evidence: EvidenceDoc[]; editable: boolean } | null>(null);
  const [form, setForm] = useState<Partial<SchoolVerification>>({});
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await schoolVerificationApi.me();
    setData(d); setForm(d.school);
  }, []);
  useEffect(() => { load().catch((e) => setErr((e as Error).message)); }, [load]);

  if (!data) return <PageLoading />;
  const { school, events, evidence, editable } = data;

  const save = async () => { setErr(""); setMsg("");
    try { await schoolVerificationApi.updateMe(form); setMsg("Saved."); load(); } catch (e) { setErr((e as Error).message); } };
  const submit = async () => { setErr(""); setMsg("");
    try { const r = await schoolVerificationApi.submit(); setMsg(`Submitted for review.${r.warnings.length ? " Note: " + r.warnings.join(" ") : ""}`); load(); } catch (e) { setErr((e as Error).message); } };
  const upload = async (f: File) => { setErr(""); try { await schoolVerificationApi.uploadEvidence(f); load(); } catch (e) { setErr((e as Error).message); } };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="School verification" subtitle="Verify your school to unlock full access."
            actions={<Badge tone={STATUS_TONE[school.verification_status]}>{school.verification_status.replace("_", " ")}</Badge>} />

          {msg && <div className="mb-4"><Alert tone="success">{msg}</Alert></div>}
          {err && <div className="mb-4"><Alert tone="danger">{err}</Alert></div>}
          {school.verification_status === "changes_requested" && school.verification_notes && (
            <div className="mb-4"><Alert tone="warning" title="Changes requested">{school.verification_notes}</Alert></div>
          )}
          {school.verification_status === "rejected" && school.verification_notes && (
            <div className="mb-4"><Alert tone="danger" title="Not approved">{school.verification_notes} — you can update the details and resubmit.</Alert></div>
          )}
          {school.verification_status === "verified" && (
            <div className="mb-4"><Alert tone="success" title="Verified">Your school is verified and has full access.</Alert></div>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader title="School details" subtitle={editable ? "Complete these, then submit for review." : "Locked while under review."} />
                <CardBody className="pt-0 grid gap-4 sm:grid-cols-2">
                  {FIELDS.map(([key, label, type]) => (
                    <FormField key={key} label={label} className={type === "textarea" ? "sm:col-span-2" : ""}>
                      {type === "textarea" ? (
                        <Textarea disabled={!editable} value={(form[key] as string) ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                      ) : type === "select" ? (
                        <Select disabled={!editable} value={(form[key] as string) ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                          <option value="">Select…</option>
                          {["primary", "secondary", "college", "multi_academy_trust", "independent", "other"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                        </Select>
                      ) : (
                        <Input disabled={!editable} value={(form[key] as string) ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                      )}
                    </FormField>
                  ))}
                  {editable && (
                    <div className="sm:col-span-2 flex gap-2">
                      <Button variant="secondary" onClick={save}>Save draft</Button>
                      <Button onClick={submit} leftIcon={<ShieldCheck size={16} />}>Submit for review</Button>
                    </div>
                  )}
                  <p className="sm:col-span-2 t-helper">An email domain alone doesn't prove a school is legitimate — please upload supporting evidence.</p>
                </CardBody>
              </Card>

              <Card className="mt-5">
                <CardHeader title="Evidence" subtitle="Private — only you and our review team can see these." />
                <CardBody className="pt-0">
                  <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  {editable && <Button variant="outline" size="sm" leftIcon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>Upload evidence</Button>}
                  <div className="mt-3 flex flex-col gap-2">
                    {evidence.length === 0 ? <div className="t-helper">No documents uploaded yet.</div> : evidence.map((d) => (
                      <a key={d.id} href={schoolVerificationApi.evidenceDownloadUrl(d.id)} target="_blank" rel="noreferrer"
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-line hover:border-brand text-[13px]">
                        <FileText size={16} className="text-brand" />
                        <span className="flex-1 truncate">{d.filename}</span>
                        <Badge tone={d.scan_status === "clean" ? "success" : d.scan_status === "flagged" ? "danger" : "warning"}>{d.scan_status}</Badge>
                      </a>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader title="History" />
              <CardBody className="pt-0">
                {events.length === 0 ? <div className="t-helper">No activity yet.</div> : (
                  <ol className="flex flex-col gap-3">
                    {events.map((e, i) => (
                      <li key={i} className="flex gap-2.5">
                        <Clock size={15} className="text-ink-muted mt-0.5 shrink-0" />
                        <div>
                          <div className="text-[13px] font-semibold text-ink capitalize">{e.to.replace("_", " ")}</div>
                          {e.note && <div className="t-helper">{e.note}</div>}
                          <div className="t-helper">{new Date(e.created_at).toLocaleString()}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
