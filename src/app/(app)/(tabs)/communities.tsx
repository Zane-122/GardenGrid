import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FriendlyButton } from '@/components/app/friendly-button';
import { GardenFrame } from '@/components/app/garden-frame';
import { OnboardingTextField } from '@/components/onboarding/onboarding-text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createCommunity,
  deleteCommunity,
  inviteToCommunity,
  leaveCommunity,
  listMyCommunities,
  respondToCommunityInvite,
  type Community,
  type CommunityList,
  type CommunityPerson,
  type IncomingCommunityInvite,
} from '@/utils/communities';

const MEMBERSHIP_LIMIT = 2;

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function names(people: CommunityPerson[]) {
  return people.map((person) => person.displayName).join(', ');
}

export default function CommunitiesScreen() {
  const theme = useTheme();
  const [list, setList] = useState<CommunityList | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await listMyCommunities());
    } catch (loadError) {
      setError(errorText(loadError, 'Could not load communities'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const membershipCount = list?.membershipCount ?? 0;
  const atLimit = membershipCount >= MEMBERSHIP_LIMIT;
  const owned = list?.communities.filter((community) => community.owned) ?? [];
  const joined = list?.communities.filter((community) => !community.owned) ?? [];
  const invites = list?.invites ?? [];

  async function create() {
    const cleaned = name.trim();
    if (!cleaned || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createCommunity(cleaned);
      setName('');
      setCreating(false);
      setNotice(`${cleaned} is ready. Invite friends from the card below.`);
      await load();
    } catch (createError) {
      setError(errorText(createError, 'Could not create that community'));
    } finally {
      setSaving(false);
    }
  }

  async function run(id: string, action: () => Promise<void>, fallback: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(errorText(actionError, fallback));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hello}>
          <ThemedText type="heading">Communities</ThemedText>
          <ThemedText themeColor="textSecondary">
            {loading
              ? 'Loading communities…'
              : `You are in ${membershipCount} of ${MEMBERSHIP_LIMIT}. Create one, or join when a friend invites you.`}
          </ThemedText>
        </View>

        {error ? <ThemedText style={{ color: theme.danger }}>{error}</ThemedText> : null}
        {notice ? <ThemedText style={{ color: theme.primary }}>{notice}</ThemedText> : null}

        {creating ? (
          <GardenFrame contentStyle={styles.card}>
            <OnboardingTextField
              label="Community name"
              value={name}
              onChangeText={setName}
              placeholder="Backyard club"
              maxLength={40}
            />
            <View style={styles.actions}>
              <FriendlyButton
                label="Cancel"
                variant="ghost"
                disabled={saving}
                onPress={() => {
                  setCreating(false);
                  setName('');
                }}
              />
              <FriendlyButton
                label={saving ? 'Creating…' : 'Create'}
                disabled={saving || name.trim().length === 0 || atLimit}
                onPress={() => void create()}
              />
            </View>
          </GardenFrame>
        ) : (
          <FriendlyButton
            label={atLimit ? 'You are in 2 communities' : 'Create a community'}
            disabled={loading || atLimit}
            onPress={() => {
              setError(null);
              setNotice(null);
              setCreating(true);
            }}
          />
        )}

        <Section title="Invites" empty={loading ? 'Loading…' : 'No invites waiting.'} count={invites.length}>
          {invites.map((invite) => (
            <InviteCard
              key={invite.id}
              invite={invite}
              busy={busyId === invite.id}
              atLimit={atLimit}
              onAccept={() =>
                void run(
                  invite.id,
                  () => respondToCommunityInvite(invite.id, true),
                  'Could not join that community',
                )
              }
              onDecline={() =>
                void run(
                  invite.id,
                  () => respondToCommunityInvite(invite.id, false),
                  'Could not decline that invite',
                )
              }
            />
          ))}
        </Section>

        <Section title="Communities you own" empty={loading ? 'Loading…' : 'You have not created one yet.'} count={owned.length}>
          {owned.map((community) => (
            <OwnedCard
              key={community.id}
              community={community}
              friends={list?.friends ?? []}
              inviting={invitingId === community.id}
              busyId={busyId}
              confirming={confirmDeleteId === community.id}
              onToggleInvite={() => setInvitingId((current) => (current === community.id ? null : community.id))}
              onInvite={(friendId) =>
                void run(friendId, () => inviteToCommunity(community.id, friendId), 'Could not send that invite')
              }
              onAskDelete={() => setConfirmDeleteId(community.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onDelete={() =>
                void run(community.id, async () => {
                  await deleteCommunity(community.id);
                  setConfirmDeleteId(null);
                }, 'Could not delete that community')
              }
            />
          ))}
        </Section>

        <Section title="Communities you're in" empty={loading ? 'Loading…' : 'You have not joined one yet.'} count={joined.length}>
          {joined.map((community) => (
            <GardenFrame key={community.id} contentStyle={styles.card}>
              <ThemedText type="smallBold">{community.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Owned by {community.owner.displayName}. {names(community.members)}
              </ThemedText>
              {confirmLeaveId === community.id ? (
                <View style={styles.actions}>
                  <FriendlyButton label="Cancel" variant="ghost" disabled={busyId !== null} onPress={() => setConfirmLeaveId(null)} />
                  <FriendlyButton
                    label={busyId === community.id ? 'Leaving…' : 'Leave'}
                    disabled={busyId !== null}
                    onPress={() =>
                      void run(community.id, async () => {
                        await leaveCommunity(community.id);
                        setConfirmLeaveId(null);
                      }, 'Could not leave that community')
                    }
                  />
                </View>
              ) : (
                <FriendlyButton label="Leave" variant="ghost" onPress={() => setConfirmLeaveId(community.id)} />
              )}
            </GardenFrame>
          ))}
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

function Section({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {count === 0 ? <ThemedText themeColor="textSecondary">{empty}</ThemedText> : children}
    </View>
  );
}

function InviteCard({
  invite,
  busy,
  atLimit,
  onAccept,
  onDecline,
}: {
  invite: IncomingCommunityInvite;
  busy: boolean;
  atLimit: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <GardenFrame contentStyle={styles.card}>
      <ThemedText type="smallBold">{invite.communityName}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {invite.from.displayName} invited you.
        {atLimit ? ' Leave a community before you can join another.' : ''}
      </ThemedText>
      <View style={styles.actions}>
        <FriendlyButton label={busy ? 'Saving…' : 'Accept'} disabled={busy || atLimit} onPress={onAccept} />
        <FriendlyButton label="Decline" variant="ghost" disabled={busy} onPress={onDecline} />
      </View>
    </GardenFrame>
  );
}

function OwnedCard({
  community,
  friends,
  inviting,
  busyId,
  confirming,
  onToggleInvite,
  onInvite,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  community: Community;
  friends: CommunityPerson[];
  inviting: boolean;
  busyId: string | null;
  confirming: boolean;
  onToggleInvite: () => void;
  onInvite: (friendId: string) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const memberIds = new Set(community.members.map((person) => person.id));
  const invitedIds = new Set(community.invites.map((invite) => invite.person.id));
  const available = friends.filter((friend) => !memberIds.has(friend.id) && !invitedIds.has(friend.id));

  return (
    <GardenFrame contentStyle={styles.card}>
      <ThemedText type="smallBold">{community.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {community.members.length === 1 ? 'Just you so far.' : names(community.members)}
      </ThemedText>
      {community.invites.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Waiting on {community.invites.map((invite) => invite.person.displayName).join(', ')}
        </ThemedText>
      ) : null}
      <FriendlyButton label={inviting ? 'Hide friends' : 'Invite a friend'} variant="ghost" onPress={onToggleInvite} />
      {inviting ? (
        available.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {friends.length === 0
              ? 'Add friends first, then invite them here.'
              : 'Every friend is already in this community or already invited.'}
          </ThemedText>
        ) : (
          available.map((friend) => (
            <View key={friend.id} style={styles.friendRow}>
              <View style={styles.person}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {friend.displayName}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  @{friend.username}
                </ThemedText>
              </View>
              <FriendlyButton
                label={busyId === friend.id ? 'Inviting…' : 'Invite'}
                disabled={busyId !== null}
                onPress={() => onInvite(friend.id)}
              />
            </View>
          ))
        )
      ) : null}
      {confirming ? (
        <View style={styles.actions}>
          <FriendlyButton label="Cancel" variant="ghost" disabled={busyId !== null} onPress={onCancelDelete} />
          <FriendlyButton
            label={busyId === community.id ? 'Deleting…' : 'Delete community'}
            disabled={busyId !== null}
            onPress={onDelete}
          />
        </View>
      ) : (
        <FriendlyButton label="Delete community" variant="ghost" onPress={onAskDelete} />
      )}
    </GardenFrame>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  person: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
});
