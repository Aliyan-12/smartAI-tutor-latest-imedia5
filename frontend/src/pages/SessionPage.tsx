import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Lock, X, Pause, Play, Volume2, VolumeX, AlertTriangle } from "lucide-react";
import ResizablePanels from "../components/ResizablePanels";
import { appointmentsApi, assessmentsApi, sessionsApi, gamificationApi, slidesApi, voiceApi } from "../services/api";
import type { FillerManifest, FillerPhrase, FillerPick } from "../services/api";
import ChatWindow from "../components/ChatWindow";
import ChatInput from "../components/ChatInput";
import AssessmentMode from "../components/AssessmentMode";
import PostSessionScreen from "../components/PostSessionScreen";
import LessonSlide from "../components/LessonSlide";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import { useAuth } from "../context/AuthContext";
import type { Assessment, ChatMessage, SlideData } from "../types";

type SessionState = "loading" | "passcode" | "active" | "ended";
type LearnTab = "learn" | "test";

const SUBJECTS = [
  "Maths","Science","English","History","Geography",
  "Physics","Chemistry","Biology","Computer Science","French","Spanish",
];

function playCorrectSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      osc.start(t); osc.stop(t + 0.42);
    });
  } catch {}
}

function playWrongSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.32);
  } catch {}
}

const PHASES_20 = [
  { label: "Intro",    end: 2  },
  { label: "Teaching", end: 13 },
  { label: "Practice", end: 16 },
  { label: "Quiz",     end: 18 },
  { label: "Summary",  end: 20 },
];
const PHASES_30 = [
  { label: "Intro",    end: 3  },
  { label: "Teaching", end: 18 },
  { label: "Practice", end: 25 },
  { label: "Quiz",     end: 28 },
  { label: "Summary",  end: 30 },
];
const PHASES_60 = [
  { label: "Warm-Up",  end: 5  },
  { label: "Teaching", end: 30 },
  { label: "Practice", end: 45 },
  { label: "Quiz",     end: 55 },
  { label: "Summary",  end: 60 },
];
const PHASES_90 = [
  { label: "Warm-Up",     end: 5  },
  { label: "Teaching",    end: 40 },
  { label: "Brain Break", end: 50 },
  { label: "Practice",    end: 65 },
  { label: "Quiz",        end: 80 },
  { label: "Summary",     end: 90 },
];

function getPhasesForDuration(mins: number) {
  if (mins <= 22) return PHASES_20;
  if (mins <= 45) return PHASES_30;
  if (mins <= 70) return PHASES_60;
  return PHASES_90;
}

const DURATION_CONFIG: Record<number, { emoji: string; name: string; sublabel: string }> = {
  20: { emoji: "⚡", name: "Quick Boost",   sublabel: "20 mins" },
  40: { emoji: "⭐", name: "Core Learning", sublabel: "40 mins" },
  60: { emoji: "🚀", name: "Deep Learning", sublabel: "1 hour"  },
  90: { emoji: "🏆", name: "Intensive",     sublabel: "90 mins" },
};

const SUBJECT_EMOJIS: Record<string, string> = {
  Maths: "🔢", Mathematics: "🔢", Math: "🔢",
  Science: "🔬", Physics: "⚛️", Chemistry: "⚗️", Biology: "🧬",
  English: "📖", History: "📜", Geography: "🌍",
  "Computer Science": "💻", French: "🇫🇷", Spanish: "🇪🇸",
};

function getCurrentPhaseIndex(elapsedMin: number, phases: typeof PHASES_30) {
  for (let i = 0; i < phases.length; i++) {
    if (elapsedMin < phases[i].end) return i;
  }
  return phases.length - 1;
}

export default function SessionPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [codeDigits, setCodeDigits] = useState<string[]>(Array(6).fill(""));
  const [joinError, setJoinError] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [totalPausedMs, setTotalPausedMs] = useState(0);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionSubject, setSessionSubject] = useState("");
  const [learnTab, setLearnTab] = useState<LearnTab>("learn");
  const [isMobile, setIsMobile] = useState(false);
  const [isSmall, setIsSmall] = useState(false);
  const [mobilePanelView, setMobilePanelView] = useState<"chat" | "learn">("chat");
  const [xp, setXp] = useState(0);
  const timerRef = useRef<number | null>(null);

  const [practiceAssessment, setPracticeAssessment] = useState<Assessment | null>(null);
  const [testAssessment, setTestAssessment] = useState<Assessment | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [practiceResult, setPracticeResult] = useState<{ score: number; weak: string[]; strong: string[]; report: string } | null>(null);
  const [testResult, setTestResult] = useState<{
    score: number;
    weak: string[];
    strong: string[];
    report: string;
    questions: Array<{ question_text: string; is_correct: boolean | null }>;
    totalCorrect: number;
    topic: string;
  } | null>(null);
  const [practiceCurrentQ, setPracticeCurrentQ] = useState(0);
  const [testCurrentQ, setTestCurrentQ] = useState(0);
  const [practiceFeedback, setPracticeFeedback] = useState<{ selectedAnswer: number; isCorrect: boolean; explanation: string | null; correctAnswer: number | null } | null>(null);
  const [testFeedback, setTestFeedback] = useState<{ selectedAnswer: number; isCorrect: boolean; explanation: string | null; correctAnswer: number | null } | null>(null);
  const [practiceAnswering, setPracticeAnswering] = useState(false);
  const [testAnswering, setTestAnswering] = useState(false);

  // Single flag: blob shows while true; cleared when TTS fires (or stream ends if TTS off)
  const [aiWaiting, setAiWaiting] = useState(false);
  const aiWaitingRef = useRef(false);
  const [toolResults, setToolResults] = useState<Array<{ tool: string; data: Record<string, unknown>; id: string }>>([]);

  // Attachment / web-search opts for ChatInput
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [researchEnabled, setResearchEnabled] = useState(false);

  // Word-by-word reveal while TTS plays
  const [ttsRevealedText, setTtsRevealedText] = useState<string>("");
  const [revealContent, setRevealContent] = useState<string | null>(null);
  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localStreamRef = useRef<string>("");
  const lastAiIdBeforeSendRef = useRef<number | null>(null);

  // Thinking-filler player: short pre-recorded phrase shown + played during the
  // wait between "send" and the real response's TTS starting.
  const [fillerText, setFillerText] = useState<string | null>(null);
  const fillerActiveRef = useRef(false);
  const fillerGenRef = useRef(0); // invalidates stale sequences on rapid re-send
  const fillerAudioRef = useRef<HTMLAudioElement | null>(null);
  const fillerCacheRef = useRef<Map<string, string>>(new Map()); // slug -> objectURL
  const fillerManifestRef = useRef<FillerManifest | null>(null);

  const [sessionBriefing, setSessionBriefing] = useState<{
    hook?: string;
    what_you_will_learn?: string[];
    key_ideas?: Array<{ title: string; summary: string }>;
    key_terms?: string[];
    session_tip?: string;
  } | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  const hasAutoStartedRef = useRef(false);

  const {
    messages, streaming, streamContent, sendMessage, stopStreaming,
    initSessionChat, activeSessionId, quizOffer, clearQuizOffer, sendQuizFeedback,
  } = useChat();

  const { voiceStatus, playing, speakText, connectVoice, disconnectVoice, isVoiceActive, startStreamTTS, feedStreamTTS, endStreamTTS, cancelStreamTTS, sendQuizResult } = useVoice();
  const [voiceMessages, setVoiceMessages] = useState<{ role: string; content: string }[]>([]);
  const voiceMessagesRef = useRef<{ role: string; content: string }[]>([]);
  const voiceAiTurnRef = useRef("");
  const [voiceQuizTopic, setVoiceQuizTopic] = useState<string | null>(null);

  const [sessionKeyStage, setSessionKeyStage] = useState("");
  const [previewAppt, setPreviewAppt] = useState<{
    subject: string;
    title: string;
    key_stage: string;
    duration_minutes: number;
    description: string;
    passcode: string | null;
  } | null>(null);
  const [currentSlide, setCurrentSlide] = useState<SlideData | null>(null);
  const [slideHistory, setSlideHistory] = useState<SlideData[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const slidePollingRefs = useRef<Map<number, number>>(new Map());

  const apptId = appointmentId ? parseInt(appointmentId) : 0;

  const sessionPhases = getPhasesForDuration(durationMinutes);
  const phaseElapsedSeconds = durationMinutes * 60 - timeRemaining;
  const phaseElapsedMin = Math.floor(phaseElapsedSeconds / 60);
  const currentPhaseIdx = getCurrentPhaseIndex(phaseElapsedMin, sessionPhases);

  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);
  // Keep ref in sync; cancel active TTS stream immediately when user mutes
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
    if (!ttsEnabled) cancelStreamTTS();
  }, [ttsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep aiWaitingRef in sync for use in setTimeout callbacks
  useEffect(() => { aiWaitingRef.current = aiWaiting; }, [aiWaiting]);

  // ── Thinking-filler player helpers ──────────────────────────────────────
  const stopFiller = useCallback(() => {
    fillerActiveRef.current = false;
    fillerGenRef.current++;           // invalidate any in-flight sequence
    if (fillerAudioRef.current) {
      try { fillerAudioRef.current.pause(); } catch { /* ignore */ }
      fillerAudioRef.current = null;
    }
    setFillerText(null);
  }, []);

  const playFillerClip = useCallback((slug: string, text: string): Promise<void> => {
    return new Promise((resolve) => {
      setFillerText(text);
      const url = fillerCacheRef.current.get(slug);
      if (!url) { resolve(); return; }
      const audio = new Audio(url);
      fillerAudioRef.current = audio;
      const done = () => resolve();
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done;           // resolves at once if stopFiller() pauses it
      audio.play().catch(done);
    });
  }, []);

  // Pick + play one or two fillers while we wait for the real response's TTS.
  const startFillerSequence = useCallback(async (message: string) => {
    if (!ttsEnabledRef.current) return;       // muted -> plain blob, no filler
    if (!fillerManifestRef.current) return;    // manifest not loaded yet
    fillerActiveRef.current = true;
    const myGen = ++fillerGenRef.current;
    // Still the active sequence AND the student is still waiting?
    const alive = () => fillerGenRef.current === myGen && aiWaitingRef.current;

    let pick: FillerPick;
    try {
      pick = await voiceApi.pickFiller(message);
    } catch {
      if (fillerGenRef.current === myGen) fillerActiveRef.current = false;
      return;
    }
    if (!alive()) return;             // real TTS started / superseded while classifying

    await playFillerClip(pick.slug, pick.text);

    // Loop a 2nd filler if the student is still waiting (real TTS not yet started).
    if (alive()) {
      const m = fillerManifestRef.current;
      const bucket = m?.categories[pick.category] || m?.categories["thinking"];
      const phrases: FillerPhrase[] = bucket?.phrases ?? [];
      const second = phrases.length ? phrases[Math.floor(Math.random() * phrases.length)] : null;
      if (second) await playFillerClip(second.slug, second.text);
    }

    // Fillers exhausted but still waiting -> fall back to the plain pulsing blob.
    if (alive()) setFillerText(null);
  }, [playFillerClip]);

  // TTS word-by-word reveal: start when TTS begins playing
  useEffect(() => {
    if (playing) {
      stopFiller();              // real answer's TTS started -> kill any filler
      setAiWaiting(false);
      aiWaitingRef.current = false;
      const content = localStreamRef.current.trim();
      if (!content) return;
      const words = content.split(" ");
      setRevealContent(content);
      setTtsRevealedText(words[0] || "");
      let i = 1;
      if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
      revealIntervalRef.current = setInterval(() => {
        i++;
        setTtsRevealedText(words.slice(0, i).join(" "));
        if (i >= words.length) {
          clearInterval(revealIntervalRef.current!);
          revealIntervalRef.current = null;
        }
      }, 60);
    } else {
      if (revealIntervalRef.current) {
        clearInterval(revealIntervalRef.current);
        revealIntervalRef.current = null;
      }
      setRevealContent(null);
      setTtsRevealedText("");
    }
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup reveal interval on unmount
  useEffect(() => () => {
    if (revealIntervalRef.current) clearInterval(revealIntervalRef.current);
  }, []);

  // Pre-load the filler manifest + cache every clip as an object URL so playback
  // is instant later. Fillers are optional — any failure degrades to the blob.
  useEffect(() => {
    let cancelled = false;
    const cache = fillerCacheRef.current;
    (async () => {
      try {
        const manifest = await voiceApi.fillersManifest();
        if (cancelled) return;
        fillerManifestRef.current = manifest;
        const slugs: string[] = [];
        Object.values(manifest.categories || {}).forEach((c) =>
          (c.phrases || []).forEach((p) => slugs.push(p.slug))
        );
        await Promise.all(
          slugs.map(async (slug) => {
            if (cancelled || cache.has(slug)) return;
            try {
              const blob = await voiceApi.fillerAudioBlob(slug);
              if (cancelled) return;
              cache.set(slug, URL.createObjectURL(blob));
            } catch { /* skip individual clip */ }
          })
        );
      } catch { /* fillers unavailable — silent, blob fallback */ }
    })();
    return () => {
      cancelled = true;
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
      if (fillerAudioRef.current) {
        try { fillerAudioRef.current.pause(); } catch { /* ignore */ }
        fillerAudioRef.current = null;
      }
    };
  }, []);

  const handleJoin = async (overrideCode?: string) => {
    if (!appointmentId) return;
    setJoinError("");
    const code = overrideCode !== undefined ? overrideCode : passcode;
    try {
      const result = await appointmentsApi.joinSession(parseInt(appointmentId), code) as any;
      setSessionStartedAt(result.session_started_at);
      setDurationMinutes(result.duration_minutes);
      setSessionTitle(result.title);
      setSessionSubject(result.subject);
      setSessionKeyStage(result.key_stage || "");

      // Restore persisted pause state
      const savedPausedSeconds: number = result.total_paused_seconds || 0;
      setTotalPausedMs(savedPausedSeconds * 1000);

      if (result.status === "paused" && result.paused_at) {
        // Session was paused — restore frozen timer position
        const pausedAtMs = new Date(result.paused_at).getTime();
        // Add time elapsed since last pause to total, so timer stays frozen at paused position
        const extraSinceLastPause = Date.now() - pausedAtMs;
        setTotalPausedMs((savedPausedSeconds * 1000) + extraSinceLastPause);
        setIsPaused(true);
        setPausedAt(Date.now()); // mark as currently paused from now
      } else {
        setIsPaused(false);
        setPausedAt(null);
      }

      setSessionState("active");
      initSessionChat(parseInt(appointmentId));

      // Load persisted slides for this session
      try {
        const persistedSlides = await slidesApi.getSessionSlides(parseInt(appointmentId));
        if (persistedSlides.length > 0) {
          setSlideHistory(persistedSlides);
          setCurrentSlide(persistedSlides[persistedSlides.length - 1]);
          setSlideIndex(persistedSlides.length - 1);
        }
      } catch {}

      // Restore any in-progress test so a page refresh doesn't lose quiz state
      try {
        const latestTest = await sessionsApi.getLatestTest(parseInt(appointmentId));
        if (latestTest && latestTest.status === "in_progress" && latestTest.questions?.length > 0) {
          setTestAssessment(latestTest);
          const firstUnanswered = latestTest.questions.findIndex(
            (q) => q.student_answer == null
          );
          setTestCurrentQ(firstUnanswered >= 0 ? firstUnanswered : latestTest.questions.length - 1);
          setLearnTab("test");
        }
      } catch {}
    } catch (err: any) {
      setJoinError(err.message || "Invalid passcode or session unavailable");
    }
  };

  useEffect(() => {
    gamificationApi.getProfile().then((p: any) => setXp(p?.xp_total ?? 0)).catch(() => {});
  }, []);

  // On mount: fetch appointment details. If no passcode, auto-join immediately.
  useEffect(() => {
    if (!appointmentId) return;
    appointmentsApi.get(parseInt(appointmentId))
      .then((appt: any) => {
        setPreviewAppt({
          subject: appt.subject || "",
          title: appt.title || "",
          key_stage: appt.key_stage || "",
          duration_minutes: appt.duration_minutes || 60,
          description: appt.description || "",
          passcode: appt.passcode || null,
        });
        setDurationMinutes(appt.duration_minutes || 60);
        setSessionState("passcode");
      })
      .catch(() => setSessionState("passcode"));
  }, [appointmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sessionState !== "passcode" || !appointmentId) return;
    setBriefingLoading(true);
    appointmentsApi.getBriefing(parseInt(appointmentId))
      .then((data: any) => setSessionBriefing(data))
      .catch(() => setSessionBriefing(null))
      .finally(() => setBriefingLoading(false));
  }, [sessionState, appointmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizOffer) return;
    if (testAssessment || testLoading || testResult) return;
    if (sessionState !== "active" || isPaused) return;
    setLearnTab("test");
    handleStartTest();
  }, [quizOffer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Voice quiz trigger: when AI voice response contains a quiz offer
  useEffect(() => {
    if (!voiceQuizTopic) return;
    if (testAssessment || testLoading || testResult) { setVoiceQuizTopic(null); return; }
    setLearnTab("test");
    handleStartTest(voiceQuizTopic);
    setVoiceQuizTopic(null);
  }, [voiceQuizTopic]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start the lesson when the session becomes active and chat is empty
  useEffect(() => {
    if (sessionState !== "active") return;
    if (messages.length > 0) return;
    if (streaming) return;
    if (hasAutoStartedRef.current) return;
    if (!activeSessionId) return;
    hasAutoStartedRef.current = true;
    setTimeout(() => {
      const topicsMatch = previewAppt?.description?.match(/Topics:\s*([^\n]+)/);
      const topicText = topicsMatch?.[1] || sessionTitle || sessionSubject || "today's topic";
      sessionSend(`Let's start our lesson on ${topicText}! I'm ready to begin.`);
    }, 800);
  }, [sessionState, messages.length, streaming, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sessionState !== "active" || !sessionStartedAt || isPaused) return;

    const updateTimer = () => {
      const start = new Date(sessionStartedAt).getTime();
      const end = start + durationMinutes * 60 * 1000 + totalPausedMs;
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        // Await status update before showing PostSessionScreen — avoids report 400s
        appointmentsApi.updateStatus(apptId, "terminated")
          .catch(() => {})
          .finally(() => setSessionState("ended"));
      }
    };

    updateTimer();
    timerRef.current = window.setInterval(updateTimer, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionState, sessionStartedAt, durationMinutes, isPaused, totalPausedMs, apptId]);

  // Auto-read test question via TTS (both chat and voice mode)
  useEffect(() => {
    if (!testAssessment) return;
    const q = testAssessment.questions[testCurrentQ];
    if (!q) return;
    const opts = q.options.map((o, i) => `${["A", "B", "C", "D"][i]}: ${o}.`).join(" ");
    if (!ttsEnabledRef.current) return;
    startStreamTTS();
    feedStreamTTS(`Question ${testCurrentQ + 1}: ${q.question_text}. Options are: ${opts}`);
    endStreamTTS();
  }, [testCurrentQ, testAssessment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-read feedback via TTS (both chat and voice mode)
  useEffect(() => {
    if (!testFeedback) return;
    const result = testFeedback.isCorrect ? "Correct!" : "Not quite.";
    const explanation = testFeedback.explanation ? ` ${testFeedback.explanation}` : "";
    const fullText = `${result}${explanation}`;
    if (!ttsEnabledRef.current) return;
    startStreamTTS();
    feedStreamTTS(fullText);
    endStreamTTS();
  }, [testFeedback]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-read final test score via TTS (both chat and voice mode)
  useEffect(() => {
    if (!testResult || !ttsEnabledRef.current) return;
    const weakMsg = testResult.weak.length > 0 ? `Areas to review: ${testResult.weak.join(", ")}.` : "Great job on all topics!";
    startStreamTTS();
    feedStreamTTS(`Quiz complete! You scored ${Math.round(testResult.score)} percent. ${weakMsg}`);
    endStreamTTS();
  }, [testResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for tool_result events dispatched by useChat
  useEffect(() => {
    const handler = (e: Event) => {
      const { tool, data } = (e as CustomEvent).detail;
      setToolResults((prev) => [...prev, { tool, data, id: Date.now().toString() }]);
    };
    window.addEventListener("tool_result", handler);
    return () => window.removeEventListener("tool_result", handler);
  }, []);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 1024);
      setIsSmall(window.innerWidth < 600);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handlePause = async () => {
    if (isPaused) {
      // Resume — credit all time since local pausedAt into totalPausedMs
      const now = Date.now();
      const localPauseDuration = pausedAt ? now - pausedAt : 0;
      setTotalPausedMs((p) => p + localPauseDuration);
      setPausedAt(null);
      setIsPaused(false);
      await appointmentsApi.updateStatus(apptId, "started").catch(() => {});
    } else {
      // Pause — disconnect voice if active
      if (isVoiceActive) disconnectVoice();
      if (timerRef.current) clearInterval(timerRef.current);
      setPausedAt(Date.now());
      setIsPaused(true);
      await appointmentsApi.updateStatus(apptId, "paused").catch(() => {});
    }
  };

  const handleEndSession = async () => {
    setEnding(true);
    if (timerRef.current) clearInterval(timerRef.current);
    await appointmentsApi.updateStatus(apptId, "terminated").catch(() => {});
    setShowEndConfirm(false);
    setEnding(false);
    setSessionState("ended");
  };

  const handleStartPractice = async () => {
    if (!apptId) return;
    setPracticeLoading(true);
    setPracticeError(null);
    try {
      const a = await sessionsApi.startPractice(apptId);
      setPracticeAssessment(a);
      setPracticeCurrentQ(0);
      setPracticeFeedback(null);
    } catch (err: any) {
      setPracticeError(err.message || "Failed to generate practice questions");
    } finally {
      setPracticeLoading(false);
    }
  };

  const handleStartTest = async (topicOverride?: string) => {
    if (!apptId) return;
    setTestLoading(true);
    setTestError(null);
    try {
      const a = await sessionsApi.startTest(apptId, topicOverride ? { topic: topicOverride } : undefined);
      setTestAssessment(a);
      setTestCurrentQ(0);
      setTestFeedback(null);
    } catch (err: any) {
      setTestError(err.message || "Failed to generate test");
    } finally {
      setTestLoading(false);
    }
  };

  const handlePracticeAnswer = async (answerIndex: number) => {
    if (!practiceAssessment || practiceAnswering) return;
    setPracticeAnswering(true);
    try {
      const q = practiceAssessment.questions[practiceCurrentQ];
      const updated = await assessmentsApi.submitAnswer(practiceAssessment.id, {
        question_index: q.question_index,
        student_answer: answerIndex,
      }) as import("../types").AssessmentQuestion;
      setPracticeFeedback({
        selectedAnswer: answerIndex,
        isCorrect: updated.is_correct ?? false,
        explanation: updated.explanation,
        correctAnswer: updated.correct_answer,
      });
      setPracticeAssessment((prev) => {
        if (!prev) return prev;
        return { ...prev, questions: prev.questions.map((q2, i) => i === practiceCurrentQ ? { ...q2, ...updated } : q2) };
      });
    } catch (err: any) {
      setPracticeError(err.message || "Failed to submit answer");
    } finally {
      setPracticeAnswering(false);
    }
  };

  const handlePracticeNext = async () => {
    if (!practiceAssessment) return;
    const next = practiceCurrentQ + 1;
    if (next < practiceAssessment.questions.length) {
      setPracticeCurrentQ(next);
      setPracticeFeedback(null);
    } else {
      try {
        const completed = await assessmentsApi.complete(practiceAssessment.id) as Assessment;
        setPracticeResult({
          score: completed.score_percent ?? 0,
          weak: completed.weak_topics ?? [],
          strong: completed.strong_topics ?? [],
          report: completed.report_text ?? "",
        });
        setPracticeAssessment(null);
        setPracticeFeedback(null);
      } catch (err: any) {
        setPracticeError(err.message || "Failed to complete practice");
      }
    }
  };

  const handleTestAnswer = async (answerIndex: number) => {
    if (!testAssessment || testAnswering) return;
    setTestAnswering(true);
    try {
      const q = testAssessment.questions[testCurrentQ];
      const updated = await assessmentsApi.submitAnswer(testAssessment.id, {
        question_index: q.question_index,
        student_answer: answerIndex,
      }) as import("../types").AssessmentQuestion;
      const isCorrectAnswer = updated.is_correct ?? false;
      setTestFeedback({
        selectedAnswer: answerIndex,
        isCorrect: isCorrectAnswer,
        explanation: updated.explanation,
        correctAnswer: updated.correct_answer,
      });
      if (isCorrectAnswer) playCorrectSound(); else playWrongSound();
      setTestAssessment((prev) => {
        if (!prev) return prev;
        return { ...prev, questions: prev.questions.map((q2, i) => i === testCurrentQ ? { ...q2, ...updated } : q2) };
      });
    } catch (err: any) {
      setTestError(err.message || "Failed to submit answer");
    } finally {
      setTestAnswering(false);
    }
  };

  const handleTestNext = async () => {
    if (!testAssessment) return;
    const next = testCurrentQ + 1;
    if (next < testAssessment.questions.length) {
      setTestCurrentQ(next);
      setTestFeedback(null);
    } else {
      try {
        const capturedQuestions = testAssessment.questions;
        const completed = await assessmentsApi.complete(testAssessment.id) as Assessment;
        const quizScore = completed.score_percent ?? 0;
        const quizWeak: string[] = Array.isArray(completed.weak_topics) ? completed.weak_topics : [];
        const quizStrong: string[] = Array.isArray(completed.strong_topics) ? completed.strong_topics : [];
        const quizTopic = completed.topic || quizOffer?.topic || sessionSubject || "the quiz";
        setTestResult({
          score: quizScore,
          weak: quizWeak,
          strong: quizStrong,
          report: completed.report_text ?? "",
          questions: capturedQuestions.map((q) => ({
            question_text: q.question_text,
            is_correct: q.is_correct ?? null,
          })),
          totalCorrect: capturedQuestions.filter((q) => q.is_correct === true).length,
          topic: quizTopic,
        });
        setTestAssessment(null);
        setTestFeedback(null);
        clearQuizOffer();

        // Build per-question detail for the AI so it can address specific wrong answers
        const questionDetails = capturedQuestions.map((q) => ({
          question_text: q.question_text,
          chosen_text: q.student_answer !== null && q.student_answer !== undefined
            ? (q.options[q.student_answer] ?? `Option ${q.student_answer + 1}`)
            : "No answer",
          correct_text: q.correct_answer !== null && q.correct_answer !== undefined
            ? (q.options[q.correct_answer] ?? `Option ${q.correct_answer + 1}`)
            : "Unknown",
          is_correct: q.is_correct === true,
        }));

        // Notify AI of quiz result — adds a visible quiz_result bubble + AI responds in chat/voice
        if (isVoiceActive) {
          sendQuizResult(quizTopic, quizScore, quizStrong, quizWeak);
        } else if (activeSessionId) {
          lastAiIdBeforeSendRef.current = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;
          localStreamRef.current = "";
          setAiWaiting(true);
          aiWaitingRef.current = true;
          stopFiller();
          void startFillerSequence("I just finished the quiz, how did I do?");
          sendQuizFeedback(activeSessionId, quizTopic, quizScore, quizStrong, quizWeak, {
            onStreamStart: () => { localStreamRef.current = ""; if (ttsEnabledRef.current) startStreamTTS(); },
            onToken: (t: string) => { localStreamRef.current += t; if (ttsEnabledRef.current) feedStreamTTS(t); },
            onStreamComplete: () => {
              if (ttsEnabledRef.current) {
                endStreamTTS();
                setTimeout(() => {
                  if (aiWaitingRef.current) { setAiWaiting(false); aiWaitingRef.current = false; }
                }, 8000);
              } else {
                setAiWaiting(false);
                aiWaitingRef.current = false;
              }
            },
          }, questionDetails);
        }
      } catch (err: any) {
        setTestError(err.message || "Failed to complete test");
      }
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Merge DB messages with live voice transcripts so they stream in real-time
  const voiceChatMessages: ChatMessage[] = voiceMessages.map((m, i) => ({
    id: -(i + 1),
    chat_id: 0,
    role: m.role as "user" | "assistant",
    content: m.content,
    timestamp: new Date().toISOString(),
  }));
  const displayMessages = voiceChatMessages.length > 0
    ? [...messages, ...voiceChatMessages]
    : messages;
  voiceMessagesRef.current = voiceMessages; // keep ref in sync for stale-closure-free access

  const totalSeconds = durationMinutes * 60;
  const elapsedSeconds = totalSeconds - timeRemaining;
  const progressFraction = totalSeconds > 0 ? elapsedSeconds / totalSeconds : 0;
  const totalDots = 5;
  const filledDots = Math.round(progressFraction * totalDots);

  const isAmber = timeRemaining < 600 && timeRemaining >= 300;
  const isRed = timeRemaining < 300;
  const topBarBg = isRed
    ? "var(--danger)"
    : isAmber
    ? "#d97706"
    : "var(--accent-blue, var(--accent))";

  const MAX_SLIDES = 15;

  // Clean up any active slide polling intervals on unmount
  useEffect(() => {
    const refs = slidePollingRefs.current;
    return () => { refs.forEach((id) => clearInterval(id)); };
  }, []);

  const generateSlide = useCallback(async (text: string) => {
    if (!text || !text.trim()) return;
    if (slideHistory.length >= MAX_SLIDES) return;

    const result = await slidesApi.generate(
      text,
      sessionSubject,
      sessionKeyStage,
      apptId || undefined,
      slideHistory.map((s) => s.topic),
    );
    if (!result) return; // skipped by backend (not slide-worthy)

    const placeholder: SlideData = {
      slide_id: result.slide_id,
      status: "generating",
      topic: result.topic,
      presentation_id: null,
      viewer_url: null,
      pptx_url: null,
    };
    const newIndex = slideHistory.length;
    setSlideHistory((prev) => [...prev, placeholder]);
    setCurrentSlide(placeholder);
    setSlideIndex(newIndex);

    // Poll until ready or failed (max 3 min)
    const intervalId = window.setInterval(async () => {
      const updated = await slidesApi.getSlide(result.slide_id);
      if (!updated) return;
      if (updated.status === "ready" || updated.status === "failed") {
        clearInterval(intervalId);
        slidePollingRefs.current.delete(result.slide_id);
        setSlideHistory((prev) =>
          prev.map((s) => (s.slide_id === result.slide_id ? updated : s))
        );
        setCurrentSlide((prev) =>
          prev?.slide_id === result.slide_id ? updated : prev
        );
      }
    }, 3000);
    slidePollingRefs.current.set(result.slide_id, intervalId);
    setTimeout(() => {
      if (slidePollingRefs.current.has(result.slide_id)) {
        clearInterval(intervalId);
        slidePollingRefs.current.delete(result.slide_id);
      }
    }, 180_000);
  }, [sessionSubject, sessionKeyStage, apptId, slideHistory]);

  const sessionSend = useCallback(
    (text: string, sendOpts?: { imageData?: string; imageMime?: string; webSearch?: boolean; research?: boolean }) => {
      lastAiIdBeforeSendRef.current = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;
      localStreamRef.current = "";
      setAiWaiting(true);
      aiWaitingRef.current = true;
      stopFiller();
      void startFillerSequence(text);
      sendMessage(text, {
        suppressNavigation: true,
        onStreamStart: () => { localStreamRef.current = ""; if (ttsEnabledRef.current) startStreamTTS(); },
        onToken: (t: string) => { localStreamRef.current += t; if (ttsEnabledRef.current) feedStreamTTS(t); },
        onStreamComplete: () => {
          if (ttsEnabledRef.current) {
            endStreamTTS();
            // Safety: if TTS never fires within 8s, clear the blob
            setTimeout(() => {
              if (aiWaitingRef.current) {
                setAiWaiting(false);
                aiWaitingRef.current = false;
              }
            }, 8000);
          } else {
            setAiWaiting(false);
            aiWaitingRef.current = false;
          }
        },
        imageData: sendOpts?.imageData,
        imageMime: sendOpts?.imageMime,
        webSearch: sendOpts?.webSearch,
        research: sendOpts?.research,
      });
    },
    [messages, sendMessage, startStreamTTS, feedStreamTTS, endStreamTTS, stopFiller, startFillerSequence]
  );

  const handleVoiceToggle = useCallback(() => {
    if (isVoiceActive) {
      disconnectVoice();
      // Clear live voice transcripts and reload DB-saved messages after a short delay
      setVoiceMessages([]);
      setTimeout(() => { if (apptId) initSessionChat(apptId); }, 1200);
    } else {
      connectVoice(activeSessionId, {
        onUserTranscript: (chunk) => {
          setVoiceMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "user") {
              return [...prev.slice(0, -1), { role: "user", content: last.content + chunk }];
            }
            return [...prev, { role: "user", content: chunk }];
          });
        },
        onAiTranscriptChunk: (chunk) => {
          voiceAiTurnRef.current += chunk;
          // Recompute full clean text from accumulated buffer so any partial
          // bracket sequences still arriving are stripped from display.
          const displayText = voiceAiTurnRef.current
            .replace(/\[[A-Z_:][^\]]*$/, "") // strip partial [...] still arriving
            .trimEnd();
          setVoiceMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return [...prev.slice(0, -1), { role: "assistant", content: displayText }];
            }
            return displayText ? [...prev, { role: "assistant", content: displayText }] : prev;
          });
        },
        onTurnComplete: () => {
          voiceAiTurnRef.current = "";
        },
        onTurnSaved: () => {
          // Capture count before async DB reload to avoid stale closure
          const savedCount = voiceMessagesRef.current.length;
          if (apptId) {
            initSessionChat(apptId).then(() => {
              // Remove only the completed-turn messages; any new messages the user
              // started during the DB load are preserved (slice keeps them).
              setVoiceMessages((prev) => prev.slice(savedCount));
            });
          } else {
            setVoiceMessages([]);
          }
        },
        onCreditsUpdate: () => {},
        onSessionCreated: () => {},
        onError: (msg) => console.error("Voice error:", msg),
        onQuizOffer: (topic) => { setVoiceQuizTopic(topic); },
      }, apptId);
    }
  }, [isVoiceActive, connectVoice, disconnectVoice, activeSessionId, apptId, initSessionChat]);

  if (sessionState === "loading") {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <img src="/Original-Logo.png" alt="SmartAI Tutor" className="auth-logo" />
          <p style={{ marginTop: 16, color: "var(--text-secondary)", fontSize: 14 }}>Loading session...</p>
        </div>
      </div>
    );
  }

  if (sessionState === "passcode") {
    const subjKey = Object.keys(SUBJECT_EMOJIS).find((k) => k.toLowerCase() === (previewAppt?.subject ?? "").toLowerCase()) ?? "";
    const subjEmoji = SUBJECT_EMOJIS[subjKey] ?? "📚";
    const dur = previewAppt?.duration_minutes ?? 60;
    const durKey = ([20, 40, 60, 90] as const).reduce((acc, v) => (Math.abs(dur - v) < Math.abs(dur - acc) ? v : acc), 60 as 20 | 40 | 60 | 90);
    const durCfg = DURATION_CONFIG[durKey];

    const desc = previewAppt?.description ?? "";
    const topicsMatch = desc.match(/Topics:\s*([^\n]+)/);
    const sessionTypeMatch = desc.match(/Session type:\s*([^\n]+)/);
    const previewTopics = topicsMatch?.[1] ?? null;
    const previewSessionType = sessionTypeMatch?.[1] ?? null;
    const phases = getPhasesForDuration(dur);

    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-primary)", display: "flex", flexDirection: "column" }}>
        <style>{`
          @media (max-width: 600px) {
            .prelession-header-row { flex-direction: column !important; gap: 14px !important; }
            .prelession-dur-badge { align-self: flex-start !important; }
            .prelession-phases { overflow-x: auto; padding-bottom: 6px; }
            .prelession-grid { grid-template-columns: 1fr !important; }
          }
          @keyframes briefingSkeleton {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.8; }
          }
        `}</style>

        {/* Top nav — matches app header style */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 28px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <button
            onClick={() => navigate("/dashboard")}
            style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, color: "#475569", padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}
          >
            ← Back
          </button>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{subjEmoji}</span>
            <span style={{ color: "#0f172a", fontSize: 15, fontWeight: 700 }}>{previewAppt?.subject || "Session"}</span>
            {previewAppt?.key_stage && <span style={{ background: "#e8f0fe", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 700, color: "#1a73e8" }}>{previewAppt.key_stage}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 99, padding: "4px 12px" }}>
            <span>{durCfg?.emoji ?? "⭐"}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>{durCfg?.sublabel ?? `${dur} min`}</span>
          </div>
        </div>

        {/* Main 2-column layout */}
        <div style={{ flex: 1, overflowY: "auto", background: "#f8fafc" }}>
          <div className="prelession-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 24, padding: "28px 32px", maxWidth: 1200, margin: "0 auto", boxSizing: "border-box" }}>

            {/* ── LEFT COLUMN ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>

              {/* Hero card */}
              <div style={{ background: "linear-gradient(135deg, #1a73e8 0%, #1557b0 100%)", borderRadius: 20, padding: "26px 24px", color: "white", boxShadow: "0 4px 20px rgba(26,115,232,0.2)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -20, right: -20, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
                <div style={{ position: "absolute", bottom: -30, left: -10, width: 90, height: 90, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
                <div style={{ position: "relative" }}>
                  <div style={{ fontSize: 46, marginBottom: 10, lineHeight: 1 }}>{subjEmoji}</div>
                  {previewAppt?.key_stage && <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.6px" }}>{previewAppt.key_stage}</div>}
                  <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15, marginBottom: 6 }}>{previewAppt?.subject || "Session"}</div>
                  {previewAppt?.title && <div style={{ fontSize: 13, opacity: 0.88, fontWeight: 500, lineHeight: 1.45 }}>{previewAppt.title}</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                    <span style={{ background: "rgba(255,255,255,0.22)", borderRadius: 99, padding: "5px 13px", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      ⏱ {dur} mins
                    </span>
                    <span style={{ background: "rgba(255,255,255,0.22)", borderRadius: 99, padding: "5px 13px", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      📊 {(() => {
                        const st = (previewSessionType || "").toLowerCase();
                        if (st.includes("scratch") || st.includes("learn")) return "Beginner Friendly";
                        if (st.includes("revision")) return "Revision Mode";
                        if (st.includes("homework")) return "Homework Focus";
                        if (st.includes("catch")) return "Catch-Up Mode";
                        return previewSessionType || "Standard";
                      })()}
                    </span>
                    {previewTopics && (
                      <span style={{ background: "rgba(255,255,255,0.16)", borderRadius: 99, padding: "5px 13px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        🎯 {previewTopics}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Lesson phase timeline */}
              <div style={{ background: "white", borderRadius: 16, padding: "20px 22px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.7px", color: "#94a3b8", marginBottom: 18 }}>Today's Lesson Plan</div>
                <div className="prelession-phases" style={{ display: "flex", alignItems: "flex-start" }}>
                  {phases.map((phase, i) => {
                    const phaseColors = ["#1a73e8","#0ea5e9","#10b981","#f59e0b","#ef4444","#1557b0"];
                    const col = phaseColors[i % phaseColors.length];
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", flex: i < phases.length - 1 ? 1 : "0 0 auto" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 50 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: col, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, boxShadow: `0 3px 10px ${col}55`, flexShrink: 0 }}>
                            {i + 1}
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#334155", whiteSpace: "nowrap", textAlign: "center" }}>{phase.label}</span>
                          <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>{phase.end}m</span>
                        </div>
                        {i < phases.length - 1 && <div style={{ flex: 1, height: 2, background: `linear-gradient(90deg, ${col}44, ${phaseColors[(i+1) % phaseColors.length]}44)`, margin: "0 2px", marginBottom: 28, minWidth: 10, borderRadius: 2 }} />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SESSION ACCESS card — only shown when appointment has a passcode */}
              {previewAppt?.passcode && <div style={{ background: "white", borderRadius: 16, padding: "22px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Lock size={15} style={{ color: "#1a73e8" }} />
                  <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.6px", color: "#1a73e8" }}>Session Access</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 3 }}>Enter your lesson code</div>
                <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px", lineHeight: 1.5 }}>Your parent or teacher may have shared a lesson code.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* 6 boxes — full width */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {codeDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        id={`code-digit-${idx}`}
                        type="text"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                          const next = [...codeDigits];
                          next[idx] = val.slice(-1);
                          setCodeDigits(next);
                          setPasscode(next.join(""));
                          if (val && idx < 5) {
                            document.getElementById(`code-digit-${idx + 1}`)?.focus();
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !codeDigits[idx] && idx > 0) {
                            document.getElementById(`code-digit-${idx - 1}`)?.focus();
                          }
                          if (e.key === "Enter" && passcode.length === 6) handleJoin();
                        }}
                        onPaste={(e) => {
                          const pasted = e.clipboardData.getData("text").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
                          const next = Array(6).fill("");
                          pasted.split("").forEach((c, i) => { next[i] = c; });
                          setCodeDigits(next);
                          setPasscode(next.join(""));
                          e.preventDefault();
                        }}
                        style={{
                          flex: 1, minWidth: 0, height: 44, textAlign: "center", fontSize: 16, fontWeight: 800,
                          fontFamily: "monospace", background: digit ? "#eff6ff" : "#f8fafc",
                          border: digit ? "2px solid #1a73e8" : "2px solid #e2e8f0",
                          borderRadius: 10, color: "#0f172a", outline: "none",
                        }}
                        placeholder="—"
                      />
                    ))}
                  </div>
                </div>
                {joinError && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8, fontWeight: 600 }}>{joinError}</p>}
              </div>}

              {/* EVERYTHING'S READY card */}
              <div style={{ background: "white", borderRadius: 16, padding: "20px 22px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ fontSize: 36, lineHeight: 1, flexShrink: 0 }}>🚀</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>Everything's Ready!</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Your AI tutor is prepared and waiting.</div>
                    </div>
                  </div>
                  {(() => {
                    const needsCode = !!previewAppt?.passcode;
                    const codeReady = !needsCode || passcode.length === 6;
                    return (
                      <button
                        onClick={() => needsCode ? handleJoin() : handleJoin("")}
                        disabled={!codeReady}
                        title={needsCode && !codeReady ? "Enter your 6-character lesson code above first" : undefined}
                        style={{
                          padding: "12px 22px",
                          background: codeReady ? "#1a73e8" : "#e2e8f0",
                          color: codeReady ? "white" : "#94a3b8",
                          border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800,
                          cursor: codeReady ? "pointer" : "not-allowed",
                          display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit", whiteSpace: "nowrap" as const,
                          boxShadow: codeReady ? "0 4px 16px rgba(26,115,232,0.2)" : "none", flexShrink: 0,
                        }}
                      >
                        🚀 Start My Lesson
                      </button>
                    );
                  })()}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" as const }}>
                  {[
                    { icon: "📓", label: "Notebook recommended" },
                    { icon: "🎯", label: "Focus mode on" },
                    { icon: "💧", label: "Water break encouraged" },
                  ].map((badge) => (
                    <span key={badge.label} style={{ display: "flex", alignItems: "center", gap: 5, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 99, padding: "4px 11px", fontSize: 11, fontWeight: 600, color: "#475569" }}>
                      {badge.icon} {badge.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* ── RIGHT COLUMN — AI Briefing ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e8f0fe", border: "1.5px solid #c5d8fb", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                  <img src="/images/aitutor 4 schools-robo.png" style={{ width: 30, height: 30, objectFit: "contain" }} alt="AI Tutor" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>AI Session Briefing</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{briefingLoading ? "Preparing your session..." : "Your personalised session preview"}</div>
                </div>
              </div>

              {/* TODAY'S MISSION — always shown, dynamic based on subject/topic/goal */}
              {(() => {
                const st = (previewSessionType || "").toLowerCase();
                const topic = previewTopics || previewAppt?.title || previewAppt?.subject || "this topic";
                const subject = previewAppt?.subject || "this subject";
                let mission = "";
                if (st.includes("scratch") || st.includes("learn")) {
                  mission = `By the end of today, you'll confidently understand ${topic} and answer exam-style questions.`;
                } else if (st.includes("revision")) {
                  mission = `By the end of today, you'll have thoroughly revised ${topic} and reinforced key exam techniques.`;
                } else if (st.includes("homework")) {
                  mission = `By the end of today, you'll have completed your ${subject} homework on ${topic} with full understanding.`;
                } else if (st.includes("catch")) {
                  mission = `By the end of today, you'll have caught up on ${topic} and built confidence for upcoming assessments.`;
                } else {
                  mission = `By the end of today, you'll confidently understand ${topic} and be ready for your next steps.`;
                }
                return (
                  <div style={{ background: "white", borderRadius: 14, padding: "18px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.6px", color: "#ef4444", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                        🔥 Today's Mission
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", lineHeight: 1.6, margin: 0 }}>{mission}</p>
                    </div>
                    <div style={{ fontSize: 36, flexShrink: 0, opacity: 0.5 }}>⚛️</div>
                  </div>
                );
              })()}

              {briefingLoading ? (
                <>
                  {[1,2,3,4].map((_, i) => (
                    <div key={i} style={{ background: "white", borderRadius: 14, padding: "18px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                      <div style={{ height: 10, borderRadius: 6, background: "#e2e8f0", width: "40%", marginBottom: 12, animation: "briefingSkeleton 1.4s ease-in-out infinite" }} />
                      {[90,75,60].slice(0,i===3?1:3).map((w,j) => (
                        <div key={j} style={{ height: 10, borderRadius: 6, background: "#f1f5f9", width: `${w}%`, marginBottom: 8, animation: "briefingSkeleton 1.4s ease-in-out infinite" }} />
                      ))}
                    </div>
                  ))}
                </>
              ) : sessionBriefing ? (
                <>

                  {sessionBriefing.what_you_will_learn && sessionBriefing.what_you_will_learn.length > 0 && (
                    <div style={{ background: "white", borderRadius: 14, padding: "18px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.6px", color: "#10b981", marginBottom: 12 }}>✅ What You'll Learn</div>
                      <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                        {sessionBriefing.what_you_will_learn.map((obj, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#d1fae5", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                            <span style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.5, fontWeight: 500 }}>{obj}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {sessionBriefing.key_ideas && sessionBriefing.key_ideas.length > 0 && (
                    <div style={{ background: "white", borderRadius: 14, padding: "18px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.6px", color: "#1a73e8", marginBottom: 12 }}>💡 Key Ideas</div>
                      <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
                        {sessionBriefing.key_ideas.map((idea, i) => (
                          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1a73e8", flexShrink: 0, marginTop: 5 }} />
                            <div>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{idea.title}</span>
                              <span style={{ fontSize: 12, color: "#64748b", marginLeft: 6 }}>— {idea.summary}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {sessionBriefing.key_terms && sessionBriefing.key_terms.length > 0 && (
                    <div style={{ background: "white", borderRadius: 14, padding: "18px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: "0.6px", color: "#f59e0b", marginBottom: 12 }}>📖 Key Vocabulary</div>
                      <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 7 }}>
                        {sessionBriefing.key_terms.map((term, i) => (
                          <span key={i} style={{ background: "linear-gradient(135deg,#fffbeb,#fef3c7)", border: "1px solid #fde68a", borderRadius: 99, padding: "4px 12px", fontSize: 12, fontWeight: 700, color: "#92400e" }}>
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {sessionBriefing.session_tip && (
                    <div style={{ background: "linear-gradient(135deg,#fff7ed,#fef3c7)", border: "1px solid #fed7aa", borderRadius: 14, padding: "16px 18px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 22, flexShrink: 0 }}>💡</span>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#c2410c", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>Session Tip</div>
                        <p style={{ fontSize: 13, color: "#7c2d12", margin: 0, lineHeight: 1.55, fontWeight: 500 }}>{sessionBriefing.session_tip}</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ background: "white", borderRadius: 14, padding: "32px 20px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                  <img src="/images/aitutor 4 schools-robo.png" style={{ width: 48, height: 48, objectFit: "contain", marginBottom: 8 }} alt="AI Tutor" />
                  <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>AI briefing will appear here shortly.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (sessionState === "ended") {
    return (
      <PostSessionScreen
        appointmentId={apptId}
        sessionTitle={sessionTitle}
        sessionSubject={sessionSubject}
        durationMinutes={durationMinutes}
      />
    );
  }

  const learnPanelInner = (
    <>
      <div style={styles.tabs}>
        {(["learn", "test"] as LearnTab[]).map((tab) => (
          <button
            key={tab}
            style={{
              ...styles.tabBtn,
              ...(learnTab === tab ? styles.tabBtnActive : {}),
            }}
            onClick={() => setLearnTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div style={styles.learnContent}>
        {isPaused ? (
          <div style={styles.pausedOverlay}>
            <span style={{ fontSize: 32 }}>⏸</span>
            <p style={styles.pausedOverlayText}>Session is paused</p>
            <p style={styles.pausedOverlaySub}>Resume the session to continue learning.</p>
            <button style={styles.pausedResumeBtn} onClick={handlePause}>
              ▶ Resume Session
            </button>
          </div>
        ) : null}
        {!isPaused && learnTab === "learn" && (
          <div style={styles.learnMessagesWrap}>
            <LessonSlide
              slide={currentSlide}
              slideIndex={slideIndex}
              totalSlides={slideHistory.length}
              onPrev={() => {
                const i = Math.max(0, slideIndex - 1);
                setSlideIndex(i);
                setCurrentSlide(slideHistory[i]);
              }}
              onNext={() => {
                const i = Math.min(slideHistory.length - 1, slideIndex + 1);
                setSlideIndex(i);
                setCurrentSlide(slideHistory[i]);
              }}
            />
          </div>
        )}

        {!isPaused && learnTab === "test" && (
          <div style={{ padding: "16px", position: "relative" }}>
            {testResult ? (
              <div>
                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  <span style={{ fontSize: 40 }}>🏅</span>
                  <p style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", margin: "6px 0 4px" }}>Quiz Complete!</p>
                  <div style={{ fontSize: 40, fontWeight: 800, color: testResult.score >= 60 ? "#10b981" : "#f97316", lineHeight: 1, margin: "2px 0 6px" }}>
                    {Math.round(testResult.score)}%
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                    {testResult.totalCorrect} of {testResult.questions.length} correct on <strong style={{ color: "var(--text-primary)" }}>{testResult.topic}</strong>
                  </p>
                </div>
                {/* Score bar */}
                <div style={{ height: 6, background: "var(--border-color)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
                  <div style={{ height: "100%", width: `${testResult.score}%`, background: testResult.score >= 60 ? "#10b981" : "#f97316", borderRadius: 99, transition: "width 0.6s ease" }} />
                </div>
                {/* Areas */}
                <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  {testResult.weak.length > 0 && (
                    <div style={{ flex: 1 }}>
                      <p style={styles.chipLabel}>Areas to Improve</p>
                      <div style={styles.chipRow}>
                        {testResult.weak.map((t) => <span key={t} style={styles.weakChip}>{t}</span>)}
                      </div>
                    </div>
                  )}
                  {testResult.strong.length > 0 && (
                    <div style={{ flex: 1 }}>
                      <p style={styles.chipLabel}>Strong Areas</p>
                      <div style={styles.chipRow}>
                        {testResult.strong.map((t) => <span key={t} style={styles.strongChip}>{t}</span>)}
                      </div>
                    </div>
                  )}
                </div>
                {/* Question breakdown */}
                {testResult.questions.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <p style={styles.chipLabel}>Question Breakdown</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {testResult.questions.map((q, i) => (
                        <div key={i} style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: `1px solid ${q.is_correct ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`,
                          background: q.is_correct ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                        }}>
                          <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{q.is_correct ? "✅" : "❌"}</span>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", margin: 0, lineHeight: 1.45 }}>
                            Q{i + 1}. {q.question_text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={styles.testSavedNote}>Your results have been saved and are visible to your teacher and parent.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  <button style={styles.generateBtn} onClick={() => navigate("/progress")}>View My Progress</button>
                  <button
                    style={{ ...styles.generateBtn, background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)" }}
                    onClick={() => { setTestResult(null); setTestAssessment(null); setTestCurrentQ(0); setTestFeedback(null); }}
                  >
                    Back to Learning
                  </button>
                </div>
              </div>
            ) : testAssessment ? (
              <div>
                {/* Progress header */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                      Question {testCurrentQ + 1} of {testAssessment.questions.length}
                    </span>
                    {quizOffer?.topic && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>{quizOffer.topic}</span>
                    )}
                  </div>
                  <div style={{ height: 4, background: "var(--border-color)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(testCurrentQ / testAssessment.questions.length) * 100}%`, background: "var(--accent-blue, var(--accent))", borderRadius: 99, transition: "width 0.4s ease" }} />
                  </div>
                </div>
                {/* Question text */}
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.55, marginBottom: 14 }}>
                  {testAssessment.questions[testCurrentQ].question_text}
                </p>
                {/* Options */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {testAssessment.questions[testCurrentQ].options.map((opt, idx) => {
                    let optStyle: React.CSSProperties = { ...styles.quizOptionBtn };
                    if (testFeedback) {
                      if (testFeedback.correctAnswer !== null && idx === testFeedback.correctAnswer) {
                        optStyle = { ...optStyle, background: "rgba(16,185,129,0.08)", borderColor: "#10b981", color: "#10b981", fontWeight: 700 };
                      } else if (idx === testFeedback.selectedAnswer && !testFeedback.isCorrect) {
                        optStyle = { ...optStyle, background: "rgba(239,68,68,0.08)", borderColor: "#ef4444", color: "#ef4444" };
                      } else {
                        optStyle = { ...optStyle, opacity: 0.4 };
                      }
                    }
                    return (
                      <button key={idx} disabled={!!testFeedback || testAnswering} onClick={() => handleTestAnswer(idx)} style={optStyle}>
                        <span style={{ ...styles.optionLabel, borderColor: testFeedback && testFeedback.correctAnswer === idx ? "#10b981" : testFeedback && testFeedback.selectedAnswer === idx && !testFeedback.isCorrect ? "#ef4444" : "var(--border-color)" }}>
                          {["A","B","C","D"][idx]}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {/* Feedback */}
                {testFeedback && (
                  <div style={{ ...styles.feedbackBox, background: testFeedback.isCorrect ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", borderColor: testFeedback.isCorrect ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: testFeedback.explanation ? 4 : 0 }}>
                      <span style={{ fontSize: 14 }}>{testFeedback.isCorrect ? "✅" : "❌"}</span>
                      <p style={{ fontSize: 13, fontWeight: 700, color: testFeedback.isCorrect ? "#10b981" : "#ef4444", margin: 0 }}>
                        {testFeedback.isCorrect ? "Correct!" : "Not quite."}
                      </p>
                    </div>
                    {testFeedback.explanation && <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>{testFeedback.explanation}</p>}
                  </div>
                )}
                {testFeedback && (
                  <button style={styles.generateBtn} onClick={handleTestNext}>
                    {testCurrentQ + 1 < testAssessment.questions.length ? "Next Question →" : "See Results"}
                  </button>
                )}
                {testError && <p style={{ ...styles.errorText, marginTop: 8 }}>{testError}</p>}
              </div>
            ) : (
              <div style={styles.assessCard}>
                {quizOffer && (
                  <div style={{ padding: "8px 12px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "var(--accent-blue, var(--accent))", fontWeight: 600, textAlign: "center" }}>
                    🤖 Your AI tutor suggested a quiz on <em>{quizOffer.topic}</em>
                  </div>
                )}
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  <span style={{ fontSize: 32 }}>📝</span>
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6, textAlign: "center" }}>Formal Test</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, textAlign: "center", marginBottom: 12 }}>
                  Complete a 10-question test on this session's topic. Results will be saved to your progress record.
                </p>
                <div style={styles.testWarning}>
                  Your score will be recorded and shared with your teacher.
                </div>
                {testError && <p style={{ ...styles.errorText, marginBottom: 10 }}>{testError}</p>}
                {isPaused ? (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 10 }}>Resume session to access the test</p>
                ) : (
                  <button
                    style={{ ...styles.generateBtn, marginTop: 12 }}
                    onClick={() => handleStartTest()}
                    disabled={testLoading}
                  >
                    {testLoading ? "Generating..." : "Start Test"}
                  </button>
                )}
              </div>
            )}
            {playing && !testAssessment && !testResult && (
              <div style={styles.ttsOverlay}>
                <span style={{ fontSize: 36 }}>🔊</span>
                <p style={styles.pausedOverlayText}>AI Tutor is speaking...</p>
                <p style={styles.pausedOverlaySub}>Wait for the lecture to end before taking the test.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  const avatarInner = (
    <>
      <div style={styles.avatarBox}>
        <div style={styles.avatarPulse} className={voiceStatus !== "idle" ? "avatar-pulse-anim" : ""}>
          <img src="/images/aitutor 4 schools-robo.png" style={{ width: "100%", height: "100%", objectFit: "contain" }} alt="AI Tutor" />
        </div>
        <p style={styles.avatarCaption}>AI Tutor Avatar</p>
        <p style={styles.avatarSub}>Coming Soon</p>
      </div>
      {voiceStatus !== "idle" && (
        <div style={styles.speakingBadge}>
          <span style={styles.speakingDot} />
          AI Tutor is speaking...
        </div>
      )}
    </>
  );

  const chatPanelInner = (
    <>
      <div style={styles.chatPanelHeader}>
        <span style={styles.chatPanelTitle}>Classroom Chat</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            title={ttsEnabled ? "Read aloud: on" : "Read aloud: off"}
            onClick={() => setTtsEnabled(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 8px", borderRadius: 99, border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 600,
              background: ttsEnabled ? "rgba(26,115,232,0.12)" : "rgba(0,0,0,0.06)",
              color: ttsEnabled ? "#1a73e8" : "var(--text-muted)",
              transition: "all 0.18s",
            }}
          >
            {ttsEnabled
              ? <Volume2 size={13} />
              : <VolumeX size={13} />}
            {ttsEnabled ? "Read aloud" : "Muted"}
          </button>
          <span style={styles.handRaise}>✋ Raise Hand</span>
        </div>
      </div>

      <div style={styles.chatMessages}>
        {isPaused && (
          <div style={styles.pausedOverlay}>
            <span style={{ fontSize: 32 }}>⏸</span>
            <p style={styles.pausedOverlayText}>Session is paused</p>
            <p style={styles.pausedOverlaySub}>Resume the session to continue chatting with your AI tutor.</p>
            <button style={styles.pausedResumeBtn} onClick={handlePause}>
              ▶ Resume Session
            </button>
          </div>
        )}
        {!isPaused && messages.length === 0 && !streaming ? (
          <div style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
            <style>{`
              @keyframes sp-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
            `}</style>
            <img src="/images/teaching-robot.png" alt="AI Tutor"
              style={{ width: 80, height: 80, objectFit: "contain", animation: "sp-float 3s ease-in-out infinite" }} />
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>Starting your lesson... 🚀</p>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>Your AI tutor is preparing a personalised lesson for you.</p>
            </div>
          </div>
        ) : !isPaused ? (
          <>
            <ChatWindow
              messages={displayMessages}
              streaming={streaming}
              streamContent={streamContent}
              onSpeak={speakText}
              isWaiting={aiWaiting}
              revealContent={revealContent}
              revealedText={ttsRevealedText}
              lastKnownAiId={lastAiIdBeforeSendRef.current}
              fillerText={fillerText}
            />
            {toolResults.map((tr) => {
              if (tr.tool === "set_homework") {
                return (
                  <div key={tr.id} style={{
                    background: "#e8f0fe",
                    border: "1.5px solid #c5d8fb",
                    borderRadius: 12,
                    padding: "12px 16px",
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    maxWidth: 420,
                  }}>
                    <span style={{ fontSize: 22 }}>📚</span>
                    <div>
                      <div style={{ fontWeight: 600, color: "#1557b0", fontSize: 13 }}>
                        Homework Set
                      </div>
                      <div style={{ color: "#0f172a", fontSize: 13 }}>
                        {tr.data.title as string}
                      </div>
                      <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>
                        Due: {tr.data.due_date ? new Date(tr.data.due_date as string).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "—"}
                      </div>
                    </div>
                  </div>
                );
              }
              if (tr.tool === "evaluate_answer") {
                const score = tr.data.score as number;
                const maxScore = tr.data.max_score as number;
                const correct = tr.data.correct as boolean;
                const borderColor = score >= 2 ? "#10b981" : score === 1 ? "#f59e0b" : "#ef4444";
                const bgColor = score >= 2 ? "#d1fae5" : score === 1 ? "#fef3c7" : "#fee2e2";
                const badgeBg = borderColor;
                const misconceptions = (tr.data.misconceptions as string[]) ?? [];
                return (
                  <div key={tr.id} style={{
                    background: bgColor,
                    border: `1.5px solid ${borderColor}`,
                    borderRadius: 12,
                    padding: "12px 16px",
                    marginTop: 8,
                    maxWidth: 480,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                        {score}/{maxScore} marks
                      </span>
                      <span style={{
                        background: badgeBg,
                        color: "#fff", borderRadius: 6, padding: "1px 8px", fontSize: 11, fontWeight: 600,
                      }}>
                        {correct ? "Correct" : "Needs work"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#0f172a", marginBottom: 4 }}>
                      {tr.data.feedback as string}
                    </div>
                    {misconceptions.length > 0 && (
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                        <span style={{ fontWeight: 600 }}>Watch out for: </span>
                        {misconceptions.join(", ")}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </>
        ) : null}
      </div>

      <div style={styles.chatInputWrap}>
        <ChatInput
          onSend={(text, opts) => sessionSend(text, opts)}
          streaming={streaming}
          onStop={stopStreaming}
          voiceStatus={voiceStatus}
          onVoiceStart={handleVoiceToggle}
          onVoiceEnd={disconnectVoice}
          disabled={isPaused}
          webSearchEnabled={webSearchEnabled}
          onWebSearchToggle={() => setWebSearchEnabled((v) => !v)}
          researchEnabled={researchEnabled}
          onResearchToggle={() => setResearchEnabled((v) => !v)}
        />
      </div>
    </>
  );

  return (
    <div style={styles.root}>
      <div style={{ ...styles.topBar, background: topBarBg, height: isSmall ? 46 : 52, padding: isSmall ? "0 10px" : "0 20px" }}>
        {/* LEFT — back + progress + title */}
        <div style={{ ...styles.topBarLeft, gap: isSmall ? 6 : 10 }}>
          <button
            style={{ ...styles.dashboardBtn, padding: isSmall ? "4px 8px" : "4px 10px" }}
            onClick={() => navigate("/student/dashboard")}
            title="Back to Dashboard"
          >
            {isSmall ? "←" : "← Dashboard"}
          </button>
          {!isSmall && (
            <div style={styles.dotProgress}>
              {Array.from({ length: totalDots }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    ...styles.dot,
                    background: i < filledDots ? "white" : "rgba(255,255,255,0.35)",
                  }}
                />
              ))}
            </div>
          )}
          {!isSmall && (
            <span style={styles.topBarTitle}>
              {sessionSubject || "Session"}{sessionTitle ? ` · ${sessionTitle}` : ""}
            </span>
          )}
        </div>

        {/* CENTER — timer */}
        <div style={styles.topBarCenter}>
          {!isSmall && <span style={styles.timerEmoji}>{isPaused ? "⏸" : "⏱"}</span>}
          <span style={{ ...styles.timerText, fontSize: isSmall ? 16 : 22, opacity: isPaused ? 0.6 : 1 }}>
            {formatTime(timeRemaining)}
          </span>
          <span style={{ ...styles.timerLabel, fontSize: isSmall ? 10 : 11 }}>
            {isPaused ? "paused" : "left"}
          </span>
        </div>

        {/* RIGHT — XP + pause + end */}
        <div style={{ ...styles.topBarRight, gap: isSmall ? 6 : 10 }}>
          {!isSmall && <span style={styles.xpChip}>🔥 {xp} XP</span>}
          {isMobile && !isSmall && isPaused && (
            <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(255,255,255,0.2)", borderRadius: 99, padding: "3px 8px" }}>
              ⏸
            </span>
          )}
          <button
            style={{
              ...styles.endBtn,
              background: isPaused ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.15)",
              padding: isSmall ? "5px 8px" : "5px 12px",
            }}
            onClick={handlePause}
            title={isPaused ? "Resume session" : "Pause session"}
          >
            {isPaused
              ? <><Play size={14} style={isSmall ? {} : { marginRight: 4 }} />{!isSmall && "Resume"}</>
              : <><Pause size={14} style={isSmall ? {} : { marginRight: 4 }} />{!isSmall && "Pause"}</>
            }
          </button>
          <button
            style={{ ...styles.endBtn, padding: isSmall ? "5px 8px" : "5px 12px" }}
            onClick={() => setShowEndConfirm(true)}
            title="End session"
          >
            <X size={14} style={isSmall ? {} : { marginRight: 4 }} />
            {!isSmall && "End Lesson"}
          </button>
        </div>
      </div>

      {sessionState === "active" && !isPaused && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 0, padding: "0 16px", height: 36,
          background: "linear-gradient(135deg, #1565c0 0%, #1a73e8 60%, #4f46e5 100%)",
          borderBottom: "2px solid rgba(255,255,255,0.15)",
        }}>
          {sessionPhases.map((phase, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 12px",
                borderRadius: 99, fontSize: 11, fontWeight: i === currentPhaseIdx ? 700 : 500,
                background: i < currentPhaseIdx
                  ? "#22c55e"
                  : i === currentPhaseIdx
                  ? "#ffffff"
                  : "transparent",
                color: i < currentPhaseIdx
                  ? "#ffffff"
                  : i === currentPhaseIdx
                  ? "#1a56db"
                  : "rgba(255,255,255,0.65)",
                boxShadow: i === currentPhaseIdx ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
                transition: "all 0.35s ease",
                whiteSpace: "nowrap",
              }}>
                {i < currentPhaseIdx && <span style={{ fontSize: 9, fontWeight: 800 }}>✓</span>}
                {phase.label}
              </div>
              {i < sessionPhases.length - 1 && (
                <div style={{
                  width: 22, height: 1,
                  background: i < currentPhaseIdx ? "rgba(34,197,94,0.6)" : "rgba(255,255,255,0.25)",
                  transition: "background 0.35s ease",
                }} />
              )}
            </div>
          ))}
        </div>
      )}

      <div style={styles.panels}>
        {isMobile ? (
          <>
            {/* Compact avatar strip */}
            <div style={{
              width: 110,
              flexShrink: 0,
              borderRight: "1px solid var(--border-color)",
              background: "var(--bg-primary)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "14px 8px",
            }}>
              <div style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "rgba(99,102,241,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }} className={voiceStatus !== "idle" ? "avatar-pulse-anim" : ""}>
                <img src="/images/aitutor 4 schools-robo.png" style={{ width: 34, height: 34, objectFit: "contain" }} alt="AI Tutor" />
              </div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#334155", textAlign: "center", margin: 0, lineHeight: 1.3 }}>
                AI Tutor
              </p>
              <span style={{ fontSize: 9, background: "#fef3c7", color: "#92400e", borderRadius: 99, padding: "2px 7px", fontWeight: 600 }}>
                Avatar
              </span>
              {voiceStatus !== "idle" && (
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "var(--accent-blue, #3b82f6)",
                  animation: "avatarPulse 1.2s ease-in-out infinite",
                  flexShrink: 0,
                }} />
              )}
            </div>

            {/* Switching content panel */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Mini panel switcher */}
              <div style={{
                display: "flex",
                borderBottom: "2px solid var(--border-color)",
                background: "var(--bg-secondary)",
                flexShrink: 0,
              }}>
                {([
                  { id: "chat", label: "💬 Chat" },
                  { id: "learn", label: "📖 Learn" },
                ] as { id: "chat" | "learn"; label: string }[]).map((tab) => (
                  <button
                    key={tab.id}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      border: "none",
                      background: "transparent",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: mobilePanelView === tab.id ? "var(--accent-blue, #3b82f6)" : "var(--text-muted)",
                      borderBottom: mobilePanelView === tab.id ? "2px solid var(--accent-blue, #3b82f6)" : "2px solid transparent",
                      marginBottom: -2,
                      transition: "color 0.15s, border-color 0.15s",
                      fontFamily: "inherit",
                    }}
                    onClick={() => setMobilePanelView(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Panel content */}
              {mobilePanelView === "chat" ? (
                <div style={{ ...styles.chatPanel, flex: 1 }}>
                  {chatPanelInner}
                </div>
              ) : (
                <div style={{ ...styles.learnPanel, width: "auto", flex: 1, borderRight: "none" }}>
                  {learnPanelInner}
                </div>
              )}
            </div>
          </>
        ) : (
          <ResizablePanels
            panels={[
              { id: "learn",  label: "Learn",  content: <div style={{ ...styles.learnPanel,  width: "100%", borderRight: "none" }}>{learnPanelInner}</div> },
              { id: "avatar", label: "Avatar", content: <div style={{ ...styles.avatarPanel, width: "100%", borderRight: "none" }}>{avatarInner}</div> },
              { id: "chat",   label: "Chat",   content: <div style={{ ...styles.chatPanel,   flex: 1 }}>{chatPanelInner}</div> },
            ]}
            initialWidths={[35, 30, 35]}
          />
        )}
      </div>

      {showEndConfirm && (
        <div
          style={styles.endModalOverlay}
          onClick={() => { if (!ending) setShowEndConfirm(false); }}
        >
          <div
            style={styles.endModalCard}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="end-modal-title"
          >
            <div style={styles.endModalIconWrap}>
              <AlertTriangle size={28} color="#dc2626" strokeWidth={2.4} />
            </div>
            <h2 id="end-modal-title" style={styles.endModalTitle}>End this lesson?</h2>
            <p style={styles.endModalText}>
              Your lesson is still in progress. If you end now, the AI tutor will stop
              and a session summary will be generated. You can’t resume this session
              afterwards.
            </p>
            <div style={styles.endModalActions}>
              <button
                style={styles.endModalCancelBtn}
                onClick={() => setShowEndConfirm(false)}
                disabled={ending}
              >
                Keep Learning
              </button>
              <button
                style={{ ...styles.endModalConfirmBtn, opacity: ending ? 0.7 : 1, cursor: ending ? "wait" : "pointer" }}
                onClick={handleEndSession}
                disabled={ending}
              >
                {ending ? "Ending…" : "End Lesson"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes avatarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.3); }
          50% { box-shadow: 0 0 0 18px rgba(99,102,241,0); }
        }
        .avatar-pulse-anim {
          animation: avatarPulse 2.4s ease-in-out infinite;
        }
        @keyframes endModalFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes endModalPop {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg-primary)",
  },
  endModalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(15, 23, 42, 0.55)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    animation: "endModalFade 0.18s ease",
  },
  endModalCard: {
    width: "100%",
    maxWidth: 420,
    background: "#ffffff",
    borderRadius: 20,
    padding: "30px 28px 24px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
    textAlign: "center",
    animation: "endModalPop 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
  },
  endModalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "#fee2e2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
  },
  endModalTitle: {
    fontSize: 21,
    fontWeight: 800,
    color: "#0f172a",
    margin: "0 0 10px",
  },
  endModalText: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "#475569",
    margin: "0 0 24px",
  },
  endModalActions: {
    display: "flex",
    gap: 12,
  },
  endModalCancelBtn: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "1.5px solid #e2e8f0",
    background: "#ffffff",
    color: "#334155",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  endModalConfirmBtn: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 6px 16px rgba(220,38,38,0.35)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "white",
    flexShrink: 0,
    transition: "background 0.5s",
    minWidth: 0,
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  dashboardBtn: {
    display: "flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 8,
    color: "white",
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  dotProgress: {
    display: "flex",
    gap: 5,
    flexShrink: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
    transition: "background 0.4s",
  },
  topBarTitle: {
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  topBarCenter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: "0 0 auto",
  },
  timerEmoji: {
    fontSize: 16,
  },
  timerText: {
    fontSize: 22,
    fontFamily: "monospace",
    fontWeight: 700,
    letterSpacing: 1,
  },
  timerLabel: {
    fontSize: 11,
    opacity: 0.8,
    marginLeft: 2,
  },
  topBarRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    justifyContent: "flex-end",
  },
  xpChip: {
    background: "rgba(255,255,255,0.2)",
    borderRadius: 99,
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  endBtn: {
    display: "flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 8,
    color: "white",
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  panels: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  learnPanel: {
    width: "35%",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-secondary)",
    overflow: "hidden",
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid var(--border-color)",
    flexShrink: 0,
  },
  tabBtn: {
    flex: 1,
    padding: "10px 0",
    border: "none",
    background: "transparent",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-muted)",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    transition: "color 0.15s, border-color 0.15s",
  },
  tabBtnActive: {
    color: "var(--accent-blue, var(--accent))",
    borderBottom: "2px solid var(--accent-blue, var(--accent))",
  },
  learnContent: {
    flex: 1,
    overflowY: "auto",
  },
  learnMessagesWrap: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  learnMessages: {
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  emptyLearn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
    textAlign: "center",
  },
  emptyLearnText: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.6,
  },
  emptyTab: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 24px",
    gap: 12,
    textAlign: "center",
  },
  emptyTabText: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.6,
    maxWidth: 200,
  },
  avatarPanel: {
    width: "30%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-primary)",
    gap: 16,
    padding: 20,
  },
  avatarBox: {
    width: 300,
    maxWidth: "100%",
    height: 400,
    background: "#f1f5f9",
    borderRadius: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: "2px dashed #cbd5e1",
  },
  avatarPulse: {
    width: 100,
    height: 100,
    borderRadius: "50%",
    background: "rgba(99,102,241,0.1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "avatarPulse 2.4s ease-in-out infinite",
  },
  avatarEmoji: {
    fontSize: 52,
  },
  avatarCaption: {
    fontSize: 15,
    fontWeight: 700,
    color: "#334155",
    margin: "4px 0 0",
  },
  avatarSub: {
    fontSize: 12,
    color: "#94a3b8",
    background: "#fef3c7",
    borderRadius: 99,
    padding: "2px 10px",
    fontWeight: 600,
  },
  speakingBadge: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 14px",
    background: "rgba(99,102,241,0.1)",
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent-blue, var(--accent))",
    border: "1px solid rgba(99,102,241,0.2)",
  },
  speakingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--accent-blue, var(--accent))",
    display: "inline-block",
    animation: "avatarPulse 1.2s ease-in-out infinite",
  },
  chatPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--bg-secondary)",
  },
  chatPanelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid var(--border-color)",
    flexShrink: 0,
  },
  chatPanelTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  handRaise: {
    fontSize: 12,
    color: "var(--text-muted)",
    background: "var(--bg-tertiary)",
    padding: "3px 10px",
    borderRadius: 99,
    border: "1px solid var(--border-color)",
    cursor: "pointer",
    userSelect: "none",
  },
  quickActions: {
    display: "flex",
    gap: 6,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-color)",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  quickBtn: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 99,
    padding: "4px 10px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 0.15s, color 0.15s",
  },
  chatMessages: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  chatEmpty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  pausedOverlay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "40px 24px",
    textAlign: "center",
    flex: 1,
  },
  pausedOverlayText: {
    fontSize: 16,
    fontWeight: 700,
    color: "#374151",
    margin: 0,
  },
  pausedOverlaySub: {
    fontSize: 13,
    color: "#94a3b8",
    margin: 0,
    maxWidth: 240,
    lineHeight: 1.5,
  },
  pausedResumeBtn: {
    marginTop: 8,
    background: "#10b981",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 20px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  quickBtnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  chatInputWrap: {
    flexShrink: 0,
  },
  assessCard: {
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 10,
    padding: "16px",
  },
  generateBtn: {
    width: "100%",
    padding: "10px 16px",
    background: "var(--accent-blue, var(--accent))",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "center" as const,
  },
  optionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 12px",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text-primary)",
    textAlign: "left" as const,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  quizOptionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "11px 14px",
    background: "var(--bg-primary)",
    border: "1.5px solid var(--border-color)",
    borderRadius: 10,
    fontSize: 13,
    color: "var(--text-primary)",
    textAlign: "left" as const,
    cursor: "pointer",
    transition: "all 0.15s",
    fontWeight: 500,
  },
  optionLabel: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0 as const,
    color: "inherit",
  },
  feedbackBox: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid",
  },
  reportBox: {
    padding: "10px 12px",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    marginBottom: 4,
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    color: "var(--text-muted)",
    marginBottom: 6,
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 5,
  },
  weakChip: {
    padding: "2px 8px",
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
    background: "rgba(239,68,68,0.1)",
    color: "#ef4444",
    border: "1px solid rgba(239,68,68,0.2)",
  },
  strongChip: {
    padding: "2px 8px",
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
    background: "rgba(16,185,129,0.1)",
    color: "#10b981",
    border: "1px solid rgba(16,185,129,0.2)",
  },
  testWarning: {
    padding: "8px 12px",
    background: "rgba(245,158,11,0.1)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 8,
    fontSize: 12,
    color: "#92400e",
    fontWeight: 600,
    textAlign: "center" as const,
  },
  testSavedNote: {
    padding: "8px 12px",
    background: "rgba(99,102,241,0.08)",
    border: "1px solid rgba(99,102,241,0.2)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--text-secondary)",
    textAlign: "center" as const,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    textAlign: "center" as const,
    margin: 0,
  },
  ttsOverlay: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "40px 24px",
    textAlign: "center" as const,
    background: "rgba(248, 250, 252, 0.88)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    zIndex: 10,
  },
};
