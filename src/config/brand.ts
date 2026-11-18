/**
 * Centralized Official Brand Identity Configuration — KAZI AFRICA
 * Source artwork: public/assets/aistudio/Logo_KAZI_Africa___Talents_en_action_6bbc7ba2.png
 *
 * Official English brand copy MUST NEVER be translated, altered, or redrawn.
 */

export const KAZI_BRAND = {
  name: 'KAZI AFRICA',
  descriptor: 'SKILLS • SERVICES • OPPORTUNITIES',
  tagline: 'African Talent Deserves Its Place.',
  alt: 'KAZI AFRICA — SKILLS • SERVICES • OPPORTUNITIES — African Talent Deserves Its Place.',
  palette: {
    navy: '#022554',
    navyMid: '#013470',
    navyDeep: '#021D4B',
    orange: '#FA6D02',
    orangeBright: '#FD9303',
    green: '#119339',
    greenAccessible: '#0E7D30',
    canvas: '#F4F7FB',
    white: '#FFFFFF',
  },
  assets: {
    source: '/assets/aistudio/Logo_KAZI_Africa___Talents_en_action_6bbc7ba2.png',
    fullLight: '/brand/kazi-logo-full.png',
    fullDark: '/brand/kazi-logo-full-dark.png',
    compactLight: '/brand/kazi-logo-compact.png',
    compactDark: '/brand/kazi-logo-compact-dark.png',
    symbolLight: '/brand/kazi-symbol.png',
    symbolDark: '/brand/kazi-symbol-dark.png',
    mono: '/brand/kazi-logo-mono.png',
    faviconIco: '/favicon.ico',
    favicon16: '/favicon-16x16.png',
    favicon32: '/favicon-32x32.png',
    appleTouchIcon: '/apple-touch-icon.png',
    pwa192: '/pwa-192x192.png',
    pwa512: '/pwa-512x512.png',
    pwaMaskable512: '/pwa-maskable-512x512.png',
  },
} as const;

export type KaziBrandVariant = 'full' | 'compact' | 'symbol' | 'mono';
export type KaziBrandTheme = 'light' | 'dark';
export type KaziBrandSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
