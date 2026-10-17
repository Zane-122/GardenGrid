import { Platform, StyleSheet, Text, useWindowDimensions, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'heading'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 500;

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && (compact ? styles.titleCompact : styles.title),
        type === 'heading' && styles.heading,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && (compact ? styles.subtitleCompact : styles.subtitle),
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        (type === 'default' || type === 'title' || type === 'heading' || type === 'subtitle') &&
          styles.block,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    width: '100%',
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  titleCompact: {
    fontSize: 34,
    fontWeight: 600,
    lineHeight: 40,
  },
  heading: {
    fontSize: 22,
    fontWeight: 600,
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: 600,
  },
  subtitleCompact: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3E8F4A',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
