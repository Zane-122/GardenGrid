import '@/global.css'

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // Text
    text: '#14201A',
    textSecondary: '#5B6B60',
    textInverse: '#F4F8F5',

    // Backgrounds
    background: '#F7FAF6',
    backgroundElement: '#EDF3EA',
    backgroundSelected: '#DCEBDC',
    surface: '#FFFFFF',
    border: '#DDE7DA',

    // Brand — green is the anchor
    primary: '#2E7D32',
    primaryLight: '#4CA753',
    primaryDark: '#1B5E20',
    onPrimary: '#F4F8F5',

    // Secondary / accent
    secondary: '#8B5E34',
    onSecondary: '#F4F8F5',
    accent: '#F2B705',
    onAccent: '#14201A',
    tint: '#2E7D32',

    // Status
    success: '#2E7D32',
    onSuccess: '#F4F8F5',
    warning: '#B45309',
    onWarning: '#F4F8F5',
    danger: '#D92D20',
    onDanger: '#F4F8F5',
    info: '#1D6FCC',
    onInfo: '#F4F8F5',

    // Utility
    icon: '#5B6B60',
    iconSelected: '#2E7D32',
    overlay: 'rgba(20, 32, 26, 0.4)',
    shadow: 'rgba(20, 32, 26, 0.12)',
  },
  dark: {
    // Text
    text: '#EAF2E8',
    textSecondary: '#A5B5A9',
    textInverse: '#14201A',

    // Backgrounds
    background: '#0E1712',
    backgroundElement: '#1A241D',
    backgroundSelected: '#233024',
    surface: '#17211A',
    border: '#2A362B',

    // Brand — green is the anchor
    primary: '#5FCB68',
    primaryLight: '#84DB8B',
    primaryDark: '#3F9C48',
    onPrimary: '#0E1712',

    // Secondary / accent
    secondary: '#C08A55',
    onSecondary: '#0E1712',
    accent: '#F5CB3A',
    onAccent: '#14201A',
    tint: '#5FCB68',

    // Status
    success: '#5FCB68',
    onSuccess: '#0E1712',
    warning: '#F0A83B',
    onWarning: '#14201A',
    danger: '#F1685E',
    onDanger: '#14201A',
    info: '#5B9DEE',
    onInfo: '#0E1712',

    // Utility
    icon: '#A5B5A9',
    iconSelected: '#5FCB68',
    overlay: 'rgba(0, 0, 0, 0.5)',
    shadow: 'rgba(0, 0, 0, 0.4)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;
