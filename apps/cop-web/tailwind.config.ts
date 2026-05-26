import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        csm: {
          bg: "var(--bg)",
          panel: "var(--panel)",
          panel2: "var(--panel-2)",
          border: "var(--border)",
          text: "var(--text)",
          muted: "var(--muted)",
          lime: "var(--lime)",
          cyan: "var(--cyan)",
          red: "var(--red)",
          yellow: "var(--yellow)",
          green: "var(--green)"
        }
      },
      boxShadow: {
        csm: "var(--shadow)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
