import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// This app uses static web rendering, so routes are also rendered in Node during
// `expo export`. AsyncStorage reaches for window.localStorage on web, which does not
// exist there, so the server pass runs without any session persistence at all.
const isServer = typeof window === 'undefined';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_KEY!,
  {
    auth: isServer
      ? {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        }
      : {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
  }
);

// Supabase only refreshes the access token while the app is in the foreground.
// The browser handles this on its own, so this is native-only.
if (!isServer && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
