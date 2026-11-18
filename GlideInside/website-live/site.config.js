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
  toolUrl: "plan-studio/app/",      // Glide Inside app: Open Glide Inside Residential goes straight to the editor
  heroVideoPlans: "assets/plan-creation-v2.mp4",             // e.g. "assets/plan-creation.mp4": plays muted on loop behind the button
  heroPoster: "assets/plan-creation-v2-poster.webp",
  premiumEnabled: true,
  orderUrl: "mailto:hello@glideinside.com.au?subject=Glide%20Inside%20enquiry",
  planOrderUrl: "mailto:hello@glideinside.com.au?subject=Glide%20Inside%20enquiry",
  // Builder accounts are open with a free 14 day trial (11/11/2026). The trial form is on /for-builders/#trial. The demo link goes to /book-a-demo/ (a form that posts to the enquiry endpoint).
  builderInterestUrl: "mailto:hello@glideinside.com.au?subject=Builder%20accounts%3A%20register%20interest", // no longer used by the pages; kept for old links
  trialUrl: "for-builders/#trial",
  builderDemoUrl: "book-a-demo/",
  portalLive: true,               // true shows the Builder login and Client login links (/portal/). LIVE from 11/11/2026 (the Worker needs PORTAL_ENABLED=1).
  portalEnabled: true,            // the portal page and Glide Inside client mode read this (src/config.js). REVIEW_BUILD stays false and the mock is off.
  portalMock: false,              // never true on the live site: the real Worker routes are used
  subdivisionOrderUrl: "mailto:hello@glideinside.com.au?subject=Subdivision%20quote%20request", // or a quote form inside the app
  // Tracking (leave empty until the owner creates the accounts; see docs/marketing/TRACKING.md)
  ga4Id: "G-8TLHQ55DN4",                      // GA4 Measurement ID, for example "G-XXXXXXXXXX". Empty = no analytics loaded.
  adsConversion: "",              // Google Ads purchase conversion, "AW-XXXXXXXXX/label". Empty = not sent.
  // CONCIERGE (AI booking assistant). OFF until the owner approves. The Worker also needs CONCIERGE_ENABLED=1. See growth/concierge/DESIGN.md.
  conciergeEnabled: false,
  // PLANNED monthly plans (18/11/2026), shown on the pages as "Coming soon, contact us". Documentation only, nothing reads these. Add Stripe links here when the owner approves the products.
  //   builder: Starter A$149 (10 logins, extra A$25), Pro A$249 (20, extra A$22), Teams A$449 (40, extra A$20)
  //   commercial: Solo A$50 (live), Pro A$149, Team A$349
  abn: "11 549 431 925",
  email: "hello@glideinside.com.au",
  phone: "0477 207 027"
};
