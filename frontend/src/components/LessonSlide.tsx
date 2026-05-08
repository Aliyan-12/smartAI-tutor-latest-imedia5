import { useState } from "react";
import type { SlideData } from "../types";

interface LessonSlideProps {
  slide: SlideData | null;
  slideIndex: number;
  totalSlides: number;
  onPrev: () => void;
  onNext: () => void;
}

const HEADER_GRADIENT = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";

export default function LessonSlide({
  slide,
  slideIndex,
  totalSlides,
  onPrev,
  onNext,
}: LessonSlideProps) {
  const [iframeBlocked, setIframeBlocked] = useState(false);

  const canPrev = slideIndex > 0;
  const canNext = slideIndex < totalSlides - 1;

  if (!slide) {
    return (
      <div style={s.empty}>
        <span style={{ fontSize: 40 }}>🖥️</span>
        <p style={s.emptyTitle}>Slides will appear here</p>
        <p style={s.emptyText}>Chat with your AI tutor to generate lesson slides.</p>
      </div>
    );
  }

  return (
    <div style={s.outerWrap}>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -600px 0; }
          100% { background-position:  600px 0; }
        }
        .slide-shimmer {
          background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
          background-size: 1200px 100%;
          animation: shimmer 1.6s infinite linear;
          border-radius: 6px;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={s.slideCard} key={`${slide.slide_id}-${slideIndex}`}>
        {/* HEADER */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <span style={s.headerIcon}>
              {slide.status === "generating" ? "⏳" : slide.status === "failed" ? "⚠️" : "📊"}
            </span>
            <div>
              <p style={s.slideLabel}>Lesson Slide</p>
              <h2 style={s.headerTitle}>{slide.topic}</h2>
            </div>
          </div>
          {totalSlides > 0 && (
            <span style={s.slideChip}>{slideIndex + 1}/{totalSlides}</span>
          )}
        </div>

        {/* BODY */}
        <div style={s.body}>

          {/* ── GENERATING skeleton ── */}
          {slide.status === "generating" && (
            <div style={s.generatingWrap}>
              <div className="slide-shimmer" style={{ height: 140, borderRadius: 10, marginBottom: 12 }} />
              <div className="slide-shimmer" style={{ height: 14, width: "70%", marginBottom: 8 }} />
              <div className="slide-shimmer" style={{ height: 12, width: "90%", marginBottom: 8 }} />
              <div className="slide-shimmer" style={{ height: 12, width: "75%", marginBottom: 16 }} />
              <div className="slide-shimmer" style={{ height: 60, borderRadius: 8 }} />
              <div style={s.generatingBadge}>
                <span style={s.spinner} />
                <span>Generating slide&hellip;</span>
              </div>
            </div>
          )}

          {/* ── READY: iframe viewer ── */}
          {slide.status === "ready" && slide.viewer_url && !iframeBlocked && (
            <div style={s.iframeWrap}>
              <iframe
                key={slide.slide_id}
                src={slide.viewer_url}
                style={s.iframe}
                title={slide.topic}
                allow="fullscreen"
                onError={() => setIframeBlocked(true)}
              />
              <div style={s.iframeActions}>
                {slide.pptx_url && (
                  <a
                    href={slide.pptx_url}
                    download
                    style={s.downloadBtn}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ↓ Download PPTX
                  </a>
                )}
                <a
                  href={slide.viewer_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.openBtn}
                >
                  ↗ Full screen
                </a>
              </div>
            </div>
          )}

          {/* ── READY but iframe blocked: fallback links ── */}
          {slide.status === "ready" && slide.viewer_url && iframeBlocked && (
            <div style={s.fallbackWrap}>
              <span style={{ fontSize: 36 }}>📊</span>
              <p style={s.fallbackTitle}>{slide.topic}</p>
              <p style={s.fallbackText}>Your browser blocked the embedded viewer.</p>
              <a
                href={slide.viewer_url}
                target="_blank"
                rel="noopener noreferrer"
                style={s.openBtnLarge}
              >
                ↗ View Slide
              </a>
              {slide.pptx_url && (
                <a
                  href={slide.pptx_url}
                  download
                  style={s.downloadBtnLarge}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ↓ Download PPTX
                </a>
              )}
            </div>
          )}

          {/* ── FAILED ── */}
          {slide.status === "failed" && (
            <div style={s.failedWrap}>
              <span style={{ fontSize: 36 }}>⚠️</span>
              <p style={s.failedTitle}>Slide generation failed</p>
              <p style={s.failedText}>
                Could not create a slide for <em>{slide.topic}</em>.
              </p>
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
  headerIcon: {
    fontSize: 36,
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
    fontSize: 16,
    fontWeight: 800,
    color: "white",
    margin: 0,
    lineHeight: 1.3,
    textShadow: "0 1px 3px rgba(0,0,0,0.2)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
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
    display: "flex",
    flexDirection: "column" as const,
    background: "#fafbff",
  },

  // Generating skeleton
  generatingWrap: {
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
    flex: 1,
  },
  generatingBadge: {
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    color: "#6366f1",
  },
  spinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    border: "2px solid #e0e7ff",
    borderTop: "2px solid #6366f1",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    flexShrink: 0,
  },

  // iframe viewer
  iframeWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    minHeight: 0,
  },
  iframe: {
    flex: 1,
    border: "none",
    width: "100%",
    minHeight: 280,
  },
  iframeActions: {
    display: "flex",
    gap: 8,
    padding: "8px 12px",
    borderTop: "1px solid #e2e8f0",
    background: "white",
    flexShrink: 0,
    flexWrap: "wrap" as const,
  },
  downloadBtn: {
    flex: 1,
    padding: "6px 10px",
    background: "#4f46e5",
    color: "white",
    border: "none",
    borderRadius: 7,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "center" as const,
    textDecoration: "none",
    display: "block",
  },
  openBtn: {
    flex: 1,
    padding: "6px 10px",
    background: "transparent",
    color: "#4f46e5",
    border: "1px solid #c7d2fe",
    borderRadius: 7,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "center" as const,
    textDecoration: "none",
    display: "block",
  },

  // Fallback (iframe blocked)
  fallbackWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 20px",
    gap: 10,
    textAlign: "center" as const,
  },
  fallbackTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: "#1e293b",
    margin: 0,
  },
  fallbackText: {
    fontSize: 12,
    color: "#94a3b8",
    margin: 0,
  },
  openBtnLarge: {
    padding: "10px 24px",
    background: "#4f46e5",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  },
  downloadBtnLarge: {
    padding: "10px 24px",
    background: "transparent",
    color: "#4f46e5",
    border: "1px solid #c7d2fe",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  },

  // Failed
  failedWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 20px",
    gap: 10,
    textAlign: "center" as const,
  },
  failedTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#ef4444",
    margin: 0,
  },
  failedText: {
    fontSize: 12,
    color: "#94a3b8",
    margin: 0,
  },

  // Nav
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

  // Empty state
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
};
