import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  askPlantAssistant,
  CHAT_COUNTER_FROM,
  CHAT_MAX_CHARS,
  describeError,
  listPlantChat,
  PlantChatError,
  validateChatDraft,
  type ChatMessage,
} from '@/utils/plant-chat';

const EXAMPLE_QUESTIONS = [
  "Why might my plant's leaves be yellowing?",
  'How often should I water this?',
  'What should I do about the last photo?',
];

type PlantChatProps = {
  plantId: string;
};

export function PlantChat({ plantId }: PlantChatProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const pendingCount = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await listPlantChat(plantId);
        if (!cancelled) {
          setMessages(saved);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(describeError(error, 'Could not load your earlier chat.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plantId]);

  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const trimmedLength = draft.trim().length;
  const overLimit = draft.length > CHAT_MAX_CHARS;
  const limitReached = limitMessage !== null;
  const inputLocked = waiting || limitReached;
  const canSend = !inputLocked && trimmedLength > 0 && !overLimit;

  async function send(text: string) {
    if (waiting || limitReached) {
      return;
    }
    const checked = validateChatDraft(text);
    if (!checked.ok) {
      setSendError(checked.error);
      return;
    }

    pendingCount.current += 1;
    const pendingId = `pending-${pendingCount.current}`;
    setSendError(null);
    setDraft('');
    setWaiting(true);
    setMessages((current) => [
      ...current,
      { id: pendingId, role: 'user', content: checked.message, created_at: new Date().toISOString() },
    ]);

    try {
      const answer = await askPlantAssistant(plantId, checked.message);
      setMessages((current) => [...current, answer.message]);
      if (answer.remainingToday != null) {
        setRemaining(answer.remainingToday);
        if (answer.remainingToday <= 0) {
          setLimitMessage("That was your last question for today. You can ask more tomorrow.");
        }
      }
    } catch (error) {
      // Put the question back so it can be edited or sent again.
      setMessages((current) => current.filter((item) => item.id !== pendingId));
      setDraft(checked.message);
      if (error instanceof PlantChatError && error.status === 429) {
        setLimitMessage(error.message);
        setRemaining(0);
      } else {
        setSendError(describeError(error));
      }
    } finally {
      setWaiting(false);
    }
  }

  const empty = !loading && messages.length === 0 && !waiting;

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={scrollToEnd}>
        <View style={styles.column}>
          {loading ? (
            <ThemedText themeColor="textSecondary">Loading your chat…</ThemedText>
          ) : null}
          {loadError ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {loadError}
            </ThemedText>
          ) : null}

          {empty ? (
            <View style={styles.empty}>
              <ThemedText type="smallBold">Ask about this plant</ThemedText>
              <ThemedText themeColor="textSecondary">
                I can look at its photo and growth data. Try one of these:
              </ThemedText>
              {EXAMPLE_QUESTIONS.map((question) => (
                <Pressable
                  key={question}
                  accessibilityRole="button"
                  disabled={inputLocked}
                  onPress={() => void send(question)}
                  style={({ pressed }) => [
                    styles.example,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                    pressed && styles.pressed,
                    inputLocked && styles.disabled,
                  ]}>
                  <ThemedText style={styles.bubbleText}>{question}</ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}

          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}

          {waiting ? (
            <View
              style={[
                styles.bubble,
                styles.assistantBubble,
                styles.thinking,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}>
              <ActivityIndicator size="small" color={theme.primary} />
              <ThemedText themeColor="textSecondary" style={styles.bubbleText}>
                Thinking…
              </ThemedText>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            paddingBottom: Math.max(insets.bottom, Spacing.two),
          },
        ]}>
        <View style={styles.column}>
          {sendError ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {sendError}
            </ThemedText>
          ) : null}
          {limitMessage ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {limitMessage}
            </ThemedText>
          ) : remaining != null ? (
            <ThemedText type="small" themeColor="textSecondary">
              {remaining === 1 ? '1 question left today' : `${remaining} questions left today`}
            </ThemedText>
          ) : null}

          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                if (sendError) {
                  setSendError(null);
                }
              }}
              editable={!inputLocked}
              multiline
              placeholder={limitReached ? 'Daily limit reached' : 'Ask about this plant'}
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Message"
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.surface,
                  borderColor: overLimit ? theme.danger : theme.border,
                },
                inputLocked && styles.disabled,
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!canSend}
              onPress={() => void send(draft)}
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
                !canSend && styles.disabled,
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                Send
              </ThemedText>
            </Pressable>
          </View>

          {draft.length >= CHAT_COUNTER_FROM ? (
            <ThemedText
              type="small"
              themeColor={overLimit ? undefined : 'textSecondary'}
              style={[styles.counter, overLimit && { color: theme.danger }]}>
              {draft.length}/{CHAT_MAX_CHARS}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const theme = useTheme();
  const mine = message.role === 'user';

  return (
    <View
      style={[
        styles.bubble,
        mine ? styles.userBubble : styles.assistantBubble,
        mine
          ? { backgroundColor: theme.primary, borderColor: theme.primary }
          : { backgroundColor: theme.surface, borderColor: theme.border },
      ]}>
      <ThemedText selectable style={[styles.bubbleText, mine && { color: theme.onPrimary }]}>
        {message.content}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.two,
  },
  thread: {
    flexGrow: 1,
    width: '100%',
    padding: Spacing.three,
    paddingTop: Spacing.two,
  },
  empty: {
    gap: Spacing.two,
  },
  example: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  bubbleText: {
    // ThemedText's default type is width: '100%', which resolves against a shrink-wrapped
    // bubble and measures the line unwrapped, so it must be auto here.
    width: 'auto',
    flexShrink: 1,
    minWidth: 0,
    // Long unbroken strings (URLs, pasted text) must wrap instead of widening the bubble.
    ...(Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as object) : null),
  },
  bubble: {
    maxWidth: '85%',
    minWidth: 0,
    flexShrink: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
  },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
  },
  send: {
    minHeight: 48,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    alignSelf: 'flex-end',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
});
