# Third-Party Notices

SmartAI Tutor bundles or references the following third-party assets. Each is used under a
permissive licence compatible with commercial distribution. Keep this file up to date when
adding UI asset libraries.

## Fonts

- **Inter** (variable) — SIL Open Font License 1.1.
  Source: https://github.com/rsms/inter · via `@fontsource-variable/inter`.
  Bundled locally (no third-party font CDN at runtime).

## Interface icons

- **Lucide** (`lucide-react`) — ISC License.
  Source: https://github.com/lucide-icons/lucide.
  Used for all interface/navigation/action icons via the shared `Icon` wrapper
  (`src/components/ui/Icon.tsx`). One icon family only, per the design system.

## Emoji (educational / personality only)

- **Microsoft Fluent Emoji** — MIT License.
  Source: https://github.com/microsoft/fluentui-emoji.
  Rendered by the `Emoji` wrapper (`src/components/ui/Emoji.tsx`) for friendly, educational
  moments only — never for critical controls. The wrapper degrades gracefully to the native
  Unicode glyph if the asset cannot be fetched.

  **Privacy note (UK Children's Code):** by default the wrapper loads Fluent Emoji assets from a
  public CDN. For strict data-minimisation the assets should be self-hosted under `public/emoji/`
  (tracked as a follow-up in the security/observability branch); flip `Emoji`'s `BASE` constant to
  the local path once assets are vendored.
