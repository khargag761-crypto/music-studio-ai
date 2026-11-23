/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: '#07090E',
          card: '#161B26',
          border: '#232B3E',
          cyan: '#00F2FE',
          purple: '#7F00FF',
          crimson: '#FF2A5F',
          green: '#00FF87',
          muted: '#8A99AD'
        }
      }
    },
  },
  plugins: [],
}
