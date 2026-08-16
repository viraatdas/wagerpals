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
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(110deg, var(--brand-1), var(--brand-2) 50%, var(--brand-3))",
        "cool-gradient":
          "linear-gradient(110deg, var(--neon-cyan), var(--neon-violet))",
        "glass-sheen":
          "linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0))",
      },
      boxShadow: {
        glow: "0 2px 8px -2px rgba(37, 99, 235, 0.18)",
        "glow-ember": "0 2px 8px -2px rgba(37, 99, 235, 0.25)",
        "glow-mint": "0 2px 8px -2px rgba(22, 163, 74, 0.2)",
        "glow-rose": "0 2px 8px -2px rgba(220, 38, 38, 0.2)",
        "glow-cyan": "0 2px 8px -2px rgba(2, 132, 199, 0.18)",
        glass: "0 1px 3px rgba(0,0,0,0.06)",
      },
      backdropBlur: {
        xs: "2px",
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
