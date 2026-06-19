import type { DisplayPuzzleProps } from "./types";

type Node = { label: string; value: number | null };

export default function FormulaTriangle({ params }: DisplayPuzzleProps) {
  const top = (params.top as Node) || { label: "a", value: null };
  const left = (params.left as Node) || { label: "b", value: 0 };
  const right = (params.right as Node) || { label: "c", value: 0 };
  const unknown = String(params.unknown || "top");

  const cell = (n: Node, isUnknown: boolean) => (isUnknown ? "?" : String(n.value));
  const col = (isUnknown: boolean) => (isUnknown ? "#7c3aed" : "#1e293b");

  return (
    <svg viewBox="0 0 240 210" style={{ width: "100%", maxWidth: 250 }}>
      <polygon points="120,14 22,186 218,186" fill="#eef2ff" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" />
      <line x1="58" y1="112" x2="182" y2="112" stroke="#6366f1" strokeWidth={2} />
      <line x1="120" y1="112" x2="120" y2="186" stroke="#6366f1" strokeWidth={2} />

      {/* top */}
      <text x="120" y="52" textAnchor="middle" fontSize={11} fill="#64748b">{top.label}</text>
      <text x="120" y="92" textAnchor="middle" fontSize={28} fontWeight={700} fill={col(unknown === "top")}>{cell(top, unknown === "top")}</text>
      {/* left */}
      <text x="85" y="150" textAnchor="middle" fontSize={24} fontWeight={700} fill={col(unknown === "left")}>{cell(left, unknown === "left")}</text>
      <text x="85" y="172" textAnchor="middle" fontSize={10} fill="#64748b">{left.label}</text>
      {/* right */}
      <text x="155" y="150" textAnchor="middle" fontSize={24} fontWeight={700} fill={col(unknown === "right")}>{cell(right, unknown === "right")}</text>
      <text x="155" y="172" textAnchor="middle" fontSize={10} fill="#64748b">{right.label}</text>
    </svg>
  );
}
