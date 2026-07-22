"""
manim_scenes.py — the CURATED, parametrised Manim animation templates.

Security: the AI never writes Manim code. It picks a `kind` from the registry and passes
validated numeric params; these Scene classes are the ONLY code that ever runs. That keeps a
model-authored animation from becoming arbitrary code execution on the server.

Lightness: every scene labels with manim's `Text` (Pango) rather than `MathTex`, and draws axes
without `add_coordinates()`, so the Docker image needs cairo/pango/ffmpeg but NOT the ~1 GB
`texlive` system package. Keep it that way when adding scenes (avoid `Tex` / `MathTex`).

This says nothing about LaTeX in the app: equation puzzles still render LaTeX via KaTeX in the
browser (see MathPuzzle.tsx + puzzle_service._repair_latex). Equations = KaTeX, diagrams =
mermaid, animations = manim — three separate paths, all live side by side.

Imported ONLY when manim is installed (guarded in manim_service), so a bare manim import is fine.
"""
import numpy as np
from manim import (  # type: ignore
    Scene, Axes, Circle, Dot, Line, Arrow, Text, TracedPath,
    Create, Write, FadeIn, GrowArrow,
    UP, DOWN, LEFT, RIGHT, PI,
    BLUE, GREEN, YELLOW, ORANGE, WHITE, GREY,
)


class SineWave(Scene):
    """A dot travels round a circle and traces the sine curve beside it — how the circle
    'becomes' the wave. Params: cycles (1-3)."""

    def __init__(self, cycles: int = 2, **kwargs):
        self.cycles = max(1, min(3, int(cycles)))
        self._t = 0.0
        super().__init__(**kwargs)

    def construct(self):
        self.camera.background_color = "#0b1020"
        circle = Circle(radius=1.2, color=BLUE).shift(LEFT * 4)
        centre = circle.get_center()
        dot = Dot(color=YELLOW).move_to(centre + RIGHT * 1.2)

        axes = Axes(
            x_range=[0, self.cycles * 2 * PI, PI], y_range=[-1.5, 1.5, 1],
            x_length=7, y_length=3, tips=False,
            axis_config={"color": GREY, "include_ticks": False},
        ).shift(RIGHT * 1.2)

        title = Text("The circle traces a sine wave", font_size=26, color=WHITE).to_edge(UP)
        self.play(Write(title), Create(circle), Create(axes), FadeIn(dot))

        radius_line = Line(centre, dot.get_center(), color=YELLOW)
        self.add(radius_line)

        wave = TracedPath(lambda: axes.c2p(self._t, np.sin(self._t)),
                          stroke_color=GREEN, stroke_width=4)
        self.add(wave)

        def update(_mob, dt):
            self._t += dt * 1.6
            ang = self._t
            new_dot = centre + np.array([np.cos(ang) * 1.2, np.sin(ang) * 1.2, 0])
            dot.move_to(new_dot)
            radius_line.put_start_and_end_on(centre, new_dot)

        dot.add_updater(update)
        self.wait(self.cycles * 2 * PI / 1.6 + 0.3)
        dot.clear_updaters()
        self.wait(0.4)


class VectorAddition(Scene):
    """Two vectors added tip-to-tail, with the resultant. Params: ax, ay, bx, by."""

    def __init__(self, ax: int = 3, ay: int = 1, bx: int = 1, by: int = 2, **kwargs):
        def clamp(v):
            return max(-4, min(4, int(v)))
        self.ax, self.ay, self.bx, self.by = clamp(ax), clamp(ay), clamp(bx), clamp(by)
        super().__init__(**kwargs)

    def construct(self):
        self.camera.background_color = "#0b1020"
        axes = Axes(x_range=[-5, 5, 1], y_range=[-4, 4, 1], x_length=9, y_length=6, tips=False,
                    axis_config={"color": GREY, "include_ticks": False})
        self.add(axes)
        o = axes.c2p(0, 0)
        a_end = axes.c2p(self.ax, self.ay)
        b_end = axes.c2p(self.ax + self.bx, self.ay + self.by)

        a = Arrow(o, a_end, color=BLUE, buff=0)
        b = Arrow(a_end, b_end, color=GREEN, buff=0)
        r = Arrow(o, b_end, color=ORANGE, buff=0)

        la = Text(f"a ({self.ax}, {self.ay})", font_size=24, color=BLUE).next_to(a, UP)
        lb = Text(f"b ({self.bx}, {self.by})", font_size=24, color=GREEN).next_to(b, RIGHT)
        lr = Text(f"a + b ({self.ax + self.bx}, {self.ay + self.by})",
                  font_size=24, color=ORANGE).next_to(r, DOWN)
        title = Text("Adding vectors tip-to-tail", font_size=26, color=WHITE).to_edge(UP)

        self.play(Write(title))
        self.play(GrowArrow(a), FadeIn(la))
        self.play(GrowArrow(b), FadeIn(lb))
        self.play(GrowArrow(r), FadeIn(lr))
        self.wait(1.2)


class NumberLineAdd(Scene):
    """Jumping along a number line to add. Params: start, step, jumps."""

    def __init__(self, start: int = 3, step: int = 2, jumps: int = 4, **kwargs):
        self.start = max(0, min(20, int(start)))
        self.step = max(1, min(5, int(step)))
        self.jumps = max(1, min(6, int(jumps)))
        super().__init__(**kwargs)

    def construct(self):
        self.camera.background_color = "#0b1020"
        hi = min(20, self.start + self.step * self.jumps)
        axes = Axes(x_range=[0, hi, 1], y_range=[0, 1, 1], x_length=10, y_length=1, tips=False,
                    axis_config={"color": GREY, "include_ticks": True})
        self.add(axes)
        for n in range(0, hi + 1):
            self.add(Text(str(n), font_size=20, color=WHITE)
                     .next_to(axes.c2p(n, 0), DOWN, buff=0.15))
        title = Text(f"Start at {self.start}, jump {self.step} — {self.jumps} times",
                     font_size=26, color=WHITE).to_edge(UP)
        self.play(Write(title))
        dot = Dot(axes.c2p(self.start, 0), color=YELLOW)
        self.play(FadeIn(dot))
        pos = self.start
        for _ in range(self.jumps):
            pos += self.step
            self.play(dot.animate.move_to(axes.c2p(pos, 0)), run_time=0.5)
        self.play(FadeIn(Text(f"= {pos}", font_size=34, color=GREEN)
                         .next_to(axes.c2p(pos, 0), UP)))
        self.wait(0.8)
