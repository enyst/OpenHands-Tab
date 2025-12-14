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
        // OpenHands brand - warm amber/gold palette (signature color)
        brand: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',  // Primary brand amber
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        // Refined semantic event colors - cohesive warm palette
        event: {
          // Agent/AI responses - signature amber (protagonist)
          agent: '#E8A642',       // Warm gold - the AI's voice
          // User messages - warm slate (supporting role)
          user: '#94A3B8',        // Warm gray-blue, understated
          // System information - soft lavender (informational)
          system: '#A78BFA',      // Muted violet
          // Actions/Operations - teal (operational, cool accent)
          action: '#2DD4BF',      // Teal - stands out against warm palette
          // Results/Observations - sage green (successful completion)
          observation: '#86EFAC', // Soft mint green
          // Errors - warm coral (alert without harshness)
          error: '#F87171',       // Soft coral red
          // Success states - emerald
          success: '#34D399',     // Emerald green
          // Pause/waiting - amber
          pause: '#FBBF24',       // Amber (matches brand)
        },
        // Warm dark surface colors (not cold grays)
        surface: {
          0: '#0C0A09',           // Deepest - warm black
          1: '#1C1917',           // Background
          2: '#292524',           // Elevated surface
          3: '#3F3A36',           // Highest elevation
        },
      },
      boxShadow: {
        'glow-sm': '0 0 8px rgba(232, 166, 66, 0.25)',
        'glow': '0 0 16px rgba(232, 166, 66, 0.35)',
        'glow-lg': '0 0 24px rgba(232, 166, 66, 0.45)',
        'event': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px -1px rgba(0, 0, 0, 0.3)',
        'event-hover': '0 4px 12px rgba(0, 0, 0, 0.4)',
        'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      },
      animation: {
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
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
          '0%': { transform: 'scale(0.96)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(232, 166, 66, 0.2)' },
          '50%': { boxShadow: '0 0 20px rgba(232, 166, 66, 0.5)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1rem',
      },
    },
  },
};
