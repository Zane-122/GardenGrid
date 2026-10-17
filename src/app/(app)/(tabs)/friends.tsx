import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { OnboardingTextField } from '@/components/onboarding/onboarding-text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getUsernameFormatError } from '@/constants/usernames';
import { useTheme } from '@/hooks/use-theme';
import {
  listFriendRequests,
  respondToFriendRequest,
  sendFriendRequest,
  type FriendRequest,
} from '@/utils/friends';

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function FriendsScreen() {
  const theme = useTheme();
  const [username, setUsername] = useState('');
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await listFriendRequests());
    } catch (loadError) {
      setError(errorText(loadError, 'Could not load friends'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function send() {
    const formatError = getUsernameFormatError(username);
    if (formatError) {
      setError(formatError);
      setNotice(null);
      return;
    }

    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await sendFriendRequest(username.trim());
      setUsername('');
      setNotice('Request sent.');
      await load();
    } catch (sendError) {
      setError(errorText(sendError, 'Could not send that request'));
    } finally {
      setSending(false);
    }
  }

  async function respond(request: FriendRequest, status: 'approved' | 'rejected') {
    setBusyId(request.id);
    setError(null);
    setNotice(null);
    try {
      await respondToFriendRequest(request.id, status);
      await load();
    } catch (respondError) {
      setError(errorText(respondError, 'Could not update that request'));
    } finally {
      setBusyId(null);
    }
  }

  const incoming = requests.filter((request) => request.status === 'pending' && request.direction === 'incoming');
  const outgoing = requests.filter((request) => request.status === 'pending' && request.direction === 'outgoing');
  const friends = requests.filter((request) => request.status === 'approved');

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hello}>
          <ThemedText type="heading">Friends</ThemedText>
          <ThemedText themeColor="textSecondary">
            {loading ? 'Loading friends…' : 'Send a request with their username.'}
          </ThemedText>
        </View>

        <OnboardingTextField
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          placeholder="their username"
        />
        <FriendlyButton
          label={sending ? 'Sending…' : 'Send request'}
          disabled={sending || username.trim().length === 0}
          onPress={() => void send()}
        />

        {error ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}
        {notice ? <ThemedText style={{ color: theme.primary }}>{notice}</ThemedText> : null}

        <Section title="Requests for you" empty="No pending requests." items={incoming}>
          {(request) => (
            <View style={styles.actions}>
              <FriendlyButton
                label={busyId === request.id ? 'Saving…' : 'Accept'}
                disabled={busyId !== null}
                onPress={() => void respond(request, 'approved')}
              />
              <FriendlyButton
                label="Decline"
                variant="ghost"
                disabled={busyId !== null}
                onPress={() => void respond(request, 'rejected')}
              />
            </View>
          )}
        </Section>

        <Section title="Sent" empty="You have not sent any requests." items={outgoing} />

        <Section title="Friends" empty="No friends yet." items={friends} />
      </ScrollView>
    </ThemedView>
  );
}

function Section({
  title,
  empty,
  items,
  children,
}: {
  title: string;
  empty: string;
  items: FriendRequest[];
  children?: (request: FriendRequest) => ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {items.length === 0 ? (
        <ThemedText themeColor="textSecondary">{empty}</ThemedText>
      ) : (
        items.map((request) => (
          <GardenFrame key={request.id} contentStyle={styles.card}>
            <View style={styles.person}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {request.person.displayName}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                @{request.person.username}
              </ThemedText>
            </View>
            {children ? children(request) : null}
          </GardenFrame>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  hello: {
    gap: Spacing.half,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
  },
  person: {
    gap: Spacing.half,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
