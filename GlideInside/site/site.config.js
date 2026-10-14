/* Single place for prices, labels and links. Page copy reads these via data-cfg="key". */
window.GI_CONFIG = {
  planPackPrice: "A$35",          // PS-SCOPE-001 §4.2, per project. Confirm GST wording (decision 17.3).
  planPackCredits: "500",
  addonFlyThroughPrice: 5,        // A$, add-on to a plan
  addonRendersPrice: 10,          // A$, add-on to a plan
  // Stripe Payment Links (create in Stripe, paste URLs). Empty = button shows "not set up yet".
  stripeFlyThrough: "",           // A$5 link
  stripeRenders: "",              // A$10 link
  stripeBoth: "",                 // A$15 link (both add-ons)
  toolUrl: "plan-studio/launch/",   // change to the Pocket Architect app route when built
  heroVideoPlans: "assets/plan-creation.mp4",             // e.g. "assets/plan-creation.mp4": plays muted on loop behind the button
  heroPoster: "assets/plan-creation-poster.webp",
  premiumEnabled: true,
  orderUrl: "mailto:hello@glideinside.com.au?subject=Glide%20Inside%20enquiry",
  planOrderUrl: "mailto:hello@glideinside.com.au?subject=Pocket%20Architect%20enquiry",
  email: "hello@glideinside.com.au",
  phone: "0477 207 027"
};
