import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, TrendingUp, AlertTriangle, Grid3x3, ArrowLeft } from "lucide-react";
import Sidebar from "../components/Sidebar";
import PageLoading from "../components/PageLoading";
import MasteryPanel, { type MasterySource } from "../components/MasteryPanel";
import { teacherApi, type ClassOverview, type ClassHeatmap, type ClassStudentRow } from "../services/api";
import { PageHeader, Card, CardBody, CardHeader, Badge, Spinner, EmptyState, StatCard, Button } from "../components/ui";

const STATE_COLOR: Record<string, string> = {
  mastered: "bg-emerald-500", secure: "bg-emerald-400", developing: "bg-sky-400",
  emerging: "bg-amber-400", needs_review: "bg-rose-400", not_started: "bg-slate-200",
};
const STATE_LABEL: Record<string, string> = {
  mastered: "Mastered", secure: "Secure", developing: "Developing",
  emerging: "Emerging", needs_review: "Needs review", not_started: "Not started",
};

export default function TeacherProgressPage() {
  const [overview, setOverview] = useState<ClassOverview | null>(null);
  const [heatmap, setHeatmap] = useState<ClassHeatmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ClassStudentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, hm] = await Promise.all([teacherApi.classOverview(), teacherApi.classHeatmap().catch(() => null)]);
      setOverview(ov); setHeatmap(hm);
    } catch { setOverview(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const source: MasterySource | null = useMemo(() => selected == null ? null : ({
    overview: () => teacherApi.studentMastery(selected.id),
    topic: (s, t) => teacherApi.studentMasteryTopic(selected.id, s, t),
  }), [selected]);

  if (loading) return <PageLoading />;

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          {selected ? (
            <>
              <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 t-helper text-brand mb-3 hover:underline"><ArrowLeft size={14} /> Back to class</button>
              <PageHeader title={selected.name} subtitle="Topic mastery and evidence." />
              {source && <MasteryPanel source={source} title="Topic mastery" />}
            </>
          ) : !overview || overview.student_count === 0 ? (
            <>
              <PageHeader title="Class progress" subtitle="How your students are getting on." />
              <EmptyState icon={<Users size={36} />} title="No students yet" description="Students in your school will appear here once they're added." />
            </>
          ) : (
            <>
              <PageHeader title="Class progress" subtitle={`${overview.student_count} students in your school.`} />

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                <StatCard label="Students" value={overview.student_count} icon={<Users size={18} />} accent="brand" />
                <StatCard label="Class average" value={`${Math.round(overview.class_avg_performance * 100)}%`} icon={<TrendingUp size={18} />} accent="success" />
                <StatCard label="Need support" value={overview.needing_support.length} icon={<AlertTriangle size={18} />} accent="warning" />
                <StatCard label="Improving" value={overview.improving_students.length} icon={<TrendingUp size={18} />} accent="success" />
              </div>

              {/* Mastery distribution */}
              <Card className="mb-5">
                <CardHeader title="Mastery distribution" subtitle="Across all tracked topics in the class." />
                <CardBody className="pt-0">
                  {Object.keys(overview.mastery_distribution).length === 0 ? <div className="t-helper">No mastery evidence yet.</div> : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(overview.mastery_distribution).map(([state, n]) => (
                        <span key={state} className="flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-full border border-line">
                          <span className={`w-2.5 h-2.5 rounded-full ${STATE_COLOR[state] ?? "bg-slate-300"}`} />
                          {STATE_LABEL[state] ?? state}: <strong>{n}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Student table */}
              <Card className="mb-5">
                <CardHeader title="Students" />
                <CardBody className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead><tr className="text-left t-eyebrow border-b border-line">
                        <th className="py-2">Student</th><th className="text-right">Avg</th><th className="text-right">Topics</th>
                        <th className="text-right">Mastered</th><th className="text-right">Review</th><th>Last active</th><th></th>
                      </tr></thead>
                      <tbody>
                        {overview.students.map((s) => (
                          <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface-muted cursor-pointer" onClick={() => setSelected(s)}>
                            <td className="py-2 font-medium text-ink flex items-center gap-2">
                              {s.name}{s.support_flag && <Badge tone="warning">support</Badge>}{s.inactive && <Badge tone="neutral">inactive</Badge>}
                            </td>
                            <td className="text-right text-ink">{Math.round(s.avg_performance * 100)}%</td>
                            <td className="text-right text-ink-muted">{s.topics_tracked}</td>
                            <td className="text-right text-success font-semibold">{s.mastered}</td>
                            <td className="text-right text-warning font-semibold">{s.needs_review}</td>
                            <td className="text-ink-muted">{s.last_active ? new Date(s.last_active).toLocaleDateString() : "—"}</td>
                            <td className="text-right"><span className="text-brand">View →</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>

              {/* Topic heatmap */}
              {heatmap && heatmap.topics.length > 0 && (
                <Card>
                  <CardHeader title="Topic heatmap" subtitle="Mastery state per student and topic." actions={<Grid3x3 size={16} className="text-ink-muted" />} />
                  <CardBody className="pt-0">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {Object.entries(STATE_LABEL).map(([k, label]) => (
                        <span key={k} className="flex items-center gap-1 t-helper"><span className={`w-2.5 h-2.5 rounded-sm ${STATE_COLOR[k]}`} /> {label}</span>
                      ))}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="text-[12px] border-separate" style={{ borderSpacing: 2 }}>
                        <thead>
                          <tr>
                            <th className="text-left sticky left-0 bg-surface pr-2 t-eyebrow">Student</th>
                            {heatmap.topics.map((t) => (
                              <th key={t} className="p-1 align-bottom"><div className="whitespace-nowrap text-ink-muted font-normal" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: 90 }}>{t.length > 18 ? t.slice(0, 18) + "…" : t}</div></th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {heatmap.rows.map((r) => (
                            <tr key={r.student_id}>
                              <td className="sticky left-0 bg-surface pr-2 font-medium text-ink whitespace-nowrap">{r.student_name}</td>
                              {r.cells.map((c, i) => (
                                <td key={i}>
                                  <div className={`w-6 h-6 rounded-sm ${STATE_COLOR[c.state] ?? "bg-slate-200"}`}
                                    title={`${STATE_LABEL[c.state] ?? c.state} · ${c.evidence_count} activities${c.last_practiced ? " · " + new Date(c.last_practiced).toLocaleDateString() : ""}`} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
