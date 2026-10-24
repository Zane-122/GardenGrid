import { StyleSheet, View } from "react-native";

/** Soft light for lamps and fireplaces: a few stacked translucent discs, static so it costs nothing to draw. */
const GLOWS = {
  lamp: { color: "255, 226, 140", size: "170%", rings: [0.07, 0.07, 0.08] },
  fire: { color: "255, 140, 50", size: "170%", rings: [0.09, 0.1, 0.12] },
} as const;

/** Where the glow sits, as a percent down its parent. Raise to move it down, lower to move it up. */
const LAMP_TOP = "30%";
const FIRE_TOP = "45%";

const RING_SCALES = [1, 0.68, 0.38];

export type GlowKind = keyof typeof GLOWS;

/** Glow kind for a shop item slug, or null when the item gives off no light. */
export function glowKindFor(slug: string | null | undefined): GlowKind | null {
  if (slug === "light") {
    return "lamp";
  }
  if (slug === "fireplace") {
    return "fire";
  }
  return null;
}

/**
 * Centered on its parent's top edge (lamp) or middle (fire). Put it in a positioned parent;
 * it sizes itself as a percentage of the parent's width.
 */
export function ItemGlow({ kind, anchor = "top" }: { kind: GlowKind; anchor?: "top" | "middle" }) {
  const glow = GLOWS[kind];
  return (
    <View
      pointerEvents="none"
      style={[styles.anchor, anchor === "middle" ? styles.middle : styles.top]}
    >
      {RING_SCALES.map((scale, index) => (
        <View
          key={scale}
          style={[
            styles.disc,
            {
              width: glow.size,
              backgroundColor: `rgba(${glow.color}, ${glow.rings[index]})`,
              transform: [{ translateY: "-50%" }, { scale }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0,
    alignItems: "center",
    zIndex: 4,
  },
  top: { top: LAMP_TOP },
  middle: { top: FIRE_TOP },
  disc: {
    position: "absolute",
    aspectRatio: 1,
    borderRadius: 9999,
  },
});
