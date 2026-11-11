// Attribution and accuracy wording for the site layers. One place, used on screen (2D plan and panel) and on the PDF sheets.
//
// Licence record (checked 11/11/2026 from the public pages named here; see docs/SITE_LOOKUP.md for what is still unconfirmed)
//   NSW cadastre (DCDB / NSW Cadastre web service)  CC BY. data.nsw.gov.au lists "Creative Commons Attribution"; the LPI statement
//                                                     on the OpenStreetMap wiki gives CC BY 3.0 Australia for the DCDB and NSW Imagery.
//   NSW imagery                                       LPI lists CC BY 3.0 AU, but the service metadata says it includes third party imagery
//                                                     (AAM, Jacobs Group Ausimage, Landsat) and states no licence. Credit text is kept; verify terms.
//   NSW 5 m DEM                                       copyright "DFSI 2019", no licence stated in the service metadata.
//   NSW land zoning                                   NSW Planning Portal, licence not checked.
//   QLD cadastral parcels                             CC BY 4.0 (Queensland Spatial Catalogue record "Cadastral data - Queensland series").
//   QLD imagery (LatestStateProgram_AllUsers)         service says CC BY-SA, BUT it includes Planet satellite fill "reproduced under licence from
//                                                     Planet and Geoplex, all rights reserved". Only SISP aerial three years or older is open, so
//                                                     the server uses QLD imagery only where the item shown is such aerial (see server/lib/site.js).
//   QLD DEM (QldDem)                                  licence not stated by the service; CC BY-SA is the owner's instruction (docs, 15/10/2026).

const NSW_CADASTRE = '(c) State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW), Lot boundaries, CC BY 3.0 AU.';
const QLD_CADASTRE = '(c) State of Queensland (Department of Resources), Cadastral parcels, CC BY 4.0. The State of Queensland gives no warranty for this data and accepts no liability for any loss arising from its use.';

export const INDICATIVE = 'Boundaries are from the cadastre and are indicative only. A registered survey is required for design, approval or construction.';

// Lines to print under the plan: [{ id, text }]. `lot` is site.lot.
export function siteCredits(lot) {
  if (!lot) return [];
  const out = [];
  out.push({ id: 'cadastre', text: lot.state === 'QLD' ? QLD_CADASTRE : NSW_CADASTRE });
  if (lot.state === 'NSW' && lot.zoning) out.push({ id: 'zoning', text: 'Land zoning: NSW Department of Planning, Housing and Infrastructure (Planning Portal).' });
  const a = lot.provenance?.aerial;
  if (lot.aerial && a?.attribution) out.push({ id: 'aerial', text: `${a.attribution}${a.captureDate ? ` Captured ${a.captureDate}.` : ' Capture date not stated.'}` });
  const e = lot.provenance?.elevation;
  if (lot.contours?.length || lot.terrain) out.push({ id: 'contours', text: contourNote(e) });
  return out;
}

// "NSW 5 m DEM, indicative only; detailed survey required" plus the accuracy the service states (or that it does not state one).
export function contourNote(e) {
  if (!e) return 'Ground levels: source not stated, indicative only; detailed survey required.';
  const res = e.resolutionM ? `${e.resolutionM} m ` : '';
  const acc = e.accuracy ? ` Vertical accuracy: ${e.accuracy}.` : '';
  const base = e.note || `${e.source || 'Digital elevation model'}, indicative only; detailed survey required`;
  return `Contours: ${base.replace(/\.$/, '')}.${res && !/\bm DEM\b/.test(base) ? '' : ''}${acc}${e.datum ? ` Datum: ${e.datum}.` : ''}`;
}

// One line for a sheet footer.
export function creditsOneLine(lot) {
  return siteCredits(lot).map((c) => c.text).join('  ');
}
