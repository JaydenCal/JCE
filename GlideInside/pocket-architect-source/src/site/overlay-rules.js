// What each mapped constraint typically means and the usual next steps, for the "Site constraints (indicative)" card.
// Ported from the JCESite constraints agent (branch claude/jcesite-stage8, cadastral-platform/backend/app/agents/sa9_constraints/rules_nsw_qld.json).
// JCESite marks those rules as SKELETONS: "values are unresolved until supplied from cited documents. Never treat as fact." So every line here is
// worded as what MAY apply, never as a finding, and every row ends in the council instruction below. Never state that a design complies with anything.

export const INSTRUCTION = {
  NSW: 'Obtain the s10.7 planning certificate (EP&A Act) for the lot and confirm with the council.',
  QLD: 'Obtain the council property or planning report (and check the SARA DA mapping) for the lot.',
};

// Plain words for the consequence codes in the JCESite rules.
const WORDS = {
  flood_planning_level: 'a flood planning level', freeboard: 'freeboard above it', floor_level: 'a minimum floor level', fill: 'limits on filling', materials: 'flood compatible materials',
  evacuation: 'an evacuation or flood emergency response', da_requirement: 'a development application',
  bal_assessment_as3959: 'a bushfire attack level (BAL) assessment to AS 3959', pbp_compliance: 'the Planning for Bushfire Protection requirements', spp_bushfire_hazard: 'the State Planning Policy bushfire hazard requirements',
  asset_protection_zone: 'an asset protection zone', rfs_referral: 'a referral to the Rural Fire Service',
  heritage_impact_statement: 'a heritage impact statement', referral: 'a referral to another authority',
  ass_management_plan: 'an acid sulfate soils management plan', work_below_rl: 'consent for works below a mapped level',
  bdar: 'a biodiversity development assessment report', boc_threshold: 'a biodiversity offsets scheme threshold test', ecological_assessment: 'an ecological assessment', offset: 'offsets',
  height_limit: 'a height limit', noise_attenuation: 'noise attenuation to the building',
  coastal_assessment: 'a coastal assessment', controlled_activity_approval: 'a controlled activity approval', riparian_setback: 'a riparian setback',
  acquiring_authority: 'an acquiring authority interest', subsidence_board_approval: 'Subsidence Advisory NSW approval',
  sepp_applicability: 'SEPP provisions', satisfactory_arrangements: 'satisfactory arrangements for infrastructure', geotechnical_assessment: 'a geotechnical assessment',
  minimum_lot_size: 'a minimum lot size', maximum_height: 'a maximum height', maximum_fsr: 'a maximum floor space ratio',
};

// Rules keyed by overlay id (the id used by /api/site/overlays). `rule` is the JCESite rule id each one came from.
const R = (rule, title, consequences, nextSteps, pathway) => ({ rule, title, consequences, nextSteps, pathway });
export const RULES = {
  flood: R('flood.fpl', 'Flood affected lot', ['flood_planning_level', 'freeboard', 'floor_level', 'fill', 'materials', 'evacuation', 'da_requirement'],
    ['Request flood information from council', 'A flood engineer may be needed if council requires one'], 'A development application with a flood assessment may be needed.'),
  bushfire: R('bushfire.bal', 'Bushfire prone land', ['bal_assessment_as3959', 'pbp_compliance', 'asset_protection_zone', 'rfs_referral'],
    ['Commission a BAL assessment (AS 3959) by an accredited practitioner', 'NSW: check Planning for Bushfire Protection; integrated development may need an RFS bush fire safety authority', 'QLD: check the State Planning Policy bushfire hazard'], 'Integrated development or a referral may apply.'),
  heritage_item: R('heritage.hia', 'Heritage item', ['heritage_impact_statement', 'referral', 'da_requirement'], ['Prepare a heritage impact statement', 'Seek pre-lodgement advice from the council heritage adviser'], 'A development application and a referral may be needed.'),
  heritage_conservation: R('heritage.hia', 'Heritage conservation area', ['heritage_impact_statement', 'da_requirement'], ['Prepare a heritage impact statement', 'Seek pre-lodgement advice from the council heritage adviser'], 'A development application may be needed.'),
  acid_sulfate: R('ass.plan', 'Acid sulfate soils', ['ass_management_plan', 'work_below_rl'], ['Confirm the class and the works depth thresholds', 'Prepare an acid sulfate soils management plan if works disturb the affected soil'], 'Consent for works below a mapped level may be needed.'),
  biodiversity: R('biodiversity.assess', 'Biodiversity values', ['bdar', 'boc_threshold', 'ecological_assessment', 'offset'], ['Engage an accredited assessor to confirm whether a biodiversity assessment is needed'], 'A referral or offsets may apply.'),
  coastal: R('coastal', 'Coastal wetlands', ['coastal_assessment', 'referral', 'da_requirement'], ['Confirm the SEPP Resilience and Hazards coastal provisions with council'], 'A development application and a referral may be needed.'),
  coastal_env: R('coastal', 'Coastal environment area', ['coastal_assessment', 'referral', 'da_requirement'], ['Confirm the SEPP Resilience and Hazards coastal provisions with council'], 'A development application may be needed.'),
  riparian: R('riparian', 'Riparian land or watercourse', ['controlled_activity_approval', 'riparian_setback'], ['Confirm any riparian setback and whether a controlled activity approval is needed'], 'Approval from the water regulator may apply.'),
  land_reservation: R('reservation', 'Land reserved for acquisition', ['acquiring_authority', 'da_requirement'], ['Confirm the acquiring authority and what development is allowed on the land'], 'A development application may be needed.'),
  airport: R('airport.limits', 'Airport noise', ['height_limit', 'noise_attenuation', 'referral'], ['Confirm the ANEF contour and any noise requirements with the airport operator and council'], 'A referral to the airport operator may apply.'),
  ols: R('airport.limits', 'Airport obstacle limitation surface', ['height_limit', 'referral'], ['Confirm the obstacle limitation surface height with the airport operator and council'], 'A referral to the airport operator may apply.'),
  mine_subsidence: R('mine_subsidence', 'Mine subsidence district', ['subsidence_board_approval'], ['Confirm Subsidence Advisory NSW requirements before design is finalised'], 'Approval from Subsidence Advisory NSW may apply.'),
  sepp_area: R('sepp', 'SEPP mapped area', ['sepp_applicability'], ['Confirm which SEPP provisions apply to the lot'], 'SEPP provisions may apply.'),
  urban_release: R('urban_release', 'Urban release area', ['satisfactory_arrangements'], ['Confirm infrastructure contribution requirements with council'], 'Satisfactory arrangements may be needed before subdivision.'),
  landslide: R('landslide', 'Landslide risk land', ['geotechnical_assessment', 'da_requirement'], ['A geotechnical assessment may be needed'], 'A development application may be needed.'),
  easement: R('easement', 'Easement', [], ['Confirm the easement width, purpose and the benefited authority from the registered plan and title', 'Building over an easement usually needs the authority consent'], ''),
  lot_size: R('controls', 'Minimum lot size map', ['minimum_lot_size'], ['Confirm the LEP clause and any exceptions that apply'], ''),
  height: R('controls', 'Height of buildings map', ['maximum_height'], ['Confirm the LEP height clause and how height is measured'], ''),
  fsr: R('controls', 'Floor space ratio map', ['maximum_fsr'], ['Confirm the LEP floor space ratio clause and what counts as floor space'], ''),
  contamination: R('contamination', 'Contaminated land', [], ['Check the s10.7 certificate and the EPA record'], ''),
  transport_corridor: R('transport', 'Transport corridor', [], ['Check with Transport for NSW and council'], ''),
};

const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** { means, steps, pathway, instruction } for an affected overlay, or null. Always indicative wording. */
export function ruleFor(id, state) {
  const r = RULES[id];
  if (!r) return null;
  const words = r.consequences.map((c) => WORDS[c]).filter(Boolean);
  return {
    title: r.title,
    means: words.length ? `This may mean ${list(words)}.${r.pathway ? ` ${r.pathway}` : ''}` : r.pathway || '',
    steps: r.nextSteps.filter((s) => !/^(NSW|QLD):/.test(s) || s.startsWith(`${state}:`)).map((s) => s.replace(/^(NSW|QLD):\s*/, '').replace(/^./, (c) => c.toUpperCase())),
    instruction: INSTRUCTION[state] || INSTRUCTION.NSW,
  };
}
