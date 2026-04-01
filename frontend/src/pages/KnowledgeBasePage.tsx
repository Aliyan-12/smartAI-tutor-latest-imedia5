import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload, Link, Globe, Trash2, RefreshCw, FileText, Cloud,
} from "lucide-react";
import { documentsApi } from "../services/api";
import Sidebar from "../components/Sidebar";
import type { KnowledgeDocument, DocumentListResponse } from "../types";

const SUBJECTS = [
  "Math", "Science", "English", "History",
  "Geography", "Computing", "Art", "Music", "General",
];

const STATUS_COLORS: Record<string, string> = {
  ready: "var(--success)",
  processing: "var(--warning)",
  failed: "var(--danger)",
  pending: "var(--text-muted)",
};

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"list" | "upload" | "import">("list");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const data = (await documentsApi.list(
        subjectFilter ? { subject: subjectFilter } : undefined
      )) as DocumentListResponse;
      setDocuments(data.documents);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    }
  }, [subjectFilter]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(""), 4000);
    return () => clearTimeout(t);
  }, [success]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this document and all its chunks?")) return;
    try {
      await documentsApi.remove(id);
      await loadDocuments();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          <div className="dashboard-page-header">
            <h1>Knowledge Base</h1>
          </div>

          {error && (
            <div className="dashboard-error">
              {error}
              <button onClick={() => setError("")} style={{ float: "right", background: "none", color: "inherit", fontSize: 16 }}>x</button>
            </div>
          )}
          {success && (
            <div style={{ background: "var(--success-light)", border: "1px solid var(--success)", color: "var(--success)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 13 }}>
              {success}
            </div>
          )}

          <div className="tab-bar" style={{ marginBottom: 20 }}>
            <button className={`tab ${activeTab === "list" ? "active" : ""}`} onClick={() => setActiveTab("list")}>
              <FileText size={14} /> Documents ({total})
            </button>
            <button className={`tab ${activeTab === "upload" ? "active" : ""}`} onClick={() => setActiveTab("upload")}>
              <Upload size={14} /> Upload File
            </button>
            <button className={`tab ${activeTab === "import" ? "active" : ""}`} onClick={() => setActiveTab("import")}>
              <Cloud size={14} /> Import / Scrape
            </button>
          </div>

          {activeTab === "list" && (
            <DocumentList
              documents={documents}
              subjectFilter={subjectFilter}
              setSubjectFilter={setSubjectFilter}
              onDelete={handleDelete}
              onRefresh={loadDocuments}
            />
          )}

          {activeTab === "upload" && (
            <UploadForm
              onSuccess={(msg) => {
                setSuccess(msg);
                setActiveTab("list");
                loadDocuments();
              }}
              onError={setError}
            />
          )}

          {activeTab === "import" && (
            <ImportForm
              onSuccess={(msg) => {
                setSuccess(msg);
                setActiveTab("list");
                loadDocuments();
              }}
              onError={setError}
            />
          )}
        </div>
      </div>
    </div>
  );
}


function DocumentList({
  documents, subjectFilter, setSubjectFilter, onDelete, onRefresh,
}: {
  documents: KnowledgeDocument[];
  subjectFilter: string;
  setSubjectFilter: (v: string) => void;
  onDelete: (id: number) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="dashboard-section">
      <div className="section-header">
        <h2>All Documents</h2>
        <div className="section-actions">
          <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} className="filter-select">
            <option value="">All Subjects</option>
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn-secondary" onClick={onRefresh} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="users-table">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Subject</th>
              <th>Source</th>
              <th>Status</th>
              <th>Chunks</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.title}
                </td>
                <td><span className={`role-tag role-student`}>{doc.subject}</span></td>
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {doc.source_type === "upload" ? doc.file_type?.toUpperCase() : doc.source_type}
                </td>
                <td>
                  <span style={{
                    color: STATUS_COLORS[doc.status] || "var(--text-muted)",
                    fontWeight: 600, fontSize: 12, textTransform: "uppercase",
                  }}>
                    {doc.status}
                  </span>
                  {doc.status === "failed" && doc.error_message && (
                    <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>{doc.error_message.slice(0, 60)}</div>
                  )}
                </td>
                <td>{doc.chunk_count}</td>
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {new Date(doc.created_at).toLocaleDateString()}
                </td>
                <td>
                  <button onClick={() => onDelete(doc.id)} className="danger" title="Delete"
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {documents.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No documents found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function UploadForm({ onSuccess, onError }: { onSuccess: (msg: string) => void; onError: (msg: string) => void }) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("General");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setUploading(true);
    try {
      await documentsApi.upload(file, title, subject);
      onSuccess(`"${title}" uploaded and processing started`);
      setTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: any) {
      onError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="dashboard-section">
      <h2 style={{ marginBottom: 16 }}>Upload Document</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-row">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.pptx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
            style={{ flex: 1 }}
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={uploading || !file}>
            <Upload size={14} /> {uploading ? "Uploading..." : "Upload & Process"}
          </button>
        </div>
      </form>
    </div>
  );
}


function ImportForm({ onSuccess, onError }: { onSuccess: (msg: string) => void; onError: (msg: string) => void }) {
  const [mode, setMode] = useState<"scrape" | "onedrive" | "gdocs">("scrape");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("General");
  const [importing, setImporting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !title) return;

    setImporting(true);
    try {
      if (mode === "scrape") {
        await documentsApi.scrape(url, title, subject);
      } else {
        await documentsApi.importLink(url, title, subject, mode);
      }
      onSuccess(`"${title}" import started`);
      setUrl("");
      setTitle("");
    } catch (err: any) {
      onError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="dashboard-section">
      <h2 style={{ marginBottom: 16 }}>Import from URL</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { key: "scrape" as const, label: "Web Scrape", icon: Globe },
          { key: "onedrive" as const, label: "OneDrive", icon: Cloud },
          { key: "gdocs" as const, label: "Google Docs", icon: Link },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={mode === key ? "btn-primary" : "btn-secondary"}
            type="button"
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <input
            placeholder={
              mode === "scrape" ? "https://www.thenational.academy/..." :
              mode === "onedrive" ? "OneDrive share link" :
              "Google Docs share link"
            }
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            style={{ flex: 2 }}
          />
        </div>
        <div className="form-row">
          <input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={importing || !url || !title}>
            {importing ? "Importing..." : mode === "scrape" ? "Scrape & Process" : "Download & Process"}
          </button>
        </div>
      </form>

      {mode === "scrape" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
          Allowed sites: thenational.academy, resourcefullearning.co.uk, bbc.co.uk, khanacademy.org
        </p>
      )}
    </div>
  );
}
