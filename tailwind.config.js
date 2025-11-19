/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/webview-src/**/*.{ts,tsx,css,html}',
    './node_modules/@openhands/ui/dist/**/*.{js,css}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Monaco', 'Courier New', 'monospace'],
      },
      colors: {
        // Brand colors - warm amber/gold palette
        brand: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        // Semantic event colors
        event: {
          system: '#9333EA',      // Purple
          action: '#3B82F6',      // Blue
          observation: '#F59E0B', // Amber
          error: '#DC2626',       // Red
          success: '#059669',     // Green
          pause: '#EAB308',       // Yellow
        },
      },
      boxShadow: {
        'glow-sm': '0 0 8px rgba(245, 158, 11, 0.3)',
        'glow': '0 0 16px rgba(245, 158, 11, 0.4)',
        'glow-lg': '0 0 24px rgba(245, 158, 11, 0.5)',
        'event': '0 2px 8px rgba(0, 0, 0, 0.2)',
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(245, 158, 11, 0.3)' },
          '50%': { boxShadow: '0 0 16px rgba(245, 158, 11, 0.6)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
};
