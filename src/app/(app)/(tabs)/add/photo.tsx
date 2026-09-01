import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/app/app-screen';
import { FriendlyButton } from '@/components/app/friendly-button';
import { ThemedText } from '@/components/themed-text';
import { useAddPlant } from '@/context/add-plant';
import { useTheme } from '@/hooks/use-theme';
import { previewPlantByPhoto } from '@/utils/plants';

export default function AddPhotoScreen() {
  const theme = useTheme();
  const { setPreview } = useAddPlant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handlePhoto(fromCamera: boolean) {
    if (busy) {
      return;
    }

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        fromCamera ? 'Camera access required' : 'Photo library access required',
        fromCamera
          ? 'Allow camera access to take a photo for identification.'
          : 'Allow photo library access to choose an existing image.'
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          base64: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          base64: true,
        });

    if (result.canceled) {
      return;
    }

    const image = result.assets[0];
    const payload = image.base64 ?? image.uri;
    if (!payload) {
      setError('Could not read that image. Try another photo.');
      return;
    }

    setBusy(true);
    setError(null);
    setStatus('Identifying plant…');
    try {
      const identified = await previewPlantByPhoto([payload]);
      if (!identified?.info) {
        throw new Error('No plant details came back for that photo');
      }
      setPreview({
        info: identified.info,
        probability: identified.suggestions?.[0]?.probability ?? null,
        similarImages: identified.similar_images ?? [],
      });
      router.push('/add/confirm');
    } catch (identifyError) {
      setError(identifyError instanceof Error ? identifyError.message : 'Photo identification failed');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen
      title="Identify from photo"
      directions="Use a clear photo of a leaf or flower. You can confirm the match on the next screen."
      step={2}
      totalSteps={3}>
      <View style={styles.actions}>
        <FriendlyButton
          label={busy ? 'Looking…' : 'Take a photo'}
          disabled={busy}
          onPress={() => void handlePhoto(true)}
        />
        <FriendlyButton
          label="Choose a photo"
          variant="ghost"
          disabled={busy}
          onPress={() => void handlePhoto(false)}
        />
      </View>
      {status ? <ThemedText themeColor="textSecondary">{status}</ThemedText> : null}
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
  },
});
