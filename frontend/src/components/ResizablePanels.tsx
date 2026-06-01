import React, { useState, useRef } from "react";
import { PanelLeftClose, PanelRightClose, PanelLeftOpen, PanelRightOpen } from "lucide-react";

interface PanelConfig {
  id: string;
  label: string;
  content: React.ReactNode;
  minPct?: number;
}

interface Props {
  panels: PanelConfig[];
  initialWidths?: number[];
}

export default function ResizablePanels({ panels, initialWidths }: Props) {
  const [widths, setWidths] = useState<number[]>(initialWidths ?? [35, 30, 35]);
  const [hidden, setHidden] = useState<boolean[]>([false, false, false]);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    dividerIdx: number;
    startX: number;
    startWidths: number[];
  } | null>(null);
  const prevWidthsRef = useRef<number[]>(initialWidths ? [...initialWidths] : [35, 30, 35]);

  const hidePanel = (i: number) => {
    const newHidden = [...hidden];
    const newWidths = [...widths];
    prevWidthsRef.current[i] = newWidths[i];
    const freed = newWidths[i];
    newWidths[i] = 0;
    newHidden[i] = true;
    const visibleIndices = panels
      .map((_, idx) => idx)
      .filter(idx => idx !== i && !hidden[idx]);
    if (visibleIndices.length > 0) {
      const totalVisible = visibleIndices.reduce((sum, idx) => sum + newWidths[idx], 0);
      visibleIndices.forEach(idx => {
        newWidths[idx] +=
          totalVisible > 0
            ? (freed * newWidths[idx]) / totalVisible
            : freed / visibleIndices.length;
      });
    }
    setWidths(newWidths);
    setHidden(newHidden);
  };

  const showPanel = (i: number) => {
    const newHidden = [...hidden];
    const newWidths = [...widths];
    newHidden[i] = false;
    const restore = Math.max(prevWidthsRef.current[i] || 25, 15);
    const visibleIndices = panels
      .map((_, idx) => idx)
      .filter(idx => idx !== i && !newHidden[idx]);
    const totalVisible = visibleIndices.reduce((sum, idx) => sum + newWidths[idx], 0);
    visibleIndices.forEach(idx => {
      newWidths[idx] -=
        totalVisible > 0
          ? (restore * newWidths[idx]) / totalVisible
          : restore / visibleIndices.length;
      newWidths[idx] = Math.max(newWidths[idx], 15);
    });
    newWidths[i] = restore;
    const totalPct = newWidths.reduce((s, w, idx) => s + (newHidden[idx] ? 0 : w), 0);
    if (totalPct > 0) {
      visibleIndices.concat([i]).forEach(idx => {
        newWidths[idx] = (newWidths[idx] / totalPct) * 100;
      });
    }
    setWidths(newWidths);
    setHidden(newHidden);
  };

  const startDrag = (dividerIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = {
      dividerIdx,
      startX: e.clientX,
      startWidths: [...widths],
    };

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const { dividerIdx: dIdx, startX, startWidths } = draggingRef.current;
      const containerW = containerRef.current.getBoundingClientRect().width;
      const deltaPct = ((ev.clientX - startX) / containerW) * 100;
      const newWidths = [...startWidths];

      let leftIdx = dIdx;
      let rightIdx = dIdx + 1;
      while (leftIdx >= 0 && hidden[leftIdx]) leftIdx--;
      while (rightIdx < panels.length && hidden[rightIdx]) rightIdx++;
      if (leftIdx < 0 || rightIdx >= panels.length) return;

      const minL = panels[leftIdx].minPct ?? 15;
      const minR = panels[rightIdx].minPct ?? 15;
      let newL = startWidths[leftIdx] + deltaPct;
      let newR = startWidths[rightIdx] - deltaPct;
      if (newL < minL) {
        newR += newL - minL;
        newL = minL;
      }
      if (newR < minR) {
        newL += newR - minR;
        newR = minR;
      }
      newWidths[leftIdx] = Math.max(minL, Math.min(newL, 80));
      newWidths[rightIdx] = Math.max(minR, Math.min(newR, 80));
      setWidths(newWidths);
    };

    const onUp = () => {
      draggingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", flex: 1, overflow: "hidden", height: "100%" }}
    >
      {panels.map((panel, i) => {
        const isHidden = hidden[i];
        const visibleCount = hidden.filter(h => !h).length;

        return (
          <React.Fragment key={panel.id}>
            {isHidden ? (
              <div
                style={{
                  width: 28,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--bg-secondary, #f8fafc)",
                  borderRight:
                    i < panels.length - 1
                      ? "1px solid var(--border-color, #e2e8f0)"
                      : "none",
                  cursor: "pointer",
                  userSelect: "none",
                  gap: 8,
                }}
                onClick={() => showPanel(i)}
                title={`Show ${panel.label}`}
              >
                <span
                  style={{
                    writingMode: "vertical-rl",
                    textOrientation: "mixed",
                    transform: "rotate(180deg)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-muted, #64748b)",
                    letterSpacing: 1,
                  }}
                >
                  {panel.label}
                </span>
                {i === panels.length - 1
                  ? <PanelRightOpen size={14} style={{ color: "var(--text-muted, #64748b)" }} />
                  : <PanelLeftOpen size={14} style={{ color: "var(--text-muted, #64748b)" }} />}
              </div>
            ) : (
              <div
                style={{
                  width: `${widths[i]}%`,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  position: "relative",
                  transition: isHidden ? "width 0.2s ease" : undefined,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 8,
                    zIndex: 10,
                    display: "flex",
                    gap: 4,
                  }}
                >
                  <button
                    onClick={() => hidePanel(i)}
                    disabled={visibleCount <= 1}
                    style={{
                      background: "rgba(0,0,0,0.06)",
                      border: "none",
                      borderRadius: 6,
                      width: 22,
                      height: 22,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: visibleCount <= 1 ? "not-allowed" : "pointer",
                      opacity: visibleCount <= 1 ? 0.3 : 0.7,
                      transition: "opacity 0.15s",
                      padding: 0,
                    }}
                    title={`Hide ${panel.label}`}
                  >
                    {i === panels.length - 1
                      ? <PanelRightClose size={14} />
                      : <PanelLeftClose size={14} />}
                  </button>
                </div>

                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  {panel.content}
                </div>
              </div>
            )}

            {/* Drag divider — both neighbours visible */}
            {i < panels.length - 1 && !isHidden && !hidden[i + 1] && (
              <div
                onMouseDown={e => startDrag(i, e)}
                style={{
                  width: 8,
                  flexShrink: 0,
                  cursor: "col-resize",
                  background: "transparent",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  userSelect: "none",
                }}
              >
                <div
                  style={{
                    width: 1,
                    height: "100%",
                    background: "var(--border-color, #e2e8f0)",
                    transition: "background 0.15s",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    padding: "6px 3px",
                    background: "var(--bg-secondary, #f8fafc)",
                    borderRadius: 4,
                    border: "1px solid var(--border-color, #e2e8f0)",
                  }}
                >
                  {[0, 1, 2].map(j => (
                    <div
                      key={j}
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: "50%",
                        background: "var(--text-muted, #94a3b8)",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Static border when one neighbour is hidden */}
            {i < panels.length - 1 &&
              !isHidden &&
              hidden[i + 1] && (
                <div
                  style={{
                    width: 1,
                    background: "var(--border-color, #e2e8f0)",
                    flexShrink: 0,
                  }}
                />
              )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
