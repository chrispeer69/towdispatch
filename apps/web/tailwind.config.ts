/**
 * US Tow DISPATCH design tokens v1.
 *
 * NEW role-named groups (`brand`, `bg`, `text.*-on-*`, `status`) are the
 * canonical surface for the v1 design system. Values live as HSL channels
 * in src/app/globals.css and are sampled from sibling product TowGrade
 * (www.towgrade.com) for cross-product visual consistency.
 *
 * LEGACY hue-named groups (`orange`, `steel`, and the flat `ok/warn/danger`
 * status set) are left in place and unchanged so existing utility classes
 * (`bg-orange`, `text-text-primary`, `bg-steel`, etc.) keep rendering the
 * previous palette. A follow-up PR will sweep components onto the new
 * role-named tokens; this config ships the tokens only.
 *
 * Single-font typography: every `font-*` family points to Inter so existing
 * `font-condensed` / `font-mono` class usage stays compiling and just
 * renders Inter at the requested weight.
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
        brand: {
          primary: 'hsl(var(--brand-primary) / <alpha-value>)',
          'primary-hover': 'hsl(var(--brand-primary-hover) / <alpha-value>)',
          'primary-text': 'hsl(var(--brand-primary-text) / <alpha-value>)',
        },
        bg: {
          base: 'hsl(var(--bg-base) / <alpha-value>)',
          surface: 'hsl(var(--bg-surface) / <alpha-value>)',
          marketing: 'hsl(var(--bg-marketing) / <alpha-value>)',
          section: 'hsl(var(--bg-section) / <alpha-value>)',
        },
        status: {
          success: 'hsl(var(--status-success) / <alpha-value>)',
          warning: 'hsl(var(--status-warning) / <alpha-value>)',
          danger: 'hsl(var(--status-danger) / <alpha-value>)',
        },
        // Legacy hue-named groups — unchanged so existing components keep
        // rendering the prior palette until they're swept onto the new
        // role-named tokens above.
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
          'primary-on-dark': 'hsl(var(--text-primary-on-dark) / <alpha-value>)',
          'secondary-on-dark': 'hsl(var(--text-secondary-on-dark) / <alpha-value>)',
          'primary-on-light': 'hsl(var(--text-primary-on-light) / <alpha-value>)',
          'secondary-on-light': 'hsl(var(--text-secondary-on-light) / <alpha-value>)',
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
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        condensed: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-inter)', 'ui-monospace', 'monospace'],
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
