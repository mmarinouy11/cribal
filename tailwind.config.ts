import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          sidebar: "#0c1e3c",
          "sidebar-hover": "#162d52",
          accent: "#06b6d4",
          "accent-hover": "#0891b2",
          "accent-light": "#cffafe",
          bg: "#f0f9ff",
        },
      },
    },
  },
  plugins: [],
};
export default config;
