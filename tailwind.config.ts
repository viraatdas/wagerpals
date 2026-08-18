import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        "background-2": "var(--bg-2)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        "muted-2": "var(--muted-2)",
        // Brand accent ramp (light → base → deep blue).
        // RGB-channel vars so alpha modifiers (bg-brand-2/10) work.
        brand: {
          1: "rgb(var(--brand-1-rgb) / <alpha-value>)",
          2: "rgb(var(--brand-2-rgb) / <alpha-value>)",
          3: "rgb(var(--brand-3-rgb) / <alpha-value>)",
          DEFAULT: "rgb(var(--brand-2-rgb) / <alpha-value>)",
        },
        // Semantic accents (legacy "neon" names, light-theme values)
        neon: {
          violet: "rgb(var(--neon-violet-rgb) / <alpha-value>)",
          cyan: "rgb(var(--neon-cyan-rgb) / <alpha-value>)",
          mint: "rgb(var(--neon-mint-rgb) / <alpha-value>)",
          rose: "rgb(var(--neon-rose-rgb) / <alpha-value>)",
          amber: "rgb(var(--neon-amber-rgb) / <alpha-value>)",
        },
        // Canonical design tokens (see app/globals.css :root for the source values).
        // Additive — legacy background/foreground/muted/brand/neon keys above are untouched.
        surface: {
          DEFAULT: "var(--color-surface)",
          elevated: "var(--color-surface-elevated)",
          sunken: "var(--color-surface-sunken)",
        },
        ground: "var(--color-bg)",
        hairline: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        ink: {
          DEFAULT: "var(--color-text)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          inverse: "var(--color-text-inverse)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent-rgb) / <alpha-value>)",
          hover: "rgb(var(--color-accent-hover-rgb) / <alpha-value>)",
          soft: "rgb(var(--color-accent-soft-rgb) / <alpha-value>)",
        },
        yes: "rgb(var(--color-yes-rgb) / <alpha-value>)",
        no: "rgb(var(--color-no-rgb) / <alpha-value>)",
        win: "rgb(var(--color-win-rgb) / <alpha-value>)",
        loss: "rgb(var(--color-loss-rgb) / <alpha-value>)",
        pending: "rgb(var(--color-pending-rgb) / <alpha-value>)",
        info: "rgb(var(--color-info-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      fontSize: {
        xs: ["var(--text-xs)", { lineHeight: "var(--leading-xs)" }],
        sm: ["var(--text-sm)", { lineHeight: "var(--leading-sm)" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-base)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-lg)" }],
        xl: ["var(--text-xl)", { lineHeight: "var(--leading-xl)" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-2xl)" }],
        "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-3xl)" }],
        "4xl": ["var(--text-4xl)", { lineHeight: "var(--leading-4xl)" }],
        "5xl": ["var(--text-5xl)", { lineHeight: "var(--leading-5xl)" }],
        "6xl": ["var(--text-6xl)", { lineHeight: "var(--leading-6xl)" }],
        "7xl": ["var(--text-7xl)", { lineHeight: "var(--leading-7xl)" }],
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        8: "var(--space-8)",
        10: "var(--space-10)",
        12: "var(--space-12)",
        16: "var(--space-16)",
        20: "var(--space-20)",
        24: "var(--space-24)",
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
        // Semantic radii — do NOT alias onto Tailwind's default sm/md/lg/xl keys.
        chip: "var(--radius-chip)",
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        panel: "var(--radius-panel)",
        pill: "var(--radius-pill)",
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(110deg, var(--brand-1), var(--brand-2) 50%, var(--brand-3))",
        "cool-gradient":
          "linear-gradient(110deg, var(--neon-cyan), var(--neon-violet))",
        "glass-sheen":
          "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0))",
      },
      boxShadow: {
        glow: "0 4px 16px -4px rgb(var(--color-accent-rgb) / 0.30)",
        "glow-ember": "0 4px 16px -4px rgb(var(--color-accent-rgb) / 0.35)",
        "glow-mint": "0 4px 16px -4px rgb(var(--color-win-rgb) / 0.30)",
        "glow-rose": "0 4px 16px -4px rgb(var(--color-loss-rgb) / 0.30)",
        "glow-cyan": "0 4px 16px -4px rgb(var(--color-info-rgb) / 0.30)",
        glass: "0 1px 3px rgba(0,0,0,0.4)",
        // The world's signature: colored edge + bloom for a card with recent
        // activity. Sits on top of an elevation shadow, never replaces it.
        live: "var(--shadow-live)",
        // Canonical elevation scale — additive alongside the glow*/glass keys above.
        "elev-1": "var(--shadow-elev-1)",
        "elev-2": "var(--shadow-elev-2)",
        "elev-3": "var(--shadow-elev-3)",
        "elev-4": "var(--shadow-elev-4)",
        accent: "var(--shadow-accent)",
      },
      backdropBlur: {
        xs: "2px",
      },
      transitionDuration: {
        instant: "var(--duration-instant)",
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
        slower: "var(--duration-slower)",
      },
      transitionTimingFunction: {
        "out-expo": "var(--ease-out)",
        "in-out-quint": "var(--ease-in-out)",
        spring: "var(--ease-spring)",
      },
      keyframes: {
        riseIn: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        floaty: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        rise: "riseIn 0.5s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fadeIn 0.25s ease-out both",
        floaty: "floaty 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
