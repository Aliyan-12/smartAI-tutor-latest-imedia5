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
from html import escape
from typing import Any, Callable, Dict, List, Optional

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
