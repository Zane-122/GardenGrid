import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AppScreenProps = {
  title: string;
  directions?: string;
  step?: number;
  totalSteps?: number;
  showBack?: boolean;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
};

export function AppScreen({
  title,
  directions,
  step,
  totalSteps,
  showBack = true,
  onBack,
  children,
  footer,
  scroll = true,
}: AppScreenProps) {
  const theme = useTheme();
  const Body = scroll ? ScrollView : View;

  return (
    <ThemedView style={styles.screen}>
      <Body
        style={styles.body}
        contentContainerStyle={scroll ? styles.content : undefined}
        keyboardShouldPersistTaps="handled">
        <View style={scroll ? undefined : styles.content}>
          <View style={styles.topRow}>
            {showBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={12}
                onPress={onBack ?? (() => router.back())}
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
            {step && totalSteps ? (
              <ThemedText type="small" themeColor="textSecondary">
                {step} of {totalSteps}
              </ThemedText>
            ) : null}
          </View>

          <View style={styles.header}>
            <ThemedText type="heading">{title}</ThemedText>
            {directions ? (
              <ThemedText themeColor="textSecondary">{directions}</ThemedText>
            ) : null}
          </View>
          <View style={styles.children}>{children}</View>
        </View>
      </Body>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    gap: Spacing.two,
  },
  children: {
    gap: Spacing.three,
    flexGrow: 1,
  },
  footer: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
