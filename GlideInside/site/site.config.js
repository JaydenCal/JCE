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
  heroVideoPlans: "",             // e.g. "assets/plan-creation.mp4" once the video exists
  heroPoster: "",
  premiumEnabled: false,          // Phase 1: Plan Pack shows "Coming soon"
  orderUrl: "../index.html#enquire",         // existing live enquiry form
  planOrderUrl: "../index.html?project=floor-plan#enquire",
  subdivisionOrderUrl: "../index.html?project=subdivision#enquire",
  email: "hello@glideinside.com.au",
  phone: "0477 207 027"
};
