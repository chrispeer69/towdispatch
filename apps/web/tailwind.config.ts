/**
 * TowCommand brand tokens are LOCKED. They are mirrored as Tailwind theme
 * tokens here AND as CSS custom properties in src/app/globals.css. Always
 * change both at the same time, and only with explicit brand sign-off.
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
          DEFAULT: '#F05A1A',
          dark: '#C44410',
          light: '#FF7A3D',
        },
        steel: {
          DEFAULT: '#1A1E2A',
          mid: '#252A38',
          light: '#2E3447',
          border: '#3A4158',
          'border-light': '#4A5270',
        },
        text: {
          primary: '#F0EDE8',
          secondary: '#9CA3B5',
          muted: '#626882',
        },
        ok: '#22C55E',
        warn: '#EAB308',
        danger: '#EF4444',
        info: '#3B82F6',
        violet: '#A855F7',
      },
      backgroundColor: {
        'orange-glow': 'rgba(240,90,26,0.15)',
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
        'orange-glow': '0 0 0 4px rgba(240,90,26,0.15)',
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
