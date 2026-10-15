/**
 * Display constants of the first person walk. They set how the walk FEELS and where the walker may step; they are NOT design requirements, not a statement of what is
 * accessible or trafficable, and no council rule is read from them. A real limit (for example a driveway grade) comes from a requirement and is checked by the server.
 */

/** The highest step the walker climbs without jumping, metres. A display setting of the walk (adjustable in the walk settings), not a requirement. */
export const FP_STEP_UP_M = 0.4;
/** The steepest ground the walker climbs, degrees. A display setting of the walk, not a requirement and not a statement of what is accessible. */
export const FP_SLOPE_LIMIT_DEG = 45;
/** Eye height above the ground, metres (walk setting). */
export const FP_EYE_HEIGHT_M = 1.6;

/** Thickness of the collision wall drawn along a building edge, a pool edge or a wall with no stated thickness, metres. Collision only; no thickness is implied for the object. */
export const FP_COLLIDER_EDGE_M = 0.3;
/** Collision height of an object with no stated height (a retaining wall, a building), metres above its base. Collision only; the object is not given this height. */
export const FP_COLLIDER_DEFAULT_HEIGHT_M = 3.0;
/** Collision height above the water level of a pool edge, so the walker cannot walk into the pool, metres. */
export const FP_POOL_EDGE_HEIGHT_M = 1.2;
/** How far below the base a collider reaches, metres (so a walker on lower ground still meets it). */
export const FP_COLLIDER_BELOW_M = 1.0;
