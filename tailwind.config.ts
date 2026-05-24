import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'concentrate-green': '#3D9970',
        'concentrate-black': '#0a0a0a',
      },
    },
  },
  plugins: [],
};

export default config;
