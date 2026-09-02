import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type FriendlyButtonProps = PressableProps & {
  label: string;
  variant?: 'primary' | 'ghost';
};

export function FriendlyButton({
  label,
  variant = 'primary',
  disabled,
  style,
  ...props
}: FriendlyButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? theme.wood : theme.surface,
          borderColor: theme.woodEdge,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...props}>
      <ThemedText type="smallBold" style={{ color: primary ? theme.plotLabel : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
});
