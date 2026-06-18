/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        barlow: ["Barlow", "sans-serif"],
        inter: ["Inter", "sans-serif"],
        serif: ["Instrument Serif", "serif"],
        dirtyline: ["Dirtyline", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
