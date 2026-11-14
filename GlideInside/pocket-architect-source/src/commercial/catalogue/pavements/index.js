// Commercial pavement catalogue: types, kerbs, markings, rates, layout logic, quantities and cost, plan set blocks, 2D and 3D.
// The 3D (view3d.js, needs three) and the 2D draw helpers (draw2d.js) are imported directly by their callers, so this index stays pure.
export { PAVEMENTS, USES, ROLE_DEFAULTS, MAKEUP_NOTE, pavementById, isPavementType, totalThicknessMm, pavementsForUse, makeUpText, makeUpShort } from './pavements.js';
export { KERBS, KERB_DEFAULTS, kerbById, isKerbType, planLines, profileArea } from './kerbs.js';
export { MARKINGS, PAINT, WHEEL_STOP, SPEED_HUMP, markingById, isMarkingType, markingGeometry, countMarkings, drawAccessibleIcon } from './markings.js';
export { RATES, DATA_DATE, RATES_CAVEAT, FOOTPATH_MM, CROSSOVER_MM, defaultAreas, pavementAreas, netAreasM2, buildKerbs, buildWheelStops, buildMarkings, pavementModel, pavementCost, siteWorksCost, footprintM2, planLegend, pavementSchedule } from './logic.js';
