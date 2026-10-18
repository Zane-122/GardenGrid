import { Tabs } from 'expo-router/js-tabs';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { GardenPalette } from '@/constants/theme';
import { gardenMix, useGardenHalfway } from '@/hooks/use-garden-mix';
import { useTheme } from '@/hooks/use-theme';

function TabBarBackground() {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(gardenMix.value, [0, 1], [theme.surface, GardenPalette.bar]),
    borderTopColor: interpolateColor(gardenMix.value, [0, 1], [theme.border, GardenPalette.barBorder]),
  }));

  return <Animated.View style={[StyleSheet.absoluteFill, styles.tabBarBackground, style]} />;
}

export default function TabsLayout() {
  const theme = useTheme();
  const garden = useGardenHalfway();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: garden ? GardenPalette.highlight : theme.primary,
        tabBarInactiveTintColor: garden ? GardenPalette.barTextMuted : theme.textSecondary,
        tabBarLabelStyle: { fontWeight: '500', fontSize: 11 },
        tabBarItemStyle: { paddingHorizontal: 0 },
        tabBarBackground: () => <TabBarBackground />,
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Garden',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'leaf.fill', android: 'eco', web: 'eco' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="grid"
        options={{
          title: 'Grid',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="water"
        options={{
          title: 'Water',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarBackground: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
