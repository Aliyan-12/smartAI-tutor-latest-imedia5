import type { SlideData } from "../types";

interface LessonSlideProps {
  slide: SlideData | null;
  isLoading: boolean;
  slideIndex: number;
  totalSlides: number;
  onPrev: () => void;
  onNext: () => void;
}

const slideInStyle = `
  @keyframes lessonSlideIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

export default function LessonSlide({
  slide,
  isLoading,
  slideIndex,
  totalSlides,
  onPrev,
  onNext,
}: LessonSlideProps) {
  if (!isLoading && !slide) {
    return (
      <div style={styles.empty}>
        <style>{slideInStyle}</style>
        <span style={{ fontSize: 36 }}>📄</span>
        <p style={styles.emptyText}>Lesson content will be shown here.</p>
      </div>
    );
  }

  if (isLoading && !slide) {
    return (
      <div style={styles.skeletonWrap}>
        <style>{`
          ${slideInStyle}
          @keyframes shimmer {
            0%   { background-position: -400px 0; }
            100% { background-position: 400px 0; }
          }
          .slide-shimmer {
            background: linear-gradient(90deg, var(--border-color) 25%, var(--bg-tertiary, #e2e8f0) 50%, var(--border-color) 75%);
            background-size: 800px 100%;
            animation: shimmer 1.4s infinite linear;
            border-radius: 6px;
          }
        `}</style>
        <div className="slide-shimmer" style={{ height: 20, width: "55%", marginBottom: 14 }} />
        <div className="slide-shimmer" style={{ height: 36, borderRadius: 99, marginBottom: 18 }} />
        <div className="slide-shimmer" style={{ height: 13, width: "90%", marginBottom: 8 }} />
        <div className="slide-shimmer" style={{ height: 13, width: "80%", marginBottom: 8 }} />
        <div className="slide-shimmer" style={{ height: 13, width: "85%", marginBottom: 18 }} />
        <div className="slide-shimmer" style={{ height: 11, width: "40%", marginBottom: 8 }} />
        <div className="slide-shimmer" style={{ height: 11, width: "70%", marginBottom: 6 }} />
        <div className="slide-shimmer" style={{ height: 11, width: "65%", marginBottom: 0 }} />
      </div>
    );
  }

  if (!slide) return null;

  const hasNav = totalSlides > 1;

  return (
    <div style={styles.outerWrap}>
      <style>{slideInStyle}</style>
      <div
        key={`${slide.title}-${slideIndex}`}
        style={styles.card}
      >
        <div style={styles.header}>
          <span style={styles.emoji}>{slide.emoji}</span>
          <p style={styles.title}>{slide.title}</p>
        </div>

        {slide.highlight && (
          <div style={styles.highlight}>
            {slide.highlight}
          </div>
        )}

        {slide.bullets.length > 0 && (
          <ul style={styles.bulletList}>
            {slide.bullets.map((b, i) => (
              <li key={i} style={styles.bulletItem}>
                <span style={styles.bulletDot} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {slide.keyTerms.length > 0 && (
          <div style={styles.keyTermsSection}>
            <p style={styles.keyTermsLabel}>KEY TERMS</p>
            {slide.keyTerms.map((kt, i) => (
              <div key={i} style={styles.keyTermRow}>
                <span style={styles.keyTermTerm}>{kt.term}</span>
                <span style={styles.keyTermDef}>{kt.definition}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasNav && (
        <div style={styles.nav}>
          <button
            style={{
              ...styles.navBtn,
              opacity: slideIndex === 0 ? 0.35 : 1,
              cursor: slideIndex === 0 ? "not-allowed" : "pointer",
            }}
            onClick={onPrev}
            disabled={slideIndex === 0}
          >
            ← Prev
          </button>
          <span style={styles.navCount}>
            {slideIndex + 1} / {totalSlides}
          </span>
          <button
            style={{
              ...styles.navBtn,
              opacity: slideIndex >= totalSlides - 1 ? 0.35 : 1,
              cursor: slideIndex >= totalSlides - 1 ? "not-allowed" : "pointer",
            }}
            onClick={onNext}
            disabled={slideIndex >= totalSlides - 1}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
    textAlign: "center",
    height: "100%",
  },
  emptyText: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.6,
    margin: 0,
  },
  skeletonWrap: {
    padding: 16,
    display: "flex",
    flexDirection: "column",
  },
  outerWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    height: "100%",
    overflowY: "auto",
  },
  card: {
    padding: 16,
    animation: "lessonSlideIn 0.3s ease both",
    flex: 1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  emoji: {
    fontSize: 32,
    flexShrink: 0,
    lineHeight: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
    lineHeight: 1.35,
  },
  highlight: {
    background: "rgba(99,102,241,0.1)",
    color: "var(--accent-blue, var(--accent))",
    borderRadius: 99,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.45,
    marginBottom: 14,
  },
  bulletList: {
    listStyle: "none",
    margin: "0 0 14px 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  bulletItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  },
  bulletDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--accent-blue, var(--accent))",
    flexShrink: 0,
    marginTop: 5,
  },
  keyTermsSection: {
    borderTop: "1px solid var(--border-color)",
    paddingTop: 12,
    marginTop: 4,
  },
  keyTermsLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    color: "var(--text-muted)",
    margin: "0 0 8px 0",
  },
  keyTermRow: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 6,
  },
  keyTermTerm: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  keyTermDef: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.45,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderTop: "1px solid var(--border-color)",
    flexShrink: 0,
    background: "var(--bg-secondary)",
  },
  navBtn: {
    background: "transparent",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.15s",
  },
  navCount: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontWeight: 600,
  },
};
