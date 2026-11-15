// Tool definitions for the commercial assistant. Light on purpose (no commercial geometry, no JSON data): the Worker imports this file
// to send the tool list to the model and to check what comes back. The functions that run each tool live in commercial-ops.js and are
// attached in the browser only. Same shape as the housing registry: { label, description, params, required }.

import { CLADDING, DOORS } from '../../commercial/finishes.js';
import { FRONT_WINDOWS, DOOR_PRESETS } from '../../commercial/schema.js';

const P = {
  num: (description) => ({ type: 'number', description }),
  str: (description) => ({ type: 'string', description }),
  bool: (description) => ({ type: 'boolean', description }),
  enm: (values, description) => ({ type: 'string', enum: values, description }),
  obj: (description, properties = {}) => ({ type: 'object', description, properties }),
};

export const LAYOUT_IDS = Object.freeze(['best', 'row-6', 'row-10', 'b2b-12', 'b2b-16', 'court-20', 'large-6']);
export const GOALS = Object.freeze(['max_gfa', 'max_units', 'max_margin', 'min_cost']);
export const FEASIBILITY_KEYS = Object.freeze(['saleRate', 'rentRate', 'yieldPct', 'landRate', 'buildRate', 'siteRate', 'landscapeRate', 'feesPct', 'contPct', 'outgoingsPct', 'mezzFactor', 'costFactor', 'councilCharges', 'landPrice']);

const PLACE = P.obj('Position of the building origin in plan mm and the turn in degrees. Leave out to place it automatically inside the setbacks.', {
  x: P.num('Plan x, mm'), y: P.num('Plan y, mm'), rotationDeg: P.num('Turn in degrees'),
});
const MIX = {
  type: 'array',
  description: 'Building types to include with how many of each, for example [{"type":"warehouse","count":1}]. Ids come from the TYPES lines of the plan context.',
  items: { type: 'object', properties: { type: { type: 'string' }, count: { type: 'number' }, params: { type: 'object' } }, required: ['type'] },
};
const CONSTRAINTS = P.obj('Optional limits for the search.', {
  minUnitM2: P.num('Smallest unit floor area, m2 (ground plus mezzanine)'),
  maxUnitM2: P.num('Largest unit floor area, m2'),
  mix: MIX,
  mustInclude: { type: 'array', items: { type: 'string' }, description: 'Building type ids that must appear in the layout' },
  parkingMin: P.num('Smallest number of bays to provide'),
  budgetAud: P.num('Most the indicative total cost may be, AUD ex GST'),
});

export const COMMERCIAL_SCHEMAS = {
  set_layout: {
    label: 'Change layout',
    description: 'Replace the unit rows with a ready-made layout: "best" fits the most floor area inside the setbacks, or one of the named templates (row-6, row-10, b2b-12, b2b-16, court-20, large-6). Buildings already on the lot stay.',
    params: { layout: P.enm(LAYOUT_IDS, 'Layout id') },
    required: ['layout'],
  },
  add_building: {
    label: 'Add building',
    description: 'Add a building of a catalogue type (see the TYPES lines of the plan context for ids and parameters). With no place it is positioned inside the setbacks, clear of the units and bays, with its truck apron free.',
    params: { type: P.str('Building type id from the plan context'), params: P.obj('Type parameters by key, for example {"widthMm":24000}. Missing keys use the defaults.'), place: PLACE },
    required: ['type'],
  },
  update_building: {
    label: 'Update building',
    description: 'Change the parameters of a building already on the lot. Use the building id from the plan context.',
    params: { id: P.str('Building id'), params: P.obj('Parameters to change, by key') },
    required: ['id', 'params'],
  },
  move_building: {
    label: 'Move building',
    description: 'Move or turn a building. Give any of x, y and rotationDeg; the ones left out keep their value.',
    params: { id: P.str('Building id'), place: PLACE },
    required: ['id', 'place'],
  },
  remove_building: {
    label: 'Remove building',
    description: 'Remove a building from the lot.',
    params: { id: P.str('Building id') },
    required: ['id'],
  },
  set_unit_options: {
    label: 'Unit options',
    description: 'Change the strata units of one row, or of every row. Sizes in mm. doors is the number of roller doors. mezzanine and office turn the mezzanine and the ground floor office on or off. windows is the front window style.',
    params: {
      target: P.str('A row id from the plan context, or "all"'),
      options: P.obj('Settings to change; leave out what stays', {
        widthMm: P.num('Unit width, mm'), depthMm: P.num('Unit depth, mm'), heightMm: P.num('Unit height, mm'),
        doors: P.num('Number of roller doors'), doorSize: P.enm(DOOR_PRESETS.map((d) => d.id), 'Roller door size, metres wide x high'),
        mezzanine: P.bool('Mezzanine on or off'), office: P.bool('Ground floor office on or off'), windows: P.enm([...FRONT_WINDOWS], 'Front window style'),
      }),
    },
    required: ['target', 'options'],
  },
  set_finishes: {
    label: 'Finishes',
    description: 'Set the cladding and roller door colours using the generic names listed.',
    params: { cladding: P.enm(CLADDING.map((c) => c.id), 'Wall and roof cladding'), doors: P.enm(DOORS.map((c) => c.id), 'Roller door colour') },
    required: [],
  },
  set_feasibility_inputs: {
    label: 'Feasibility inputs',
    description: 'Set the feasibility inputs by key: saleRate, rentRate (AUD per m2 of GFA), yieldPct, landRate (AUD per m2 of lot), buildRate, siteRate, landscapeRate (AUD per m2), feesPct, contPct, landPrice (AUD). Send null to go back to the default. area is the market area key.',
    params: { inputs: P.obj('Values by key'), area: P.str('Market area key, or leave out') },
    required: ['inputs'],
  },
  run_best_fit: {
    label: 'Best fit',
    description: 'Search layouts that stay inside the setbacks and provide the bays needed, and put the best one for the goal on the lot. Goals: max_gfa (most floor area), max_units (most units), max_margin (best indicative margin), min_cost (lowest cost per m2 among layouts with most of the available floor area).',
    params: { goal: P.enm([...GOALS], 'What to maximise or minimise'), constraints: CONSTRAINTS },
    required: ['goal'],
  },
  compare_options: {
    label: 'Compare options',
    description: 'Work out up to three alternative layouts (different unit sizes, counts or building mixes) and show a comparison table the person can apply from. Nothing on the lot changes until they choose one.',
    params: { n: P.num('How many options, 2 or 3') },
    required: [],
  },
  explain_checks: {
    label: 'Explain checks',
    description: 'Report the checks list and the parking working in plain words, with the source and status of each control. Changes nothing.',
    params: {},
    required: [],
  },
  draft_brief: {
    label: 'Development brief',
    description: 'Write a short development brief for this lot and layout (site, controls with sources and status, proposed mix, yield, indicative feasibility, risks, next steps) and keep it with the plan set.',
    params: {},
    required: [],
  },
};

/** Operations the person triggers from the table; the model never sees them. */
export const HIDDEN_SCHEMAS = {
  apply_option: { label: 'Apply option', description: 'Apply one of the compared options.', params: { optionId: P.str('Option id') }, required: ['optionId'] },
};

export const COMMERCIAL_OP_NAMES = Object.freeze(Object.keys(COMMERCIAL_SCHEMAS));
export const COMMERCIAL_REPORT_OPS = Object.freeze(['compare_options', 'explain_checks']);

/** Registry of every commercial operation (visible and hidden). run() is attached in the browser by commercial-ops.js. */
export const COMMERCIAL_OPS = Object.fromEntries(
  Object.entries({ ...COMMERCIAL_SCHEMAS, ...HIDDEN_SCHEMAS }).map(([name, s]) => [name, {
    ...s,
    mode: 'commercial',
    run() {
      const e = new Error('Commercial operations are not loaded.');
      e.name = 'OpError';
      throw e;
    },
  }]),
);

/** Anthropic tool list for commercial mode. */
export function commercialToolSchemas() {
  return Object.entries(COMMERCIAL_SCHEMAS).map(([name, op]) => ({ name, description: op.description, input_schema: { type: 'object', properties: structuredClone(op.params), required: op.required || [] } }));
}
