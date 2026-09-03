import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, Target, Gauge, Heart, BookOpen, Flag, Clock, Accessibility, ShieldCheck,
  Check, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { settingsApi, curriculumApi, type LearningPreferences } from "../services/api";
import {
  applyAccessibility, coerceA11y, type AccessibilityPrefs, type TextSize,
} from "../lib/accessibility";
import { PageHeader, Card, CardBody, Button, Badge, Switch, Alert, Spinner } from "../components/ui";

/* ── Option catalogues (bounded — must match backend _ALLOWED_STYLES / prompt keys) ── */
const LEARNING_STYLES: { key: string; label: string; hint: string }[] = [
  { key: "visual", label: "Visual", hint: "Diagrams & pictures" },
  { key: "step_by_step", label: "Step by step", hint: "One step at a time" },
  { key: "examples", label: "Real examples", hint: "Everyday situations" },
  { key: "worked_examples", label: "Worked examples", hint: "See it solved first" },
  { key: "analogies", label: "Analogies", hint: "Compare to things I know" },
  { key: "diagrams", label: "Diagrams", hint: "Draw it out" },
  { key: "concise", label: "Keep it short", hint: "Brief, to the point" },
];
const CHALLENGE_LEVELS: { key: string; label: string; hint: string }[] = [
  { key: "support", label: "Gentle", hint: "More support & scaffolding" },
  { key: "core", label: "Just right", hint: "Standard for my level" },
  { key: "stretch", label: "Stretch me", hint: "Harder extension questions" },
];
const QUESTION_TYPES: { key: string; label: string }[] = [
  { key: "multiple_choice", label: "Multiple choice" },
  { key: "short_answer", label: "Short answer" },
  { key: "worked_examples", label: "Work it through" },
  { key: "true_false", label: "True / false" },
  { key: "fill_blank", label: "Fill the gap" },
];
const PACES: { key: string; label: string; hint: string }[] = [
  { key: "slower", label: "Slower", hint: "Take your time" },
  { key: "just_right", label: "Just right", hint: "A steady pace" },
  { key: "faster", label: "Faster", hint: "Move quickly" },
];
const SUBJECTS = [
  "Maths", "English", "Science", "Biology", "Chemistry", "Physics",
  "History", "Geography", "Computer Science", "French", "Spanish", "Art",
];
const GOALS: { key: string; label: string }[] = [
  { key: "exam_prep", label: "Exam preparation" },
  { key: "homework", label: "Homework help" },
  { key: "mastery", label: "Master a topic" },
  { key: "confidence", label: "Build confidence" },
  { key: "independent", label: "Independent practice" },
];
const SESSION_LENGTHS = [20, 40, 60, 90];
const TEXT_SIZES: { key: TextSize; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "large", label: "Large" },
  { key: "larger", label: "Largest" },
];

/* ── Small presentational helpers ─────────────────────────────────────── */
function Chip({ active, onClick, children, disabled }: {
  active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={[
        "px-3.5 py-2 rounded-full border text-[13px] font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        disabled ? "opacity-50 cursor-not-allowed" : "",
        active
          ? "border-brand bg-brand text-white shadow-sm"
          : "border-line bg-surface text-ink hover:border-brand hover:text-brand",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function OptionCard({ active, onClick, label, hint }: {
  active: boolean; onClick: () => void; label: string; hint: string;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={[
        "flex flex-col items-start gap-0.5 p-3 rounded-xl border text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        active
          ? "border-brand bg-brand-light ring-1 ring-brand/30"
          : "border-line bg-surface hover:border-brand",
      ].join(" ")}
    >
      <span className="flex items-center gap-1.5 font-bold text-[13.5px] text-ink">
        {active && <Check size={14} className="text-brand" />}{label}
      </span>
      <span className="t-helper">{hint}</span>
    </button>
  );
}

function ToggleRow({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="t-body text-ink">{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

function Section({ icon, title, desc, children }: {
  icon: React.ReactNode; title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-brand-light text-brand flex items-center justify-center">
            {icon}
          </div>
          <div>
            <h2 className="t-card-title">{title}</h2>
            <p className="t-helper mt-0.5">{desc}</p>
          </div>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function TagInput({ value, onChange, placeholder }: {
  value: string[]; onChange: (v: string[]) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase()) && value.length < 20) {
      onChange([...value, t]);
    }
    setDraft("");
  };
  return (
    <div className="flex flex-wrap gap-2 items-center p-2 rounded-lg border border-line bg-surface">
      {value.map((tag) => (
        <span key={tag} className="flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full bg-brand-light text-brand text-[12.5px] font-semibold">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((v) => v !== tag))}
            className="w-4 h-4 rounded-full hover:bg-brand/20 flex items-center justify-center">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
        onBlur={add} placeholder={placeholder}
        className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-[13px] text-ink placeholder:text-ink-muted py-1"
      />
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
type Draft = {
  learning_style: string[];
  teaching_pace: string;
  learning_goals: string;
  default_session_length: number;
  voice_responses: boolean;
  show_hints: boolean;
  auto_start_next_topic: boolean;
  interests: string[];
  preferred_subjects: string[];
  challenge_level: string;
  question_types: string[];
  practice_after_explanation: boolean;
  goals: string[];
  accessibility: AccessibilityPrefs;
};

function toDraft(p: LearningPreferences): Draft {
  const tp = (p.teaching_preferences ?? {}) as Record<string, unknown>;
  return {
    learning_style: p.learning_style ?? [],
    teaching_pace: p.teaching_pace || "just_right",
    learning_goals: p.learning_goals ?? "",
    default_session_length: p.default_session_length || 60,
    voice_responses: p.voice_responses ?? true,
    show_hints: p.show_hints ?? true,
    auto_start_next_topic: p.auto_start_next_topic ?? false,
    interests: p.interests ?? [],
    preferred_subjects: p.preferred_subjects ?? [],
    challenge_level: (tp.challenge_level as string) || "core",
    question_types: Array.isArray(tp.question_types) ? (tp.question_types as string[]) : [],
    practice_after_explanation: tp.practice_after_explanation === true,
    goals: Array.isArray(tp.goals) ? (tp.goals as string[]) : [],
    accessibility: coerceA11y(tp.accessibility),
  };
}

export default function StudentPreferencesPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<number | null>(null);

  // Favourite-subject options come from the Resource Hub curriculum, never a hardcoded list.
  const [hubSubjects, setHubSubjects] = useState<string[]>([]);
  useEffect(() => {
    curriculumApi.getSubjects()
      .then((r) => setHubSubjects(r.subjects.map((s) => s.name)))
      .catch(() => setHubSubjects([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const p = await settingsApi.getLearningPreferences();
      const d = toDraft(p);
      setDraft(d);
      setBaseline(JSON.stringify(d));
      applyAccessibility(d.accessibility); // reflect the server copy immediately
    } catch {
      setError("We couldn't load your preferences. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => draft != null && JSON.stringify(draft) !== baseline, [draft, baseline]);

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const toggleIn = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  // Live-apply accessibility as the student toggles it (instant, testable feedback).
  const setA11y = (a: Partial<AccessibilityPrefs>) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d.accessibility, ...a };
      applyAccessibility(next);
      return { ...d, accessibility: next };
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    // Derive the prompt-consumed teaching_preferences booleans from the chips the
    // student picked, so both the "Learning style" and "Prefers" prompt lines agree.
    const ls = draft.learning_style;
    const teaching_preferences = {
      real_life_examples: ls.includes("examples"),
      step_by_step: ls.includes("step_by_step"),
      analogies: ls.includes("analogies"),
      worked_examples: ls.includes("worked_examples"),
      short_summaries: ls.includes("concise"),
      practice_as_we_go: draft.practice_after_explanation,
      challenge_level: draft.challenge_level,
      question_types: draft.question_types,
      practice_after_explanation: draft.practice_after_explanation,
      goals: draft.goals,
      accessibility: draft.accessibility,
    };
    try {
      const updated = await settingsApi.updateLearningPreferences({
        learning_style: draft.learning_style,
        teaching_pace: draft.teaching_pace,
        learning_goals: draft.learning_goals,
        default_session_length: draft.default_session_length,
        voice_responses: draft.voice_responses,
        show_hints: draft.show_hints,
        auto_start_next_topic: draft.auto_start_next_topic,
        interests: draft.interests,
        preferred_subjects: draft.preferred_subjects,
        teaching_preferences,
      });
      const d = toDraft(updated);
      setDraft(d);
      setBaseline(JSON.stringify(d));
      applyAccessibility(d.accessibility);
      setSaved(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Something went wrong saving your preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <PageHeader
            title="Learning preferences"
            subtitle="Tell your tutor how you like to learn. You can change these any time."
          />

          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : !draft ? (
            <Alert tone="danger" title="Couldn't load preferences">{error}</Alert>
          ) : (
            <>
              {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

              <div className="grid gap-5 xl:grid-cols-2 pb-24">
                {/* 1 — Learning style */}
                <Section icon={<Sparkles size={18} />} title="How I learn best"
                  desc="Pick anything that helps. Your tutor will lean on these.">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {LEARNING_STYLES.map((s) => (
                      <OptionCard key={s.key} label={s.label} hint={s.hint}
                        active={draft.learning_style.includes(s.key)}
                        onClick={() => patch({ learning_style: toggleIn(draft.learning_style, s.key) })} />
                    ))}
                  </div>
                </Section>

                {/* 2 — Practice */}
                <Section icon={<Target size={18} />} title="Practice & challenge"
                  desc="How hard, and what kind of questions you enjoy.">
                  <div className="t-label mb-2">Challenge level</div>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {CHALLENGE_LEVELS.map((c) => (
                      <OptionCard key={c.key} label={c.label} hint={c.hint}
                        active={draft.challenge_level === c.key}
                        onClick={() => patch({ challenge_level: c.key })} />
                    ))}
                  </div>
                  <div className="t-label mb-2">Question types I like</div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {QUESTION_TYPES.map((q) => (
                      <Chip key={q.key} active={draft.question_types.includes(q.key)}
                        onClick={() => patch({ question_types: toggleIn(draft.question_types, q.key) })}>
                        {q.label}
                      </Chip>
                    ))}
                  </div>
                  <div className="flex flex-col gap-3 pt-1">
                    <ToggleRow label="Give me a quick practice question after each explanation"
                      checked={draft.practice_after_explanation}
                      onChange={(v) => patch({ practice_after_explanation: v })} />
                    <ToggleRow label="Offer hints before showing the answer"
                      checked={draft.show_hints} onChange={(v) => patch({ show_hints: v })} />
                  </div>
                </Section>

                {/* 3 — Pace */}
                <Section icon={<Gauge size={18} />} title="Pace"
                  desc="How quickly you like to move through new ideas.">
                  <div className="grid grid-cols-3 gap-2">
                    {PACES.map((p) => (
                      <OptionCard key={p.key} label={p.label} hint={p.hint}
                        active={draft.teaching_pace === p.key}
                        onClick={() => patch({ teaching_pace: p.key })} />
                    ))}
                  </div>
                </Section>

                {/* 4 — Interests */}
                <Section icon={<Heart size={18} />} title="Interests & hobbies"
                  desc="Your tutor weaves these into examples to make ideas stick.">
                  <TagInput value={draft.interests} onChange={(v) => patch({ interests: v })}
                    placeholder="Type an interest and press Enter…" />
                </Section>

                {/* 5 — Subjects */}
                <Section icon={<BookOpen size={18} />} title="Favourite subjects"
                  desc="Subjects you enjoy most — for suggestions and encouragement.">
                  <div className="flex flex-wrap gap-2">
                    {(hubSubjects.length ? hubSubjects : SUBJECTS).map((s) => (
                      <Chip key={s} active={draft.preferred_subjects.includes(s)}
                        onClick={() => patch({ preferred_subjects: toggleIn(draft.preferred_subjects, s) })}>
                        {s}
                      </Chip>
                    ))}
                  </div>
                </Section>

                {/* 6 — Goals */}
                <Section icon={<Flag size={18} />} title="My goals"
                  desc="What you're working towards right now.">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {GOALS.map((g) => (
                      <Chip key={g.key} active={draft.goals.includes(g.key)}
                        onClick={() => patch({ goals: toggleIn(draft.goals, g.key) })}>
                        {g.label}
                      </Chip>
                    ))}
                  </div>
                  <textarea
                    value={draft.learning_goals} maxLength={400}
                    onChange={(e) => patch({ learning_goals: e.target.value })}
                    placeholder="Anything specific? e.g. 'Get confident with fractions before my test.'"
                    className="w-full min-h-[80px] p-3 rounded-lg border border-line bg-surface text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-y"
                  />
                </Section>

                {/* 7 — Session preferences */}
                <Section icon={<Clock size={18} />} title="Session preferences"
                  desc="Defaults for your live lessons.">
                  <div className="t-label mb-2">Default session length</div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {SESSION_LENGTHS.map((m) => (
                      <Chip key={m} active={draft.default_session_length === m}
                        onClick={() => patch({ default_session_length: m })}>
                        {m} min
                      </Chip>
                    ))}
                  </div>
                  <div className="flex flex-col gap-3">
                    <ToggleRow label="Read answers aloud (voice)"
                      checked={draft.voice_responses} onChange={(v) => patch({ voice_responses: v })} />
                    <ToggleRow label="Automatically start the next topic"
                      checked={draft.auto_start_next_topic} onChange={(v) => patch({ auto_start_next_topic: v })} />
                  </div>
                </Section>

                {/* 8 — Accessibility */}
                <Section icon={<Accessibility size={18} />} title="Accessibility"
                  desc="These change the app for you straight away.">
                  <div className="t-label mb-2">Text size</div>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {TEXT_SIZES.map((t) => (
                      <OptionCard key={t.key} label={t.label} hint={t.key === "default" ? "Standard" : t.key === "large" ? "+12%" : "+25%"}
                        active={draft.accessibility.text_size === t.key}
                        onClick={() => setA11y({ text_size: t.key })} />
                    ))}
                  </div>
                  <div className="flex flex-col gap-3">
                    <ToggleRow label="Dark mode"
                      checked={draft.accessibility.theme === "dark"} onChange={(v) => setA11y({ theme: v ? "dark" : "system" })} />
                    <ToggleRow label="Reduce motion & animations"
                      checked={draft.accessibility.reduced_motion} onChange={(v) => setA11y({ reduced_motion: v })} />
                    <ToggleRow label="Higher contrast colours"
                      checked={draft.accessibility.high_contrast} onChange={(v) => setA11y({ high_contrast: v })} />
                    <ToggleRow label="Show captions during voice lessons"
                      checked={draft.accessibility.captions} onChange={(v) => setA11y({ captions: v })} />
                  </div>
                </Section>

                {/* 9 — Privacy */}
                <Section icon={<ShieldCheck size={18} />} title="Your data & privacy"
                  desc="What we store and who can see it.">
                  <ul className="t-body flex flex-col gap-2 list-disc pl-5">
                    <li>Your preferences shape how your tutor teaches — they're never sold or shared with other students.</li>
                    <li>Your parent or teacher can see these preferences to help support your learning.</li>
                    <li>Your <strong>Key Stage</strong> and <strong>Year Group</strong> are set by your school and can't be changed here.</li>
                  </ul>
                  <div className="mt-3">
                    <Link to="/privacy"><Button variant="outline" size="sm">Privacy &amp; data requests</Button></Link>
                  </div>
                </Section>
              </div>

              {/* Sticky save bar */}
              <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
                style={{ paddingLeft: "var(--sidebar-width, 0)" }}>
                <div className="flex items-center justify-between gap-3 px-7 py-3 max-w-[1400px] mx-auto">
                  <div className="flex items-center gap-2 t-helper">
                    {saved ? (
                      <span className="flex items-center gap-1.5 text-success font-semibold"><Check size={15} /> Preferences saved</span>
                    ) : dirty ? (
                      <Badge tone="warning">Unsaved changes</Badge>
                    ) : (
                      <span>All changes saved</span>
                    )}
                  </div>
                  <Button onClick={save} disabled={!dirty || saving} loading={saving}>
                    Save changes
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
