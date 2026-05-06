import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload, Link, Globe, Trash2, RefreshCw, FileText, Cloud, RotateCcw,
  ChevronRight, ChevronDown, FolderOpen, Folder, File, BookOpen, Brain,
} from "lucide-react";
import { documentsApi } from "../services/api";
import Sidebar from "../components/Sidebar";
import type { KnowledgeDocument, DocumentListResponse } from "../types";

const KEY_STAGES = ["KS1", "KS2", "KS3", "KS4", "KS5"];
const SUBJECTS = [
  "Biology", "Chemistry", "Physics", "Combined Science",
  "Maths", "English", "History", "Geography",
  "Computing", "Art", "Music", "DT", "PE",
  "French", "German", "Spanish", "General",
];
const EXAM_BOARDS = ["None", "AQA", "Edexcel", "OCR", "WJEC"];
const TIERS = ["None", "Foundation", "Higher"];

const STATUS_COLORS: Record<string, string> = {
  ready: "var(--success)", processing: "var(--warning)",
  failed: "var(--danger)", pending: "var(--text-muted)",
};

type KbSection = "course_material" | "model_training";

export default function KnowledgeBasePage() {
  const [activeSection, setActiveSection] = useState<KbSection>("course_material");
  const [courseDocuments, setCourseDocuments] = useState<KnowledgeDocument[]>([]);
  const [trainingDocuments, setTrainingDocuments] = useState<KnowledgeDocument[]>([]);
  const [courseTotal, setCourseTotal] = useState(0);
  const [trainingTotal, setTrainingTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<"list" | "upload" | "import">("list");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadDocuments = useCallback(async () => {
    try {
      const [courseData, trainingData] = await Promise.all([
        documentsApi.list({ kb_type: "course_material" }) as Promise<DocumentListResponse>,
        documentsApi.list({ kb_type: "model_training" }) as Promise<DocumentListResponse>,
      ]);
      setCourseDocuments(courseData.documents);
      setCourseTotal(courseData.total);
      setTrainingDocuments(trainingData.documents);
      setTrainingTotal(trainingData.total);
    } catch (err: any) { setError(err.message); }
  }, []);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(""), 4000); return () => clearTimeout(t); }
  }, [success]);

  const handleSectionSwitch = (section: KbSection) => {
    setActiveSection(section);
    setActiveTab("list");
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this document and all its chunks?")) return;
    try { await documentsApi.remove(id); await loadDocuments(); } catch (err: any) { setError(err.message); }
  };

  const handleRetry = async (id: number) => {
    try { await documentsApi.retry(id); setSuccess("Retrying..."); setTimeout(loadDocuments, 2000); } catch (err: any) { setError(err.message); }
  };

  const documents = activeSection === "course_material" ? courseDocuments : trainingDocuments;
  const total = activeSection === "course_material" ? courseTotal : trainingTotal;

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">

          <div className="dashboard-page-header">
            <h1>Knowledge Base</h1>
          </div>

          <div style={{
            display: "flex", gap: 0, marginBottom: 24,
            background: "var(--bg-secondary)", borderRadius: "var(--radius)",
            padding: 4, width: "fit-content",
          }}>
            <button
              onClick={() => handleSectionSwitch("course_material")}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 18px", borderRadius: "calc(var(--radius) - 2px)",
                border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: activeSection === "course_material" ? "var(--bg-primary)" : "transparent",
                color: activeSection === "course_material" ? "var(--primary)" : "var(--text-secondary)",
                boxShadow: activeSection === "course_material" ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s",
              }}
            >
              <BookOpen size={15} />
              Course Material
              <span style={{
                background: activeSection === "course_material" ? "var(--primary)" : "var(--text-muted)",
                color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11,
              }}>{courseTotal}</span>
            </button>
            <button
              onClick={() => handleSectionSwitch("model_training")}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 18px", borderRadius: "calc(var(--radius) - 2px)",
                border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: activeSection === "model_training" ? "var(--bg-primary)" : "transparent",
                color: activeSection === "model_training" ? "var(--primary)" : "var(--text-secondary)",
                boxShadow: activeSection === "model_training" ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s",
              }}
            >
              <Brain size={15} />
              Model Training
              <span style={{
                background: activeSection === "model_training" ? "var(--primary)" : "var(--text-muted)",
                color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11,
              }}>{trainingTotal}</span>
            </button>
          </div>

          {activeSection === "course_material" ? (
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, marginTop: -8 }}>
              Curriculum documents used for real-time teaching context. Upload lesson PDFs, scrape educational websites, or import from OneDrive/Google Docs.
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, marginTop: -8 }}>
              Expert tutor transcripts used to train the AI's teaching style. Upload video transcripts or expert lesson recordings — the AI will mirror their tone and conciseness.
            </p>
          )}

          {error && (
            <div className="dashboard-error">
              {error}
              <button onClick={() => setError("")} style={{ float: "right", background: "none", color: "inherit", fontSize: 16, cursor: "pointer" }}>×</button>
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
              <Upload size={14} /> Upload
            </button>
            <button className={`tab ${activeTab === "import" ? "active" : ""}`} onClick={() => setActiveTab("import")}>
              <Cloud size={14} /> Import / Scrape
            </button>
          </div>

          {activeTab === "list" && (
            <DocumentTree
              documents={documents}
              section={activeSection}
              onDelete={handleDelete}
              onRetry={handleRetry}
              onRefresh={loadDocuments}
            />
          )}
          {activeTab === "upload" && (
            <UploadForm
              section={activeSection}
              onSuccess={(m) => { setSuccess(m); setActiveTab("list"); loadDocuments(); }}
              onError={setError}
            />
          )}
          {activeTab === "import" && (
            <ImportForm
              section={activeSection}
              onSuccess={(m) => { setSuccess(m); setActiveTab("list"); loadDocuments(); }}
              onError={setError}
            />
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Document Tree ───────────────────────────────────────────────────────────

interface TreeNode {
  label: string;
  children?: TreeNode[];
  docs?: KnowledgeDocument[];
}

function buildTree(documents: KnowledgeDocument[]): TreeNode[] {
  const ksMap: Record<string, Record<string, Record<string, KnowledgeDocument[]>>> = {};
  for (const doc of documents) {
    const ks = doc.key_stage || "Other";
    const subj = doc.subject || "General";
    const board = doc.exam_board && doc.exam_board !== "None" ? doc.exam_board : "General";
    if (!ksMap[ks]) ksMap[ks] = {};
    if (!ksMap[ks][subj]) ksMap[ks][subj] = {};
    if (!ksMap[ks][subj][board]) ksMap[ks][subj][board] = [];
    ksMap[ks][subj][board].push(doc);
  }
  const tree: TreeNode[] = [];
  for (const ks of Object.keys(ksMap).sort()) {
    const subjNodes: TreeNode[] = [];
    for (const subj of Object.keys(ksMap[ks]).sort()) {
      const boardNodes: TreeNode[] = [];
      for (const board of Object.keys(ksMap[ks][subj]).sort()) {
        boardNodes.push({ label: board, docs: ksMap[ks][subj][board] });
      }
      subjNodes.push({ label: subj, children: boardNodes });
    }
    tree.push({ label: ks, children: subjNodes });
  }
  return tree;
}

function buildTrainingTree(documents: KnowledgeDocument[]): TreeNode[] {
  const subjMap: Record<string, KnowledgeDocument[]> = {};
  for (const doc of documents) {
    const subj = doc.subject || "General";
    if (!subjMap[subj]) subjMap[subj] = [];
    subjMap[subj].push(doc);
  }
  return Object.keys(subjMap).sort().map((subj) => ({
    label: subj,
    docs: subjMap[subj],
  }));
}

function DocumentTree({ documents, section, onDelete, onRetry, onRefresh }: {
  documents: KnowledgeDocument[];
  section: KbSection;
  onDelete: (id: number) => void;
  onRetry: (id: number) => void;
  onRefresh: () => void;
}) {
  const tree = section === "course_material" ? buildTree(documents) : buildTrainingTree(documents);
  const emptyText = section === "course_material"
    ? "No curriculum documents uploaded yet. Use the Upload tab to add lesson content."
    : "No training transcripts uploaded yet. Upload expert tutor PDFs to improve AI teaching style.";
  const heading = section === "course_material" ? "Curriculum Documents" : "Training Transcripts";

  return (
    <div className="dashboard-section">
      <div className="section-header">
        <h2>{heading}</h2>
        <button className="btn-secondary" onClick={onRefresh} title="Refresh"><RefreshCw size={14} /></button>
      </div>
      {tree.length === 0 && <p className="empty-text">{emptyText}</p>}
      <div className="doc-tree">
        {tree.map((node) => (
          <TreeFolder key={node.label} node={node} level={0} onDelete={onDelete} onRetry={onRetry} />
        ))}
      </div>
    </div>
  );
}

function TreeFolder({ node, level, onDelete, onRetry }: {
  node: TreeNode; level: number; onDelete: (id: number) => void; onRetry: (id: number) => void;
}) {
  const [open, setOpen] = useState(level < 2);
  const hasChildren = (node.children && node.children.length > 0) || (node.docs && node.docs.length > 0);
  const totalDocs = countDocs(node);

  return (
    <div className="tree-node">
      <div
        className={`tree-folder ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: level * 20 + 8 }}
      >
        {hasChildren ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{ width: 14 }} />}
        {open ? <FolderOpen size={15} /> : <Folder size={15} />}
        <span className="tree-folder-label">{node.label}</span>
        <span className="tree-folder-count">{totalDocs}</span>
      </div>
      {open && node.children && node.children.map((child) => (
        <TreeFolder key={child.label} node={child} level={level + 1} onDelete={onDelete} onRetry={onRetry} />
      ))}
      {open && node.docs && node.docs.map((doc) => (
        <div key={doc.id} className="tree-doc" style={{ paddingLeft: (level + 1) * 20 + 8 }}>
          <File size={14} className="tree-doc-icon" />
          <span className="tree-doc-name">{doc.title}</span>
          <span className="tree-doc-type">{doc.file_type?.toUpperCase() || doc.source_type}</span>
          <span className="tree-doc-status" style={{ color: STATUS_COLORS[doc.status] }}>{doc.status}</span>
          <span className="tree-doc-chunks">{doc.chunk_count} chunks</span>
          <div className="tree-doc-actions">
            {doc.status === "failed" && (
              <button onClick={(e) => { e.stopPropagation(); onRetry(doc.id); }} title="Retry"><RotateCcw size={13} /></button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }} title="Delete" className="danger"><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function countDocs(node: TreeNode): number {
  let count = node.docs?.length || 0;
  if (node.children) for (const child of node.children) count += countDocs(child);
  return count;
}


// ─── Upload Form ─────────────────────────────────────────────────────────────

function UploadForm({ section, onSuccess, onError }: {
  section: KbSection;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [keyStage, setKeyStage] = useState("KS4");
  const [subject, setSubject] = useState("Biology");
  const [examBoard, setExamBoard] = useState("AQA");
  const [tier, setTier] = useState("Higher");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isCourse = section === "course_material";

  const addFiles = (incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase();
      return ext === "pdf" || ext === "docx" || ext === "pptx";
    });
    if (valid.length) setFiles((prev) => [...prev, ...valid]);
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    setUploading(true);
    try {
      const ks = isCourse ? keyStage : "KS5";
      const board = isCourse ? examBoard : "None";
      const t = isCourse ? tier : "None";
      await documentsApi.upload(files, ks, subject, board, t, section);
      const label = isCourse ? `${keyStage} ${subject}` : subject;
      onSuccess(`${files.length} file(s) uploaded to ${isCourse ? "Course Material" : "Model Training"} — ${label}`);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: any) { onError(err.message); } finally { setUploading(false); }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const extIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "PDF";
    if (ext === "docx") return "DOC";
    if (ext === "pptx") return "PPT";
    return "FILE";
  };

  return (
    <div className="dashboard-section">
      <h2 style={{ marginBottom: 6 }}>
        {isCourse ? "Upload Curriculum Content" : "Upload Training Transcripts"}
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
        {isCourse
          ? "Select the curriculum level, then drop your lesson files. Each file's name becomes the lesson title."
          : "Upload expert tutor transcripts (PDF, DOCX, PPTX). The AI will learn from these to improve its teaching style. Select the subject this transcript covers."}
      </p>

      <form onSubmit={handleSubmit}>
        {isCourse ? (
          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="upload-label">Key Stage</label>
              <select value={keyStage} onChange={(e) => setKeyStage(e.target.value)} className="upload-select">
                {KEY_STAGES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="upload-label">Subject</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className="upload-select">
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="upload-label">Exam Board</label>
              <select value={examBoard} onChange={(e) => setExamBoard(e.target.value)} className="upload-select">
                {EXAM_BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="upload-label">Tier</label>
              <select value={tier} onChange={(e) => setTier(e.target.value)} className="upload-select">
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="upload-label">Subject</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className="upload-select">
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}

        <input
          ref={fileRef} type="file" accept=".pdf,.docx,.pptx" multiple
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); }}
          style={{ display: "none" }}
        />

        <div
          className={`upload-dropzone ${dragOver ? "drag-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={28} strokeWidth={1.5} />
          <p className="dropzone-title">
            {isCourse ? "Drag and drop lesson files here" : "Drag and drop transcript files here"}
          </p>
          <p className="dropzone-sub">or click to browse</p>
          <p className="dropzone-hint">PDF, DOCX, PPTX up to 50MB each</p>
        </div>

        {files.length > 0 && (
          <div className="upload-file-list">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="upload-file-item">
                <span className="file-ext-badge">{extIcon(f.name)}</span>
                <div className="file-info">
                  <span className="file-name">{f.name}</span>
                  <span className="file-size">{formatSize(f.size)}</span>
                </div>
                <button type="button" className="file-remove" onClick={() => removeFile(i)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="form-actions" style={{ marginTop: 16 }}>
          <button type="submit" className="btn-primary" disabled={uploading || files.length === 0}>
            <Upload size={14} /> {uploading ? "Processing..." : `Upload ${files.length} File${files.length !== 1 ? "s" : ""}`}
          </button>
          {files.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => { setFiles([]); if (fileRef.current) fileRef.current.value = ""; }}>
              Clear All
            </button>
          )}
        </div>
      </form>
    </div>
  );
}


// ─── Import Form ─────────────────────────────────────────────────────────────

function ImportForm({ section, onSuccess, onError }: {
  section: KbSection;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"scrape" | "onedrive" | "gdocs">("scrape");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [keyStage, setKeyStage] = useState("KS4");
  const [subject, setSubject] = useState("Biology");
  const [examBoard, setExamBoard] = useState("AQA");
  const [tier, setTier] = useState("Higher");
  const [importing, setImporting] = useState(false);

  const isCourse = section === "course_material";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !title) return;
    setImporting(true);
    try {
      const ks = isCourse ? keyStage : "KS5";
      const board = isCourse ? examBoard : "None";
      const t = isCourse ? tier : "None";
      if (mode === "scrape") {
        await documentsApi.scrape(url, title, ks, subject, board, t, undefined, section);
      } else {
        await documentsApi.importLink(url, title, ks, subject, board, t, undefined, mode, section);
      }
      onSuccess(`"${title}" import started for ${isCourse ? "Course Material" : "Model Training"}`);
      setUrl(""); setTitle("");
    } catch (err: any) { onError(err.message); } finally { setImporting(false); }
  };

  return (
    <div className="dashboard-section">
      <h2 style={{ marginBottom: 16 }}>Import from URL</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {([["scrape", "Web Scrape", Globe], ["onedrive", "OneDrive", Cloud], ["gdocs", "Google Docs", Link]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setMode(key)} className={mode === key ? "btn-primary" : "btn-secondary"} type="button" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <input
            placeholder={mode === "scrape" ? "https://www.thenational.academy/..." : mode === "onedrive" ? "OneDrive share link" : "Google Docs share link"}
            value={url} onChange={(e) => setUrl(e.target.value)} required style={{ flex: 2 }}
          />
          <input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        {isCourse ? (
          <div className="form-row">
            <div style={{ flex: 1 }}><label className="upload-label">Key Stage</label><select value={keyStage} onChange={(e) => setKeyStage(e.target.value)} className="upload-select">{KEY_STAGES.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
            <div style={{ flex: 1 }}><label className="upload-label">Subject</label><select value={subject} onChange={(e) => setSubject(e.target.value)} className="upload-select">{SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div style={{ flex: 1 }}><label className="upload-label">Exam Board</label><select value={examBoard} onChange={(e) => setExamBoard(e.target.value)} className="upload-select">{EXAM_BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
            <div style={{ flex: 1 }}><label className="upload-label">Tier</label><select value={tier} onChange={(e) => setTier(e.target.value)} className="upload-select">{TIERS.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          </div>
        ) : (
          <div className="form-row">
            <div style={{ flex: 1 }}><label className="upload-label">Subject</label><select value={subject} onChange={(e) => setSubject(e.target.value)} className="upload-select">{SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={importing || !url || !title}>
            {importing ? "Importing..." : mode === "scrape" ? "Scrape & Process" : "Download & Process"}
          </button>
        </div>
      </form>
      {mode === "scrape" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
          Allowed: thenational.academy, resourcefullearning.co.uk, bbc.co.uk, khanacademy.org
        </p>
      )}
    </div>
  );
}
