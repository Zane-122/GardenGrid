import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

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
  secureTextEntry,
  ...textInputProps
}: OnboardingTextFieldProps) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const isSecure = Boolean(secureTextEntry);

  return (
    <View style={styles.wrapper}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : theme.wood,
          },
        ]}>
        <TextInput
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          secureTextEntry={isSecure && !visible}
          style={[styles.input, { color: theme.text }, style]}
          {...textInputProps}
        />
        {isSecure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setVisible((current) => !current)}
            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
            <SymbolView
              tintColor={theme.wood}
              size={20}
              name={{
                ios: visible ? 'eye.slash' : 'eye',
                android: visible ? 'visibility_off' : 'visibility',
                web: visible ? 'visibility_off' : 'visibility',
              }}
            />
          </Pressable>
        ) : null}
      </View>
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
  field: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: Spacing.one,
  },
  input: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    fontWeight: 500,
  },
  toggle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.65,
  },
});
