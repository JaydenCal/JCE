import type { Config } from "tailwindcss";
const v = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { bg: v("bg"), surface: v("surface"), subtle: v("subtle"), ink: v("ink"), muted: v("muted"), line: v("line"),
        brand: { DEFAULT: v("brand"), fg: v("brand-fg"), soft: v("brand-soft") }, warn: v("warn"), danger: v("danger"), ok: v("ok") },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
      borderRadius: { xl2: "1.25rem" },
      boxShadow: { card: "0 1px 2px rgb(16 24 40 / .05), 0 8px 24px -12px rgb(16 24 40 / .12)" },
    },
  },
  plugins: [],
} satisfies Config;
