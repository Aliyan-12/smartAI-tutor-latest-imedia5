import { useCallback, useEffect, useState } from "react";
import { Brain, ChevronDown, RefreshCw, Target } from "lucide-react";
import { gamificationApi, type MasteryEngine, type MasteryBreakdown } from "../services/api";
import { Card, CardBody, Badge, Button, Spinner } from "./ui";

const STATE_META: Record<string, { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  emerging: { label: "Emerging", tone: "warning" },
  developing: { label: "Developing", tone: "brand" },
  secure: { label: "Secure", tone: "success" },
  mastered: { label: "Mastered", tone: "success" },
  needs_review: { label: "Needs review", tone: "danger" },
};

function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function TopicRow({ subject, topic, state, performance, confidence, evidence_count }:
  { subject: string; topic: string; state: string; performance: number; confidence: number; evidence_count: number }) {
  const [open, setOpen] = useState(false);
  const [bd, setBd] = useState<MasteryBreakdown | null>(null);
  const meta = STATE_META[state] ?? STATE_META.not_started;
  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && !bd) setBd(await gamificationApi.masteryTopic(subject, topic).catch(() => null));
  };
  return (
    <div className="border-b border-line last:border-0">
      <button onClick={toggle} className="w-full flex items-center gap-3 py-2.5 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="t-body font-semibold text-ink truncate">{topic}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-3 max-w-md">
            <div><div className="t-helper mb-0.5">Performance {Math.round(performance * 100)}%</div><Bar value={performance} tone="bg-brand" /></div>
            <div><div className="t-helper mb-0.5">Confidence {Math.round(confidence * 100)}%</div><Bar value={confidence} tone="bg-success" /></div>
          </div>
        </div>
        <ChevronDown size={16} className={`text-ink-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pb-3 pl-1">
          {!bd ? <Spinner /> : (
            <div className="rounded-lg bg-surface-muted p-3">
              <div className="t-eyebrow mb-1">Why this score?</div>
              <ul className="t-helper list-disc pl-4 mb-2">{bd.breakdown.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(bd.breakdown.evidence_by_type).map(([k, v]) => (
                  <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-surface border border-line text-ink-muted">{k.replace("_", " ")} ×{v}</span>
                ))}
              </div>
              <div className="t-helper mt-2">Based on {bd.evidence_count} activities across {bd.distinct_sessions} session(s) · engine v{bd.algorithm_version}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MasteryPanel() {
  const [data, setData] = useState<MasteryEngine | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => gamificationApi.masteryEngine().then(setData).catch(() => setData(null)), []);
  useEffect(() => { load(); }, [load]);

  const backfill = async () => {
    setBusy(true);
    try { await gamificationApi.masteryBackfill(); await load(); } finally { setBusy(false); }
  };

  if (!data) return null;
  const active = data.topics.filter((t) => t.evidence_count > 0);
  const counts: Record<string, number> = {};
  active.forEach((t) => { counts[t.state] = (counts[t.state] || 0) + 1; });

  return (
    <Card className="mb-5">
      <CardBody>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-brand-light text-brand flex items-center justify-center"><Brain size={18} /></div>
            <div>
              <h2 className="t-card-title">Mastery</h2>
              <div className="t-helper">Evidence-based · engine v{data.algorithm_version}</div>
            </div>
          </div>
          {active.length === 0 && (
            <Button size="sm" variant="secondary" loading={busy} leftIcon={<RefreshCw size={14} />} onClick={backfill}>Build from history</Button>
          )}
        </div>

        {active.length === 0 ? (
          <div className="t-helper">No mastery evidence yet — complete a few activities, or build it from your history.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(counts).map(([state, n]) => {
                const meta = STATE_META[state] ?? STATE_META.not_started;
                return <Badge key={state} tone={meta.tone}>{meta.label}: {n}</Badge>;
              })}
            </div>

            {data.recommendations.length > 0 && (
              <div className="mb-4 rounded-lg border border-brand/20 bg-brand-light p-3">
                <div className="flex items-center gap-1.5 t-label text-brand mb-1.5"><Target size={14} /> Focus next</div>
                <div className="flex flex-col gap-1">
                  {data.recommendations.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="text-ink truncate">{r.topic}</span>
                      <span className="t-helper shrink-0">{r.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-[420px] overflow-y-auto pr-1">
              {active.map((t) => <TopicRow key={t.subject + t.topic} {...t} />)}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
