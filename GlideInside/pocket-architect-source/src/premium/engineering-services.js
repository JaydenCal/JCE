// Engineering services that JCE Infrastructure fulfils, offered from the "Order engineering" panel and listed on the siting report.
// THE OWNER EDITS THIS FILE. Each service has an indicative "from" price in AUD, GST excluded.
// EVERY PRICE BELOW IS A PLACEHOLDER: price to confirm. Until the owner sets a price the UI shows "Request a quote" and no figure.
//
//   priceFromAud     the indicative starting price, whole dollars
//   priceToConfirm   true  = the price above is only a placeholder. The panel shows "Request a quote" and no price.
//                    false = the owner has confirmed the price. The panel then shows "From $X, GST excluded".
//   need             what the enquiry form's "What do you need?" is set to: 'engineering', 'da' or 'both' (the server only accepts these)
//
// To publish a price: change priceFromAud and set priceToConfirm to false. Nothing is sent when someone picks a service. The enquiry form
// opens with the service filled in, and the person must tick the consent box and press Send.

export const ENGINEERING_SERVICES = [
  { id: 'site-classification-footings', label: 'Site classification and footing design', blurb: 'Soil class to AS 2870 from the geotechnical report, and footing and slab design for the chosen house.', need: 'engineering', priceFromAud: 950, priceToConfirm: true },
  { id: 'stormwater-concept', label: 'Stormwater concept', blurb: 'Roof and site drainage concept with the discharge point, ready for the approval.', need: 'engineering', priceFromAud: 750, priceToConfirm: true },
  { id: 'driveway-long-section', label: 'Driveway long section', blurb: 'Long section of the driveway and crossover with grades checked against the council standard.', need: 'engineering', priceFromAud: 450, priceToConfirm: true },
  { id: 'retaining-wall-design', label: 'Retaining wall design', blurb: 'Engineered retaining walls where the site falls or the batter does not fit.', need: 'engineering', priceFromAud: 850, priceToConfirm: true },
  { id: 'civil-plans-da', label: 'Civil plans for DA', blurb: 'Civil engineering plans for the development application: levels, drainage, driveway and erosion control.', need: 'da', priceFromAud: 1800, priceToConfirm: true },
  { id: 'flood-bushfire-coordination', label: 'Flood or bushfire report coordination', blurb: 'We coordinate the flood or bushfire report the council asks for, with the specialist consultant.', need: 'da', priceFromAud: 450, priceToConfirm: true },
];

export const SERVICE_BY_ID = Object.fromEntries(ENGINEERING_SERVICES.map((s) => [s.id, s]));

/** The text the UI shows for the price: "Request a quote" until the owner has confirmed the price. */
export function priceLabel(service) {
  if (!service || service.priceToConfirm !== false || !Number.isFinite(service.priceFromAud)) return 'Request a quote';
  return `From $${service.priceFromAud.toLocaleString('en-AU')}, GST excluded`;
}

export const serviceHeadline = (s) => s.blurb;

/**
 * What the enquiry form is opened with for a service: { need, notes }. Only text for the form fields. Sending needs the person's consent.
 */
export function enquiryPrefill(service) {
  if (!service) return {};
  const price = service.priceToConfirm !== false ? 'Price to be quoted.' : `Listed price: ${priceLabel(service)}.`;
  return { need: service.need, notes: `Service requested: ${service.label}. ${price}` };
}
