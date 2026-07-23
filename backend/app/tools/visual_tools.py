"""
visual_tools.py — DISPLAY-ONLY teaching visuals: mermaid diagrams, SVG diagrams, Manim animations.

Split out of `puzzle_tools` because these answer a different question. A PUZZLE is something the
student DOES and submits; these are what the tutor EXPLAINS WITH — nothing to submit, no marking,
no XP. Keeping them in the puzzle group meant "show a diagram" and "set a practice question" were
weighted as the same kind of act, which is exactly how lessons ended up asking a student to solve
something before it had been taught.

They form the `visuals` group, bound alongside `teaching` (slide navigation) and prioritised
during the TEACH/RECAP phases; the `puzzles` + `assessment` groups take priority in PRACTICE and
QUIZ. Every group stays bound in every phase — the lesson state anchor sets the PRIORITY, it does
not gate the tools, so the tutor can always reach for a diagram when a student is stuck.

Safety, in one line each (details in the services):
  mermaid — a declarative DSL, rendered client-side at securityLevel:"strict"; a bad spec is
            bounced back to the model rather than shown.
  svg     — model-authored markup put through an ALLOW-LIST PARSER (`sanitize_svg`) that rebuilds
            it from scratch, so scripts/handlers/external refs cannot survive into the page.
  manim   — real Python, so it gets two independent layers: an AST allow-list, then rendering in
            an isolated process with a scrubbed environment and hard resource limits.
"""
import logging
from typing import Union

from langchain_core.tools import tool

from app.services import image_gen_service, puzzle_service
from app.tools.session_tools import ToolContext
from app.tools.puzzle_tools import persist_and_return, _coerce_dict

logger = logging.getLogger(__name__)


def visual_tool_groups(ctx: ToolContext) -> dict:
    """The `visuals` group: display-only diagrams and animations the tutor teaches FROM."""

    async def _persist_and_return(full: dict) -> dict:
        return await persist_and_return(ctx, full)

    @tool
    async def explanatory_puzzle(image_prompt: str, caption: str = "", title: str = "") -> dict:
        """
        Show a clear, generated diagram/illustration that EXPLAINS the concept you are
        teaching right now (e.g. "a labelled diagram comparing a plant cell and an animal
        cell", "the water cycle with arrows"). A GO-TO teaching visual for Science / Maths /
        Physics / Chemistry / Biology — show it instead of a wall of text. Display-only: the
        student just looks at it, so after showing it, keep teaching FROM it (no answer to
        wait for). image_prompt is a vivid description of the picture to draw; caption is one
        short line shown under it.

        Prefer svg_diagram / draw_svg when the picture must be EXACT (counts, labels, measured
        angles) — a generated image mislabels and miscounts. Call SILENTLY.
        """
        # PRE-SEEDED FIRST. A topic image generated once by `app.seed_explanatory_images` is
        # instant and its labelling has been checked, whereas a live generation costs ~5-10 s
        # mid-lesson and looks different every time. Scoped like the resources are: the chosen
        # subtopic's image, else the unit's. Only fall through to live generation when neither
        # has been seeded, so nothing regresses on an unseeded topic.
        url = image_gen_service.topic_image_url(
            ctx.subject, ctx.key_stage, ctx.unit_title, ctx.topic_title,
        )
        if url:
            logger.info("EXPLANATORY served pre-seeded topic image (unit=%r subtopic=%r)",
                        ctx.unit_title, ctx.topic_title)
        else:
            key = f"{ctx.subject}|{ctx.key_stage}|{ctx.topic_title or ''}"
            url = await image_gen_service.generate_image(image_prompt, cache_key=key)
        if not url:
            return {"action": "show_puzzle", "error": "image_gen_failed",
                    "message": "The image couldn't be generated — keep teaching in words instead."}
        return await _persist_and_return(puzzle_service.build_explanatory(url, caption, title))

    @tool
    async def mermaid_diagram(mermaid: str, caption: str = "", title: str = "") -> dict:
        """
        Show a live MERMAID DIAGRAM on the student's screen to EXPLAIN a concept visually — a
        flowchart, cycle, process, sequence, timeline, hierarchy, mind-map or state machine. This
        is your GO-TO for anything with steps, arrows, stages or relationships: photosynthesis,
        the water/rock/nitrogen cycle, a reaction pathway, digestion, a food chain, an algorithm,
        circuit logic, classification trees, a maths method's steps. It renders instantly and
        EXACTLY (no image generation, never misdrawn), so PREFER it over explanatory_puzzle for
        structured concepts. Display-only — nothing to submit; teach FROM it.

        `mermaid` is a valid Mermaid spec, e.g.
          "flowchart LR\\n  A[Carbon dioxide] --> P((Photosynthesis))\\n  B[Water] --> P\\n  P --> G[Glucose]\\n  P --> O[Oxygen]"
        Start it with a diagram type (flowchart TD/LR, sequenceDiagram, stateDiagram-v2, timeline,
        mindmap, pie…). Keep it focused — 4-10 nodes reads best. Do NOT wrap it in ``` fences and
        do NOT put your spoken explanation inside it.

        GROUND IT IN THE SLIDE — this is what makes the diagram teach instead of decorate. Build
        the nodes from the "ON-SCREEN SLIDE" content you were given this turn: use the slide's OWN
        stages, terms and numbers as the node labels, in the slide's order. If the slide lists four
        stages of the water cycle, the flowchart has those four stages with those names — not a
        generic textbook version. A diagram whose labels don't appear on the slide is wrong.

        LEAD WITH THE DIAGRAM, then explain it in a few plain sentences — not a wall of text.
        Call SILENTLY.
        """
        spec = puzzle_service.clean_mermaid(mermaid)
        if not puzzle_service.is_valid_mermaid(spec):
            return {"action": "show_puzzle", "error": "bad_mermaid",
                    "message": "That isn't a Mermaid diagram. Start with a type like 'flowchart TD', "
                               "'sequenceDiagram', 'stateDiagram-v2', 'timeline', 'mindmap' or 'pie', "
                               "with the nodes/edges below it and NO ``` fences."}
        return await _persist_and_return(puzzle_service.build_mermaid(spec, caption, title))

    @tool
    async def svg_diagram(kind: str, params: Union[dict, str] = "", caption: str = "") -> dict:
        """
        Show a READY-MADE, exactly-drawn TEACHING DIAGRAM for this topic — a labelled structure the
        student can look at while you explain it. These are drawn by the server from real
        curriculum diagrams, so they are ALWAYS correct (a generated picture mislabels and
        miscounts). Display-only — teach FROM it.

        PREFER THIS over explanatory_puzzle whenever one of these fits the topic:
          Biology  : animal_cell · plant_cell · digestive_system · photosynthesis
          Chemistry: particle_states (solid/liquid/gas) · atom_shells {"element":"Carbon","protons":6,"neutrons":6}
          Physics  : series_circuit {"lamps":2} · parallel_circuit · wave_parts {"cycles":2}
                     · solar_system · forces_on_object {"up":"Lift","down":"Weight","left":"Drag","right":"Thrust"}

        The LESSON STATE block tells you which diagram matches the topic you're teaching right now —
        use that one. If none fits, use draw_svg (write your own) or mermaid_diagram (flows/cycles)
        instead. Call SILENTLY, then explain the diagram in a few plain sentences.
        """
        from app.services import svg_diagram_service as sds
        k = (kind or "").strip().lower()
        avail = sds.available_kinds(ctx.key_stage, ctx.subject)
        if k not in sds.DIAGRAMS:
            return {"action": "show_puzzle", "error": "bad_kind",
                    "message": f"Unknown diagram {kind!r}. For {ctx.subject} at {ctx.key_stage} "
                               f"choose one of: {', '.join(avail) or 'none'} — or draw it yourself "
                               "with draw_svg."}
        if k not in avail:
            return {"action": "show_puzzle", "error": "not_for_key_stage",
                    "message": f"{k!r} doesn't suit {ctx.subject} at {ctx.key_stage}. "
                               f"Choose one of: {', '.join(avail) or 'none'} — or use draw_svg."}
        built = sds.build(k, _coerce_dict(params))
        if not built:
            return {"action": "show_puzzle", "error": "render_failed",
                    "message": "That diagram couldn't be drawn — use draw_svg or mermaid_diagram."}
        return await _persist_and_return(
            puzzle_service.build_svg_diagram(built["svg"], caption or built["caption"], built["title"]))

    @tool
    async def draw_svg(svg: str, caption: str = "", title: str = "") -> dict:
        """
        DRAW YOUR OWN teaching diagram as SVG, for a topic the ready-made `svg_diagram` set doesn't
        cover. Use this whenever you need an exact, labelled picture of THIS lesson's content — a
        labelled leaf, a force diagram, a rock layer, a bond, a shape with its dimensions marked,
        an apparatus setup. It renders instantly and exactly. Display-only — teach FROM it.

        GROUND IT IN THE SLIDE: build the diagram from the "ON-SCREEN SLIDE" content you were given
        this turn — same parts, same labels, same numbers as the slide the student is looking at.

        Write ONE complete `<svg>` element with a viewBox (use `viewBox="0 0 640 400"`), no ``` fences:
          <svg viewBox="0 0 640 400"><ellipse cx="320" cy="200" rx="200" ry="130" fill="#dbeafe"
          stroke="#1e3a8a" stroke-width="3"/><text x="320" y="205" text-anchor="middle"
          font-size="18" fill="#0f172a">Nucleus</text></svg>

        RULES — markup only, no scripting:
          • Allowed: g, path, rect, circle, ellipse, line, polyline, polygon, text, tspan, defs,
            linearGradient/stop, marker, clipPath, use (href="#local" only), and SMIL
            (<animate>, <animateTransform>) if gentle motion helps.
          • NOT allowed and silently removed: <script>, <foreignObject>, <image>, <style>, any
            on* handler, and any external URL. Everything must be self-contained.
          • Label generously — a diagram with no text teaches nothing. Keep font-size >= 14.
          • Every tag must be closed (`<circle ... />`).

        Call SILENTLY, then explain it in a few plain sentences.
        """
        from app.services import svg_diagram_service as sds
        try:
            clean = sds.sanitize_svg(svg)
        except sds.SvgError as e:
            return {"action": "show_puzzle", "error": "bad_svg", "message": f"{e}. Fix and resend."}
        return await _persist_and_return(
            puzzle_service.build_svg_diagram(clean, caption, title or "Diagram"))

    @tool
    async def animate_concept(code: str, caption: str = "", title: str = "") -> dict:
        """
        ANIMATE an idea that MOTION explains better than a still picture — a wave travelling,
        particles diffusing, a shape rotating or being reflected, a graph being traced out, a
        number line being jumped along, forces acting, an orbit. You WRITE the animation: pass the
        body of a Manim `Scene.construct()`. Display-only; teach FROM it.

        GROUND IT IN THE SLIDE: animate the actual example on the "ON-SCREEN SLIDE" you were given
        this turn — the same numbers and the same shapes the student is looking at.

        `code` is the construct() body ONLY — no imports, no `class`, no `def`, indentation from
        column 0, no ``` fences:
            c = Circle(radius=1.5, color=BLUE)
            label = Text("radius", font_size=28).next_to(c, DOWN)
            self.play(Create(c), Write(label))
            r = Line(c.get_center(), c.get_right(), color=YELLOW)
            self.play(Create(r))
            self.wait(1)

        RULES (the server refuses anything else and tells you why):
          • NO LaTeX — `MathTex`/`Tex` are unavailable. Use `Text("x squared")` / `Text("3/4")`.
          • No imports, no def/class, no while-loops, no file access, no numpy. Points are plain
            lists: `[x, y, 0]`. `for i in range(n)` is fine.
          • Available: Circle, Square, Rectangle, Polygon, Line, Arrow, Dot, Text, VGroup, Axes,
            NumberLine, NumberPlane, ParametricFunction, Brace, Angle … and Create, Write, FadeIn,
            FadeOut, Transform, Rotate, Indicate, LaggedStart, `.animate`, self.play, self.wait.
          • Keep it SHORT — one idea, 5-15 seconds.

        The render takes a couple of seconds and this tool WAITS for it, so when it returns
        successfully the animation IS on screen — go straight into explaining it. Call SILENTLY.
        """
        from app.services import manim_service as mms
        if not mms.MANIM_AVAILABLE:
            return {"action": "show_puzzle", "error": "animations_disabled",
                    "message": "Animations aren't enabled here — use draw_svg or mermaid_diagram instead."}
        try:
            status, key = await mms.render_code(code)
        except mms.SceneCodeError as e:
            return {"action": "show_puzzle", "error": "bad_code",
                    "message": f"{e}. Fix the animation code and resend, or use draw_svg instead."}
        if status == "failed":
            return {"action": "show_puzzle", "error": "render_failed",
                    "message": "That scene couldn't be rendered, so nothing is on screen. Draw the "
                               "idea with draw_svg or mermaid_diagram instead — don't refer to an "
                               "animation."}
        if status != "ready":
            return {"action": "show_puzzle", "error": "rendering",
                    "message": "That animation is taking unusually long and is NOT on screen — "
                               "explain it with draw_svg or mermaid_diagram or in words now."}
        url = f"/api/curriculum/animations/{key}.mp4"
        return await _persist_and_return(
            puzzle_service.build_animation(url, caption, title or "Animation"))

    return {"visuals": [explanatory_puzzle, mermaid_diagram, svg_diagram, draw_svg, animate_concept]}
