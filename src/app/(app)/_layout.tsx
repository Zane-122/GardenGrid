import AppTabs from '@/components/app-tabs';
import { useRequestGardenLocation } from '@/hooks/use-request-garden-location';

export default function AppLayout() {
  useRequestGardenLocation();
  return <AppTabs />;
}
