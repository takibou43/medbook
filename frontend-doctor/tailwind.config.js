/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        cairo: ["Cairo", "Tahoma", "system-ui", "sans-serif"],
      },
      colors: {
        primary: {
          50: "#eefbf9",
          100: "#d3f4ee",
          200: "#a7e8dd",
          300: "#72d5c7",
          400: "#3fb9ac",
          500: "#219e92",
          600: "#187f77",
          700: "#166661",
          800: "#16514e",
          900: "#154442",
          950: "#062725",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
      },
    },
  },
  plugins: [],
};
