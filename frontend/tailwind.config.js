/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Near-black vault palette. `ink` is the page, `panel` the cards.
        ink: {
          950: '#06060a',
          900: '#0a0a10',
          850: '#0e0e16',
          800: '#13131d',
          750: '#191926',
          700: '#20202f',
          600: '#2b2b3d',
        },
        /**
         * Driven by CSS variables so the accent can be re-picked at runtime
         * from Settings. The defaults live in index.css; `lib/theme.ts` is the
         * only thing that overwrites them.
         */
        accent: {
          50: 'rgb(var(--accent-50) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
          900: 'rgb(var(--accent-900) / <alpha-value>)',
        },
        glow: 'rgb(var(--glow) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'Inter var',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 18px 40px -24px rgba(0,0,0,0.9)',
        lift: '0 30px 60px -28px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.06)',
        glow: '0 0 0 1px rgb(var(--accent-500) / 0.35), 0 12px 40px -12px rgb(var(--accent-500) / 0.55)',
      },
      backgroundImage: {
        'vault-radial':
          'radial-gradient(1200px 600px at 15% -10%, rgb(var(--accent-500) / 0.18), transparent 60%), radial-gradient(900px 500px at 85% 0%, rgb(var(--glow) / 0.10), transparent 55%)',
        'card-sheen':
          'linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0) 45%, rgba(255,255,255,0.04) 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        equalize: {
          '0%,100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.3s ease-out both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.6s infinite',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.22,1,0.36,1) both',
        equalize: 'equalize 0.9s ease-in-out infinite',
      },
      transitionTimingFunction: {
        vault: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
