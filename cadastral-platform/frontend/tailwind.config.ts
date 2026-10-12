import type { Config } from "tailwindcss";
const v = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { bg: v("bg"), surface: v("surface"), subtle: v("subtle"), ink: v("ink"), muted: v("muted"), line: v("line"), scene: v("scene"),
        brand: { DEFAULT: v("brand"), fg: v("brand-fg"), soft: v("brand-soft"), strong: v("brand-strong") }, gold: v("gold"), warn: v("warn"), danger: v("danger"), ok: v("ok") },
      fontFamily: {
        sans: ["var(--font-body)", "IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Jost", "Century Gothic", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { xl2: "0.75rem" },
      boxShadow: { card: "0 1px 0 rgb(var(--line) / .6), 0 18px 40px -26px rgb(30 32 36 / .28)", paper: "0 1px 2px rgb(30 32 36 / .08), 0 30px 60px -30px rgb(30 32 36 / .38)" },
    },
  },
  plugins: [],
} satisfies Config;
