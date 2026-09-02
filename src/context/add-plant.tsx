import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { PlantBasicInfo, PlantSimilarImage } from '@/utils/plants';

export type PlantPreview = {
  info: PlantBasicInfo;
  fallbackName?: string;
  probability?: number | null;
  similarImages?: PlantSimilarImage[];
};

type AddPlantContextValue = {
  preview: PlantPreview | null;
  setPreview: (preview: PlantPreview | null) => void;
};

const AddPlantContext = createContext<AddPlantContextValue | null>(null);

export function AddPlantProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<PlantPreview | null>(null);
  const value = useMemo(() => ({ preview, setPreview }), [preview]);

  return <AddPlantContext.Provider value={value}>{children}</AddPlantContext.Provider>;
}

export function useAddPlant() {
  const context = useContext(AddPlantContext);
  if (!context) {
    throw new Error('useAddPlant must be used inside AddPlantProvider');
  }
  return context;
}
