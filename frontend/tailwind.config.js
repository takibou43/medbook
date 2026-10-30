/** @type {import('tailwindcss').Config} */
export default {
  // :hover يعمل على الأجهزة التي تدعم المرور فقط، فلا يبقى الزر «عالقًا» بعد اللمس على الهاتف.
  future: { hoverOnlyWhenSupported: true },
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
        card: "0 1px 2px 0 rgb(15 37 35 / 0.05), 0 4px 12px -4px rgb(15 37 35 / 0.08)",
        pop: "0 20px 40px -12px rgb(6 39 37 / 0.35), 0 2px 8px rgb(6 39 37 / 0.10)",
      },
    },
  },
  plugins: [],
};
