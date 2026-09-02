import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.screen}>
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.four },
        ]}>
        <View style={styles.hero}>
          <ThemedText type="code" style={styles.brand}>
            Garden Grid
          </ThemedText>
          <ThemedText type="title" style={styles.title}>
            Grow something great
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            Plan, track, and tend your garden — right from your phone.
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/onboarding/name')}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.primary },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
              Sign up
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/onboarding/sign-in')}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">Log in</ThemedText>
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  hero: {
    gap: Spacing.two,
  },
  brand: {
    textTransform: 'uppercase',
  },
  title: {
    marginTop: Spacing.two,
  },
  actions: {
    gap: Spacing.two,
  },
  button: {
    minHeight: 52,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
