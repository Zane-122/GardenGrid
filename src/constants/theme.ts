import '@/global.css'

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#2A1E16',
    textSecondary: '#6B5344',
    textInverse: '#F7F0E4',

    background: '#EFE6D6',
    backgroundElement: '#E4D4C0',
    backgroundSelected: '#D8C3A6',
    surface: '#F7F0E4',
    border: '#C4A06A',

    primary: '#3F6B3A',
    primaryLight: '#5A8A52',
    primaryDark: '#2C4E29',
    onPrimary: '#F7F0E4',

    secondary: '#8B5E34',
    onSecondary: '#F7F0E4',
    accent: '#C4A06A',
    onAccent: '#2A1E16',
    tint: '#3F6B3A',

    success: '#3F6B3A',
    onSuccess: '#F7F0E4',
    warning: '#B45309',
    onWarning: '#F7F0E4',
    danger: '#A33B32',
    onDanger: '#F7F0E4',
    info: '#1D6FCC',
    onInfo: '#F7F0E4',

    woodOuter: '#C4A06A',
    wood: '#8B5E34',
    woodEdge: '#5C3D22',
    soil: '#5A4030',
    plot: '#6E4E3A',
    plotLine: '#4A3224',
    plotHover: '#7D5C44',
    plotLabel: '#E8D5C0',

    icon: '#6B5344',
    iconSelected: '#3F6B3A',
    overlay: 'rgba(42, 30, 22, 0.4)',
    shadow: 'rgba(92, 61, 34, 0.28)',
  },
  dark: {
    text: '#F3E6D4',
    textSecondary: '#C4B4A0',
    textInverse: '#1A1410',

    background: '#16110D',
    backgroundElement: '#241C16',
    backgroundSelected: '#2E241C',
    surface: '#1E1813',
    border: '#8B5E34',

    primary: '#7CB86A',
    primaryLight: '#9ACC8A',
    primaryDark: '#5A8A52',
    onPrimary: '#16110D',

    secondary: '#C08A55',
    onSecondary: '#16110D',
    accent: '#C4A06A',
    onAccent: '#1A1410',
    tint: '#7CB86A',

    success: '#7CB86A',
    onSuccess: '#16110D',
    warning: '#F0A83B',
    onWarning: '#1A1410',
    danger: '#E07A72',
    onDanger: '#1A1410',
    info: '#5B9DEE',
    onInfo: '#16110D',

    woodOuter: '#8B5E34',
    wood: '#6B4423',
    woodEdge: '#C08A55',
    soil: '#2A1E16',
    plot: '#3A2C20',
    plotLine: '#1E1510',
    plotHover: '#4A3A2A',
    plotLabel: '#C4B4A0',

    icon: '#C4B4A0',
    iconSelected: '#7CB86A',
    overlay: 'rgba(0, 0, 0, 0.5)',
    shadow: 'rgba(0, 0, 0, 0.45)',
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
