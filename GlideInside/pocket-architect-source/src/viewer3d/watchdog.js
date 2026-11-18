// The slow rebuild watchdog (viewer.js): a rebuild over the limit drops the 3D view to simplified detail; once rebuilds are fast again it
// goes back to full detail. Pure logic, no DOM: record(buildMs, detail) says what the viewer should do next.
//   'degrade'  a full detail build was over the limit: rebuild at low detail
//   'recover'  low detail builds are fast enough that full detail should fit again: rebuild at full detail
//   null       nothing to change
// A low detail build is faster than a full one, so the full build time is estimated from the ratio seen when the view was degraded (at least
// MIN_RATIO). Full detail is tried again after RECOVER_STREAK fast low detail builds in a row whose estimate is under RECOVER_FRACTION of the
// limit. A recovery that is slow again backs off (the streak needed doubles, up to 16) so a site that really is heavy settles at low detail.
export const RECOVER_FRACTION = 0.6;
export const RECOVER_STREAK = 2;
export const MIN_RATIO = 1.5;

export function createWatchdog(limitMs) {
  let ratio = 3; let learned = false; let streak = 0; let need = RECOVER_STREAK; let lastFull = 0; let recovering = false;
  return {
    limitMs,
    get state() { return { ratio, streak, need, lastFull }; },
    record(ms, detail) {
      if (detail === 'full') {
        if (ms > limitMs) {
          lastFull = ms; streak = 0; learned = false;
          if (recovering) need = Math.min(16, need * 2); // the recovery did not hold
          recovering = false;
          return 'degrade';
        }
        recovering = false; need = RECOVER_STREAK;
        return null;
      }
      // low detail: learn the ratio from the first low build after a slow full one, then watch for fast builds
      if (lastFull && !learned && ms > 0) { ratio = Math.max(MIN_RATIO, lastFull / ms); learned = true; }
      if (ms * ratio < limitMs * RECOVER_FRACTION) streak++; else streak = 0;
      if (streak >= need) { streak = 0; recovering = true; return 'recover'; }
      return null;
    },
    reset() { streak = 0; need = RECOVER_STREAK; lastFull = 0; recovering = false; ratio = 3; learned = false; },
  };
}
