import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        paper: "#fbfcfe",
        line: "#d5dde8",
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
      boxShadow: {
        focus: "0 0 0 3px rgba(14, 165, 233, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
