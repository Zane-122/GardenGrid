import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const DAILY_WATERING_KIND = 'daily-watering';
const WATERING_CHANNEL_ID = 'watering';

if (Platform.OS === 'ios' || Platform.OS === 'android') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Schedules a single repeating local notification at 8:00 in the device
 * timezone. The OS delivers it while the app is backgrounded or closed.
 */
export async function ensureDailyWateringNotification() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(WATERING_CHANNEL_ID, {
      name: 'Watering',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;
  if (existingStatus !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    return;
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const daily = scheduled.filter((item) => item.content.data?.kind === DAILY_WATERING_KIND);
  if (daily.length === 1) {
    return;
  }

  await Promise.all(daily.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time to water your garden',
      body: 'Open Garden Grid and mark the plants you watered today.',
      data: { kind: DAILY_WATERING_KIND },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
      channelId: WATERING_CHANNEL_ID,
    },
  });
}
