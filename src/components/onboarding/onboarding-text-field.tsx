import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type OnboardingTextFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
};

export function OnboardingTextField({
  label,
  error,
  style,
  ...textInputProps
}: OnboardingTextFieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        autoCorrect={false}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : theme.border,
          },
          style,
        ]}
        {...textInputProps}
      />
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.one,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    fontWeight: 500,
  },
});
