import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/app/app-screen';
import { FriendlyButton } from '@/components/app/friendly-button';
import { OnboardingTextField } from '@/components/onboarding/onboarding-text-field';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAddPlant } from '@/context/add-plant';
import { useTheme } from '@/hooks/use-theme';
import {
  plantSearchLabels,
  previewPlantByName,
  searchPlantByName,
  selectPlantSearchMatches,
  type PlantNameMatch,
} from '@/utils/plants';

export default function AddSearchScreen() {
  const theme = useTheme();
  const { setPreview } = useAddPlant();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PlantNameMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  async function handleSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 2 || searching || busy) {
      if (trimmed.length < 2) {
        setError('Enter at least 2 characters.');
      }
      return;
    }

    Keyboard.dismiss();
    setSearching(true);
    setError(null);
    try {
      const result = await searchPlantByName(trimmed);
      setMatches(selectPlantSearchMatches(trimmed, result?.entities ?? []));
      setHasSearched(true);
    } catch (searchError) {
      setMatches([]);
      setHasSearched(true);
      setError(searchError instanceof Error ? searchError.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectMatch(match: PlantNameMatch) {
    if (busy) {
      return;
    }

    const labels = plantSearchLabels(match);
    setBusy(true);
    setError(null);
    try {
      const result = await previewPlantByName(match.access_token);
      if (!result?.info) {
        throw new Error('No plant details came back for that name');
      }
      setPreview({
        info: result.info,
        fallbackName: labels.title,
      });
      router.push('/add/confirm');
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not load that plant');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen
      title="Search by name"
      directions="Enter a common name, tap Search, then select a result."
      step={2}
      totalSteps={3}>
      <OnboardingTextField
        label="Plant name"
        value={query}
        onChangeText={setQuery}
        placeholder="Basil"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        blurOnSubmit
        editable={!busy && !searching}
        onSubmitEditing={() => void handleSearch()}
      />

      <FriendlyButton
        label={searching ? 'Searching…' : 'Search'}
        disabled={busy || searching || query.trim().length < 2}
        onPress={() => void handleSearch()}
      />

      {!searching && hasSearched && matches.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          No matching plants. Try a shorter or more common name.
        </ThemedText>
      ) : null}

      {matches.map((match) => {
        const labels = plantSearchLabels(match);
        return (
          <Pressable
            key={`${match.access_token}-${match.matched_in}`}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void handleSelectMatch(match)}
            style={({ pressed }) => [
              styles.match,
              { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}>
            {match.thumbnail ? (
              <Image source={{ uri: match.thumbnail }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  ?
                </ThemedText>
              </View>
            )}
            <View style={styles.matchText}>
              <ThemedText type="smallBold">{labels.title}</ThemedText>
            </View>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              View
            </ThemedText>
          </Pressable>
        );
      })}

      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchText: {
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});
