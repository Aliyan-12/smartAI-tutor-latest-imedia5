/**
 * ResourceViewer — renders the Resource Hub resource the AI is currently teaching
 * from, driven by `show_resource` / advance / retreat tool events on the session
 * WebSocket. PDFs jump to the current page (#page=N); PowerPoint/Word use the
 * Office Online embed; YouTube and external links embed inline.
 */
export interface ResourceSlide {
  resourceHubId: number;
  title: string;
  resourceType: string;
  fileUrl: string | null;
  youtubeUrl: string | null;
  externalUrl: string | null;
  slideIndex: number;
  pageCount: number;
}

function youtubeEmbed(url: string): string {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}

function officeEmbed(url: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
}

/** Build the iframe src for the current resource + slide. */
function viewerSrc(slide: ResourceSlide): string | null {
  const type = (slide.resourceType || "").toLowerCase();
  if (type === "youtube" && slide.youtubeUrl) return youtubeEmbed(slide.youtubeUrl);
  if (type === "external_link" && slide.externalUrl) return slide.externalUrl;
  if (slide.fileUrl) {
    if (type === "pdf") return `${slide.fileUrl}#page=${slide.slideIndex}&toolbar=0`;
    // powerpoint / worksheet / mark_scheme / docx → Office Online viewer
    return officeEmbed(slide.fileUrl);
  }
  if (slide.externalUrl) return slide.externalUrl;
  if (slide.youtubeUrl) return youtubeEmbed(slide.youtubeUrl);
  return null;
}

const TYPE_LABEL: Record<string, string> = {
  pdf: "PDF",
  powerpoint: "Slides",
  worksheet: "Worksheet",
  mark_scheme: "Mark scheme",
  markscheme: "Mark scheme",
  homework: "Homework",
  youtube: "Video",
  external_link: "Link",
};

export default function ResourceViewer({ slide }: { slide: ResourceSlide }) {
  const src = viewerSrc(slide);
  const typeLabel = TYPE_LABEL[(slide.resourceType || "").toLowerCase()] || slide.resourceType || "Resource";
  const showSlideCount = slide.pageCount > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid var(--border, #e2e8f0)", flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
          color: "var(--accent, #1a73e8)", background: "rgba(26,115,232,0.1)",
          padding: "3px 8px", borderRadius: 6, flexShrink: 0,
        }}>
          {typeLabel}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 600, color: "var(--text-primary, #0f172a)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
        }}>
          {slide.title}
        </span>
        {showSlideCount && (
          <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)", flexShrink: 0, fontWeight: 600 }}>
            Slide {slide.slideIndex} / {slide.pageCount}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#f8fafc" }}>
        {src ? (
          <iframe
            key={slide.resourceHubId}
            src={src}
            title={slide.title}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            allow="fullscreen; encrypted-media"
          />
        ) : (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: "100%", textAlign: "center", padding: 24, color: "var(--text-muted, #64748b)",
          }}>
            <span style={{ fontSize: 40, marginBottom: 10 }}>📄</span>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{slide.title}</p>
            <p style={{ margin: "6px 0 0", fontSize: 12 }}>This resource has no preview available.</p>
          </div>
        )}
      </div>
    </div>
  );
}
