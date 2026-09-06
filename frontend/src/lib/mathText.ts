// Convert LaTeX-style maths (as the AI sometimes emits in plain chat) into clean, readable
// Unicode so the text chat NEVER shows raw "$10^{-1}$" / "$\frac{1}{2}$" markup.
//
// Design goal: 0% leakage and 0% content loss.
//  - Every recognised math span ($...$, $$...$$, \(...\), \[...\]) is unwrapped and rewritten.
//  - Anything we can't map to a Unicode script falls back to readable caret/paren notation
//    (e.g. ^(x+1)) rather than being dropped — so nothing goes missing.
//  - A lone "$" (currency like "$5") is left untouched: we only transform matched pairs whose
//    inner text actually looks like maths (contains \ ^ _ { }).

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", a: "ᵃ", b: "ᵇ", x: "ˣ", y: "ʸ",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", x: "ₓ", n: "ₙ", i: "ᵢ",
};

// Map a whole string to Unicode scripts, or return "" if any character is unmappable.
function toScripts(s: string, map: Record<string, string>): string {
  let out = "";
  for (const ch of s) {
    if (map[ch] === undefined) return "";
    out += map[ch];
  }
  return out;
}

const SYMBOLS: [RegExp, string][] = [
  [/\\times/g, "×"], [/\\div/g, "÷"], [/\\cdot/g, "·"], [/\\pm/g, "±"], [/\\mp/g, "∓"],
  [/\\leq\b/g, "≤"], [/\\le\b/g, "≤"], [/\\geq\b/g, "≥"], [/\\ge\b/g, "≥"],
  [/\\neq\b/g, "≠"], [/\\ne\b/g, "≠"], [/\\approx/g, "≈"], [/\\equiv/g, "≡"], [/\\propto/g, "∝"],
  [/\\pi/g, "π"], [/\\theta/g, "θ"], [/\\alpha/g, "α"], [/\\beta/g, "β"], [/\\gamma/g, "γ"],
  [/\\Delta/g, "Δ"], [/\\delta/g, "δ"], [/\\lambda/g, "λ"], [/\\mu/g, "µ"], [/\\sigma/g, "σ"],
  [/\\Sigma/g, "Σ"], [/\\infty/g, "∞"], [/\\sum/g, "∑"], [/\\int/g, "∫"], [/\\sqrt\b/g, "√"],
  [/\\rightarrow/g, "→"], [/\\to\b/g, "→"], [/\\Rightarrow/g, "⇒"], [/\\leftarrow/g, "←"],
  [/\\degree/g, "°"], [/\\circ/g, "°"], [/\\%/g, "%"], [/\\ast/g, "*"], [/\\star/g, "★"],
  [/\\left/g, ""], [/\\right/g, ""], [/\\!/g, ""], [/\\,/g, " "], [/\\;/g, " "], [/\\:/g, " "],
  [/\\quad/g, "  "], [/\\qquad/g, "   "],
];

// Rewrite the inner LaTeX of a single math span into readable text.
function latexToText(input: string): string {
  let s = input;
  // \text{...} / \mathrm{...} / \mathbf{...} → keep the inner words
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1");
  // fractions: \frac{a}{b}, \dfrac{a}{b}, \tfrac{a}{b}
  s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a, b) => `${a}/${b}`);
  // roots: \sqrt{x} → √(x)
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a) => `√(${a})`);
  // superscripts / subscripts (braced first, then single char)
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, g) => toScripts(g, SUP) || `^(${g})`);
  s = s.replace(/\^(\\?[A-Za-z0-9+\-=()])/g, (_m, g) => toScripts(g, SUP) || `^${g}`);
  s = s.replace(/_\{([^{}]*)\}/g, (_m, g) => toScripts(g, SUB) || `_(${g})`);
  s = s.replace(/_(\\?[A-Za-z0-9+\-=()])/g, (_m, g) => toScripts(g, SUB) || `_${g}`);
  // named symbols
  for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);
  // any remaining \command → keep its name (never leave a stray backslash)
  s = s.replace(/\\([A-Za-z]+)/g, "$1");
  // drop leftover braces + the escape for a literal dollar
  s = s.replace(/\\\$/g, "$").replace(/[{}]/g, "");
  return s;
}

export function normalizeMathText(input: string): string {
  if (!input) return input;
  if (!input.includes("$") && !input.includes("\\(") && !input.includes("\\[")) return input;
  let s = input;
  // block math first: $$...$$, \[...\]
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, g) => latexToText(g));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, g) => latexToText(g));
  // inline: \(...\)
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, g) => latexToText(g));
  // inline $...$ — only when the inner text really looks like maths (avoids mangling "$5")
  s = s.replace(/\$([^$\n]+?)\$/g, (m, g) => (/[\\^_{}]/.test(g) ? latexToText(g) : m));
  return s;
}
