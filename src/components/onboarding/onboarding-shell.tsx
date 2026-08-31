import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type OnboardingShellProps = {
  step: number;
  totalSteps?: number;
  title: string;
  subtitle: string;
  children: ReactNode;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  loadingLabel?: string;
  /** Defaults to showing a back button on every step past the first. */
  showBack?: boolean;
  /** Rendered under the continue button, e.g. the "already have an account?" link. */
  footer?: ReactNode;
};

export function OnboardingShell({
  step,
  totalSteps = 5,
  title,
  subtitle,
  children,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  continueLoading = false,
  loadingLabel = 'Checking…',
  showBack,
  footer,
}: OnboardingShellProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const canGoBack = showBack ?? step > 1;

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + Spacing.three,
              paddingBottom: Spacing.three,
            },
          ]}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              {canGoBack ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  hitSlop={12}
                  onPress={() => router.back()}
                  style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
                  <SymbolView
                    tintColor={theme.text}
                    name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                    size={18}
                  />
                </Pressable>
              ) : (
                <View style={styles.backButton} />
              )}

              <View style={styles.dots} accessibilityLabel={`Step ${step} of ${totalSteps}`}>
                {Array.from({ length: totalSteps }, (_, index) => {
                  const active = index < step;
                  return (
                    <View
                      key={index}
                      style={[
                        styles.dot,
                        {
                          backgroundColor: active ? theme.primary : theme.border,
                          width: index === step - 1 ? 22 : 8,
                        },
                      ]}
                    />
                  );
                })}
              </View>

              <ThemedText type="small" themeColor="textSecondary" style={styles.stepLabel}>
                {step}/{totalSteps}
              </ThemedText>
            </View>

            <ThemedText type="code" style={styles.brand}>
              Garden Grid
            </ThemedText>
            <ThemedText type="subtitle">{title}</ThemedText>
            <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>
          </View>

          <View style={styles.body}>{children}</View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, Spacing.three),
              borderTopColor: theme.border,
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            disabled={continueDisabled || continueLoading}
            onPress={onContinue}
            style={({ pressed }) => [
              styles.continueButton,
              { backgroundColor: theme.primary },
              (continueDisabled || continueLoading) && styles.disabled,
              pressed && !continueDisabled && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
              {continueLoading ? loadingLabel : continueLabel}
            </ThemedText>
          </Pressable>
          {footer ? <View style={styles.footerExtra}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.five,
  },
  header: {
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  stepLabel: {
    width: 36,
    textAlign: 'right',
  },
  brand: {
    textTransform: 'uppercase',
    marginTop: Spacing.two,
  },
  body: {
    flexGrow: 1,
    gap: Spacing.three,
  },
  footer: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  continueButton: {
    minHeight: 52,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerExtra: {
    alignItems: 'center',
    marginTop: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.75,
  },
});
