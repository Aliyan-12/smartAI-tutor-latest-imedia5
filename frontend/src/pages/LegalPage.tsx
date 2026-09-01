import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, FileText } from "lucide-react";
import { legalApi, type LegalDocSummary, type LegalDocFull } from "../services/api";
import { Card, Badge, Spinner, EmptyState } from "../components/ui";

/** Public legal surface — readable without login. `/legal` lists documents; `/legal/:docKey`
 *  renders one. All documents are DRAFT scaffolds pending legal review (flagged in the UI). */
export default function LegalPage() {
  const { docKey } = useParams();
  return (
    <div className="min-h-screen bg-surface-page text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-3xl px-5 h-14 flex items-center justify-between">
          <Link to="/legal" className="flex items-center gap-2 font-extrabold text-ink">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white text-sm">S</span>
            SmartAI Tutor
          </Link>
          <Link to="/" className="text-[13px] font-semibold text-brand hover:underline">Back to app →</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">
        {docKey ? <SingleDoc docKey={docKey} /> : <DocIndex />}
      </main>
    </div>
  );
}

function DocIndex() {
  const [docs, setDocs] = useState<LegalDocSummary[] | null>(null);
  useEffect(() => { legalApi.documents().then((r) => setDocs(r.documents)).catch(() => setDocs([])); }, []);
  if (!docs) return <div className="flex justify-center py-16"><Spinner /></div>;
  return (
    <>
      <h1 className="t-page-title mb-1">Legal & Privacy</h1>
      <p className="t-body mb-6">Our policies for using SmartAI Tutor. These are working drafts pending final legal review.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {docs.map((d) => (
          <Link key={d.doc_key} to={`/legal/${d.doc_key}`} className="block">
            <Card className="p-4 h-full hover:border-brand transition-colors">
              <div className="flex items-start gap-3">
                <FileText size={18} className="text-brand mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="t-card-title">{d.title}</span>
                    {d.is_draft && <Badge tone="warning">Draft</Badge>}
                    {d.requires_consent && <Badge tone="brand">Consent</Badge>}
                  </div>
                  <p className="t-helper mt-1 line-clamp-3">{d.summary}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

function SingleDoc({ docKey }: { docKey: string }) {
  const [doc, setDoc] = useState<LegalDocFull | null | "404">(null);
  useEffect(() => { legalApi.document(docKey).then(setDoc).catch(() => setDoc("404")); }, [docKey]);
  if (doc === null) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (doc === "404") return <EmptyState icon={<FileText size={40} />} title="Document not found" action={<Link to="/legal" className="text-brand font-semibold">All policies</Link>} />;
  return (
    <>
      <Link to="/legal" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-muted hover:text-ink mb-4">
        <ArrowLeft size={15} /> All policies
      </Link>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h1 className="t-page-title">{doc.title}</h1>
        {doc.is_draft && <Badge tone="warning">Draft</Badge>}
      </div>
      <p className="t-helper mb-6">Version {doc.version}{doc.published_at ? ` · ${new Date(doc.published_at).toLocaleDateString()}` : ""}</p>
      <Card className="p-6">
        <div className="legal-prose">
          <ReactMarkdown>{doc.content}</ReactMarkdown>
        </div>
      </Card>
    </>
  );
}
