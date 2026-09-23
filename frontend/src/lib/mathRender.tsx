import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Solid maths rendering for the puzzle area:
 *  - `$…$` / `\(…\)` spans render as real KaTeX (inherits the surrounding text colour).
 *  - bare caret / underscore notation in plain text (x^2, 10^-3, x_1) becomes Unicode
 *    (x², 10⁻³, x₁), with a readable caret fallback when a character can't be mapped.
 * So a question like "Factorise: x^2 + 7x + 12" or "$x^{-1}$" is always shown as maths,
 * never as raw markup — the same in every KS/YG theme.
 */

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", a: "ᵃ", b: "ᵇ", x: "ˣ", y: "ʸ",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", x: "ₓ", n: "ₙ", i: "ᵢ",
};

function mapAll(s: string, map: Record<string, string>): string | null {
  let out = "";
  for (const ch of s) {
    if (map[ch] === undefined) return null;
    out += map[ch];
  }
  return out;
}

/** Convert bare ^/​_ notation in ordinary text to Unicode super/subscripts. */
function scriptify(input: string): string {
  let s = input;
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, g) => mapAll(g, SUP) ?? `^(${g})`);
  s = s.replace(/\^(-?[0-9A-Za-z]+)/g, (_m, g) => mapAll(g, SUP) ?? `^${g}`);
  s = s.replace(/_\{([^{}]*)\}/g, (_m, g) => mapAll(g, SUB) ?? `_(${g})`);
  s = s.replace(/_([0-9A-Za-z]+)/g, (_m, g) => mapAll(g, SUB) ?? `_${g}`);
  return s;
}

function splitOnMath(text: string): { math: boolean; content: string }[] {
  const out: { math: boolean; content: string }[] = [];
  const re = /\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ math: false, content: text.slice(last, m.index) });
    out.push({ math: true, content: m[1] ?? m[2] ?? m[3] ?? "" });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ math: false, content: text.slice(last) });
  return out;
}

/** Render a raw LaTeX string with KaTeX (falls back to a readable form if it can't parse). */
export function KaTeX({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(() => {
    if (!tex) return "";
    try {
      return katex.renderToString(tex, { throwOnError: true, displayMode: block });
    } catch {
      return null;
    }
  }, [tex, block]);
  if (html === null) return <span>{scriptify(tex)}</span>;
  return <span style={{ color: "inherit" }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Render mixed text + maths. */
export function MathText({ text }: { text: string }) {
  if (!text) return null;
  const segs = splitOnMath(text);
  return (
    <>
      {segs.map((s, i) => (s.math ? <KaTeX key={i} tex={s.content} /> : <span key={i}>{scriptify(s.content)}</span>))}
    </>
  );
}
