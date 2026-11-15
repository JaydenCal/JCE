// Minimal storage for the booking concierge (table concierge_bookings, migration 0020). D1 in production, memory in tests.
// No personal data is stored: reference, idempotency key, type, slot time, status, provider id and an ownership token HASH.

const row = (r) => r && {
  id: r.id, idemKey: r.idem_key, type: r.type, slotStartMs: Number(r.slot_start_ms), status: r.status, provider: r.provider,
  providerRef: r.provider_ref ?? null, ownerHash: r.owner_hash ?? null, attempts: Number(r.attempts) || 0, createdAt: r.created_at, updatedAt: r.updated_at,
};
const COLS = { status: 'status', providerRef: 'provider_ref', ownerHash: 'owner_hash', attempts: 'attempts' };

export function createD1BookingStore(db) {
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const first = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const changed = (r) => (r?.meta?.changes ?? 0) > 0;
  return {
    kind: 'd1',
    /** Atomic claim: true only for the first caller for this id AND this idempotency key. */
    async claim(r) {
      return changed(await run(
        `INSERT OR IGNORE INTO concierge_bookings (id, idem_key, type, slot_start_ms, status, provider, attempts, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'pending', ?5, 1, ?6, ?6)`, r.id, r.idemKey, r.type, r.slotStartMs, r.provider, r.at));
    },
    async get(id) { return row(await first('SELECT * FROM concierge_bookings WHERE id = ?1', id)); },
    async getByIdem(k) { return row(await first('SELECT * FROM concierge_bookings WHERE idem_key = ?1', k)); },
    /** Compare and set: applies the patch only when the row is in one of the `from` statuses. */
    async updateIf(id, from, patch, at) {
      const sets = []; const args = [];
      for (const [k, v] of Object.entries(patch)) if (COLS[k]) { args.push(v); sets.push(`${COLS[k]} = ?${args.length}`); }
      args.push(at); sets.push(`updated_at = ?${args.length}`);
      args.push(id); const idIdx = args.length;
      const marks = from.map((s) => { args.push(s); return `?${args.length}`; });
      return changed(await run(`UPDATE concierge_bookings SET ${sets.join(', ')} WHERE id = ?${idIdx} AND status IN (${marks.join(',')})`, ...args));
    },
    async purgeBefore(iso) { return run('DELETE FROM concierge_bookings WHERE created_at < ?1', iso); },
  };
}

export function createMemoryBookingStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    rows,
    async claim(r) {
      if (rows.has(r.id) || [...rows.values()].some((x) => x.idem_key === r.idemKey)) return false;
      rows.set(r.id, { id: r.id, idem_key: r.idemKey, type: r.type, slot_start_ms: r.slotStartMs, status: 'pending', provider: r.provider, provider_ref: null, owner_hash: null, attempts: 1, created_at: r.at, updated_at: r.at });
      return true;
    },
    async get(id) { return row(rows.get(id)); },
    async getByIdem(k) { return row([...rows.values()].find((x) => x.idem_key === k)); },
    async updateIf(id, from, patch, at) {
      const r = rows.get(id);
      if (!r || !from.includes(r.status)) return false;
      for (const [k, v] of Object.entries(patch)) if (COLS[k]) r[COLS[k]] = v;
      r.updated_at = at;
      return true;
    },
    async purgeBefore(iso) { for (const [k, r] of rows) if (r.created_at < iso) rows.delete(k); },
  };
}
