/**
 * US Tow DISPATCH brand tokens. The DARK palette is LOCKED — values live as HSL
 * channels in src/app/globals.css under the `.dark` selector. The `:root`
 * (light) palette is a new addition that ships with the theme toggle. The
 * tokens consumed here read from CSS variables so all `bg-steel`,
 * `text-text-primary`, etc. classes flip automatically when the theme is
 * toggled.
 */
import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        orange: {
          DEFAULT: 'hsl(var(--orange) / <alpha-value>)',
          dark: 'hsl(var(--orange-dark) / <alpha-value>)',
          light: 'hsl(var(--orange-light) / <alpha-value>)',
        },
        steel: {
          DEFAULT: 'hsl(var(--steel) / <alpha-value>)',
          mid: 'hsl(var(--steel-mid) / <alpha-value>)',
          light: 'hsl(var(--steel-light) / <alpha-value>)',
          border: 'hsl(var(--steel-border) / <alpha-value>)',
          'border-light': 'hsl(var(--steel-border-light) / <alpha-value>)',
        },
        text: {
          primary: 'hsl(var(--text-primary) / <alpha-value>)',
          secondary: 'hsl(var(--text-secondary) / <alpha-value>)',
          muted: 'hsl(var(--text-muted) / <alpha-value>)',
        },
        ok: 'hsl(var(--green) / <alpha-value>)',
        warn: 'hsl(var(--yellow) / <alpha-value>)',
        danger: 'hsl(var(--red) / <alpha-value>)',
        info: 'hsl(var(--blue) / <alpha-value>)',
        violet: 'hsl(var(--purple) / <alpha-value>)',
      },
      backgroundColor: {
        'orange-glow': 'var(--orange-glow-rgba)',
      },
      fontFamily: {
        sans: ['var(--font-barlow)', 'system-ui', 'sans-serif'],
        condensed: ['var(--font-barlow-condensed)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '14px',
      },
      boxShadow: {
        'orange-glow': '0 0 0 4px var(--orange-glow-rgba)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out both',
      },
    },
  },
  plugins: [animate],
};

export default config;
