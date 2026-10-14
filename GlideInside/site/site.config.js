/* Single place for prices, labels and links. Page copy reads these via data-cfg="key". */
window.GI_CONFIG = {
  planPackPrice: "A$30",          // PS-SCOPE-001 §4.2, per project. Confirm GST wording (decision 17.3).
  planPackCredits: "500",
  addonFlyThroughPrice: 5,        // A$, add-on to a plan
  addonRendersPrice: 10,          // A$, add-on to a plan
  // Stripe Payment Links (create in Stripe, paste URLs). Empty = button shows "not set up yet".
  stripeFlyThrough: "",           // A$5 link
  stripeRenders: "",              // A$10 link
  stripeBoth: "",                 // A$15 link (both add-ons)
  signupUrl: "",                  // account registration in the app
  stripePlan: "",                 // A$30 Payment Link; enable adjustable quantity in Stripe so people can buy several plans at once
  toolUrl: "plan-studio/index.html#example",   // change to the Pocket Architect app route when built
  heroVideoPlans: "",             // e.g. "assets/plan-creation.mp4": plays muted on loop behind the button
  heroPoster: "",
  premiumEnabled: false,          // Phase 1: Plan Pack shows "Coming soon"
  orderUrl: "mailto:hello@glideinside.com.au?subject=Glide%20Inside%20enquiry",
  planOrderUrl: "mailto:hello@glideinside.com.au?subject=Pocket%20Architect%20enquiry",
  subdivisionOrderUrl: "mailto:hello@glideinside.com.au?subject=Subdivision%20quote%20request"  // or a quote form/route inside the app,
  email: "hello@glideinside.com.au",
  phone: "0477 207 027"
};
