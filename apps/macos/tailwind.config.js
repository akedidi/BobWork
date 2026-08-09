/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Bob Work Design System
        'bw-bg': {
          DEFAULT: '#F5F5F7',
          dark: '#1C1C1E',
        },
        'bw-surface': {
          1: '#FFFFFF',
          2: '#F9F9F9',
          3: '#F5F5F5',
          'dark-1': '#2C2C2E',
          'dark-2': '#3A3A3C',
          'dark-3': '#48484A',
        },
        'bw-text': {
          primary: '#1D1D1F',
          secondary: '#6E6E73',
          tertiary: '#86868B',
          'primary-dark': '#F5F5F7',
          'secondary-dark': '#AEAEB2',
          'tertiary-dark': '#8E8E93',
        },
        'bw-border': {
          light: '#E5E5E7',
          medium: '#D2D2D7',
          strong: '#A1A1A6',
          'light-dark': '#38383A',
          'medium-dark': '#48484A',
        },
        'bw-accent': {
          primary: '#2563EB',
          'primary-hover': '#1D4ED8',
          secondary: '#0891B2',
          'secondary-hover': '#0E7490',
        },
        'bw-success': '#059669',
        'bw-warning': '#D97706',
        'bw-error': '#DC2626',
        'bw-risk': {
          low: '#059669',
          medium: '#D97706',
          high: '#EA580C',
          critical: '#DC2626',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', '"Fira Code"', '"Cascadia Code"', 'monospace'],
      },
      fontSize: {
        'xs': ['11px', { lineHeight: '1.4' }],
        'sm': ['13px', { lineHeight: '1.5' }],
        'base': ['15px', { lineHeight: '1.6' }],
        'lg': ['17px', { lineHeight: '1.5' }],
        'xl': ['20px', { lineHeight: '1.4' }],
        '2xl': ['24px', { lineHeight: '1.3' }],
        '3xl': ['30px', { lineHeight: '1.2' }],
      },
      borderRadius: {
        'sm': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.08)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [],
}
