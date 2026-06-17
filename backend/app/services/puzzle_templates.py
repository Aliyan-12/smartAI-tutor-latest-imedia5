"""
Pre-authored visual-puzzle registry (Synthesis-style).

The AI never free-draws a puzzle — it SELECTS a template by id and supplies a few
typed params (or just a content id). `puzzle_service.build()` validates/clamps the
params, computes the solution, and returns a render payload the frontend draws.
Templates are tagged by subject + key_stage so the lesson only offers
age/subject-appropriate puzzles.

`render` maps to a frontend component in components/puzzles/. `kind`:
  - "svg"  → lightweight SVG components
  - "konva"→ drag/interactive react-konva components
"""
from typing import Dict, List

# ── Predefined content for the drag puzzles (so the AI only picks an id) ─────────
DIAGRAMS: Dict[str, dict] = {
    "plant": {
        "title": "Label the plant",
        "width": 360, "height": 300,
        # slots are drop targets at (x,y); each expects `label`
        "slots": [
            {"id": "flower", "x": 180, "y": 40, "label": "Flower"},
            {"id": "leaf", "x": 250, "y": 150, "label": "Leaf"},
            {"id": "stem", "x": 180, "y": 170, "label": "Stem"},
            {"id": "roots", "x": 180, "y": 260, "label": "Roots"},
        ],
    },
    "animal_cell": {
        "title": "Label the animal cell",
        "width": 360, "height": 300,
        "slots": [
            {"id": "nucleus", "x": 180, "y": 150, "label": "Nucleus"},
            {"id": "membrane", "x": 320, "y": 150, "label": "Cell membrane"},
            {"id": "cytoplasm", "x": 110, "y": 90, "label": "Cytoplasm"},
            {"id": "mitochondria", "x": 230, "y": 220, "label": "Mitochondria"},
        ],
    },
}

SORTING_SETS: Dict[str, dict] = {
    "everyday": {
        "title": "Sort each into solid, liquid or gas",
        "bins": ["solid", "liquid", "gas"],
        "items": [
            {"name": "Ice cube", "bin": "solid"},
            {"name": "Rock", "bin": "solid"},
            {"name": "Water", "bin": "liquid"},
            {"name": "Juice", "bin": "liquid"},
            {"name": "Steam", "bin": "gas"},
            {"name": "Air", "bin": "gas"},
        ],
    },
}

FOOD_CHAINS: Dict[str, dict] = {
    "grassland": {"title": "Put the food chain in order", "order": ["Grass", "Rabbit", "Fox"]},
    "pond": {"title": "Put the food chain in order", "order": ["Algae", "Tadpole", "Heron"]},
}

# ── Template registry ───────────────────────────────────────────────────────────
# subjects matched case-insensitively as substrings of the lesson subject.
TEMPLATES: List[dict] = [
    {
        "id": "fraction_bar", "render": "fraction_bar", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "fraction", "title": "Fraction bar",
        "description": "A bar split into equal parts with some shaded — student names the fraction.",
        "params_doc": "total_parts (int 2-12), shaded_parts (int 0..total_parts)",
    },
    {
        "id": "number_line", "render": "number_line", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "integer", "title": "Number line",
        "description": "An arrow points at a value on a number line — student reads the number.",
        "params_doc": "min (int), max (int), step (int>=1), marker (int min..max)",
    },
    {
        "id": "shape_count", "render": "shape_count", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2"],
        "answer_type": "integer", "title": "Count the shapes",
        "description": "A scatter of shapes — student counts how many of one shape.",
        "params_doc": "triangles (int 0-8), circles (int 0-8), squares (int 0-8), target_shape ('triangle'|'circle'|'square')",
    },
    {
        "id": "area_grid", "render": "area_grid", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS2", "KS3"],
        "answer_type": "integer", "title": "Rectangle area",
        "description": "A w×h grid of unit squares — student gives the area.",
        "params_doc": "width (int 1-12), height (int 1-12)",
    },
    {
        "id": "build_fraction", "render": "build_fraction", "kind": "konva",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "drag", "title": "Build the fraction",
        "description": "Student clicks/drag-shades parts of a bar to make a target fraction.",
        "params_doc": "total_parts (int 2-12), target_num (int 0..total_parts)",
    },
    {
        "id": "label_diagram", "render": "label_diagram", "kind": "konva",
        "subjects": ["science", "biology"], "key_stages": ["KS2", "KS3"],
        "answer_type": "drag", "title": "Label the diagram",
        "description": "Student drags labels onto the correct parts of a diagram.",
        "params_doc": f"diagram (one of: {', '.join(DIAGRAMS)})",
    },
    {
        "id": "states_of_matter", "render": "states_of_matter", "kind": "konva",
        "subjects": ["science", "chemistry", "physics"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "drag", "title": "States of matter",
        "description": "Student sorts items into solid / liquid / gas bins.",
        "params_doc": f"set (one of: {', '.join(SORTING_SETS)})",
    },
    {
        "id": "food_chain_order", "render": "food_chain_order", "kind": "konva",
        "subjects": ["science", "biology"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "drag", "title": "Order the food chain",
        "description": "Student drags organisms into the correct food-chain order.",
        "params_doc": f"chain (one of: {', '.join(FOOD_CHAINS)})",
    },
]

TEMPLATES_BY_ID: Dict[str, dict] = {t["id"]: t for t in TEMPLATES}


def templates_for(subject: str, key_stage: str) -> List[dict]:
    subj = (subject or "").lower()
    ks = (key_stage or "").upper()
    out = []
    for t in TEMPLATES:
        if subj and not any(s in subj for s in t["subjects"]):
            continue
        if ks and t["key_stages"] and ks not in t["key_stages"]:
            continue
        out.append(t)
    return out
