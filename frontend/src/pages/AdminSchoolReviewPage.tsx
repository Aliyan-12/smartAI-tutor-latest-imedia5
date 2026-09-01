import { useCallback, useEffect, useState } from "react";
import { Building2, FileText, AlertTriangle, Clock } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { schoolVerificationApi, type SchoolVerification, type VerificationEvent, type EvidenceDoc } from "../services/api";
import { PageHeader, Card, CardHeader, CardBody, Button, Badge, Input, Tabs, EmptyState, Spinner } from "../components/ui";

const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  draft: "neutral", submitted: "brand", under_review: "brand", verified: "success",
  rejected: "danger", changes_requested: "warning", suspended: "danger",
};
const FILTERS = [
  { key: "", label: "All" }, { key: "submitted", label: "Submitted" },
  { key: "under_review", label: "Under review" }, { key: "verified", label: "Verified" },
  { key: "changes_requested", label: "Changes" }, { key: "rejected", label: "Rejected" },
];

export default function AdminSchoolReviewPage() {
  const [filter, setFilter] = useState("");
  const [apps, setApps] = useState<SchoolVerification[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ school: SchoolVerification; events: VerificationEvent[]; evidence: EvidenceDoc[]; duplicate_warnings: string[] } | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    const r = await schoolVerificationApi.applications(filter || undefined);
    setApps(r.applications); setLoading(false);
  }, [filter]);
  useEffect(() => { loadList().catch(() => setLoading(false)); }, [loadList]);

  const openDetail = async (id: number) => { setSelId(id); setNote(""); setDetail(await schoolVerificationApi.application(id)); };
  const act = async (to: string) => {
    if (!selId) return;
    await schoolVerificationApi.transition(selId, to, note || undefined);
    await openDetail(selId); loadList();
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="School verification" subtitle="Review and approve school applications." />
          <div className="mb-4"><Tabs items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={setFilter} /></div>

          <div className="grid gap-5 lg:grid-cols-5">
            <div className="lg:col-span-2 flex flex-col gap-2">
              {loading ? <div className="flex justify-center py-10"><Spinner /></div>
                : apps.length === 0 ? <EmptyState icon={<Building2 size={36} />} title="No applications" />
                : apps.map((a) => (
                  <button key={a.id} onClick={() => openDetail(a.id)}
                    className={`text-left p-3.5 rounded-lg border transition-colors ${selId === a.id ? "border-brand bg-brand-light" : "border-line bg-surface hover:border-brand"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-ink truncate">{a.name}</span>
                      <Badge tone={STATUS_TONE[a.verification_status]}>{a.verification_status.replace("_", " ")}</Badge>
                    </div>
                    <div className="t-helper mt-0.5">{a.country ?? "—"} · {a.domain ?? "no domain"}{a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleDateString()}` : ""}</div>
                  </button>
                ))}
            </div>

            <div className="lg:col-span-3">
              {!detail ? <Card><CardBody><div className="t-helper">Select an application to review.</div></CardBody></Card> : (
                <Card>
                  <CardHeader title={detail.school.name} subtitle={detail.school.legal_name ?? undefined}
                    actions={<Badge tone={STATUS_TONE[detail.school.verification_status]}>{detail.school.verification_status.replace("_", " ")}</Badge>} />
                  <CardBody className="pt-0">
                    {detail.duplicate_warnings.length > 0 && (
                      <div className="mb-4 border border-warning/30 bg-warning-light rounded-lg p-3">
                        <div className="flex items-center gap-2 text-warning font-bold text-[13px] mb-1"><AlertTriangle size={15} /> Possible duplicates</div>
                        <ul className="t-helper list-disc pl-5">{detail.duplicate_warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    )}
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] mb-4">
                      {([["Country", detail.school.country], ["Type", detail.school.school_type], ["Identifier", detail.school.identifier], ["Domain", detail.school.domain], ["Website", detail.school.website], ["Contact", detail.school.contact_email]] as [string, string | null][]).map(([k, v]) => (
                        <div key={k}><dt className="t-eyebrow">{k}</dt><dd className="text-ink">{v || "—"}</dd></div>
                      ))}
                    </dl>

                    <div className="mb-4">
                      <div className="t-label mb-1.5">Evidence (private)</div>
                      {detail.evidence.length === 0 ? <div className="t-helper">No evidence uploaded.</div> : detail.evidence.map((d) => (
                        <a key={d.id} href={schoolVerificationApi.evidenceDownloadUrl(d.id)} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2 rounded-lg border border-line hover:border-brand text-[13px] mb-1.5">
                          <FileText size={15} className="text-brand" /><span className="flex-1 truncate">{d.filename}</span>
                          <Badge tone={d.scan_status === "clean" ? "success" : "warning"}>{d.scan_status}</Badge>
                        </a>
                      ))}
                    </div>

                    <Input placeholder="Reviewer note (shown to the school for changes/rejection)" value={note} onChange={(e) => setNote(e.target.value)} className="mb-3" />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => act("under_review")}>Mark under review</Button>
                      <Button size="sm" variant="success" onClick={() => act("verified")}>Verify</Button>
                      <Button size="sm" onClick={() => act("changes_requested")}>Request changes</Button>
                      <Button size="sm" variant="danger" onClick={() => act("rejected")}>Reject</Button>
                      {detail.school.verification_status === "verified" && <Button size="sm" variant="outline" onClick={() => act("suspended")}>Suspend</Button>}
                    </div>

                    <div className="mt-5 pt-4 border-t border-line">
                      <div className="t-label mb-2">Audit trail</div>
                      <ol className="flex flex-col gap-2">
                        {detail.events.map((e, i) => (
                          <li key={i} className="flex gap-2 text-[12.5px]">
                            <Clock size={14} className="text-ink-muted mt-0.5 shrink-0" />
                            <span><span className="font-semibold text-ink capitalize">{e.to.replace("_", " ")}</span>{e.note ? ` — ${e.note}` : ""} <span className="text-ink-muted">· {new Date(e.created_at).toLocaleString()}</span></span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
