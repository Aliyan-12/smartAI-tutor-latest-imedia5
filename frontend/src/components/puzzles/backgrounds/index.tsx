import Aurora from "./Aurora";
import Blueprint from "./Blueprint";
import Paper from "./Paper";
import Mesh from "./Mesh";
import Bubbles from "./Bubbles";

/**
 * The puzzle-box backdrops. The server picks one at random per puzzle (see the backend
 * `_pick_bg`) and passes it in `params.background`, so the box never looks the same twice.
 *
 * Each backdrop is a self-contained SVG/CSS layer — no external assets, no network — so it
 * works offline and inside the artifact CSP. It renders BEHIND the activity; `theme` tells the
 * player whether to draw its header text light or dark.
 */
export type BgVariant = "aurora" | "blueprint" | "paper" | "mesh" | "bubbles" | "plain";

export const BG_THEME: Record<BgVariant, "light" | "dark"> = {
  aurora: "light",
  blueprint: "light",
  paper: "light",
  mesh: "dark",
  bubbles: "dark",
  plain: "light",
};

export function bgTheme(variant?: string): "light" | "dark" {
  return BG_THEME[(variant as BgVariant)] ?? "light";
}

export default function PuzzleBackground({ variant }: { variant?: string }) {
  switch (variant) {
    case "aurora":    return <Aurora />;
    case "blueprint": return <Blueprint />;
    case "paper":     return <Paper />;
    case "mesh":      return <Mesh />;
    case "bubbles":   return <Bubbles />;
    default:          return null;   // "plain" (or unknown) → the panel's own white background
  }
}
