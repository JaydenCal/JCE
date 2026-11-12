/* Single place for prices, labels and links. Page copy reads these via data-cfg="key". */
window.GI_CONFIG = {
  planPackPrice: "A$30",          // PS-SCOPE-001 §4.2, per project. Confirm GST wording (decision 17.3).
  planPackCredits: "500",
  addonFlyThroughPrice: 10,       // A$, add-on to a plan
  addonRendersPrice: 10,          // A$, add-on to a plan
  // Stripe Payment Links (create in Stripe, paste URLs). Empty = button shows "not set up yet".
  stripeFlyThrough: "",           // A$10 link
  stripeRenders: "",              // A$10 link
  stripeBoth: "",                 // A$20 link (both add-ons)
  toolUrl: "plan-studio/app/",      // Pocket Architect app: Open Pocket Architect goes straight to the editor
  heroVideoPlans: "assets/plan-creation-v2.mp4",             // e.g. "assets/plan-creation.mp4": plays muted on loop behind the button
  heroPoster: "assets/plan-creation-v2-poster.webp",
  premiumEnabled: true,
  orderUrl: "mailto:hello@glideinside.com.au?subject=Glide%20Inside%20enquiry",
  planOrderUrl: "mailto:hello@glideinside.com.au?subject=Pocket%20Architect%20enquiry",
  // Builder accounts are open with a free 14 day trial (11/11/2026). The trial form is on /for-builders/#trial. The demo link goes to /book-a-demo/ (a form that posts to the enquiry endpoint).
  builderInterestUrl: "mailto:hello@glideinside.com.au?subject=Builder%20accounts%3A%20register%20interest", // no longer used by the pages; kept for old links
  trialUrl: "for-builders/#trial",
  builderDemoUrl: "book-a-demo/",
  portalLive: true,               // true shows the Builder login and Client login links (/portal/). LIVE from 11/11/2026 (the Worker needs PORTAL_ENABLED=1).
  portalEnabled: true,            // the portal page and Pocket Architect client mode read this (src/config.js). REVIEW_BUILD stays false and the mock is off.
  portalMock: false,              // never true on the live site: the real Worker routes are used
  subdivisionOrderUrl: "mailto:hello@glideinside.com.au?subject=Subdivision%20quote%20request", // or a quote form inside the app
  // Tracking (leave empty until the owner creates the accounts; see docs/marketing/TRACKING.md)
  ga4Id: "G-8TLHQ55DN4",                      // GA4 Measurement ID, for example "G-XXXXXXXXXX". Empty = no analytics loaded.
  adsConversion: "",              // Google Ads purchase conversion, "AW-XXXXXXXXX/label". Empty = not sent.
  abn: "29 699 165 663",
  email: "hello@glideinside.com.au",
  phone: "0477 207 027"
};
