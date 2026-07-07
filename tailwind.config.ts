import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        paper: "#fbfcfe",
        line: "#d5dde8",
        // ≥3:1 vs white/paper (WCAG 1.4.11) — for borders that ARE the
        // component boundary (form inputs). Decorative borders stay on `line`.
        "line-strong": "#64748b",
        action: "#075985",
        "action-dark": "#0c4a6e",
        "soft-green": "#ecfdf5",
        "soft-gold": "#fffbeb",
      },
      fontFamily: {
        sans: [
          "Atkinson Hyperlegible",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
