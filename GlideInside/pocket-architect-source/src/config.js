// Brand and feature configuration. The host website overrides these (docs/SCOPE.md 12.10).
const hasWindow = typeof window !== 'undefined';
const params = hasWindow ? new URLSearchParams(window.location.search) : new URLSearchParams();
const isLocal = hasWindow && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export const CONFIG = {
  productName: 'Plan Studio',
  // Selling entity printed on paid exports. Placeholder until decision 17.1 is made.
  seller: { name: 'Glide Inside', abn: '' },
  apiBase: '/api',
  premiumEnabled: false, // Phase 1: premium shows as "coming soon" until the back end is live
  planPack: { priceAud: 30, gstInclusive: true, credits: 500, reexportMonths: 12 },
  links: {
    engineering: '', // engineering enquiry URL (configurable)
    flythrough: '',
    terms: '',
    privacy: '',
  },
  autosaveKey: 'ps.autosave.v1',
  embedMode: params.get('embed') === 'demo' ? 'demo' : 'full',
  // Unlocks client-side exports for local testing only. Never true in production.
  devUnlock: isLocal && params.has('dev'),
  disclaimer:
    'Concept design only. Not for construction. Not a development application or complying development drawing. Not checked against planning controls, the National Construction Code or BASIX. Verify all dimensions on site.',
};
