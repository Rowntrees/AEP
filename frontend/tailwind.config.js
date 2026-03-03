/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: "#0f0f0f",
        card: "#1a1a1a",
        border: "#2a2a2a",
        muted: "#6b7280",
        accent: "#6366f1",
      },
    },
  },
  plugins: [],
};
