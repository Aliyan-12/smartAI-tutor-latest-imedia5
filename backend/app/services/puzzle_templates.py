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

# ── Diagrams for label_diagram (drag labels onto parts) ─────────────────────────
DIAGRAMS: Dict[str, dict] = {
    "plant": {
        "title": "Label the plant", "width": 360, "height": 300,
        "slots": [
            {"id": "flower", "x": 180, "y": 40, "label": "Flower"},
            {"id": "leaf", "x": 250, "y": 150, "label": "Leaf"},
            {"id": "stem", "x": 180, "y": 170, "label": "Stem"},
            {"id": "roots", "x": 180, "y": 270, "label": "Roots"},
        ],
    },
    "animal_cell": {
        "title": "Label the animal cell", "width": 360, "height": 300,
        "slots": [
            {"id": "nucleus", "x": 180, "y": 150, "label": "Nucleus"},
            {"id": "membrane", "x": 320, "y": 150, "label": "Cell membrane"},
            {"id": "cytoplasm", "x": 110, "y": 90, "label": "Cytoplasm"},
            {"id": "mitochondria", "x": 230, "y": 220, "label": "Mitochondria"},
        ],
    },
    "leaf": {
        "title": "Label the leaf", "width": 360, "height": 300,
        "slots": [
            {"id": "tip", "x": 180, "y": 45, "label": "Tip"},
            {"id": "blade", "x": 250, "y": 140, "label": "Blade"},
            {"id": "midrib", "x": 180, "y": 150, "label": "Midrib"},
            {"id": "stalk", "x": 180, "y": 265, "label": "Stalk"},
        ],
    },
    "simple_circuit": {
        "title": "Label the circuit", "width": 360, "height": 300,
        "slots": [
            {"id": "cell", "x": 180, "y": 270, "label": "Cell"},
            {"id": "bulb", "x": 180, "y": 40, "label": "Bulb"},
            {"id": "switch", "x": 320, "y": 150, "label": "Switch"},
            {"id": "wire", "x": 40, "y": 150, "label": "Wire"},
        ],
    },
    "human_body": {
        "title": "Label the body", "width": 360, "height": 320,
        "slots": [
            {"id": "head", "x": 180, "y": 40, "label": "Head"},
            {"id": "arm", "x": 90, "y": 160, "label": "Arm"},
            {"id": "torso", "x": 180, "y": 165, "label": "Torso"},
            {"id": "leg", "x": 180, "y": 285, "label": "Leg"},
        ],
    },
    "atom": {
        "title": "Label the atom", "width": 360, "height": 300,
        "slots": [
            {"id": "nucleus", "x": 180, "y": 150, "label": "Nucleus"},
            {"id": "electron", "x": 180, "y": 40, "label": "Electron"},
            {"id": "shell", "x": 320, "y": 150, "label": "Shell"},
        ],
    },
    "wave": {
        "title": "Label the wave", "width": 360, "height": 220,
        "slots": [
            {"id": "crest", "x": 80, "y": 55, "label": "Crest"},
            {"id": "trough", "x": 170, "y": 165, "label": "Trough"},
            {"id": "wavelength", "x": 250, "y": 30, "label": "Wavelength"},
            {"id": "amplitude", "x": 305, "y": 110, "label": "Amplitude"},
        ],
    },
}

# ── Sorting sets for states_of_matter / sort_categories (drag into bins) ─────────
SORTING_SETS: Dict[str, dict] = {
    "everyday": {
        "title": "Sort each into solid, liquid or gas", "bins": ["solid", "liquid", "gas"],
        "items": [
            {"name": "Ice cube", "bin": "solid"}, {"name": "Rock", "bin": "solid"},
            {"name": "Water", "bin": "liquid"}, {"name": "Juice", "bin": "liquid"},
            {"name": "Steam", "bin": "gas"}, {"name": "Air", "bin": "gas"},
        ],
    },
    "living_nonliving": {
        "title": "Sort into living and non-living", "bins": ["living", "non-living"],
        "items": [
            {"name": "Tree", "bin": "living"}, {"name": "Dog", "bin": "living"}, {"name": "Flower", "bin": "living"},
            {"name": "Rock", "bin": "non-living"}, {"name": "Car", "bin": "non-living"}, {"name": "Phone", "bin": "non-living"},
        ],
    },
    "vertebrates": {
        "title": "Sort into vertebrate and invertebrate", "bins": ["vertebrate", "invertebrate"],
        "items": [
            {"name": "Dog", "bin": "vertebrate"}, {"name": "Fish", "bin": "vertebrate"}, {"name": "Eagle", "bin": "vertebrate"},
            {"name": "Snail", "bin": "invertebrate"}, {"name": "Worm", "bin": "invertebrate"}, {"name": "Spider", "bin": "invertebrate"},
        ],
    },
    "animal_diet": {
        "title": "Sort by diet", "bins": ["herbivore", "carnivore", "omnivore"],
        "items": [
            {"name": "Cow", "bin": "herbivore"}, {"name": "Rabbit", "bin": "herbivore"},
            {"name": "Lion", "bin": "carnivore"}, {"name": "Shark", "bin": "carnivore"},
            {"name": "Bear", "bin": "omnivore"}, {"name": "Human", "bin": "omnivore"},
        ],
    },
    "conductors": {
        "title": "Sort into conductors and insulators", "bins": ["conductor", "insulator"],
        "items": [
            {"name": "Copper", "bin": "conductor"}, {"name": "Iron", "bin": "conductor"}, {"name": "Gold", "bin": "conductor"},
            {"name": "Wood", "bin": "insulator"}, {"name": "Plastic", "bin": "insulator"}, {"name": "Rubber", "bin": "insulator"},
        ],
    },
    "metals": {
        "title": "Sort into metals and non-metals", "bins": ["metal", "non-metal"],
        "items": [
            {"name": "Iron", "bin": "metal"}, {"name": "Copper", "bin": "metal"}, {"name": "Gold", "bin": "metal"},
            {"name": "Oxygen", "bin": "non-metal"}, {"name": "Sulfur", "bin": "non-metal"}, {"name": "Carbon", "bin": "non-metal"},
        ],
    },
    "acids": {
        "title": "Sort by pH type", "bins": ["acid", "alkali", "neutral"],
        "items": [
            {"name": "Lemon juice", "bin": "acid"}, {"name": "Vinegar", "bin": "acid"},
            {"name": "Soap", "bin": "alkali"}, {"name": "Bleach", "bin": "alkali"},
            {"name": "Pure water", "bin": "neutral"}, {"name": "Salt water", "bin": "neutral"},
        ],
    },
    "elements_compounds": {
        "title": "Sort into elements and compounds", "bins": ["element", "compound"],
        "items": [
            {"name": "Oxygen", "bin": "element"}, {"name": "Iron", "bin": "element"}, {"name": "Gold", "bin": "element"},
            {"name": "Water", "bin": "compound"}, {"name": "Carbon dioxide", "bin": "compound"}, {"name": "Salt", "bin": "compound"},
        ],
    },
    "physical_chemical": {
        "title": "Sort into physical and chemical changes", "bins": ["physical change", "chemical change"],
        "items": [
            {"name": "Melting ice", "bin": "physical change"}, {"name": "Boiling water", "bin": "physical change"}, {"name": "Cutting paper", "bin": "physical change"},
            {"name": "Burning wood", "bin": "chemical change"}, {"name": "Rusting iron", "bin": "chemical change"}, {"name": "Baking a cake", "bin": "chemical change"},
        ],
    },
    "energy_sources": {
        "title": "Sort into renewable and non-renewable", "bins": ["renewable", "non-renewable"],
        "items": [
            {"name": "Solar", "bin": "renewable"}, {"name": "Wind", "bin": "renewable"}, {"name": "Hydro", "bin": "renewable"},
            {"name": "Coal", "bin": "non-renewable"}, {"name": "Oil", "bin": "non-renewable"}, {"name": "Gas", "bin": "non-renewable"},
        ],
    },
    "mixtures": {
        "title": "Sort into pure substances and mixtures", "bins": ["pure substance", "mixture"],
        "items": [
            {"name": "Gold", "bin": "pure substance"}, {"name": "Distilled water", "bin": "pure substance"}, {"name": "Oxygen", "bin": "pure substance"},
            {"name": "Air", "bin": "mixture"}, {"name": "Salt water", "bin": "mixture"}, {"name": "Milk", "bin": "mixture"},
        ],
    },
    "magnetic": {
        "title": "Sort into magnetic and non-magnetic", "bins": ["magnetic", "non-magnetic"],
        "items": [
            {"name": "Iron", "bin": "magnetic"}, {"name": "Steel", "bin": "magnetic"}, {"name": "Nickel", "bin": "magnetic"},
            {"name": "Wood", "bin": "non-magnetic"}, {"name": "Plastic", "bin": "non-magnetic"}, {"name": "Copper", "bin": "non-magnetic"},
        ],
    },
}

# ── Sequences for food_chain_order / sequence_order (drag into order) ────────────
FOOD_CHAINS: Dict[str, dict] = {
    "grassland": {"title": "Put the food chain in order", "order": ["Grass", "Rabbit", "Fox"]},
    "pond": {"title": "Put the food chain in order", "order": ["Algae", "Tadpole", "Heron"]},
    "ocean": {"title": "Put the food chain in order", "order": ["Plankton", "Small fish", "Shark"]},
    "butterfly": {"title": "Put the life cycle in order", "order": ["Egg", "Caterpillar", "Chrysalis", "Butterfly"]},
    "frog": {"title": "Put the life cycle in order", "order": ["Egg", "Tadpole", "Froglet", "Frog"]},
    "plant_life": {"title": "Put the life cycle in order", "order": ["Seed", "Seedling", "Plant", "Flower"]},
    "water_cycle": {"title": "Put the water cycle in order", "order": ["Evaporation", "Condensation", "Precipitation", "Collection"]},
    "digestion": {"title": "Put digestion in order", "order": ["Mouth", "Stomach", "Small intestine", "Large intestine"]},
    "rock_cycle": {"title": "Put the rock cycle in order", "order": ["Weathering", "Erosion", "Transport", "Deposition"]},
    "reflex_arc": {"title": "Put the reflex arc in order", "order": ["Stimulus", "Receptor", "Sensory neuron", "Motor neuron", "Response"]},
}

# ── Template registry ───────────────────────────────────────────────────────────
# subjects matched case-insensitively as substrings of the lesson subject.
TEMPLATES: List[dict] = [
    # ── Maths: number & fractions ──
    {
        "id": "fraction_bar", "render": "fraction_bar", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "fraction", "title": "Fraction bar",
        "description": "A bar split into equal parts with some shaded — student names the fraction.",
        "params_doc": "total_parts (int 2-12), shaded_parts (int 0..total_parts)",
    },
    {
        "id": "pie_fraction", "render": "pie_fraction", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "fraction", "title": "Fraction circle",
        "description": "A circle (pizza) split into equal slices with some shaded — student names the fraction.",
        "params_doc": "total_parts (int 2-12), shaded_parts (int 0..total_parts)",
    },
    {
        "id": "build_fraction", "render": "build_fraction", "kind": "konva",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "drag", "title": "Build the fraction",
        "description": "Student clicks parts of a bar to shade a target fraction.",
        "params_doc": "total_parts (int 2-12), target_num (int 0..total_parts)",
    },
    {
        "id": "number_line", "render": "number_line", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "integer", "title": "Number line",
        "description": "An arrow points at a value on a number line — student reads the number.",
        "params_doc": "min (int), max (int), step (int>=1), marker (int min..max)",
    },
    {
        "id": "place_value", "render": "place_value", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2"],
        "answer_type": "integer", "title": "Place value blocks",
        "description": "Base-ten blocks (hundreds/tens/ones) — student reads the number.",
        "params_doc": "hundreds (int 0-9), tens (int 0-9), ones (int 0-9)",
    },
    {
        "id": "array_grid", "render": "array_grid", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "integer", "title": "Multiplication array",
        "description": "A rows×cols array of dots — student gives the total (rows × cols).",
        "params_doc": "rows (int 1-10), cols (int 1-10)",
    },
    {
        "id": "shape_count", "render": "shape_count", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2"],
        "answer_type": "integer", "title": "Count the shapes",
        "description": "A scatter of shapes — student counts how many of one shape.",
        "params_doc": "triangles (int 0-8), circles (int 0-8), squares (int 0-8), target_shape ('triangle'|'circle'|'square')",
    },
    {
        "id": "clock_read", "render": "clock", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS1", "KS2"],
        "answer_type": "text", "title": "Tell the time",
        "description": "An analogue clock — student reads the time as h:mm (e.g. 3:30).",
        "params_doc": "hour (int 1-12), minute (int 0-59, multiples of 5 are clearest)",
    },
    # ── Maths: geometry, data, algebra (older) ──
    {
        "id": "area_grid", "render": "area_grid", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS2", "KS3"],
        "answer_type": "integer", "title": "Rectangle area",
        "description": "A w×h grid of unit squares — student gives the area.",
        "params_doc": "width (int 1-12), height (int 1-12)",
    },
    {
        "id": "angle_classify", "render": "angle", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS2", "KS3", "KS4"],
        "answer_type": "choice", "title": "Classify the angle",
        "description": "An angle is drawn — student picks acute / right / obtuse / reflex.",
        "params_doc": "degrees (int 10-330)",
    },
    {
        "id": "coordinate_read", "render": "coordinate_grid", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS2", "KS3", "KS4"],
        "answer_type": "text", "title": "Read the coordinate",
        "description": "A point is plotted on a grid — student reads its coordinates as x,y.",
        "params_doc": "x (int 0..size), y (int 0..size), size (int 5-10)",
    },
    {
        "id": "bar_chart", "render": "bar_chart", "kind": "svg",
        "subjects": ["math", "science", "physics", "chemistry", "biology"],
        "key_stages": ["KS2", "KS3", "KS4", "KS5"],
        "answer_type": "integer", "title": "Read the bar chart",
        "description": "A simple bar chart — student reads the value of one labelled bar.",
        "params_doc": "bars (list of {label, value}); ask (the label to read)",
    },
    {
        "id": "balance_solve", "render": "balance_scales", "kind": "svg",
        "subjects": ["math"], "key_stages": ["KS3", "KS4", "KS5"],
        "answer_type": "integer", "title": "Balance the equation",
        "description": "A balance scale models x + a = b (or a·x = b) — student solves for x.",
        "params_doc": "op ('add'|'mul'), a (int 1-20), b (int) — add: x+a=b; mul: a*x=b",
    },
    # ── Science / Physics / Chemistry / Biology ──
    {
        "id": "label_diagram", "render": "label_diagram", "kind": "konva",
        "subjects": ["science", "biology", "physics", "chemistry"], "key_stages": ["KS1", "KS2", "KS3", "KS4"],
        "answer_type": "drag", "title": "Label the diagram",
        "description": "Student drags labels onto the correct parts of a diagram.",
        "params_doc": f"diagram (one of: {', '.join(DIAGRAMS)})",
    },
    {
        "id": "sort_categories", "render": "states_of_matter", "kind": "konva",
        "subjects": ["science", "biology", "chemistry", "physics"],
        "key_stages": ["KS1", "KS2", "KS3", "KS4", "KS5"],
        "answer_type": "drag", "title": "Sort into groups",
        "description": "Student drags items into the correct category bins (classification).",
        "params_doc": f"set (one of: {', '.join(k for k in SORTING_SETS if k != 'everyday')})",
    },
    {
        "id": "states_of_matter", "render": "states_of_matter", "kind": "konva",
        "subjects": ["science", "chemistry", "physics"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "drag", "title": "States of matter",
        "description": "Student sorts items into solid / liquid / gas bins.",
        "params_doc": "set ('everyday')",
    },
    {
        "id": "sequence_order", "render": "food_chain_order", "kind": "konva",
        "subjects": ["science", "biology"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "drag", "title": "Put in order",
        "description": "Student drags stages into the correct order (life cycle / process).",
        "params_doc": "seq (one of: butterfly, frog, plant_life, water_cycle, digestion, rock_cycle, reflex_arc)",
    },
    {
        "id": "food_chain_order", "render": "food_chain_order", "kind": "konva",
        "subjects": ["science", "biology"], "key_stages": ["KS1", "KS2", "KS3"],
        "answer_type": "drag", "title": "Order the food chain",
        "description": "Student drags organisms into the correct food-chain order.",
        "params_doc": "chain (one of: grassland, pond, ocean)",
    },
    {
        "id": "particle_state", "render": "particle_state", "kind": "svg",
        "subjects": ["science", "chemistry", "physics"], "key_stages": ["KS2", "KS3"],
        "answer_type": "choice", "title": "Particle states",
        "description": "Particles drawn packed/loose/spread — student picks solid, liquid or gas.",
        "params_doc": "state ('solid'|'liquid'|'gas')",
    },
    {
        "id": "formula_triangle", "render": "formula_triangle", "kind": "svg",
        "subjects": ["physics", "science", "math"], "key_stages": ["KS3", "KS4", "KS5"],
        "answer_type": "integer", "title": "Formula triangle",
        "description": "A formula triangle (top = left × right, e.g. distance = speed × time) with two values given — student computes the missing one.",
        "params_doc": "top {label, value}, left {label, value}, right {label, value}; set exactly ONE of the three values to null (the unknown). Relation: top = left × right.",
    },
    # ── Image-driven (catalog-backed) — work for ANY subject/topic that has cached
    #    images (subjects=[] is a wildcard). The frontend pulls real curriculum-topic
    #    images from the topic-image catalog at build time, so these illustrate most
    #    topics across every key stage. ──
    {
        "id": "identify_image", "render": "identify_image", "kind": "image",
        "subjects": [], "key_stages": [],
        "answer_type": "choice", "title": "What is this?",
        "description": "Shows a real image of a topic; the student picks (or types) its correct name from the unit's topics. Great for recognition/vocabulary across any subject.",
        "params_doc": "no params needed — the image + options come from the lesson's topic-image catalog. Optionally topic='exact topic title' to feature a specific topic.",
    },
    {
        "id": "match_image", "render": "match_image", "kind": "image",
        "subjects": [], "key_stages": [],
        "answer_type": "match", "title": "Match the images",
        "description": "Shows several real topic images and their names jumbled; the student matches each image to its label. Works for any subject with enough cached topic images.",
        "params_doc": "no params needed — images + labels come from the lesson's topic-image catalog.",
    },
]

# Category for each puzzle (drives the UI chip + lets the model pick by kind).
_CATEGORY_BY_ID: Dict[str, str] = {
    "fraction_bar": "fractions", "pie_fraction": "fractions", "build_fraction": "fractions",
    "number_line": "number", "place_value": "number", "array_grid": "number", "clock_read": "number",
    "shape_count": "counting",
    "area_grid": "geometry", "angle_classify": "geometry", "coordinate_read": "geometry",
    "bar_chart": "data",
    "balance_solve": "algebra", "formula_triangle": "algebra",
    "label_diagram": "labelling",
    "sort_categories": "sorting", "states_of_matter": "sorting",
    "sequence_order": "sequencing", "food_chain_order": "sequencing",
    "particle_state": "recognition", "identify_image": "recognition",
    "match_image": "matching",
}
for _t in TEMPLATES:
    _t["category"] = _CATEGORY_BY_ID.get(_t["id"], "practice")

TEMPLATES_BY_ID: Dict[str, dict] = {t["id"]: t for t in TEMPLATES}


def templates_for(subject: str, key_stage: str) -> List[dict]:
    subj = (subject or "").lower()
    ks = (key_stage or "").upper()
    out = []
    for t in TEMPLATES:
        # An empty subjects list = wildcard (image puzzles work for any subject).
        if subj and t["subjects"] and not any(s in subj for s in t["subjects"]):
            continue
        if ks and t["key_stages"] and ks not in t["key_stages"]:
            continue
        out.append(t)
    return out
