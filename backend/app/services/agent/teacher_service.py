"""
svg_diagram_service.py — deterministic, curriculum-grounded SVG teaching diagrams.

Why SVG and not a generated image: a generated picture cannot be trusted to draw exact structures
or labels (that is how a "2/6" fraction bar shipped as 1/5, and why force arrows disagreed with
the tutor). These diagrams are drawn by code from validated params, so what is on screen ALWAYS
matches what the tutor says. They render instantly in the browser — no GPU, no video render wait,
nothing stored on disk.

Division of labour between the three visual families:
    SVG  (here)  — spatial/labelled structures: a cell, a circuit, a wave, the solar system.
    mermaid      — flows, cycles, sequences, relationships (photosynthesis flow, food chains).
    manim        — motion that a still cannot show (diffusion, orbits, a wave travelling).

Every entry is tagged with the KEY STAGES and SUBJECTS it suits plus the TOPIC KEYWORDS that
should trigger it, so `pick_for_topic` can offer the right diagram for the lesson actually being
taught (the unit/subtopic titles come from the Resource Hub mirror).

SAFETY: all text baked into the SVG comes from these templates or from validated params, and any
param-derived text is escaped by `_esc` — the model never injects raw markup.
"""
import logging
import re
from html import escape
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

W, H = 640, 400          # every diagram uses the same viewBox so the panel sizing is uniform
INK = "#0f172a"
MUTED = "#64748b"
LINE = "#94a3b8"


def _esc(v: Any) -> str:
    return escape(str(v), quote=True)


def _clampi(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _wrap(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="100%" height="100%" font-family="system-ui,sans-serif">{body}</svg>')


def _label(x: float, y: float, text: str, size: int = 13, colour: str = INK,
           anchor: str = "middle", weight: int = 600) -> str:
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{colour}" '
            f'text-anchor="{anchor}" font-weight="{weight}">{_esc(text)}</text>')


def _leader(x1: float, y1: float, x2: float, y2: float) -> str:
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{LINE}" stroke-width="1.2"/>')


def _title(text: str) -> str:
    return _label(W / 2, 26, text, size=17, weight=800)


# ── Biology ──────────────────────────────────────────────────────────────────────

def _cell(p: dict, plant: bool) -> str:
    """Animal or plant cell with labelled organelles (KS3 Cells)."""
    parts = [_title("Plant cell" if plant else "Animal cell")]
    cx, cy = 250, 215
    if plant:
        parts.append(f'<rect x="120" y="115" width="260" height="200" rx="10" fill="#dcfce7" '
                     f'stroke="#15803d" stroke-width="5"/>')
        parts.append(f'<rect x="132" y="127" width="236" height="176" rx="8" fill="#f0fdf4" '
                     f'stroke="#22c55e" stroke-width="2"/>')
        parts.append('<ellipse cx="250" cy="215" rx="86" ry="56" fill="#bbf7d0" stroke="#16a34a" stroke-width="2"/>')
        for x, y in ((175, 165), (330, 175), (190, 275), (325, 268)):
            parts.append(f'<ellipse cx="{x}" cy="{y}" rx="17" ry="10" fill="#16a34a" opacity="0.85"/>')
    else:
        parts.append('<ellipse cx="250" cy="215" rx="140" ry="102" fill="#ede9fe" stroke="#7c3aed" stroke-width="4"/>')
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="36" fill="#a78bfa" stroke="#5b21b6" stroke-width="2.5"/>')
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="12" fill="#4c1d95"/>')
    for x, y in ((196, 168), (306, 262)):
        parts.append(f'<ellipse cx="{x}" cy="{y}" rx="22" ry="11" fill="#fb7185" stroke="#be123c" stroke-width="2"/>')

    rows = [("Nucleus", cx, cy - 46, 470, 120),
            ("Mitochondria", 306, 262, 470, 300),
            ("Cell membrane", 250, 317 if plant else 317, 470, 348)]
    if plant:
        rows += [("Cell wall", 120, 130, 60, 96), ("Chloroplast", 175, 165, 60, 150),
                 ("Vacuole", 250, 190, 60, 205)]
    else:
        rows += [("Cytoplasm", 170, 250, 60, 150)]
    for text, ax, ay, lx, ly in rows:
        parts.append(_leader(ax, ay, lx, ly))
        parts.append(_label(lx, ly - 6, text, size=12,
                            anchor="start" if lx > 300 else "start"))
    return _wrap("".join(parts))


def _digestive(p: dict) -> str:
    """The digestive system in order (KS2/KS3 Digestion)."""
    stages = [("Mouth", 90), ("Oesophagus", 160), ("Stomach", 230),
              ("Small intestine", 300), ("Large intestine", 355)]
    parts = [_title("The digestive system")]
    for i, (name, y) in enumerate(stages):
        parts.append(f'<rect x="180" y="{y - 20}" width="280" height="36" rx="18" '
                     f'fill="#fef3c7" stroke="#f59e0b" stroke-width="2"/>')
        parts.append(_label(320, y + 4, f"{i + 1}. {name}", size=14))
        if i < len(stages) - 1:
            ny = stages[i + 1][1] - 20
            parts.append(f'<path d="M320 {y + 16} L320 {ny}" stroke="#f59e0b" stroke-width="3" '
                         f'marker-end="url(#svgarrow)"/>')
    parts.append(_label(W / 2, 388, "Food travels down in this order", size=12, colour=MUTED, weight=500))
    return _wrap(_ARROW_DEF + "".join(parts))


def _leaf_photosynthesis(p: dict) -> str:
    """Inputs and outputs of photosynthesis on a leaf (KS3 Plant nutrition)."""
    parts = [_title("Photosynthesis")]
    parts.append('<path d="M250 200 C150 120 180 300 320 265 C420 240 380 130 250 200 Z" '
                 'fill="#bbf7d0" stroke="#15803d" stroke-width="3"/>')
    parts.append('<path d="M250 200 L340 258" stroke="#15803d" stroke-width="3" fill="none"/>')
    parts.append('<circle cx="120" cy="80" r="26" fill="#fde047" stroke="#ca8a04" stroke-width="2"/>')
    parts.append(_label(120, 120, "Light", size=13))
    ins = [("Carbon dioxide", 90, 250, 175, 232), ("Water", 120, 330, 205, 268)]
    outs = [("Glucose", 540, 180, 350, 215), ("Oxygen", 545, 300, 345, 250)]
    for text, lx, ly, ax, ay in ins:
        parts.append(f'<path d="M{lx + 60} {ly} L{ax} {ay}" stroke="#2563eb" stroke-width="2.5" marker-end="url(#svgarrow)"/>')
        parts.append(_label(lx, ly + 4, text, size=12, anchor="middle", colour="#1d4ed8"))
    for text, lx, ly, ax, ay in outs:
        parts.append(f'<path d="M{ax} {ay} L{lx - 55} {ly}" stroke="#ea580c" stroke-width="2.5" marker-end="url(#svgarrow)"/>')
        parts.append(_label(lx, ly + 4, text, size=12, colour="#c2410c"))
    return _wrap(_ARROW_DEF + "".join(parts))


# ── Chemistry ────────────────────────────────────────────────────────────────────

def _particle_states(p: dict) -> str:
    """Particle arrangement in solid / liquid / gas (KS3 States of matter)."""
    import random as _r
    parts = [_title("Particles in solids, liquids and gases")]
    boxes = [("Solid", 40, "regular"), ("Liquid", 235, "close"), ("Gas", 430, "spread")]
    for name, x0, mode in boxes:
        parts.append(f'<rect x="{x0}" y="90" width="170" height="200" rx="10" fill="#f8fafc" stroke="{LINE}" stroke-width="2"/>')
        parts.append(_label(x0 + 85, 76, name, size=15, weight=800))
        rng = _r.Random(hash(mode) & 0xffff)
        if mode == "regular":
            for r_ in range(5):
                for c in range(4):
                    parts.append(f'<circle cx="{x0 + 36 + c * 33}" cy="{112 + r_ * 33}" r="12" fill="#38bdf8" stroke="#0369a1" stroke-width="1.5"/>')
        elif mode == "close":
            for i in range(18):
                cx = x0 + 30 + rng.random() * 112
                cy = 150 + rng.random() * 128
                parts.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="12" fill="#34d399" stroke="#047857" stroke-width="1.5"/>')
        else:
            for i in range(9):
                cx = x0 + 24 + rng.random() * 124
                cy = 106 + rng.random() * 168
                parts.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="11" fill="#f472b6" stroke="#be185d" stroke-width="1.5"/>')
        note = {"regular": "Fixed places, vibrate", "close": "Touching, can slide",
                "spread": "Far apart, move fast"}[mode]
        parts.append(_label(x0 + 85, 308, note, size=11, colour=MUTED, weight=500))
    return _wrap("".join(parts))


def _atom_shells(p: dict) -> str:
    """Bohr-style atom with electron shells (KS3 Atoms/elements)."""
    protons = _clampi(p.get("protons", p.get("z"), ), 1, 20, 6)
    neutrons = _clampi(p.get("neutrons"), 0, 24, protons)
    name = _esc(p.get("element") or "Atom")
    parts = [_title(f"Structure of an atom — {name}")]
    cx, cy = 300, 215
    caps = [2, 8, 8, 2]
    left = protons
    shells = []
    for c in caps:
        shells.append(min(c, max(0, left)))
        left -= min(c, max(0, left))
    for i, count in enumerate(shells):
        r = 52 + i * 38
        if count <= 0:
            continue
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{LINE}" stroke-width="1.2" stroke-dasharray="4 5"/>')
        import math
        for k in range(count):
            a = (k / count) * 2 * math.pi - math.pi / 2
            ex, ey = cx + math.cos(a) * r, cy + math.sin(a) * r
            parts.append(f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="6" fill="#2563eb" stroke="#fff" stroke-width="1.5"/>')
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="30" fill="#fee2e2" stroke="#dc2626" stroke-width="2"/>')
    parts.append(_label(cx, cy - 2, f"{protons}p", size=13, colour="#b91c1c"))
    parts.append(_label(cx, cy + 15, f"{neutrons}n", size=13, colour=MUTED))
    parts.append(_label(520, 120, "Electrons", size=12, colour="#1d4ed8"))
    parts.append(_label(520, 300, "Nucleus:", size=12))
    parts.append(_label(520, 318, "protons + neutrons", size=11, colour=MUTED, weight=500))
    return _wrap("".join(parts))


# ── Physics ──────────────────────────────────────────────────────────────────────

def _circuit(p: dict, parallel: bool) -> str:
    """A labelled series or parallel circuit (KS3 Circuits)."""
    lamps = _clampi(p.get("lamps", p.get("bulbs")), 1, 3, 2)
    parts = [_title("Parallel circuit" if parallel else "Series circuit")]
    # battery
    parts.append('<line x1="150" y1="120" x2="150" y2="300" stroke="#0f172a" stroke-width="0"/>')
    parts.append('<rect x="132" y="196" width="8" height="44" fill="#0f172a"/>')
    parts.append('<rect x="148" y="206" width="8" height="24" fill="#0f172a"/>')
    parts.append(_label(120, 222, "Cell", size=12, anchor="end"))
    wire = 'stroke="#0f172a" stroke-width="3" fill="none"'
    if not parallel:
        parts.append(f'<path d="M136 196 L136 110 L500 110 L500 330 L136 330 L136 240" {wire}/>')
        for i in range(lamps):
            x = 220 + i * 130
            parts.append(f'<circle cx="{x}" cy="110" r="20" fill="#fef9c3" stroke="#ca8a04" stroke-width="3"/>')
            parts.append(f'<path d="M{x - 14} 96 L{x + 14} 124 M{x + 14} 96 L{x - 14} 124" stroke="#ca8a04" stroke-width="2"/>')
            parts.append(_label(x, 78, f"Lamp {i + 1}", size=11))
        parts.append(_label(320, 360, "One loop — the same current flows through every lamp",
                            size=12, colour=MUTED, weight=500))
    else:
        parts.append(f'<path d="M136 196 L136 110 L500 110 M500 110 L500 330 M136 330 L500 330 M136 330 L136 240" {wire}/>')
        for i in range(max(2, lamps)):
            x = 250 + i * 120
            parts.append(f'<path d="M{x} 110 L{x} 330" {wire}/>')
            parts.append(f'<circle cx="{x}" cy="220" r="20" fill="#fef9c3" stroke="#ca8a04" stroke-width="3"/>')
            parts.append(f'<path d="M{x - 14} 206 L{x + 14} 234 M{x + 14} 206 L{x - 14} 234" stroke="#ca8a04" stroke-width="2"/>')
            parts.append(_label(x, 196, f"Lamp {i + 1}", size=11))
        parts.append(_label(320, 366, "Separate branches — each lamp gets the full voltage",
                            size=12, colour=MUTED, weight=500))
    return _wrap("".join(parts))


def _wave(p: dict) -> str:
    """A labelled transverse wave: wavelength, amplitude, crest, trough (KS3 Waves/Sound)."""
    import math
    amp = _clampi(p.get("amplitude"), 20, 70, 55)
    cycles = _clampi(p.get("cycles", p.get("waves")), 1, 4, 2)
    parts = [_title("Parts of a wave")]
    mid = 220
    pts = []
    for i in range(0, 481):
        x = 80 + i
        t = (i / 480) * cycles * 2 * math.pi
        pts.append(f"{x},{mid - math.sin(t) * amp:.1f}")
    parts.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="#2563eb" stroke-width="3.5"/>')
    parts.append(f'<line x1="60" y1="{mid}" x2="590" y2="{mid}" stroke="{LINE}" stroke-width="1.5" stroke-dasharray="5 5"/>')
    one = 480 / cycles
    x1 = 80 + one * 0.25
    x2 = x1 + one
    parts.append(f'<path d="M{x1} 96 L{x2} 96" stroke="#16a34a" stroke-width="2" marker-start="url(#svgarrow)" marker-end="url(#svgarrow)"/>')
    parts.append(_label((x1 + x2) / 2, 88, "Wavelength", size=12, colour="#15803d"))
    parts.append(f'<path d="M{x1} {mid} L{x1} {mid - amp}" stroke="#ea580c" stroke-width="2" marker-end="url(#svgarrow)"/>')
    parts.append(_label(x1 + 54, mid - amp / 2, "Amplitude", size=12, colour="#c2410c"))
    parts.append(_label(x1, mid - amp - 12, "Crest", size=12))
    parts.append(_label(x1 + one / 2, mid + amp + 22, "Trough", size=12))
    return _wrap(_ARROW_DEF + "".join(parts))


def _solar_system(p: dict) -> str:
    """The planets in order from the Sun (KS2/KS3 Space)."""
    planets = [("Mercury", "#a8a29e", 6), ("Venus", "#fbbf24", 9), ("Earth", "#3b82f6", 10),
               ("Mars", "#ef4444", 8), ("Jupiter", "#f59e0b", 20), ("Saturn", "#fcd34d", 17),
               ("Uranus", "#67e8f9", 13), ("Neptune", "#3b82f6", 12)]
    parts = [_title("Our solar system")]
    parts.append('<circle cx="46" cy="215" r="46" fill="#fde047" stroke="#f59e0b" stroke-width="3"/>')
    parts.append(_label(46, 288, "Sun", size=13))
    x = 130
    for i, (name, colour, r) in enumerate(planets):
        y = 215
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{colour}" stroke="{INK}" stroke-width="1.2"/>')
        if name == "Saturn":
            parts.append(f'<ellipse cx="{x}" cy="{y}" rx="{r + 10}" ry="4.5" fill="none" stroke="#eab308" stroke-width="2"/>')
        ly = y - r - 12 if i % 2 == 0 else y + r + 20
        parts.append(_label(x, ly, name, size=11))
        x += r + 52
    parts.append(_label(W / 2, 372, "Not to scale — order from the Sun", size=11, colour=MUTED, weight=500))
    return _wrap("".join(parts))


def _forces_on_object(p: dict) -> str:
    """The four forces on a moving object (KS3 Forces)."""
    up = _esc(p.get("up") or "Lift / Upthrust")
    down = _esc(p.get("down") or "Weight")
    left = _esc(p.get("left") or "Drag")
    right = _esc(p.get("right") or "Thrust")
    parts = [_title("Forces on an object")]
    parts.append('<rect x="270" y="180" width="100" height="70" rx="10" fill="#dbeafe" stroke="#2563eb" stroke-width="3"/>')
    arrows = [(320, 175, 320, 96, right if False else up, "#16a34a", 0, -14),
              (320, 255, 320, 334, down, "#dc2626", 0, 20),
              (265, 215, 176, 215, left, "#ea580c", -12, -10),
              (375, 215, 464, 215, right, "#7c3aed", 12, -10)]
    for x1, y1, x2, y2, text, colour, dx, dy in arrows:
        parts.append(f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{colour}" stroke-width="4" marker-end="url(#svgarrow)"/>')
        anchor = "middle" if x1 == x2 else ("end" if x2 < x1 else "start")
        parts.append(_label(x2 + dx, y2 + dy, text, size=12, colour=colour, anchor=anchor))
    return _wrap(_ARROW_DEF + "".join(parts))


_ARROW_DEF = ('<defs><marker id="svgarrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" '
              'orient="auto"><polygon points="0 0, 9 4.5, 0 9" fill="currentColor" '
              'style="fill:inherit"/></marker></defs>')


# ── Maths ────────────────────────────────────────────────────────────────────────
# Maths is over half the curriculum here, so these cover its biggest recurring themes:
# place value / significant figures / standard form, fractions, angles, area & perimeter,
# and reading a bar chart.

_PV_COLUMNS = [("Thousands", 1000), ("Hundreds", 100), ("Tens", 10), ("Ones", 1),
               ("Tenths", 0.1), ("Hundredths", 0.01)]


def _place_value(p: dict) -> str:
    """Place-value columns with a number placed in them; optionally highlights the significant
    figures (KS2/KS3 place value · decimals · significant figures · standard form)."""
    raw = str(p.get("number", p.get("value", "3040"))).strip()
    sig = _clampi(p.get("significant_figures", p.get("sig_figs")), 0, 6, 0)
    digits = [c for c in raw if c.isdigit()]
    digits = digits[:6] or ["0"]
    # index of the first significant digit (first non-zero)
    first_sig = next((i for i, d in enumerate(digits) if d != "0"), 0)

    parts = [_title(f"Place value — {_esc(raw)}")]
    n = len(digits)
    total_w = n * 84
    x0 = (W - total_w) / 2
    cols = _PV_COLUMNS[:n] if n <= len(_PV_COLUMNS) else _PV_COLUMNS
    for i, d in enumerate(digits):
        x = x0 + i * 84
        is_sig = sig > 0 and first_sig <= i < first_sig + sig
        fill = "#dbeafe" if is_sig else "#f8fafc"
        stroke = "#2563eb" if is_sig else LINE
        parts.append(f'<rect x="{x:.0f}" y="120" width="76" height="96" rx="8" fill="{fill}" '
                     f'stroke="{stroke}" stroke-width="{3 if is_sig else 1.6}"/>')
        parts.append(_label(x + 38, 184, d, size=38, weight=800,
                            colour="#1d4ed8" if is_sig else INK))
        name = cols[i][0] if i < len(cols) else ""
        parts.append(_label(x + 38, 238, name, size=11, colour=MUTED, weight=600))
        if sig > 0 and first_sig <= i < first_sig + sig:
            parts.append(_label(x + 38, 106, f"{i - first_sig + 1}{'st' if i == first_sig else ('nd' if i - first_sig == 1 else ('rd' if i - first_sig == 2 else 'th'))}",
                                size=11, colour="#1d4ed8"))
    if sig > 0:
        parts.append(_label(W / 2, 300, f"The first {sig} significant figure(s) are highlighted — "
                                        f"count from the FIRST non-zero digit.", size=13, colour="#1d4ed8"))
        parts.append(_label(W / 2, 326, "Leading zeros are never significant.",
                            size=12, colour=MUTED, weight=500))
    else:
        parts.append(_label(W / 2, 300, "Each column is 10× the one to its right.",
                            size=13, colour=MUTED, weight=500))
    return _wrap("".join(parts))


def _fraction_compare(p: dict) -> str:
    """Two fraction bars side by side (KS1-KS3 fractions · equivalence · comparing)."""
    a_n = _clampi(p.get("a_numerator", p.get("n1")), 0, 12, 1)
    a_d = _clampi(p.get("a_denominator", p.get("d1")), 1, 12, 2)
    b_n = _clampi(p.get("b_numerator", p.get("n2")), 0, 12, 2)
    b_d = _clampi(p.get("b_denominator", p.get("d2")), 1, 12, 4)
    a_n, b_n = min(a_n, a_d), min(b_n, b_d)
    parts = [_title("Comparing fractions")]
    for row, (nn, dd, colour) in enumerate(((a_n, a_d, "#2563eb"), (b_n, b_d, "#16a34a"))):
        y = 120 + row * 110
        bw = 440
        x0 = 100
        parts.append(_label(x0 - 22, y + 40, f"{nn}/{dd}", size=20, anchor="end", colour=colour))
        for i in range(dd):
            w = bw / dd
            fill = colour if i < nn else "#ffffff"
            parts.append(f'<rect x="{x0 + i * w:.1f}" y="{y}" width="{w:.1f}" height="62" '
                         f'fill="{fill}" stroke="{INK}" stroke-width="1.8"/>')
    va = a_n / a_d if a_d else 0
    vb = b_n / b_d if b_d else 0
    verdict = ("They are EQUIVALENT — the same amount." if abs(va - vb) < 1e-9
               else (f"{a_n}/{a_d} is bigger." if va > vb else f"{b_n}/{b_d} is bigger."))
    parts.append(_label(W / 2, 356, verdict, size=14))
    return _wrap("".join(parts))


def _angle_types(p: dict) -> str:
    """The four angle types drawn to scale (KS2/KS3 angles · geometry · shape)."""
    import math
    parts = [_title("Types of angle")]
    kinds = [("Acute", 45, "#16a34a", "less than 90°"), ("Right", 90, "#2563eb", "exactly 90°"),
             ("Obtuse", 130, "#f97316", "between 90° and 180°"), ("Reflex", 240, "#7c3aed", "more than 180°")]
    for i, (name, deg, colour, note) in enumerate(kinds):
        cx = 90 + i * 155
        cy = 215
        r = 54
        a = math.radians(deg)
        parts.append(f'<line x1="{cx}" y1="{cy}" x2="{cx + r}" y2="{cy}" stroke="{INK}" stroke-width="3"/>')
        parts.append(f'<line x1="{cx}" y1="{cy}" x2="{cx + math.cos(-a) * r:.1f}" '
                     f'y2="{cy + math.sin(-a) * r:.1f}" stroke="{INK}" stroke-width="3"/>')
        large = 1 if deg > 180 else 0
        ax, ay = cx + 26, cy
        bx = cx + math.cos(-a) * 26
        by = cy + math.sin(-a) * 26
        parts.append(f'<path d="M{ax} {ay} A 26 26 0 {large} 0 {bx:.1f} {by:.1f}" fill="none" '
                     f'stroke="{colour}" stroke-width="3"/>')
        parts.append(_label(cx + 10, cy + 78, name, size=14, colour=colour))
        parts.append(_label(cx + 10, cy + 96, note, size=10.5, colour=MUTED, weight=500))
    return _wrap("".join(parts))


def _area_perimeter(p: dict) -> str:
    """A labelled rectangle showing area vs perimeter (KS2/KS3 area · perimeter)."""
    w_ = _clampi(p.get("width", p.get("w")), 1, 20, 8)
    h_ = _clampi(p.get("height", p.get("h")), 1, 20, 5)
    parts = [_title("Area and perimeter")]
    px, py = 170, 120
    pw, ph = 300, 170
    parts.append(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="#dbeafe" '
                 f'stroke="#2563eb" stroke-width="3"/>')
    for i in range(1, w_):
        x = px + pw * i / w_
        parts.append(f'<line x1="{x:.1f}" y1="{py}" x2="{x:.1f}" y2="{py + ph}" stroke="#93c5fd" stroke-width="1"/>')
    for i in range(1, h_):
        y = py + ph * i / h_
        parts.append(f'<line x1="{px}" y1="{y:.1f}" x2="{px + pw}" y2="{y:.1f}" stroke="#93c5fd" stroke-width="1"/>')
    parts.append(_label(px + pw / 2, py - 12, f"{w_} cm", size=14, colour="#1d4ed8"))
    parts.append(_label(px - 34, py + ph / 2 + 5, f"{h_} cm", size=14, colour="#1d4ed8"))
    parts.append(_label(px + pw / 2, py + ph / 2 + 6, f"Area = {w_} × {h_} = {w_ * h_} cm²",
                        size=16, weight=800))
    parts.append(_label(W / 2, 330, f"Perimeter = all the way round = {2 * (w_ + h_)} cm", size=14))
    parts.append(_label(W / 2, 354, "Area fills the inside · perimeter goes around the edge",
                        size=12, colour=MUTED, weight=500))
    return _wrap("".join(parts))


def _bar_chart(p: dict) -> str:
    """A labelled bar chart to read off (KS1-KS3 statistics · charts · data)."""
    raw = p.get("values") or [4, 7, 3, 6]
    labels = p.get("labels") or ["A", "B", "C", "D"]
    if isinstance(raw, str):
        raw = [v.strip() for v in raw.split(",")]
    if isinstance(labels, str):
        labels = [v.strip() for v in labels.split(",")]
    vals = []
    for v in list(raw)[:6]:
        try:
            vals.append(max(0, min(20, int(v))))
        except (TypeError, ValueError):
            vals.append(0)
    if not vals:
        vals = [4, 7, 3, 6]
    labels = (list(labels) + [f"#{i+1}" for i in range(len(vals))])[:len(vals)]
    top = max(vals + [1])
    parts = [_title("Reading a bar chart")]
    bx, by, bw, bh = 110, 300, 400, 190
    parts.append(f'<line x1="{bx}" y1="{by}" x2="{bx + bw}" y2="{by}" stroke="{INK}" stroke-width="2.5"/>')
    parts.append(f'<line x1="{bx}" y1="{by}" x2="{bx}" y2="{by - bh}" stroke="{INK}" stroke-width="2.5"/>')
    for g in range(0, top + 1, max(1, top // 5)):
        y = by - (g / top) * bh
        parts.append(f'<line x1="{bx - 5}" y1="{y:.1f}" x2="{bx + bw}" y2="{y:.1f}" stroke="#e2e8f0" stroke-width="1"/>')
        parts.append(_label(bx - 12, y + 4, str(g), size=11, colour=MUTED, anchor="end", weight=500))
    n = len(vals)
    slot = bw / n
    colours = ["#2563eb", "#16a34a", "#f97316", "#7c3aed", "#ec4899", "#0891b2"]
    for i, v in enumerate(vals):
        h = (v / top) * bh
        x = bx + i * slot + slot * 0.18
        w = slot * 0.64
        parts.append(f'<rect x="{x:.1f}" y="{by - h:.1f}" width="{w:.1f}" height="{h:.1f}" '
                     f'fill="{colours[i % len(colours)]}" rx="3"/>')
        parts.append(_label(x + w / 2, by - h - 8, str(v), size=12))
        parts.append(_label(x + w / 2, by + 18, str(labels[i])[:10], size=11, colour=MUTED, weight=600))
    return _wrap("".join(parts))


# ── Registry ─────────────────────────────────────────────────────────────────────
# topics = keywords matched against the lesson's unit/subtopic title.

DIAGRAMS: Dict[str, Dict[str, Any]] = {
    "animal_cell": {
        "build": lambda p: _cell(p, plant=False), "title": "Animal cell",
        "caption": "The main parts of an animal cell.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["biology", "science"],
        "topics": ["cell", "animal cell", "organelle", "microscope", "nucleus", "cytoplasm"],
    },
    "plant_cell": {
        "build": lambda p: _cell(p, plant=True), "title": "Plant cell",
        "caption": "A plant cell — note the cell wall, chloroplasts and vacuole.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["biology", "science"],
        "topics": ["plant cell", "cell wall", "chloroplast", "vacuole", "cell", "photosynthesis"],
    },
    "digestive_system": {
        "build": _digestive, "title": "The digestive system",
        "caption": "The route food takes through the body.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["biology", "science"],
        "topics": ["digest", "digestion", "digestive", "stomach", "intestine", "teeth", "food"],
    },
    "photosynthesis": {
        "build": _leaf_photosynthesis, "title": "Photosynthesis",
        "caption": "Light, carbon dioxide and water in — glucose and oxygen out.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["biology", "science"],
        "topics": ["photosynthesis", "plant nutrition", "chlorophyll", "leaf", "glucose"],
    },
    "particle_states": {
        "build": _particle_states, "title": "Solids, liquids and gases",
        "caption": "How particles are arranged in each state of matter.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["chemistry", "science", "physics"],
        "topics": ["state of matter", "states", "solid", "liquid", "gas", "particle",
                   "changes of state", "melting", "evaporation", "condens"],
    },
    "atom_shells": {
        "build": _atom_shells, "title": "Structure of an atom",
        "caption": "Protons and neutrons in the nucleus, electrons in shells.",
        "key_stages": ["KS3", "KS4", "KS5"], "subjects": ["chemistry", "science", "physics"],
        "topics": ["atom", "atomic structure", "element", "proton", "neutron", "electron",
                   "periodic table", "compound"],
    },
    "series_circuit": {
        "build": lambda p: _circuit(p, parallel=False), "title": "Series circuit",
        "caption": "One loop — the same current flows through every component.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["physics", "science"],
        "topics": ["series circuit", "circuit", "current", "electric", "cell", "lamp", "bulb"],
    },
    "parallel_circuit": {
        "build": lambda p: _circuit(p, parallel=True), "title": "Parallel circuit",
        "caption": "Separate branches — each component gets the full voltage.",
        "key_stages": ["KS3", "KS4"], "subjects": ["physics", "science"],
        "topics": ["parallel circuit", "parallel", "resistance", "branch", "voltage"],
    },
    "wave_parts": {
        "build": _wave, "title": "Parts of a wave",
        "caption": "Wavelength, amplitude, crest and trough.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["physics", "science"],
        "topics": ["wave", "sound", "amplitude", "wavelength", "frequency", "light", "vibration"],
    },
    "solar_system": {
        "build": _solar_system, "title": "Our solar system",
        "caption": "The eight planets in order from the Sun.",
        "key_stages": ["KS1", "KS2", "KS3"], "subjects": ["physics", "science"],
        "topics": ["solar system", "planet", "space", "sun", "earth", "moon", "orbit", "beyond"],
    },
    "forces_on_object": {
        "build": _forces_on_object, "title": "Forces on an object",
        "caption": "Balanced and unbalanced forces acting on a moving object.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["physics", "science"],
        "topics": ["force", "thrust", "drag", "weight", "upthrust", "friction", "moving by force",
                   "hidden force", "gravity", "air resistance"],
    },

    # ── Maths (over half the curriculum — these cover its biggest recurring themes) ──
    "place_value_columns": {
        "build": _place_value, "title": "Place value columns",
        "caption": "Each column is ten times the one to its right.",
        "key_stages": ["KS1", "KS2", "KS3", "KS4"], "subjects": ["maths"],
        "topics": ["significant figure", "standard form", "place value", "rounding", "round to",
                   "decimal", "power", "indices", "estimat", "ordering numbers", "tens and ones",
                   "digit"],
    },
    "fraction_compare": {
        "build": _fraction_compare, "title": "Comparing fractions",
        "caption": "Two fraction bars side by side.",
        "key_stages": ["KS1", "KS2", "KS3"], "subjects": ["maths"],
        "topics": ["fraction", "equivalent", "compare", "numerator", "denominator", "percent",
                   "ratio", "proportion", "half", "quarter", "third"],
    },
    "angle_types": {
        "build": _angle_types, "title": "Types of angle",
        "caption": "Acute, right, obtuse and reflex angles.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["maths"],
        "topics": ["angle", "geometry", "shape", "polygon", "triangle", "degrees", "protractor",
                   "properties of shape", "acute", "obtuse", "reflex"],
    },
    "area_perimeter": {
        "build": _area_perimeter, "title": "Area and perimeter",
        "caption": "Area fills the inside; perimeter goes around the edge.",
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["maths"],
        "topics": ["area", "perimeter", "volume", "surface", "rectangle", "square units", "cm2"],
    },
    "bar_chart": {
        "build": _bar_chart, "title": "Reading a bar chart",
        "caption": "Read each bar off against the scale.",
        "key_stages": ["KS1", "KS2", "KS3", "KS4"], "subjects": ["maths", "science"],
        "topics": ["chart", "graph", "statistic", "data", "average", "mean", "median", "mode",
                   "bar", "pictogram", "tally", "frequency", "diagrams"],
    },
}

KINDS = list(DIAGRAMS)


def _norm_ks(ks: Optional[str]) -> str:
    return (ks or "").upper().replace(" ", "")


def available_kinds(key_stage: Optional[str], subject: Optional[str]) -> List[str]:
    ks = _norm_ks(key_stage)
    subj = (subject or "").strip().lower()
    out = []
    for k, e in DIAGRAMS.items():
        if ks and e["key_stages"] and ks not in e["key_stages"]:
            continue
        if subj and e["subjects"] and not any(s in subj for s in e["subjects"]):
            continue
        out.append(k)
    return out


def pick_for_topic(topic: Optional[str], key_stage: Optional[str],
                   subject: Optional[str]) -> List[str]:
    """The diagram(s) whose topic keywords match this lesson, best match first."""
    t = (topic or "").lower()
    if not t:
        return []
    allowed = set(available_kinds(key_stage, subject))
    scored = []
    for k in allowed:
        hits = sum(1 for kw in DIAGRAMS[k]["topics"] if kw in t)
        if hits:
            scored.append((hits, k))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [k for _h, k in scored]


# ─────────────────────────────────────────────────────────────────────────────
# MODEL-AUTHORED SVG — sanitiser
# ─────────────────────────────────────────────────────────────────────────────
# The templates above cover 16 common structures; the curriculum has hundreds. So the tutor may
# also WRITE an SVG for whatever it is teaching. That markup is inlined into the page with
# `dangerouslySetInnerHTML`, so it is an XSS sink and is treated as hostile input.
#
# This is an ALLOW-LIST PARSER, not a filter. The markup is parsed to a tree, every element and
# attribute not on the lists below is dropped, and the result is re-serialised from scratch —
# so anything the parser did not explicitly understand cannot survive into the output. A
# blocklist ("strip <script>") would be defeated by the first novel vector; this cannot be,
# because unknown input is dropped rather than passed through.
#
# Note there is NO code execution here at all: SVG is declarative markup. That makes this
# strictly safer than the Manim path, which is why the tutor is pointed here first.

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"

MAX_SVG_CHARS = 20000
MAX_SVG_NODES = 800

_SVG_ELEMENTS = {
    "svg", "g", "defs", "title", "desc", "symbol", "use",
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "textPath",
    "marker", "linearGradient", "radialGradient", "stop", "pattern",
    "clipPath", "mask", "filter",
    # SMIL — free animation with no video render at all
    "animate", "animateTransform", "animateMotion", "mpath", "set",
    # a small, well-understood filter set
    "feGaussianBlur", "feOffset", "feMerge", "feMergeNode", "feDropShadow",
    "feColorMatrix", "feBlend", "feFlood", "feComposite",
}

_PRESENTATION_ATTRS = {
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
    "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
    "stroke-miterlimit", "opacity", "color", "display", "visibility", "transform",
    "vector-effect", "paint-order", "shape-rendering", "clip-path", "clip-rule",
    "mask", "filter", "marker-start", "marker-mid", "marker-end",
    "font-family", "font-size", "font-weight", "font-style", "text-anchor",
    "dominant-baseline", "alignment-baseline", "letter-spacing", "word-spacing",
    "baseline-shift", "writing-mode", "stop-color", "stop-opacity",
    "flood-color", "flood-opacity",
}

_SVG_ATTRS = _PRESENTATION_ATTRS | {
    "id", "class", "style",
    # geometry
    "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "d", "points", "dx", "dy", "rotate", "pathLength",
    # root / viewport
    "viewBox", "preserveAspectRatio", "version", "xmlns", "xmlns:xlink",
    # text
    "textLength", "lengthAdjust", "startOffset", "xml:space",
    # gradients / patterns
    "gradientUnits", "gradientTransform", "spreadMethod", "offset", "fx", "fy",
    "patternUnits", "patternContentUnits", "patternTransform",
    # markers
    "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits",
    # clip / mask
    "clipPathUnits", "maskUnits", "maskContentUnits",
    # animation
    "attributeName", "attributeType", "from", "to", "by", "values", "keyTimes",
    "keySplines", "dur", "begin", "end", "repeatCount", "repeatDur", "calcMode",
    "additive", "accumulate", "type", "path", "keyPoints",
    # filter primitives
    "in", "in2", "result", "stdDeviation", "mode", "operator", "k1", "k2", "k3", "k4",
    # local references only — enforced in _clean_attr
    "href", "xlink:href",
}


class SvgError(ValueError):
    """Sanitising failed — the message is written to be actionable by the model."""


def _local(tag: str) -> Optional[str]:
    """Strip the namespace. Returns None for a namespace we don't accept at all."""
    if not isinstance(tag, str):
        return None                       # comments / PIs arrive as callables
    if tag.startswith("{"):
        ns, _, name = tag[1:].partition("}")
        if ns == _SVG_NS:
            return name
        if ns == _XLINK_NS:
            return f"xlink:{name}"
        return None
    return tag


def _safe_style(value: str) -> bool:
    v = value.lower().replace(" ", "")
    if "javascript:" in v or "expression(" in v or "@import" in v or "behavior:" in v:
        return False
    # url(#local) is fine (gradients/markers); any other url() reaches off-document
    idx = 0
    while True:
        idx = v.find("url(", idx)
        if idx == -1:
            return True
        if not v[idx + 4:].lstrip("'\"").startswith("#"):
            return False
        idx += 4


def _clean_attr(name: str, value: str) -> Optional[Tuple[str, str]]:
    n = _local(name)
    if not n:
        return None
    if n.lower().startswith("on"):        # every event handler, known or not
        return None
    if n not in _SVG_ATTRS:
        return None
    v = (value or "").strip()
    if n in ("href", "xlink:href"):
        # Only same-document references (<use href="#star">). Anything else could fetch,
        # navigate or carry a javascript: payload.
        if not v.startswith("#"):
            return None
    if n == "style" and not _safe_style(v):
        return None
    if n == "attributeName":
        # SMIL can animate an arbitrary attribute — including one that would become a handler.
        if v not in _PRESENTATION_ATTRS and v not in (
                "x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points",
                "transform", "offset", "x1", "y1", "x2", "y2"):
            return None
    if "javascript:" in v.lower().replace(" ", ""):
        return None
    return n, v


_VOID_OK = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
            "stop", "use", "animate", "animateTransform", "animateMotion", "set",
            "mpath", "feGaussianBlur", "feOffset", "feMergeNode", "feDropShadow",
            "feColorMatrix", "feBlend", "feFlood", "feComposite"}


def _serialise(el, out: List[str], budget: List[int]) -> None:
    tag = _local(el.tag)
    if not tag or tag not in _SVG_ELEMENTS:
        return                              # drop the element AND its subtree
    budget[0] -= 1
    if budget[0] < 0:
        raise SvgError(f"the diagram has too many elements (max {MAX_SVG_NODES}) — "
                       "show one clear structure, not a whole scene")

    attrs = []
    kept: dict = {}
    for k, v in (el.attrib or {}).items():
        cleaned = _clean_attr(k, v)
        if cleaned:
            kept[cleaned[0]] = cleaned[1]
            attrs.append(f'{cleaned[0]}="{escape(cleaned[1], quote=True)}"')

    # THE CLASSIC SVG TRAP: `fill` defaults to BLACK, not none. A <path>/<polyline> drawn as a
    # WIRE — stroked, open, no fill given — is therefore filled solid black between its endpoints.
    # A student was shown a parallel circuit as three black triangles. If the author stroked it
    # and said nothing about fill, they meant a line, so make that explicit. Elements that DO
    # specify a fill, and genuinely-filled shapes (polygon arrowheads, rect, circle), are
    # untouched — as is any element with no stroke, which is filled on purpose.
    if (tag in ("path", "polyline")
            and "fill" not in kept
            and "fill" not in (kept.get("style") or "")):
        attrs.append('fill="none"')
        # A path with neither fill nor stroke was only visible BECAUSE of the black default, so
        # give it a visible stroke rather than turning it invisible.
        if "stroke" not in kept and "stroke" not in (kept.get("style") or ""):
            attrs.append('stroke="#0f172a"')
        if "stroke-width" not in kept:
            attrs.append('stroke-width="2"')

    open_tag = f"<{tag}{(' ' + ' '.join(attrs)) if attrs else ''}"

    children = list(el)
    text = (el.text or "").strip()
    if not children and not text and tag in _VOID_OK:
        out.append(open_tag + "/>")
        return

    out.append(open_tag + ">")
    if text:
        out.append(escape(text))
    for child in children:
        _serialise(child, out, budget)
        tail = (child.tail or "").strip()
        if tail:
            out.append(escape(tail))
    out.append(f"</{tag}>")


def sanitize_svg(markup: str) -> str:
    """Return safe, self-contained SVG, or raise SvgError with a model-actionable message."""
    import xml.etree.ElementTree as ET

    src = (markup or "").strip()
    if not src:
        raise SvgError("the SVG was empty")
    if len(src) > MAX_SVG_CHARS:
        raise SvgError(f"the SVG is too long ({len(src)} chars, max {MAX_SVG_CHARS})")

    # Strip a ```svg fence if the model wrapped it despite being told not to.
    if src.startswith("```"):
        src = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", src).strip()

    # Reject doctypes/entities/PIs BEFORE parsing: internal entity expansion is a
    # denial-of-service ("billion laughs") and external entities read local files (XXE).
    low = src.lower()
    if "<!doctype" in low or "<!entity" in low or "<?" in low:
        raise SvgError("doctypes, entities and processing instructions are not allowed — "
                       "send a plain <svg>…</svg> element only")

    start = src.find("<svg")
    if start == -1:
        raise SvgError("that isn't an SVG — it must start with an <svg> element carrying a viewBox")
    src = src[start:]

    try:
        root = ET.fromstring(src)
    except ET.ParseError as e:
        raise SvgError(f"the SVG is not well-formed XML ({e}) — every tag must be closed, "
                       "e.g. <circle ... /> and <text ...>label</text>") from e

    if _local(root.tag) != "svg":
        raise SvgError("the root element must be <svg>")

    out: List[str] = []
    _serialise(root, out, [MAX_SVG_NODES])
    svg = "".join(out)

    # Guarantee a viewBox so the diagram scales to the Learn panel instead of overflowing.
    if "viewBox=" not in svg:
        w = (root.get("width") or "").strip().rstrip("px") or str(W)
        h = (root.get("height") or "").strip().rstrip("px") or str(H)
        try:
            svg = svg.replace("<svg", f'<svg viewBox="0 0 {float(w):g} {float(h):g}"', 1)
        except ValueError:
            svg = svg.replace("<svg", f'<svg viewBox="0 0 {W} {H}"', 1)
    if "xmlns=" not in svg:
        svg = svg.replace("<svg", f'<svg xmlns="{_SVG_NS}"', 1)
    return svg


def build(kind: str, params: Optional[dict] = None) -> Optional[Dict[str, str]]:
    """(svg, title, caption) for a diagram kind, or None if unknown."""
    entry = DIAGRAMS.get((kind or "").strip().lower())
    if not entry:
        return None
    try:
        svg = entry["build"](params or {})
    except Exception as e:  # noqa: BLE001 — a broken diagram must never break the lesson
        logger.warning("svg diagram build failed kind=%s: %s: %s", kind, type(e).__name__, e)
        return None
    return {"svg": svg, "title": entry["title"], "caption": entry["caption"]}


# ═══════════════════════════════════════════════════════════════════════════
# MANIM ANIMATIONS (merged from the former manim_service.py)
# ═══════════════════════════════════════════════════════════════════════════
"""
manim_service.py — compile, sandbox, render and cache MODEL-AUTHORED Manim animations.

The tutor writes the body of a Manim `Scene.construct()` for whatever it is teaching right now,
so animation coverage is no longer capped by a handful of hand-written templates. Running
model-authored Python is genuinely dangerous, so it is gated by TWO independent layers — either
one alone would be insufficient:

  LAYER 1 — STATIC ALLOW-LIST (`validate_scene_code`). The code is parsed to an AST and every
    node is checked against an allow-list. No imports, no def/class/lambda-free-for-all, no
    `while`, no attribute whose name starts with `_` (this is what kills the classic
    `().__class__.__base__.__subclasses__()` sandbox escape), and every free variable must be a
    curated Manim name or a safe builtin. Rejections come back as a message the model can act on.

  LAYER 2 — PROCESS ISOLATION (`_render_sync`). Validated code still runs in a SEPARATE process,
    never in the API worker: a scrubbed environment (the app's DB URL, Gemini key and JWT secret
    are NOT passed), a throwaway cwd, an empty PYTHONPATH so `app.*` is unimportable, POSIX
    rlimits on CPU/memory/file-size, its own session so a timeout kills the whole process group,
    and a hard wall-clock timeout.

  Layer 1 assumes it is bypassable and Layer 2 assumes it will be reached. Known residual gap:
  there is no network namespace, so egress is not blocked at the OS level — it is blocked by
  Layer 1 having no reachable import/socket name, and its blast radius is limited by the
  scrubbed env holding no credentials. Closing it properly means running this in its own
  container or as a separate unprivileged user.

Two operational properties are unchanged:
  - GRACEFUL DEGRADATION. Manim (+ cairo/pango/ffmpeg) is OPTIONAL. Without it `MANIM_AVAILABLE`
    is False and the tool tells the model to use a diagram instead.
  - NEVER BLOCKS A TURN. A cache HIT serves instantly; a MISS renders in the BACKGROUND and the
    turn reports "rendering" (the tutor explains with a diagram now; it is instant next time).
"""
import ast
import asyncio
import hashlib
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# Rendered MP4s live here; served at /api/curriculum/animations/{key}.mp4
ANIM_DIR = Path("/app/media/animations")

# Scratch space for the generated scene script. This MUST live outside /app: dev runs uvicorn
# with --reload, whose watcher restarts the server whenever a .py file under the app tree
# changes — writing the scene there restarted the backend on every render and dropped every
# live lesson WebSocket. The system temp dir is not watched.
_WORK_DIR = Path(tempfile.gettempdir()) / "manim_work"

try:  # manim is heavy + optional — its absence disables animations, it never breaks the app
    import manim as _manim  # type: ignore  # noqa: F401
    MANIM_AVAILABLE = True
except Exception as e:  # noqa: BLE001
    MANIM_AVAILABLE = False
    logger.info("Manim not available (%s) — animations disabled; the tutor uses diagrams.", e)


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 1 — static validation
# ─────────────────────────────────────────────────────────────────────────────

MAX_CODE_CHARS = 6000
MAX_AST_NODES = 900

# Statements/expressions the scene body may use. Anything absent is refused, so this list is the
# whole grammar the model is allowed to write — deliberately smaller than Python.
_ALLOWED_NODES = {
    ast.Module, ast.Expr, ast.Assign, ast.AugAssign, ast.For, ast.If, ast.Pass,
    ast.Break, ast.Continue, ast.Call, ast.Name, ast.Attribute, ast.Constant,
    ast.JoinedStr, ast.FormattedValue, ast.List, ast.Tuple, ast.Dict, ast.Set,
    ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.Subscript, ast.Slice,
    ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.comprehension,
    ast.Starred, ast.keyword, ast.arg, ast.arguments, ast.Lambda, ast.IfExp,
    ast.Load, ast.Store, ast.Del, ast.NamedExpr,
    # operators
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.USub, ast.UAdd, ast.Not, ast.Invert, ast.And, ast.Or,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn,
    ast.Is, ast.IsNot, ast.MatMult, ast.BitAnd, ast.BitOr, ast.BitXor,
    ast.LShift, ast.RShift,
}

# Refused with a specific explanation, because the model would otherwise keep retrying these.
_NODE_HELP = {
    ast.Import: "imports are not allowed — every Manim name you need is already available",
    ast.ImportFrom: "imports are not allowed — every Manim name you need is already available",
    ast.FunctionDef: "'def' is not allowed — use a lambda or write the steps inline",
    ast.AsyncFunctionDef: "'async def' is not allowed",
    ast.ClassDef: "'class' is not allowed — write only the body of construct()",
    ast.While: "'while' is not allowed (it can hang) — use 'for i in range(n)'",
    ast.Try: "try/except is not allowed",
    ast.Raise: "'raise' is not allowed",
    ast.With: "'with' is not allowed",
    ast.Global: "'global' is not allowed",
    ast.Nonlocal: "'nonlocal' is not allowed",
    ast.Delete: "'del' is not allowed",
    ast.Assert: "'assert' is not allowed",
    ast.Return: "'return' is not allowed — this is the body of construct()",
    ast.Yield: "generators are not allowed",
    ast.YieldFrom: "generators are not allowed",
    ast.Await: "'await' is not allowed",
}

_SAFE_BUILTINS = {
    "range", "len", "min", "max", "abs", "round", "sum", "int", "float", "str",
    "list", "tuple", "dict", "set", "enumerate", "zip", "sorted", "reversed",
    "bool", "any", "all", "map", "filter",
}

_MANIM_CONSTANTS = {
    "PI", "TAU", "DEGREES", "UP", "DOWN", "LEFT", "RIGHT", "IN", "OUT", "ORIGIN",
    "UL", "UR", "DL", "DR", "X_AXIS", "Y_AXIS", "Z_AXIS",
    "SMALL_BUFF", "MED_SMALL_BUFF", "MED_LARGE_BUFF", "LARGE_BUFF",
    # screen edges / frame geometry (real config-derived constants)
    "TOP", "BOTTOM", "LEFT_SIDE", "RIGHT_SIDE",
    "FRAME_WIDTH", "FRAME_HEIGHT", "FRAME_X_RADIUS", "FRAME_Y_RADIUS",
    "DEFAULT_STROKE_WIDTH", "DEFAULT_DOT_RADIUS", "DEFAULT_FONT_SIZE",
}

_MANIM_COLORS = {
    "WHITE", "BLACK", "RED", "GREEN", "BLUE", "YELLOW", "ORANGE", "PURPLE", "PINK",
    "GREY", "GRAY", "TEAL", "MAROON", "GOLD", "LIGHT_GREY", "DARK_GREY", "LIGHT_GRAY",
    "DARK_GRAY", "LIGHT_BROWN", "DARK_BROWN", "PURE_RED", "PURE_GREEN", "PURE_BLUE",
    "LIGHT_PINK", "DARKER_GREY", "DARKER_GRAY",
    "LIGHTER_GREY", "LIGHTER_GRAY", "GREY_BROWN", "GRAY_BROWN",
    "YELLOW_A", "YELLOW_E",  # (A..E for the main stems are added by the loop below)
}
# BLUE_A … GOLD_E etc.
for _stem in ("BLUE", "RED", "GREEN", "YELLOW", "PURPLE", "GREY", "GRAY", "TEAL",
              "MAROON", "GOLD", "PINK", "ORANGE"):
    for _suf in ("A", "B", "C", "D", "E"):
        _MANIM_COLORS.add(f"{_stem}_{_suf}")

_MANIM_MOBJECTS = {
    # shapes
    "Circle", "Square", "Rectangle", "RoundedRectangle", "Triangle", "Polygon",
    "RegularPolygon", "Line", "DashedLine", "Arrow", "DoubleArrow", "Vector",
    "Dot", "LabeledDot", "Ellipse", "Annulus", "Arc", "ArcBetweenPoints", "Sector",
    "AnnularSector", "Star", "Cross", "Elbow", "Angle", "RightAngle", "Brace",
    "BraceBetweenPoints", "SurroundingRectangle", "Underline", "Cutout", "ArcPolygon",
    "CubicBezier", "ArrowVectorField", "Polyline", "DashedVMobject",
    # text — Text/MarkupText/Paragraph are Pango (no LaTeX); MathTex/Tex/Title need LaTeX (texlive)
    "Text", "MarkupText", "Paragraph", "MathTex", "Tex", "SingleStringMathTex", "Title",
    # numbers / counters — render via Text by default (see _LATEX_FREE_PREAMBLE)
    "DecimalNumber", "Integer", "Variable",
    # containers
    "VGroup", "Group", "VDict", "VMobject", "Mobject",
    # graphing
    "Axes", "NumberPlane", "NumberLine", "ComplexPlane", "BarChart",
    "ParametricFunction", "FunctionGraph", "ImplicitFunction", "ValueTracker",
    "always_redraw", "Table", "MobjectTable", "IntegerTable",
    # tables/braces helpers
    "Rectangle", "Square",
    # extra shapes / arrows / annotations (render without LaTeX)
    "Point", "CurvedArrow", "CurvedDoubleArrow", "TangentLine", "RegularPolygram",
    "Polygram", "BackgroundRectangle", "DecimalTable",
}

_MANIM_ANIMATIONS = {
    "Create", "Uncreate", "Write", "Unwrite", "DrawBorderThenFill", "AddTextLetterByLetter",
    "FadeIn", "FadeOut", "Transform", "ReplacementTransform", "TransformMatchingShapes",
    "GrowFromCenter", "GrowFromEdge", "GrowFromPoint", "GrowArrow", "SpinInFromNothing",
    "ShrinkToCenter", "Rotate", "Rotating", "MoveAlongPath", "Indicate", "Flash",
    "Circumscribe", "FocusOn", "Wiggle", "ApplyWave", "ShowPassingFlash", "Blink",
    "LaggedStart", "LaggedStartMap", "AnimationGroup", "Succession", "Wait", "Restore",
    "ScaleInPlace", "ApplyMethod", "MoveToTarget", "CounterclockwiseTransform",
    "ClockwiseTransform", "FadeTransform", "FadeTransformPieces",
    # transforms / functions / updaters
    "TransformFromCopy", "FadeToColor", "ApplyFunction", "ApplyPointwiseFunction",
    "ApplyComplexFunction", "Homotopy", "MaintainPositionRelativeTo", "CyclicReplace",
    "Swap", "UpdateFromFunc", "UpdateFromAlphaFunc", "ChangingDecimal",
    "ChangeDecimalToValue", "ShowIncreasingSubsets", "ShowSubmobjectsOneByOne",
    "AddTextWordByWord", "RemoveTextLetterByLetter", "Broadcast", "TransformMatchingTex",
    # rate functions
    "linear", "smooth", "there_and_back", "there_and_back_with_pause", "rush_into",
    "rush_from", "slow_into", "double_smooth", "wiggle", "ease_in_sine", "ease_out_sine",
    "ease_in_out_sine", "ease_in_quad", "ease_out_quad", "ease_in_out_quad",
}

ALLOWED_NAMES = (
    {"self", "np"} | _SAFE_BUILTINS | _MANIM_CONSTANTS | _MANIM_COLORS
    | _MANIM_MOBJECTS | _MANIM_ANIMATIONS
)

# Named explicitly so the refusal can say WHY and point at the alternative.
_BLOCKED_NAMES = {
    # NOTE: MathTex/Tex/Title/DecimalNumber/Integer/Variable are now ALLOWED — LaTeX (texlive) is
    # installed in the image and numbers render via Text (see _LATEX_FREE_PREAMBLE). `np` is allowed
    # too (numpy is installed + injected into the runner). These moved to the allow-list.
    "TexTemplate": "don't build a TexTemplate — just call MathTex(...) / Tex(...) directly",
    # No loading images/SVGs into an animation (SVGMobject/ImageMobject load a FILE — not allowed,
    # and they can't take a raw string anyway). Build the shape from primitives, or use draw_svg.
    "SVGMobject": "SVGMobject is not available (it loads an external file). Build the shape from "
                  "primitives — Circle, Rectangle, RoundedRectangle, Polygon, Line, Dot, VGroup — "
                  "or, if you want a static labelled picture, use the draw_svg tool instead of an animation.",
    "ImageMobject": "ImageMobject is not available (no external images). Build the picture from "
                    "primitives (Circle/Rectangle/Polygon/Line/Dot/VGroup), or use draw_svg / "
                    "explanatory_puzzle for a static picture.",
    "SVGMobjectFromString": "not available — build the shape from primitives, or use draw_svg.",
    "config": "the global config is not writable from a scene",
    "open": "file access is not allowed",
    "eval": "eval is not allowed",
    "exec": "exec is not allowed",
    "compile": "compile is not allowed",
    "getattr": "getattr is not allowed",
    "setattr": "setattr is not allowed",
    "delattr": "delattr is not allowed",
    "globals": "globals is not allowed",
    "locals": "locals is not allowed",
    "vars": "vars is not allowed",
    "dir": "dir is not allowed",
    "type": "type is not allowed",
    "object": "object is not allowed",
    "super": "super is not allowed",
    "input": "input is not allowed",
    "breakpoint": "breakpoint is not allowed",
    "exit": "exit is not allowed",
    "quit": "quit is not allowed",
    "help": "help is not allowed",
    "__import__": "imports are not allowed",
    "__builtins__": "builtins access is not allowed",
}

# Attributes that expose frames/globals without a leading underscore, plus numpy's file-I/O
# helpers (now that `np` is allowed) — np.load can even execute pickled code, so these are shut off.
_BLOCKED_ATTRS = {
    "gi_frame", "gi_code", "cr_frame", "cr_code", "ag_frame", "ag_code",
    "f_globals", "f_locals", "f_builtins", "f_back", "tb_frame", "tb_next",
    "func_globals", "func_code", "func_builtins", "im_func", "im_self",
    # numpy file I/O (np.*) — no reading/writing files from an animation
    "load", "save", "savez", "savez_compressed", "fromfile", "tofile", "memmap",
    "genfromtxt", "loadtxt", "savetxt", "fromregex", "DataSource",
}


class SceneCodeError(ValueError):
    """Validation failed — the message is written to be actionable by the model."""


def _bound_names(tree: ast.AST) -> set:
    """Every name the body itself binds (assignments, loop vars, comprehensions, lambda args)."""
    out: set = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            out.add(node.id)
        elif isinstance(node, ast.arg):
            out.add(node.arg)
        elif isinstance(node, ast.NamedExpr) and isinstance(node.target, ast.Name):
            out.add(node.target.id)
    return out


def validate_scene_code(code: str) -> str:
    """Return the cleaned scene body, or raise SceneCodeError with a model-actionable message.

    This is Layer 1. It assumes it can be bypassed — process isolation is what contains a
    bypass — but it is what stops the overwhelming majority of dangerous code, and it is what
    gives the model a specific reason it can correct.
    """
    src = textwrap.dedent(code or "").strip("\n")
    if not src.strip():
        raise SceneCodeError("the animation code was empty")
    if len(src) > MAX_CODE_CHARS:
        raise SceneCodeError(f"the animation code is too long ({len(src)} chars, max {MAX_CODE_CHARS})")

    try:
        tree = ast.parse(src, mode="exec")
    except SyntaxError as e:
        raise SceneCodeError(f"Python syntax error on line {e.lineno}: {e.msg}") from e

    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_AST_NODES:
        raise SceneCodeError(f"the animation is too complex ({len(nodes)} nodes, max {MAX_AST_NODES}) "
                             "— show ONE idea, not a whole lesson")

    local = _bound_names(tree)

    for node in nodes:
        kind = type(node)
        if kind in _NODE_HELP:
            raise SceneCodeError(_NODE_HELP[kind])
        if kind not in _ALLOWED_NODES:
            raise SceneCodeError(f"'{kind.__name__}' is not allowed in an animation body")

        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr in _BLOCKED_ATTRS:
                raise SceneCodeError(f"attribute '.{node.attr}' is not allowed")

        elif isinstance(node, ast.Name):
            name = node.id
            if name in _BLOCKED_NAMES:
                raise SceneCodeError(_BLOCKED_NAMES[name])
            if name.startswith("__"):
                raise SceneCodeError(f"'{name}' is not allowed")
            if isinstance(node.ctx, ast.Load) and name not in ALLOWED_NAMES and name not in local:
                raise SceneCodeError(
                    f"'{name}' is not an available Manim name. Use only standard Manim objects "
                    "(Circle, Square, Line, Arrow, Dot, Text, VGroup, Axes, NumberLine, "
                    "NumberPlane, ParametricFunction …) and animations (Create, Write, FadeIn, "
                    "Transform, Rotate, Indicate …)."
                )

    return src


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 2 — isolated execution
# ─────────────────────────────────────────────────────────────────────────────

RENDER_TIMEOUT_S = 90
_CPU_SECONDS = 60
_MEM_BYTES = 3 * 1024 * 1024 * 1024      # 3 GB — cairo/ffmpeg need real headroom
_FSIZE_BYTES = 256 * 1024 * 1024

# Blocking `MathTex`/`Tex` in the validator is NOT enough to keep a scene LaTeX-free: several
# ordinary Mobjects reach for LaTeX internally to typeset their number labels, and shell out to
# the `latex` binary that isn't installed. Verified to fail without this: Axes(include_numbers),
# Axes.add_coordinates(), NumberLine(include_numbers) and therefore ax.plot(...) with numbered
# axes — i.e. exactly what a "straight-line graphs" lesson asks for. Repointing the two label
# constructors at Pango `Text` makes every one of them render. (NumberPlane and bare shapes were
# always fine, which is why this hid for so long.)
_LATEX_FREE_PREAMBLE = """\
DecimalNumber.set_default(mob_class=Text)
Integer.set_default(mob_class=Text)
NumberLine.set_default(label_constructor=Text)
"""

_RUNNER = '''\
from manim import *
from manim import tempconfig
import numpy as np

{preamble}
class Gen(Scene):
    def construct(self):
{body}

with tempconfig({{
    "quality": "low_quality",
    "output_file": {key!r},
    "format": "mp4",
    "media_dir": {media!r},
    "disable_caching": True,
    "verbosity": "ERROR",
    "progress_bar": "none",
}}):
    Gen().render()
'''


def _limits():
    """POSIX rlimits for the render process. None on platforms without `resource`."""
    try:
        import resource  # noqa: PLC0415 — POSIX-only, imported lazily on purpose
    except ImportError:
        return None

    def _apply():
        resource.setrlimit(resource.RLIMIT_CPU, (_CPU_SECONDS, _CPU_SECONDS))
        resource.setrlimit(resource.RLIMIT_AS, (_MEM_BYTES, _MEM_BYTES))
        resource.setrlimit(resource.RLIMIT_FSIZE, (_FSIZE_BYTES, _FSIZE_BYTES))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    return _apply


def code_key(code: str) -> str:
    """Cache key for a scene body — identical code renders once, ever."""
    return f"gen-{hashlib.sha256(code.encode()).hexdigest()[:16]}"


def cached_path(key: str) -> Optional[Path]:
    p = ANIM_DIR / f"{key}.mp4"
    return p if p.exists() else None


def _render_sync(code: str, key: str) -> bool:
    """Render validated scene code to ANIM_DIR/{key}.mp4 in an ISOLATED process.

    Blocking — always call via a thread. Returns True only if the MP4 landed.
    """
    if not MANIM_AVAILABLE:
        return False
    ANIM_DIR.mkdir(parents=True, exist_ok=True)
    _WORK_DIR.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix="scene-", dir=str(_WORK_DIR)))
    try:
        script = _RUNNER.format(
            preamble=_LATEX_FREE_PREAMBLE,
            body=textwrap.indent(code, " " * 8),
            key=key,
            media=str(work / "media"),
        )
        script_path = work / "scene.py"
        script_path.write_text(script, encoding="utf-8")

        # Scrubbed environment. The API process holds DATABASE_URL, GEMINI_API_KEY, JWT/SESSION
        # secrets and SMTP credentials — none of them are passed here. PYTHONPATH is emptied so
        # `app.*` cannot be imported even if Layer 1 were bypassed.
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(work),
            "TMPDIR": str(work),
            "PYTHONPATH": "",
            "PYTHONDONTWRITEBYTECODE": "1",
            "MPLBACKEND": "Agg",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        }

        popen_kw = {}
        limits = _limits()
        if limits is not None:
            # start_new_session gives the child its own process group, so a timeout kills
            # ffmpeg and every other grandchild too rather than orphaning them.
            popen_kw = {"preexec_fn": limits, "start_new_session": True}
        else:
            logger.warning("manim sandbox: rlimits unavailable on this platform "
                           "(no `resource` module) — relying on the wall-clock timeout only")

        proc = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(work), env=env, capture_output=True, timeout=RENDER_TIMEOUT_S,
            **popen_kw,
        )
        if proc.returncode != 0:
            raw = (proc.stderr or b"").decode("utf-8", "replace")
            err = raw.strip().splitlines()
            # Call this one out by name. It renders as a generic FileNotFoundError('latex') that
            # says nothing about WHICH mobject wanted LaTeX, and because the render is in the
            # background the model never learns the animation failed — it just never appears.
            if "'latex'" in raw or "No such file or directory: 'latex'" in raw:
                logger.error(
                    "ANIMATION render key=%s needed the LaTeX binary — a mobject typeset its "
                    "labels with MathTex despite the LaTeX-free preamble. Add its label "
                    "constructor to _LATEX_FREE_PREAMBLE (see the note there).", key)
                return False
            _detail = err[-1] if err else ""
            logger.warning("ANIMATION render failed key=%s rc=%s: %s",
                           key, proc.returncode, _detail or "(no stderr)")
            # Stash the real manim error so animate_concept can hand it to the model for a fix
            # (e.g. "Cannot call Mobject.get_start for a Mobject with no points").
            _render_errors[key] = _detail
            return False

        matches = sorted(work.rglob(f"{key}.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not matches:
            logger.warning("ANIMATION render produced no file for %s", key)
            return False
        shutil.move(str(matches[0]), str(ANIM_DIR / f"{key}.mp4"))
        logger.info("ANIMATION rendered key=%s", key)
        return True

    except subprocess.TimeoutExpired:
        logger.warning("ANIMATION render timed out after %ss key=%s", RENDER_TIMEOUT_S, key)
        return False
    except Exception as e:  # noqa: BLE001 — a failed render must never break the tutor
        logger.warning("ANIMATION render error key=%s: %s: %s", key, type(e).__name__, e)
        return False
    finally:
        shutil.rmtree(work, ignore_errors=True)


_inflight: dict = {}
# key → the last manim render error string, so render_code can pass a model-actionable reason back
# ("Cannot call Mobject.get_start for a Mobject with no points") for self-correction.
_render_errors: dict = {}

# How long a turn will wait for an animation before giving up on showing it THIS turn.
# Measured renders are ~2-3s and a tool-using turn already takes 15-45s, so waiting is nearly
# free and is the difference between animations appearing and never appearing at all.
RENDER_WAIT_S = 30.0


async def render_code(code: str, wait_s: float = RENDER_WAIT_S) -> Tuple[str, Optional[str], str]:
    """(status, key, detail) — status is 'ready' | 'rendering' | 'failed' | 'unavailable'; `detail`
    is the real manim error on 'failed' (model-actionable, "" otherwise).

    WAITS for the render rather than firing it into the background. The old fire-and-forget
    version returned 'rendering' on a miss and promised the animation would be "instant next
    time" — true in the TEMPLATE era, when a handful of fixed param sets meant the cache filled
    up quickly. It is FALSE for model-authored code: the key is a hash of the exact source, the
    model never writes byte-identical code twice (one space is a different key), so every request
    missed, every animation came back 'rendering', and an animation could never reach the screen
    in ANY lesson. Measured across four real lessons: animation 0, mermaid 0.

    A render that overruns `wait_s` is left running and cached for a later identical request, so
    a slow scene degrades to the old behaviour instead of blocking the lesson.
    Raises SceneCodeError if the code fails validation.
    """
    if not MANIM_AVAILABLE:
        return "unavailable", None, ""
    clean = validate_scene_code(code)
    key = code_key(clean)
    if cached_path(key):
        return "ready", key, ""

    task = _inflight.get(key)
    if task is None or task.done():
        task = asyncio.create_task(asyncio.to_thread(_render_sync, clean, key))
        _inflight[key] = task

        def _cleanup(_t, _k=key):
            _inflight.pop(_k, None)

        task.add_done_callback(_cleanup)

    try:
        # shield so a timeout here doesn't cancel the render itself — it keeps going and lands
        # in the cache for the next attempt.
        ok = await asyncio.wait_for(asyncio.shield(task), timeout=wait_s)
    except asyncio.TimeoutError:
        logger.info("ANIMATION still rendering after %.0fs key=%s — continuing in background",
                    wait_s, key)
        return "rendering", key, ""
    except Exception as e:  # noqa: BLE001
        logger.warning("ANIMATION render task error key=%s: %s", key, e)
        return "failed", key, str(e)
    if ok:
        _render_errors.pop(key, None)
        return "ready", key, ""
    return "failed", key, _render_errors.pop(key, "")


def manim_available_kinds(key_stage: Optional[str] = None, subject: Optional[str] = None) -> List[str]:
    """Renamed from available_kinds when merged into teacher_service (svg has one too). Unused
    externally; kept for reference. Original note:

    Kept for the lesson anchor's visual rotation.

    Animations used to be a fixed template list gated by key stage and subject, which is exactly
    why they almost never appeared. The tutor now writes the scene, so an animation is available
    for ANY topic whenever manim is installed.
    """
    return ["animation"] if MANIM_AVAILABLE else []


# ═══════════════════════════════════════════════════════════════════════════
# TEACHING-VISUAL BUILDERS (merged from puzzle_service.py — mermaid / svg / animation
# payload builders + backgrounds; these RETURN payload dicts, no puzzle state)
# ═══════════════════════════════════════════════════════════════════════════
_LIGHT_BACKGROUNDS = ["aurora", "blueprint", "paper"]
_DARK_BACKGROUNDS = ["mesh", "bubbles"]


def pick_background(dark: bool = False) -> str:
    return random.choice(_DARK_BACKGROUNDS if dark else _LIGHT_BACKGROUNDS)


# ── Builders ─────────────────────────────────────────────────────────────────────
# Each returns a full payload INCLUDING `solution` + `puzzle_type`. The tool persists
# the whole thing, then strips `solution` before handing the client payload to the model.

def build_explanatory(image_url: str, caption: str = "", title: str = "") -> Dict[str, Any]:
    return {
        "render": "explanatory_image",
        "puzzle_type": "explanatory",
        "title": title or "Let's look at this",
        "prompt": caption or "",
        "params": {"image": image_url, "caption": caption or ""},
        "solution": None,            # display-only, nothing to grade
        "answer_type": "none",
    }


# Mermaid diagram types the client can render. Used only to sanity-check that the model actually
# sent a diagram (not prose), so a broken spec is bounced back to it rather than shown as an error.
_MERMAID_STARTS = (
    "graph", "flowchart", "sequencediagram", "classdiagram", "statediagram", "erdiagram",
    "gantt", "pie", "mindmap", "timeline", "journey", "gitgraph", "quadrantchart",
    "xychart", "sankey", "requirementdiagram", "block-beta", "c4context",
)


# Characters that make the flowchart grammar choke inside an UNQUOTED label. Verified against the
# real mermaid parser: parentheses inside a [] node are the killer (`F[Use SINE (SOH)]` — the
# exact spec that shipped to a student as a wall of raw code). Quoting is always safe.
_MERMAID_NEEDS_QUOTE = re.compile(r"[()\[\]{}&|<>#;]")

# ONE pass over all shapes, as an alternation — never several passes. A second pass re-matches
# nodes the first already rewrote: `P((Photosynthesis))` became `P("(Photosynthesis")` and the
# docstring's own example stopped parsing. Each `(?!x)` guard also makes the DOUBLE-delimiter
# shapes (`((circle))`, `[[sub]]`, `{{hex}}`) unmatchable — they're rare, and their contents are
# genuinely ambiguous to quote, so they are deliberately left untouched rather than half-fixed.
_MERMAID_NODE_RE = re.compile(
    r'(?<![\w"])([A-Za-z_]\w*)'
    r'(?:'
    r'\[(?!\[)(?P<sq>[^\]\n]*)\](?!\])'      # A[label] — parens INSIDE are the real-world break
    r'|\((?!\()(?P<rnd>[^()\n]*)\)(?!\))'    # A(label)
    r'|\{(?!\{)(?P<rho>[^{}\n]*)\}(?!\})'    # A{label}
    r')'
)


def _quote_mermaid_labels(spec: str) -> str:
    """Wrap node labels in quotes when they contain characters the parser can't take raw.

    The model writes natural labels ("Use SINE (SOH)", "Opposite & Hypotenuse"); mermaid needs
    those quoted. Without this the whole diagram throws and the student sees the raw spec as a
    wall of code. Same idea as `_repair_latex`: repair server-side rather than hoping the model
    gets the syntax exactly right every time.
    """
    def _fix(m):
        node = m.group(1)
        for key, open_d, close_d in (("sq", "[", "]"), ("rnd", "(", ")"), ("rho", "{", "}")):
            label = m.group(key)
            if label is None:
                continue
            stripped = label.strip()
            if (not stripped
                    or stripped.startswith('"')
                    or not _MERMAID_NEEDS_QUOTE.search(stripped)):
                return m.group(0)
            safe = stripped.replace('"', "'")
            return f'{node}{open_d}"{safe}"{close_d}'
        return m.group(0)

    return _MERMAID_NODE_RE.sub(_fix, spec)


def clean_mermaid(spec: str) -> str:
    """Strip ```mermaid fences / stray backticks, then repair unquoted node labels."""
    s = (spec or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s).strip()
    return _quote_mermaid_labels(s)


def is_valid_mermaid(spec: str) -> bool:
    first = (spec or "").lstrip().lower()
    return any(first.startswith(k) for k in _MERMAID_STARTS)


def build_mermaid(spec: str, caption: str = "", title: str = "") -> Dict[str, Any]:
    """A MERMAID diagram rendered LIVE in the browser (flowchart / cycle / sequence / timeline /
    state / mind-map …). Display-only — accurate and instant, no image generation, no GPU, and it
    can't misrender counts the way a generated picture can. Same show_puzzle pipeline as the rest."""
    return {
        "render": "mermaid",
        "puzzle_type": "explanatory",
        "title": title or "Diagram",
        "prompt": caption or "",
        "params": {"mermaid": clean_mermaid(spec), "caption": caption or ""},
        "solution": None,
        "answer_type": "none",
    }


def build_svg_diagram(svg: str, caption: str = "", title: str = "") -> Dict[str, Any]:
    """A deterministic, server-drawn SVG teaching diagram (cell, circuit, wave, solar system…).
    Display-only. Drawn by code from validated params, so the picture always matches what the
    tutor says — unlike a generated image, which can misdraw structures and labels."""
    return {
        "render": "svg_diagram",
        "puzzle_type": "explanatory",
        "title": title or "Diagram",
        "prompt": caption or "",
        "params": {"svg": svg, "caption": caption or ""},
        "solution": None,
        "answer_type": "none",
    }


def build_animation(video_url: str, caption: str = "", title: str = "",
                    poster_url: str = "") -> Dict[str, Any]:
    """A pre-rendered Manim animation (MP4). Display-only. `video_url` is served from the animation
    cache; `poster_url` is an optional first-frame image shown while it loads."""
    return {
        "render": "animation",
        "puzzle_type": "explanatory",
        "title": title or "Animation",
        "prompt": caption or "",
        "params": {"video": video_url, "poster": poster_url or "", "caption": caption or ""},
        "solution": None,
        "answer_type": "none",
    }


