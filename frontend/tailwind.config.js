/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Preflight OFF: this app has ~2.8k lines of hand-written CSS. Tailwind is added as an
  // ADDITIVE utility layer so existing pages keep working; new primitives + the shell are
  // fully Tailwind. Colours resolve to the app's existing CSS-variable design tokens, so both
  // systems share one source of truth and stay dark-mode ready.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          light: "var(--accent-light)",
          muted: "var(--accent-muted)",
        },
        surface: {
          DEFAULT: "var(--bg-secondary)",
          page: "var(--bg-primary)",
          muted: "var(--bg-tertiary)",
          hover: "var(--bg-hover)",
        },
        ink: {
          DEFAULT: "var(--text-primary)",
          soft: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        line: {
          DEFAULT: "var(--border)",
          soft: "var(--border-light)",
        },
        success: { DEFAULT: "var(--success)", light: "var(--success-light)" },
        warning: { DEFAULT: "var(--warning)", light: "var(--warning-light)" },
        danger: { DEFAULT: "var(--danger)", light: "var(--danger-light)" },
      },
      borderColor: { DEFAULT: "var(--border)" },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        focus: "0 0 0 3px var(--accent-muted)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "slide-in-left": "slide-in-left 0.25s cubic-bezier(0.4,0,0.2,1)",
      },
    },
  },
  plugins: [],
};
