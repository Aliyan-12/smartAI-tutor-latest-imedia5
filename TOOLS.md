# 🛠️ Tool Inventory — every tool the AI tutor can call

Complete reference for the agentic tools the AI uses during a lesson (and the small `/chat`
subset). Tools are the ONLY way the AI changes the student's screen or the platform — it never
free-draws or free-writes state.

## How tools are bound

- **By group, per turn.** `tools/registry.py::make_tools(ctx, groups)` assembles only the tool
  **groups** relevant to the current lesson state (anti-hallucination — fewer, scoped tools per
  call). Groups: `teaching · visuals · puzzles · interact · assessment · mastery · platform ·
  lifecycle · research`.
- **By agent, per phase.** In the multi-agent (crewai) pipeline the **Navigator** picks ONE
  specialist agent for the turn and binds only its groups:

  | Agent | Phase | Tool groups bound |
  |-------|-------|-------------------|
  | **Intro / Recap** | recap | `teaching`, `interact` |
  | **Teacher** | teach | `teaching`, `visuals`, `interact` |
  | **Practitioner** | practice, quiz | `puzzles`, `interact`, `mastery`, `assessment` |
  | **Summarizer** | review | `lifecycle` |

  (The single-agent fallback binds a state-driven superset via `select_tool_groups`.)
- **The AI calls tools SILENTLY, then speaks about what's on screen.** No server "refuse" logic —
  the AI is aligned to show one thing and make its words match the screen.

---

## 1. Slide / view tools — `session_tools.py` · group `teaching`

The deck (Resource-Hub slides) is the curriculum backbone; these move what's on the Learn panel.

| Tool | Args | What it does |
|------|------|--------------|
| `show_resource` | `resource_hub_id`, `slide_index=1` | Open a specific resource and jump to a slide/page. |
| `advance_lesson_slide` | — | Move forward exactly one slide (or to the next resource). |
| `retreat_lesson_slide` | — | Move back one slide (re-teach). |
| `jump_to_slide` | `slide_index` | Jump directly to a slide **number** in the current deck (teach the right slide, or on request). |

Moving to a slide clears any on-screen puzzle (slides ↔ puzzles are mutually-exclusive views).
The deck map + on-screen slide text are injected into the turn so the AI teaches in the deck's order.

---

## 2. Visual teaching tools — `visual_tools.py` · group `visuals`

Display-only teaching visuals (what the tutor EXPLAINS with). Prioritised in the TEACH/RECAP phases.

| Tool | Args | What it does |
|------|------|--------------|
| `explanatory_puzzle` | `image_prompt`, `caption`, `title` | A labelled teaching PICTURE (real topic image where one exists, else generated). Display only. |
| `mermaid_diagram` | `mermaid`, `caption`, `title` | Model-authored Mermaid flowchart / cycle / tree / comparison. |
| `svg_diagram` | `kind`, `params`, `caption` | A **ready-made**, server-drawn SVG (cell, circuit, wave, forces, solar system…). Accurate by construction. |
| `draw_svg` | `svg`, `caption`, `title` | Model-authored SVG, run through the **allow-list sanitiser** (XSS-safe) — for a structure with no ready-made template. |
| `animate_concept` | `code`, `caption`, `title` | Model-authored **Manim** animation, run in the AST + process **sandbox** (RCE-safe), cached, then shown. |

`svg_diagram` sanitiser and `animate_concept` sandbox are **security boundaries**, not band-aids —
model output is never trusted for markup/code.

---

## 3. Puzzle tools — `puzzle_tools.py` · group `puzzles`

What the student DOES. Prioritised in the PRACTICE/QUIZ phases (KS1–KS2 also during teaching).

| Tool | Args | What it looks like |
|------|------|--------------------|
| `labelling_puzzle` | `items`, `prompt` | Label the parts of pictures/diagrams. |
| `matching_puzzle` | `items`, `prompt` | Pair pictures ↔ names (tap-to-pair). |
| `math_puzzle` | `question`, `answer`, `mode`, `latex`, `image_prompt`, `distractors` | A maths problem as **KaTeX** (or an image). Tappable bubbles when `distractors` given; else typed. **The AI writes VALID KaTeX — the server no longer repairs it (see §7).** |
| `diagram_math_puzzle` | `concept`, `params` | **Deterministic** fraction / clock / ruler / shape — picture AND answer both server-derived from the same params. |
| `graph_puzzle` | `question`, `answer`, `spec` | Read a real matplotlib graph (KS4–KS5 maths/science). |
| `manipulative_puzzle` | `kind`, `params` | Hands-on Synthesis-style manipulative — AI passes params ONLY, server derives prompt + answer + marking (see §5). |
| `clear_puzzle` | — | Remove the on-screen puzzle. |

**Evaluators** (mark the student's submitted attempt, then the AI reacts): `labelling_evaluator`,
`matching_evaluator`, `math_evaluator`, `graph_evaluator`, `manipulative_evaluator`. Manipulative +
`diagram_math` marking is **exact server-side comparison** (no LLM judge, cannot contradict the
screen); labelling/matching/open answers use the fast LLM judge.

---

## 4. Tap-to-answer — `puzzle_tools.py` · group `interact`

| Tool | Args | What it does |
|------|------|--------------|
| `quick_replies` | `options` | 2–4 PIPE-separated tap options (right answer + plausible wrong ones). Available to **every** agent so any short question comes with taps — KS1–KS3 should almost never type. |

---

## 5. Assessment, mastery, platform, lifecycle, research — `platform_tools.py`

| Group | Tool | Args | What it does |
|-------|------|------|--------------|
| `assessment` | `generate_quiz` | `topic`, `difficulty`, `num_questions` | The **ONE** MCQ quiz per session, in the quiz window only (guarded). |
| `mastery` | `get_student_mastery` | `topics` | Read the student's mastery level per topic. |
| `mastery` | `update_topic_mastery` | `topic`, `performance`, `score_percent` | Update mastery after a quiz/practice. |
| `mastery` | `evaluate_answer` | `question`, `student_answer`, `mark_scheme`, `topic` | LLM-judged open-answer feedback (score + misconceptions). |
| `platform` | `advance_lesson_phase` | `to_step` | Move the lesson-plan step forward. |
| `platform` | `create_assignment` | … | Set homework. |
| `platform` | `load_resource` | `query` | Pull a matching resource onto the screen. |
| `platform` | `pause_lesson` / `resume_lesson` | `reason` / — | Pause/resume (freezes/unfreezes the lesson clock). |
| `lifecycle` | `end_lesson` | `closing_note` | End the lesson — **hard-guarded**: only fires after `lesson.timeout` or a student End click. |
| `lifecycle` | `generate_session_report` | … | Write the end-of-lesson report card. |
| `research` | `web_search` | `query`, `num_results` | Live web results. |
| `research` | `deep_research` | `topic`, `research_questions` | Multi-question research synthesis. |

**`/chat` subset** (`chat_tools.py`): `web_search`, `deep_research` only.

---

## 6. Manipulatives — deterministic & hands-on (AI passes params only)

The server derives the question, answer & marking from the same params, so a manipulative can never
contradict what's on screen. Subject + Key-Stage gates are HARD (a Maths lesson never gets
`atom_builder`; KS5 Maths gets only `equation_balance` / `algebra_tiles`).

### 6a. Maths — foundational
| Kind | KS | Topic keywords | Example params |
|------|----|----------------|----------------|
| `place_value_counters` | KS1–3 | place value, tens and ones, expanded form | `{"target": 6}` |
| `column_addition` | KS2–4 | column addition, carrying | `{"addends": [24, 38]}` |
| `number_grid_sums` | KS2–4 | number bond, missing number, magic square | `{"size": 3, "values": [[7,8,3],...]}` |
| `times_table_dash` | KS1–3 | times table, multiplication | `{"table": 8, "count": 10, "seconds": 60}` |
| `fraction_canvas` | KS1–3 | fraction, half, quarter, numerator | `{"denominator": 4, "shaded": 3}` |
| `dot_array` | KS1–3 | array, square number, rows of | `{"rows": 4, "cols": 4}` |
| `counting_bubbles` | KS1–2 | counting, how many | `{"count": 7, "item": "apples"}` |
| `compare_numbers` | KS1–3 | compare, greater than, smaller | `{"left": 29, "right": 92}` |
| `order_numbers` | KS1–3 | order, smallest to, ascending | `{"numbers": [45, 12, 51]}` |
| `clock_hands` | KS1–2 | time, clock, o'clock, half past | `{"hour": 3, "minute": 30}` |
| `money_coins` | KS1–2 | money, coin, pence, change | `{"amount_p": 47}` |
| `number_line_jump` | KS1–3 | number line, counting on/back, skip count | `{"start": 3, "step": 2, "jumps": 4}` |
| `coordinate_plot` | KS2–4 | coordinate, plot, axes, quadrant | `{"x": 3, "y": 4}` |

### 6b. Maths — advanced (KS3–KS5, never counters/fractions)
| Kind | KS | Topic keywords | Example params |
|------|----|----------------|----------------|
| `equation_balance` | KS3–5 | equation, solve for, unknown | `{"a": 3, "b": 2, "c": 11}` → 3x+2=11 |
| `algebra_tiles` | KS3–5 | factorise, quadratic, expand | `{"b": 5, "c": 6}` → x²+5x+6 |

### 6c. Science — universal shapes (server-owned content banks)
| Kind | KS | Topic keywords | Example params |
|------|----|----------------|----------------|
| `sorting_bins` | KS1–5 | sort, classify, group, living, material, conductor, acid… | `{"set": "living_nonliving"}` |
| `sequence_order` | KS1–5 | order, sequence, life cycle, food chain, water cycle… | `{"set": "water_cycle"}` |

`sorting_bins` sets: `living_nonliving` · `materials` · `solid_liquid_gas` · `magnetic_nonmagnetic` ·
`conductors_insulators` · `herbivore_carnivore_omnivore` · `vertebrates_invertebrates` ·
`renewable_nonrenewable` · `acids_alkalis` · `metals_nonmetals` · `elements_compounds_mixtures` ·
`prokaryote_eukaryote` · `plant_animal_cell` (each KS-gated).

`sequence_order` sets: `butterfly_life_cycle` · `frog_life_cycle` · `plant_life_cycle` · `food_chain` ·
`water_cycle` · `planets` · `scientific_method` · `digestion` · `blood_circulation` · `mitosis` · `rock_cycle`.

### 6d. Science — Chemistry / Physics / Biology
| Kind | Subject / KS | Topic keywords | Example params |
|------|--------------|----------------|----------------|
| `atom_builder` | Chem/Sci KS3–5 | atom, proton, electron, isotope, ion, shell | `{"element": "carbon"}` |
| `balance_equation` | Chem/Sci KS3–5 | balancing, chemical equation, conservation of mass | `{"equation": "CH4 + O2 -> CO2 + H2O"}` |
| `ph_scale` | Chem/Sci KS2–4 | ph, acid, alkali, indicator, litmus | `{"substance": "lemon_juice"}` |
| `force_arrows` | Phys/Sci KS3–5 | force, resultant, balanced, newton | `{"left": 30, "right": 50}` |
| `punnett_square` | Bio/Sci KS4–5 | genetics, inheritance, allele, dominant | `{"parent1": "Bb", "parent2": "Bb"}` |

---

## 7. Rules worth knowing

- **Subject + KS gate is hard.** Enforced per registry entry — the AI cannot override it.
- **Topic gate.** A manipulative only appears if its keywords match the lesson topic; no match →
  the AI uses a classic puzzle instead (intended).
- **The mix.** When a topic has a manipulative, the server alternates hands-on / classic in a
  random order (capped at 3 of a kind): ~60/40 hands-on KS1–2, 50/50 KS3, 45/55 KS4, 40/60 KS5.
- **KS-gated teaching.** KS1–KS2 teaching is interactive (puzzles/quick_replies as it teaches);
  KS3+ moves through slides briskly with no puzzles during teaching (saved for the practice phase).
- **The AI never supplies a manipulative's answer** — server derives + marks by exact comparison.
- **LaTeX: NO server repair (changed).** The AI writes valid KaTeX directly. If KaTeX can't render
  it, the frontend bounces a `latex_error` event back and the **Practitioner** re-emits corrected
  LaTeX (validate → fix → retry, capped per session). See the `math_puzzle` docstring for the rules.

---

## 8. Quick test matrix — one lesson per row hits a different family

| Subject | KS | Topic to ask for | Should give you |
|---------|----|------------------|-----------------|
| Maths | KS1 | Measurement – Time | `clock_hands` |
| Maths | KS1 | Fractions | `fraction_canvas` |
| Maths | KS2 | Coordinates | `coordinate_plot` |
| Maths | KS4 | Factorising quadratics | `algebra_tiles` |
| Maths | KS5 | Solving linear equations | `equation_balance` |
| Science | KS1 | Living things and habitats | `sorting_bins` |
| Science | KS2 | The water cycle | `sequence_order` |
| Chemistry | KS3 | Acids and alkalis | `ph_scale` |
| Chemistry | KS4 | Atomic structure | `atom_builder` |
| Physics | KS3 | Forces and motion | `force_arrows` |
| Biology | KS4 | Genetics and inheritance | `punnett_square` |

Legend for your own notes: ✅ works · ⚠️ issue · ❌ broken · ⬜ not tested yet

---

## Platform services & APIs (production features)

These are backend services/routers added by the production feature branches (not AI agent tools, but
part of the product surface):

- **Billing** — `services/billing/` (provider abstraction + immutable ledger + idempotent webhooks);
  routers `billing`, `school_billing`. Card data never reaches the backend; dev uses a mock provider.
- **Mastery engine** — `services/mastery_algorithm.py` (pure, deterministic, versioned) +
  `services/mastery_service.py` (evidence store, recompute, breakdown, recommendations, auto-backfill).
- **Settings** — `services/platform_settings_service.py` + `settings_registry.py` (scoped, validated,
  audited); `parent_settings_service.py`, `teacher_settings_service.py`.
- **Notifications** — `services/notification_service.py` (preference-aware, deduplicated) + in-app centre.
- **Observability** — `observability/metrics.py`, `middleware/observability.py` (request IDs + structured
  logs), `middleware/sensitive_rate_limit.py`, `routers/observability.py` (metrics + reconciliation).
- **Navigation registry** — `frontend/src/lib/navigation.tsx` is the single source of truth for
  role-specific sidebar navigation; the sidebar renders from it.
