import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GardenFrame } from '@/components/app/garden-frame';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listUserPlants, plantDisplayName, type InventoryPlant } from '@/utils/plants';
import {
  isScheduledWateringDay,
  listLatestWateringDates,
  listWateringLogs,
  localDateKey,
  plantWateringSchedule,
  type PlantWateringStatus,
} from '@/utils/watering';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function monthCells(year: number, month: number) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(localDateKey(new Date(year, month, day)));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

function monthTitle(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function dayTitle(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function dayNumber(dateKey: string) {
  return Number(dateKey.slice(8));
}

export default function WateringCalendarScreen() {
  const theme = useTheme();
  const today = localDateKey();
  const initial = new Date();
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [selected, setSelected] = useState(today);
  const [plants, setPlants] = useState<InventoryPlant[]>([]);
  const [logsByDay, setLogsByDay] = useState<Record<string, string[]>>({});
  const [schedules, setSchedules] = useState<Map<string, PlantWateringStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const from = localDateKey(new Date(year, month, 1));
    const to = localDateKey(new Date(year, month + 1, 0));
    try {
      const [nextPlants, logs, latestWatered] = await Promise.all([
        listUserPlants(),
        listWateringLogs(from, to),
        listLatestWateringDates(),
      ]);
      const grouped: Record<string, string[]> = {};
      for (const log of logs) {
        grouped[log.wateredOn] ??= [];
        grouped[log.wateredOn].push(log.plantId);
      }
      const nextSchedules = new Map<string, PlantWateringStatus>();
      for (const plant of nextPlants) {
        nextSchedules.set(plant.id, plantWateringSchedule(plant, latestWatered.get(plant.id) ?? null, today));
      }
      setPlants(nextPlants);
      setLogsByDay(grouped);
      setSchedules(nextSchedules);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the watering calendar');
    } finally {
      setLoading(false);
    }
  }, [month, today, year]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function shiftMonth(offset: number) {
    const next = new Date(year, month + offset, 1);
    const nextYear = next.getFullYear();
    const nextMonth = next.getMonth();
    setYear(nextYear);
    setMonth(nextMonth);
    setLoading(true);
    const todayDate = new Date();
    if (todayDate.getFullYear() === nextYear && todayDate.getMonth() === nextMonth) {
      setSelected(localDateKey(todayDate));
    } else {
      setSelected(localDateKey(next));
    }
  }

  const weeks = monthCells(year, month);
  const plantsById = new Map(plants.map((plant) => [plant.id, plant]));
  const wateredIds = logsByDay[selected] ?? [];
  const wateredPlants = wateredIds
    .map((id) => plantsById.get(id))
    .filter((plant): plant is InventoryPlant => plant != null);
  const scheduledPlants = plants.filter((plant) => {
    const schedule = schedules.get(plant.id);
    return schedule != null && isScheduledWateringDay(schedule, selected) && !wateredIds.includes(plant.id);
  });

  function scheduledIdsOn(dateKey: string) {
    const watered = new Set(logsByDay[dateKey] ?? []);
    return plants.filter((plant) => {
      const schedule = schedules.get(plant.id);
      return schedule != null && isScheduledWateringDay(schedule, dateKey) && !watered.has(plant.id);
    });
  }

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.hello}>
          <ThemedText type="heading">Watering</ThemedText>
          <ThemedText themeColor="textSecondary">
            {loading
              ? 'Loading the month…'
              : 'Filled dots are days you watered. Open dots are upcoming waterings.'}
          </ThemedText>
        </View>

        {error ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        ) : null}

        <GardenFrame variant="bed" fill style={styles.calendarFrame} contentStyle={styles.calendar}>
          <View style={styles.monthRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              hitSlop={8}
              onPress={() => shiftMonth(-1)}
              style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}>
              <SymbolView
                name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                tintColor={theme.text}
                size={18}
              />
            </Pressable>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.monthTitle}>
              {monthTitle(year, month)}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              hitSlop={8}
              onPress={() => shiftMonth(1)}
              style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                tintColor={theme.text}
                size={18}
              />
            </Pressable>
          </View>

          <View style={styles.week}>
            {WEEKDAYS.map((label, index) => (
              <ThemedText key={`${label}-${index}`} type="small" themeColor="textSecondary" style={styles.weekday}>
                {label}
              </ThemedText>
            ))}
          </View>

          {weeks.map((week, weekIndex) => (
            <View key={weekIndex} style={styles.weekRow}>
              {week.map((dateKey, dayIndex) => {
                if (!dateKey) {
                  return <View key={`empty-${weekIndex}-${dayIndex}`} style={styles.day} />;
                }

                const wateredCount = logsByDay[dateKey]?.length ?? 0;
                const scheduledCount = scheduledIdsOn(dateKey).length;
                const isSelected = dateKey === selected;
                const isToday = dateKey === today;
                return (
                  <Pressable
                    key={dateKey}
                    accessibilityRole="button"
                    accessibilityLabel={`${dayTitle(dateKey)}, ${wateredCount} watered, ${scheduledCount} scheduled`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setSelected(dateKey)}
                    style={({ pressed }) => [
                      styles.day,
                      isSelected && { backgroundColor: theme.backgroundSelected, borderColor: theme.wood },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={isToday ? { color: theme.oxygen } : undefined}
                      themeColor={isSelected ? 'text' : undefined}>
                      {dayNumber(dateKey)}
                    </ThemedText>
                    <View style={styles.marks}>
                      {wateredCount > 0 ? (
                        <View style={[styles.mark, { backgroundColor: theme.primary }]} />
                      ) : null}
                      {scheduledCount > 0 ? (
                        <View style={[styles.mark, styles.scheduledMark, { borderColor: theme.oxygen }]} />
                      ) : null}
                      {wateredCount === 0 && scheduledCount === 0 ? <View style={styles.markSpacer} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </GardenFrame>

        <GardenFrame variant="bed" fill style={styles.detailFrame} contentStyle={styles.detail}>
          <ThemedText type="smallBold">{dayTitle(selected)}</ThemedText>
          {wateredPlants.length === 0 && scheduledPlants.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              {selected < today ? 'No plants were marked watered.' : 'No plants are scheduled.'}
            </ThemedText>
          ) : (
            <ScrollView style={styles.plantList} contentContainerStyle={styles.plantListContent}>
              {scheduledPlants.length > 0 ? (
                <ThemedText themeColor="textSecondary">
                  {selected < today
                    ? `${scheduledPlants.length} missed`
                    : selected === today
                      ? `${scheduledPlants.length} need water`
                      : `${scheduledPlants.length} scheduled`}
                </ThemedText>
              ) : null}
              {scheduledPlants.map((plant) => (
                <View key={`due-${plant.id}`} style={styles.plantRow}>
                  <View style={[styles.drop, styles.scheduledDrop, { borderColor: theme.oxygen }]} />
                  <ThemedText>{plantDisplayName(plant.info)}</ThemedText>
                </View>
              ))}
              {wateredPlants.length > 0 ? (
                <ThemedText themeColor="textSecondary">
                  {wateredPlants.length} watered
                </ThemedText>
              ) : null}
              {wateredPlants.map((plant) => (
                <View key={plant.id} style={styles.plantRow}>
                  <View style={[styles.drop, { backgroundColor: theme.primary }]} />
                  <ThemedText>{plantDisplayName(plant.info)}</ThemedText>
                </View>
              ))}
            </ScrollView>
          )}
        </GardenFrame>
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
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  hello: {
    gap: Spacing.half,
  },
  calendarFrame: {
    flex: 3,
  },
  calendar: {
    gap: Spacing.two,
  },
  weekRow: {
    flex: 1,
    flexDirection: 'row',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    flex: 1,
    textAlign: 'center',
  },
  week: {
    flexDirection: 'row',
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
  },
  day: {
    flex: 1,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  marks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 6,
  },
  mark: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  scheduledMark: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  markSpacer: {
    width: 6,
    height: 6,
  },
  detailFrame: {
    flex: 2,
  },
  detail: {
    gap: Spacing.two,
  },
  plantList: {
    flex: 1,
  },
  plantListContent: {
    gap: Spacing.two,
  },
  plantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  drop: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scheduledDrop: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
