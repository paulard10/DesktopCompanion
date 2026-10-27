/**
 * Source-selected layout. All lengths here are DIP (CSS pixels in the
 * renderer), not physical pixels or Three.js world units. No runtime selector.
 *
 * Framing, hit proxy and trail offset intentionally have separate roles even
 * where their current values agree. The full animated rig has no fixed DIP box.
 * Chat anchoring and travel still use the actual live window bounds.
 */
export interface CompanionLayout {
  readonly windowDip: { readonly width: number; readonly height: number };
  readonly placementMarginDip: number;
  readonly cameraFramingDip: { readonly bodyDiameter: number };
  readonly bodyProxyDip: { readonly diameter: number };
  readonly chatBadgeDip: { readonly centerX: number; readonly centerY: number; readonly radius: number };
  readonly trailAnchorDip: { readonly bodyRadius: number };
  /** Mirrored capsules, relative to the body center. Null retains legacy input. */
  readonly armProxyDip: {
    readonly fromX: number; readonly fromY: number;
    readonly toX: number; readonly toY: number; readonly radius: number;
  } | null;
}

export const LEGACY_LAYOUT = {
  windowDip: { width: 300, height: 400 },
  placementMarginDip: 16,
  cameraFramingDip: { bodyDiameter: 160 },
  bodyProxyDip: { diameter: 160 },
  chatBadgeDip: { centerX: 262, centerY: 332, radius: 18 },
  trailAnchorDip: { bodyRadius: 80 },
  armProxyDip: null,
} as const satisfies CompanionLayout;

export const COMPACT_LAYOUT = {
  windowDip: { width: 216, height: 224 },
  placementMarginDip: 16,
  cameraFramingDip: { bodyDiameter: 108 },
  bodyProxyDip: { diameter: 108 },
  chatBadgeDip: { centerX: 190, centerY: 198, radius: 18 },
  trailAnchorDip: { bodyRadius: 54 },
  armProxyDip: { fromX: 60, fromY: 0, toX: 72, toY: 42, radius: 25 },
} as const satisfies CompanionLayout;

/** Roll back in source by selecting LEGACY_LAYOUT, then rebuild/restart. */
export const COMPANION_LAYOUT: CompanionLayout = COMPACT_LAYOUT;

/** The badge's square CSS box; the hit shape remains circular. */
export function chatBadgeBoundsDip(layout: CompanionLayout = COMPANION_LAYOUT): { x: number; y: number; width: number; height: number } {
  const badge = layout.chatBadgeDip;
  return {
    x: badge.centerX - badge.radius,
    y: badge.centerY - badge.radius,
    width: badge.radius * 2,
    height: badge.radius * 2,
  };
}
