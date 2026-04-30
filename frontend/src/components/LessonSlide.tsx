import type { SlideData } from "../types";

interface LessonSlideProps {
  slide: SlideData | null;
  isLoading: boolean;
  slideIndex: number;
  totalSlides: number;
  onPrev: () => void;
  onNext: () => void;
  onRetry?: () => void;
  slideFailed?: boolean;
}

const HEADER_GRADIENT = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";

export default function LessonSlide({
  slide,
  isLoading,
  slideIndex,
  totalSlides,
  onPrev,
  onNext,
  onRetry,
  slideFailed,
}: LessonSlideProps) {
  if (!isLoading && !slide) {
    return (
      <div style={s.empty}>
        <span style={{ fontSize: 40 }}>{slideFailed ? "⚠️" : "🖥️"}</span>
        <p style={s.emptyTitle}>
          {slideFailed ? "Slide could not be generated" : "Slides will appear here"}
        </p>
        <p style={s.emptyText}>
          {slideFailed
            ? "The AI couldn't create a slide for that response."
            : "Chat with your AI tutor to generate lesson slides."}
        </p>
        {slideFailed && onRetry && (
          <button onClick={onRetry} style={s.retryBtn} type="button">
            ↻ Retry Slide
          </button>
        )}
      </div>
    );
  }

  if (isLoading && !slide) {
    return (
      <div style={s.skeletonWrap}>
        <style>{`
          @keyframes shimmer {
            0%   { background-position: -600px 0; }
            100% { background-position: 600px 0; }
          }
          .slide-shimmer {
            background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
            background-size: 1200px 100%;
            animation: shimmer 1.6s infinite linear;
            border-radius: 6px;
          }
        `}</style>
        <div style={{ background: "#6366f1", borderRadius: "12px 12px 0 0", padding: "20px 20px 18px", marginBottom: 0 }}>
          <div className="slide-shimmer" style={{ height: 18, width: "60%", marginBottom: 10, opacity: 0.5 }} />
          <div className="slide-shimmer" style={{ height: 26, width: "80%", opacity: 0.4 }} />
        </div>
        <div style={{ background: "white", borderRadius: "0 0 12px 12px", padding: 20, flex: 1 }}>
          <div className="slide-shimmer" style={{ height: 14, borderRadius: 99, marginBottom: 16 }} />
          <div className="slide-shimmer" style={{ height: 12, width: "90%", marginBottom: 10 }} />
          <div className="slide-shimmer" style={{ height: 12, width: "75%", marginBottom: 10 }} />
          <div className="slide-shimmer" style={{ height: 12, width: "82%", marginBottom: 20 }} />
          <div className="slide-shimmer" style={{ height: 60, borderRadius: 8 }} />
        </div>
      </div>
    );
  }

  if (!slide) return null;

  const canPrev = slideIndex > 0;
  const canNext = slideIndex < totalSlides - 1;

  return (
    <div style={s.outerWrap}>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={s.slideCard} key={`${slide.title}-${slideIndex}`}>
        {/* HEADER */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <span style={s.headerEmoji}>{slide.emoji}</span>
            <div>
              <p style={s.slideLabel}>Lesson Slide</p>
              <h2 style={s.headerTitle}>{slide.title}</h2>
            </div>
          </div>
          {totalSlides > 0 && (
            <span style={s.slideChip}>{slideIndex + 1}/{totalSlides}</span>
          )}
        </div>

        {/* BODY */}
        <div style={s.body}>
          {slide.highlight && (
            <div style={s.highlightBox}>
              <span style={s.highlightIcon}>💡</span>
              <p style={s.highlightText}>{slide.highlight}</p>
            </div>
          )}

          {slide.bullets.length > 0 && (
            <div style={s.section}>
              <p style={s.sectionLabel}>Key Points</p>
              <ul style={s.bulletList}>
                {slide.bullets.map((b, i) => (
                  <li key={i} style={s.bulletItem}>
                    <span style={s.bulletSquare} />
                    <span style={s.bulletText}>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {slide.keyTerms.length > 0 && (
            <div style={s.section}>
              <p style={s.sectionLabel}>Key Terms</p>
              <div style={s.keyTermsGrid}>
                {slide.keyTerms.map((kt, i) => (
                  <div key={i} style={s.keyTermCard}>
                    <span style={s.keyTermTerm}>{kt.term}</span>
                    <span style={s.keyTermDef}>{kt.definition}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* NAV */}
        <div style={s.nav}>
          <button
            style={{ ...s.navBtn, opacity: canPrev ? 1 : 0.3, cursor: canPrev ? "pointer" : "not-allowed" }}
            onClick={onPrev}
            disabled={!canPrev}
            type="button"
          >
            ← Previous
          </button>
          <span style={s.navCounter}>
            Slide {slideIndex + 1} of {totalSlides}
          </span>
          <button
            style={{ ...s.navBtn, opacity: canNext ? 1 : 0.3, cursor: canNext ? "pointer" : "not-allowed" }}
            onClick={onNext}
            disabled={!canNext}
            type="button"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  outerWrap: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    padding: "14px 14px 10px",
    boxSizing: "border-box",
  },
  slideCard: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 4px 20px rgba(79,70,229,0.18), 0 1px 4px rgba(0,0,0,0.08)",
    border: "1px solid rgba(79,70,229,0.15)",
    animation: "slideIn 0.35s ease both",
    background: "white",
  },
  header: {
    background: HEADER_GRADIENT,
    padding: "18px 18px 16px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  headerEmoji: {
    fontSize: 40,
    lineHeight: 1,
    flexShrink: 0,
    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))",
  },
  slideLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
    color: "rgba(255,255,255,0.65)",
    margin: "0 0 3px 0",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 800,
    color: "white",
    margin: 0,
    lineHeight: 1.3,
    textShadow: "0 1px 3px rgba(0,0,0,0.2)",
  },
  slideChip: {
    fontSize: 11,
    fontWeight: 700,
    background: "rgba(255,255,255,0.2)",
    color: "white",
    borderRadius: 99,
    padding: "3px 9px",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
    border: "1px solid rgba(255,255,255,0.3)",
  },
  body: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    background: "#fafbff",
  },
  highlightBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    background: "rgba(79,70,229,0.07)",
    borderLeft: "4px solid #4f46e5",
    borderRadius: "0 8px 8px 0",
  },
  highlightIcon: {
    fontSize: 16,
    flexShrink: 0,
    marginTop: 1,
  },
  highlightText: {
    fontSize: 13,
    fontWeight: 600,
    color: "#3730a3",
    lineHeight: 1.55,
    margin: 0,
    fontStyle: "italic",
  },
  section: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.8px",
    color: "#6366f1",
    margin: 0,
    borderBottom: "1px solid rgba(99,102,241,0.2)",
    paddingBottom: 5,
  },
  bulletList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  bulletItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
  },
  bulletSquare: {
    width: 8,
    height: 8,
    borderRadius: 2,
    background: "#6366f1",
    flexShrink: 0,
    marginTop: 5,
  },
  bulletText: {
    fontSize: 13,
    color: "#1e293b",
    lineHeight: 1.6,
  },
  keyTermsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  keyTermCard: {
    background: "#f1f5f9",
    borderRadius: 8,
    padding: "9px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    border: "1px solid #e2e8f0",
  },
  keyTermTerm: {
    fontSize: 12,
    fontWeight: 800,
    color: "#1e293b",
    letterSpacing: "0.3px",
  },
  keyTermDef: {
    fontSize: 12,
    color: "#64748b",
    lineHeight: 1.5,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderTop: "1px solid #e2e8f0",
    flexShrink: 0,
    background: "white",
  },
  navBtn: {
    background: "transparent",
    border: "none",
    fontSize: 12,
    fontWeight: 700,
    color: "#6366f1",
    cursor: "pointer",
    padding: "4px 0",
    fontFamily: "inherit",
    transition: "opacity 0.15s",
  },
  navCounter: {
    fontSize: 11,
    fontWeight: 600,
    color: "#94a3b8",
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 24px",
    gap: 10,
    textAlign: "center" as const,
    height: "100%",
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#334155",
    margin: 0,
  },
  emptyText: {
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 1.6,
    margin: 0,
    maxWidth: 220,
  },
  retryBtn: {
    marginTop: 6,
    padding: "8px 20px",
    background: "#4f46e5",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  skeletonWrap: {
    margin: "14px",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 4px 20px rgba(79,70,229,0.1)",
    display: "flex",
    flexDirection: "column" as const,
  },
};
