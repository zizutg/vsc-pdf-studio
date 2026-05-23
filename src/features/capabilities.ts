export type StudioFeature =
  | 'annotate'
  | 'highlight'
  | 'comment'
  | 'search'
  | 'outline'
  | 'pageNavigation'
  | 'copySelection'
  | 'formFill';

export interface CapabilitySnapshot {
  tier: 'free' | 'pro';
  features: Record<StudioFeature, boolean>;
}

export function createDefaultCapabilities(): CapabilitySnapshot {
  return {
    tier: 'free',
    features: {
      annotate: true,
      highlight: true,
      comment: true,
      search: true,
      outline: true,
      pageNavigation: true,
      copySelection: true,
      formFill: true
    }
  };
}

export function hasFeature(
  capabilities: CapabilitySnapshot,
  feature: StudioFeature
): boolean {
  return Boolean(capabilities.features[feature]);
}
