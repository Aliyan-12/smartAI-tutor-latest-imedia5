import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Star, CalendarCheck, TrendingUp, Sparkles, ThumbsUp } from "lucide-react";
import Sidebar from "../components/Sidebar";
import MasteryPanel, { type MasterySource } from "../components/MasteryPanel";
import { parentApi, type ChildOverview } from "../services/api";
import { PageHeader, Card, CardBody, CardHeader, Badge, Spinner, EmptyState, StatCard } from "../components/ui";

interface Child { id: number; name: string }

const STATE_LABEL: Record<string, string> = {
  emerging: "Getting started", developing: "Coming along", secure: "Confident",
  mastered: "Mastered", needs_review: "Worth a review", not_started: "Not started",
};

export default function ParentProgressPage() {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [childId, setChildId] = useState<number | null>(null);
  const [overview, setOverview] = useState<ChildOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    parentApi.getStudents().then((list) => {
      const cs = (list as Child[]) ?? [];
      setChildren(cs);
      if (cs.length) setChildId(cs[0].id);
    }).catch(() => setChildren([]));
  }, []);

  const loadOverview = useCallback(async () => {
    if (childId == null) return;
    setLoading(true); setError(null); setOverview(null);
    try { setOverview(await parentApi.childOverview(childId)); }
    catch { setError("We couldn't load this child's progress right now."); }
    finally { setLoading(false); }
  }, [childId]);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Parent-scoped mastery source for the shared panel (authorised on the backend).
  const source: MasterySource | null = useMemo(() => childId == null ? null : ({
    overview: () => parentApi.childMastery(childId),
    topic: (s, t) => parentApi.childMasteryTopic(childId, s, t),
  }), [childId]);

  if (!children) return <div className="app-layout"><Sidebar /><div className="main-content"><div className="dashboard-content flex justify-center py-16"><Spinner /></div></div></div>;

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader title="Progress tracker" subtitle="See how your child is getting on and where to help." />

          {children.length === 0 ? (
            <EmptyState icon={<Sparkles size={36} />} title="No children linked yet"
              description="Link a child from your account settings to see their progress here." />
          ) : (
            <>
              {/* Child selector */}
              <div className="flex flex-wrap gap-2 mb-5">
                {children.map((c) => (
                  <button key={c.id} onClick={() => setChildId(c.id)}
                    className={`px-4 py-2 rounded-full border text-[13px] font-semibold transition-colors ${childId === c.id ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand"}`}>
                    {c.name}
                  </button>
                ))}
              </div>

              {loading ? <div className="flex justify-center py-12"><Spinner /></div>
                : error ? <Card><CardBody><div className="t-helper text-danger">{error}</div></CardBody></Card>
                : overview && (
                  <>
                    {/* Snapshot */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                      <StatCard label="Day streak" value={overview.streak} icon={<Flame size={18} />} accent="warning" />
                      <StatCard label="Sessions completed" value={overview.sessions_completed} icon={<CalendarCheck size={18} />} accent="brand" />
                      <StatCard label="Average score" value={`${Math.round(overview.assessments.average_score)}%`} icon={<TrendingUp size={18} />} accent="success" />
                      <StatCard label="XP earned" value={overview.xp_total.toLocaleString()} icon={<Star size={18} />} accent="brand" />
                    </div>

                    {/* Mastery summary (plain language) */}
                    <Card className="mb-5">
                      <CardHeader title="Where things stand" subtitle={`Tracking ${overview.topics_tracked} topic${overview.topics_tracked === 1 ? "" : "s"}.`} />
                      <CardBody className="pt-0">
                        {Object.keys(overview.mastery_counts).length === 0 ? (
                          <div className="t-helper">No activity recorded yet — progress will appear after a few lessons.</div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(overview.mastery_counts).map(([state, n]) => (
                              <Badge key={state} tone={state === "needs_review" ? "warning" : state === "mastered" || state === "secure" ? "success" : "brand"}>
                                {STATE_LABEL[state] ?? state}: {n}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardBody>
                    </Card>

                    {/* Strengths + focus */}
                    <div className="grid md:grid-cols-2 gap-4 mb-5">
                      <Card>
                        <CardHeader title="Doing well" />
                        <CardBody className="pt-0">
                          {overview.assessments.strong_topics.length === 0 ? <div className="t-helper">Building up evidence.</div> : (
                            <ul className="flex flex-col gap-1.5">
                              {overview.assessments.strong_topics.slice(0, 6).map((t, i) => (
                                <li key={i} className="flex items-center gap-2 t-body"><ThumbsUp size={14} className="text-success shrink-0" /> {t}</li>
                              ))}
                            </ul>
                          )}
                        </CardBody>
                      </Card>
                      <Card>
                        <CardHeader title="Worth some practice" />
                        <CardBody className="pt-0">
                          {overview.recommendations.length === 0 && overview.assessments.weak_topics.length === 0 ? (
                            <div className="t-helper">Nothing flagged — great going!</div>
                          ) : (
                            <ul className="flex flex-col gap-1.5">
                              {(overview.recommendations.length ? overview.recommendations.map((r) => r.topic) : overview.assessments.weak_topics).slice(0, 6).map((t, i) => (
                                <li key={i} className="flex items-center gap-2 t-body"><Sparkles size={14} className="text-brand shrink-0" /> {t}</li>
                              ))}
                            </ul>
                          )}
                        </CardBody>
                      </Card>
                    </div>

                    {/* Full mastery drill-down (shared panel, parent-scoped) */}
                    {source && <MasteryPanel source={source} title="Topic mastery" />}
                  </>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
