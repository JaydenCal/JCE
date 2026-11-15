// Who already has an account here (no DOM, so tests can import it).

/** Someone who already has an account here: a builder or client login, a Commercial subscriber or trial login, an internal account. */
export const hasOtherAccount = (app) => {
  try {
    const st = app.premium?.state;
    if (app.portal || st?.portal || st?.csub) return true;
    if (st?.portalPending) return true; // the builder sign in check has not finished: wait before offering anything
  } catch {
    /* treat as no other account */
  }
  return false;
};
