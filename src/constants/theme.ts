import '@/global.css'

import { Platform } from 'react-native';

const flat = {
  text: '#1C1C1C',
  textSecondary: '#6F6F6F',
  textInverse: '#FFFFFF',

  background: '#F5F5F5',
  backgroundElement: '#EEEEEE',
  backgroundSelected: '#E7F3E8',
  surface: '#FFFFFF',
  border: '#E4E4E4',

  primary: '#3E8F4A',
  primaryLight: '#E7F3E8',
  primaryDark: '#2F7040',
  onPrimary: '#FFFFFF',

  secondary: '#3E8F4A',
  onSecondary: '#FFFFFF',
  accent: '#3E8F4A',
  onAccent: '#FFFFFF',
  tint: '#3E8F4A',

  success: '#3E8F4A',
  onSuccess: '#FFFFFF',
  warning: '#3E8F4A',
  onWarning: '#FFFFFF',
  danger: '#B5524A',
  onDanger: '#FFFFFF',
  info: '#3E8F4A',
  onInfo: '#FFFFFF',

  woodOuter: '#F5F5F5',
  wood: '#3E8F4A',
  woodEdge: '#E4E4E4',
  soil: '#F5F5F5',
  plot: '#FFFFFF',
  plotLine: '#E4E4E4',
  plotHover: '#E7F3E8',
  plotLabel: '#7A7A7A',

  icon: '#6F6F6F',
  iconSelected: '#3E8F4A',
  overlay: 'rgba(0, 0, 0, 0.35)',
  shadow: 'transparent',

  oxygen: '#0ba0a5',
  pollen: '#ffd500',
} as const;

/** Earthy green-and-brown palette used only by the grid page. */
export const GardenPalette = {
  // Lawn behind the bed
  grass: '#4C7F33',

  // Raised bed
  woodOuter: '#8A5A33',
  woodEdge: '#4E331C',
  soil: '#5A381D',
  plot: '#6F4727',
  plotLine: '#3F2815',
  plotHover: '#86A03F',
  plotLabel: '#BFA27E',
  highlight: '#F2C94C',

  // Parchment panels sitting on the grass
  panel: '#F4EAD2',
  panelBorder: '#C4AA7C',
  panelText: '#3B2A1A',
  panelTextSecondary: '#6E5A44',
  panelDanger: '#A8402F',

  // Top bar and tab bar while on the grid page
  bar: '#4E331C',
  barBorder: '#33200F',
  barText: '#F4EAD2',
  barTextMuted: '#CDB48C',
  barPill: '#6F4727',
} as const;

export const Colors = {
  light: flat,
  dark: flat,
};

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
