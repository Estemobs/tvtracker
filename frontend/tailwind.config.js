/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          950: '#0b0d10',
          900: '#12151a',
          800: '#1a1e25',
          700: '#242932',
          600: '#343b47',
        },
        accent: {
          500: '#6366f1',
          600: '#4f46e5',
        },
      },
      screens: {
        xs: '480px',
      },
    },
  },
  plugins: [],
};
