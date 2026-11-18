// Commercial pavement catalogue: types, kerbs, markings, rates, layout logic, quantities and cost, plan set blocks, 2D and 3D.
// The 3D (view3d.js, needs three) and the 2D draw helpers (draw2d.js) are imported directly by their callers, so this index stays pure.
export { PAVEMENTS, USES, ROLE_DEFAULTS, MAKEUP_NOTE, pavementById, isPavementType, totalThicknessMm, pavementsForUse, makeUpText, makeUpShort } from './pavements.js';
export { KERBS, KERB_DEFAULTS, kerbById, isKerbType, planLines, profileArea } from './kerbs.js';
export { MARKINGS, PAINT, WHEEL_STOP, SPEED_HUMP, markingById, isMarkingType, markingGeometry, countMarkings, drawAccessibleIcon } from './markings.js';
export { RATES, DATA_DATE, RATES_CAVEAT, FOOTPATH_MM, CROSSOVER_MM, defaultAreas, pavementAreas, netAreasM2, buildKerbs, buildWheelStops, buildMarkings, pavementModel, pavementCost, siteWorksCost, footprintM2, planLegend, pavementSchedule } from './logic.js';
export { hardstandTypes, hardstandList, hsContext, snapPoint, rectPolygon, measure, drawnWarnings, addHardstand, setHardstandPolygon, moveHardstand, setHardstandType, removeHardstand, duplicateHardstand, insertVertex, removeVertex, fillRegion, markingPrompts, addPromptMarking, hardstandSummary, hardstandAt, OVERLAP_RULE } from './hardstand.js';
export { carparkLayout, carparkAreas, carparkTotals, carparkMarkings, entryGaps, cpConfig, BAY_TYPES, CARPARK_DEFAULTS, CARPARK_NOTE, liveCarpark, bayAt, longestEdgeAngle } from './carpark.js';
export { carparkOf, carparkSummary, carparkLayoutFor } from './logic.js';
export { rotatePolygon, resizeRect, isRect, setHardstandCarpark, shiftBayRow, removeBay, snapTurn } from './hardstand.js';
