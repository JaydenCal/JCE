/* Single place for prices, labels and links. Page copy reads these via data-cfg="key". */
window.GI_CONFIG = {
  planPackPrice: "A$35",          // PS-SCOPE-001 §4.2, per project. Confirm GST wording (decision 17.3).
  planPackCredits: "500",
  addonFlyThroughPrice: 10,       // A$, add-on to a plan
  addonRendersPrice: 10,          // A$, add-on to a plan
  // Stripe Payment Links (create in Stripe, paste URLs). Empty = button shows "not set up yet".
  stripeFlyThrough: "",           // A$10 link
  stripeRenders: "",              // A$10 link
  stripeBoth: "",                 // A$20 link (both add-ons)
  toolUrl: "plan-studio/launch/",   // change to the Pocket Architect app route when built
  heroVideoPlans: "assets/plan-creation-v2.mp4",             // e.g. "assets/plan-creation.mp4": plays muted on loop behind the button
  heroPoster: "assets/plan-creation-v2-poster.webp",
  premiumEnabled: true,
  orderUrl: "mailto:hello@glideinside.com.au?subject=Glide%20Inside%20enquiry",
  planOrderUrl: "mailto:hello@glideinside.com.au?subject=Pocket%20Architect%20enquiry",
  subdivisionOrderUrl: "mailto:hello@glideinside.com.au?subject=Subdivision%20quote%20request", // or a quote form inside the app
  // Tracking (leave empty until the owner creates the accounts; see docs/marketing/TRACKING.md)
  ga4Id: "G-8TLHQ55DN4",                      // GA4 Measurement ID, for example "G-XXXXXXXXXX". Empty = no analytics loaded.
  adsConversion: "",              // Google Ads purchase conversion, "AW-XXXXXXXXX/label". Empty = not sent.
  abn: "11 549 431 925",
  email: "hello@glideinside.com.au",
  phone: "0477 207 027"
};
