// Brand and feature configuration. The host website overrides these (docs/SCOPE.md 12.10).
const hasWindow = typeof window !== 'undefined';
const params = hasWindow ? new URLSearchParams(window.location.search) : new URLSearchParams();
const isLocal = hasWindow && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

// false by default so a production build keeps the builder and client features closed until launch. Set true only for the
// mock/review build the owner looks at (it also turns the in-browser mock on). To open the real portal, the host page sets
// GI_CONFIG.portalEnabled = true (and the Worker needs PORTAL_ENABLED=1). See docs/PORTAL_API.md, "Going live".
const REVIEW_BUILD = false;

export const CONFIG = {
  productName: 'Pocket Architect',
  // Selling entity printed on paid exports. Placeholder until decision 17.1 is made.
  seller: { name: 'JCE Infrastructure Pty Ltd trading as Glide Inside', abn: '29 699 165 663' },
  // Same origin: the Cloudflare Worker is routed at glideinside.com.au/api/* (one site, no CORS, cookie sessions stay same-site).
  apiBase: '/api',
  aiMock: false, // true serves canned assistant replies in the browser (review builds only)
  premiumEnabled: false, // Phase 1: premium shows as "coming soon" until the back end is live
  planPack: { priceAud: 35, gstInclusive: true, credits: 500, reexportMonths: 12 },
  links: {
    engineering: '', // engineering enquiry URL (configurable)
    flythrough: '',
    terms: '',
    privacy: '',
  },
  // Site lookup ("Find my block"): address search, lot boundary, DCDB neighbours, aerial and LiDAR/DEM contours (docs/SITE_LOOKUP.md).
  // siteMock true serves recorded-shape SAMPLE data from src/site/fixtures/ without calling the API (tests and review builds only).
  siteLookupEnabled: true,
  siteMock: false,
  // Setback rules are served statically from the site, one file per council (see tools/split-setbacks.mjs). Relative to the app page.
  setbacksBase: '../data/setbacks/',
  siteAerialMarginM: 30, // aerial and elevation grid extend this far beyond the lot boundary
  // Builder and client accounts (docs/PORTAL_API.md). While the back end does not exist the portal runs on the in-browser mock.
  // portalMock true runs the screens on the in-browser mock; false calls the real Worker routes (docs/PORTAL_API.md).
  // The host page can pick with GI_CONFIG.portalMock. Default: the mock only in the review build.
  portalMock: hasWindow && typeof window.GI_CONFIG?.portalMock === 'boolean' ? window.GI_CONFIG.portalMock : REVIEW_BUILD,
  // Builder and client features (portal page, client mode in Pocket Architect). Off in the production config until launch;
  // on in the mock/review build. The host site can set GI_CONFIG.portalEnabled = true to open it.
  portalEnabled: hasWindow && typeof window.GI_CONFIG?.portalEnabled === 'boolean' ? window.GI_CONFIG.portalEnabled : REVIEW_BUILD,
  portal: {
    appUrl: './', // Pocket Architect, relative to the portal page; the site sets GI_CONFIG.portalAppUrl
    signInUrl: '../../portal/', // the portal sign in page, relative to Pocket Architect; the site sets GI_CONFIG.portalSignInUrl
    clientLoginFeeAud: 35, // per NEW client login in a calendar month, incl. GST
    aiTopUp: { credits: 300, priceAud: 10 }, // incl. GST, charged on the end of month invoice
    aiMonthlyCredits: 300, // per login per month, hard stop at zero
  },
  // The Glide Inside home page, relative to Pocket Architect: where Back goes when nothing else is known. The site can set GI_CONFIG.homeUrl.
  homeUrl: (hasWindow && typeof window.GI_CONFIG?.homeUrl === 'string' && window.GI_CONFIG.homeUrl) || '../../index.html',
  autosaveKey: 'ps.autosave.v1',
  embedMode: params.get('embed') === 'demo' ? 'demo' : 'full',
  // Unlocks client-side exports for local testing only. Never true in production.
  devUnlock: isLocal && params.has('dev'),
  // STAGING ONLY: the staging site sets GI_CONFIG.staging = true. The app then asks the server for a free test Plan Pack, and the server
  // only hands one out when it runs with STAGING=1 (health reports devGrant). On the live Worker neither side exists.
  stagingGrant: hasWindow && window.GI_CONFIG?.staging === true,
  disclaimer:
    'Concept design only. Not for construction. Not a development application or complying development drawing. Not checked against planning controls, the National Construction Code or BASIX. Verify all dimensions on site.',
};
