// Storage for the "coming soon" features (migration 0025): widget settings, leads, webhook settings and deliveries, builder site cost rate
// defaults and engineering order requests. D1 for production, an in-memory twin for tests. Plain camelCase objects in and out.
// Every read and write that touches builder data takes the orgId, so a builder only ever reaches their own rows.

const j = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
const b = (v) => !!v;

const leadOut = (r) => r && ({ id: r.id, orgId: r.org_id, createdAt: r.created_at, source: r.source, name: r.name, email: r.email, phone: r.phone || '', address: r.address || '', lotLabel: r.lot_label || '', houseId: r.house_id || '', houseName: r.house_name || '', hostOrigin: r.host_origin || '', consentAt: r.consent_at, consentText: r.consent_text, status: r.status, note: r.note || '' });
const delOut = (r) => r && ({ id: r.id, orgId: r.org_id, leadId: r.lead_id, createdAt: r.created_at, attempts: r.attempts, status: r.status, lastStatus: r.last_status ?? null, lastError: r.last_error || '', lastAttemptAt: r.last_attempt_at || null, nextAttemptAt: r.next_attempt_at || null });
const orderOut = (r) => r && ({ id: r.id, createdAt: r.created_at, orgId: r.org_id || null, orgName: r.org_name || '', services: j(r.services_json, []), name: r.name, email: r.email, phone: r.phone || '', address: r.address || '', lotLabel: r.lot_label || '', designName: r.design_name || '', designLink: r.design_link || '', notes: r.notes || '', consentAt: r.consent_at, consentText: r.consent_text, status: r.status });

export function createD1LeadsStore(db) {
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const first = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const changed = (r) => (r?.meta?.changes ?? 0) > 0;
  return {
    kind: 'd1',
    async getWidget(orgId) {
      const r = await first('SELECT * FROM widget_settings WHERE org_id = ?1', orgId);
      return r ? { enabled: b(r.enabled), origins: j(r.origins_json, []), houseIds: j(r.house_ids_json, []), updatedAt: r.updated_at } : null;
    },
    async putWidget(orgId, w, at) {
      await run('INSERT INTO widget_settings (org_id, enabled, origins_json, house_ids_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(org_id) DO UPDATE SET enabled = ?2, origins_json = ?3, house_ids_json = ?4, updated_at = ?5', orgId, w.enabled ? 1 : 0, JSON.stringify(w.origins || []), JSON.stringify(w.houseIds || []), at);
    },
    async insertLead(l) {
      await run('INSERT INTO leads (id, org_id, created_at, source, name, email, phone, address, lot_label, house_id, house_name, host_origin, consent_at, consent_text, status, note) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)', l.id, l.orgId, l.createdAt, l.source, l.name, l.email, l.phone || null, l.address || null, l.lotLabel || null, l.houseId || null, l.houseName || null, l.hostOrigin || null, l.consentAt, l.consentText, l.status || 'new', l.note || null);
    },
    async listLeads(orgId, { limit = 500 } = {}) { return (await all('SELECT * FROM leads WHERE org_id = ?1 ORDER BY created_at DESC, id LIMIT ?2', orgId, limit)).map(leadOut); },
    async getLead(orgId, id) { return leadOut(await first('SELECT * FROM leads WHERE org_id = ?1 AND id = ?2', orgId, id)); },
    async countLeads(orgId) { return Number((await first('SELECT COUNT(*) AS n FROM leads WHERE org_id = ?1', orgId))?.n ?? 0); },
    async findRecentLead(orgId, email, houseId, sinceIso) { return leadOut(await first('SELECT * FROM leads WHERE org_id = ?1 AND email = ?2 AND COALESCE(house_id, \'\') = ?3 AND created_at >= ?4 LIMIT 1', orgId, email, houseId || '', sinceIso)); },
    async updateLead(orgId, id, patch) {
      const sets = []; const args = [orgId, id];
      for (const [k, c] of [['status', 'status'], ['note', 'note']]) if (patch[k] !== undefined) { args.push(patch[k]); sets.push(`${c} = ?${args.length}`); }
      if (!sets.length) return false;
      return changed(await run(`UPDATE leads SET ${sets.join(', ')} WHERE org_id = ?1 AND id = ?2`, ...args));
    },
    async deleteLead(orgId, id) {
      await run('DELETE FROM webhook_deliveries WHERE org_id = ?1 AND lead_id = ?2', orgId, id);
      return changed(await run('DELETE FROM leads WHERE org_id = ?1 AND id = ?2', orgId, id));
    },
    async getWebhook(orgId) { const r = await first('SELECT * FROM lead_webhooks WHERE org_id = ?1', orgId); return r ? { url: r.url, secret: r.secret, enabled: b(r.enabled), updatedAt: r.updated_at } : null; },
    async putWebhook(orgId, w, at) {
      await run('INSERT INTO lead_webhooks (org_id, url, secret, enabled, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(org_id) DO UPDATE SET url = ?2, secret = ?3, enabled = ?4, updated_at = ?5', orgId, w.url, w.secret, w.enabled ? 1 : 0, at);
    },
    async deleteWebhook(orgId) { await run('DELETE FROM lead_webhooks WHERE org_id = ?1', orgId); },
    async insertDelivery(d) { await run('INSERT INTO webhook_deliveries (id, org_id, lead_id, created_at, attempts, status, next_attempt_at) VALUES (?1,?2,?3,?4,?5,?6,?7)', d.id, d.orgId, d.leadId, d.createdAt, d.attempts || 0, d.status || 'pending', d.nextAttemptAt || null); },
    async getDelivery(orgId, id) { return delOut(await first('SELECT * FROM webhook_deliveries WHERE org_id = ?1 AND id = ?2', orgId, id)); },
    async updateDelivery(id, p) { await run('UPDATE webhook_deliveries SET attempts = ?2, status = ?3, last_status = ?4, last_error = ?5, last_attempt_at = ?6, next_attempt_at = ?7 WHERE id = ?1', id, p.attempts, p.status, p.lastStatus ?? null, p.lastError || null, p.lastAttemptAt || null, p.nextAttemptAt || null); },
    async listDeliveries(orgId, limit = 50) { return (await all('SELECT * FROM webhook_deliveries WHERE org_id = ?1 ORDER BY created_at DESC, id LIMIT ?2', orgId, limit)).map(delOut); },
    async listDueDeliveries(orgId, nowIso, limit = 10) { return (await all("SELECT * FROM webhook_deliveries WHERE org_id = ?1 AND status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?2 ORDER BY next_attempt_at LIMIT ?3", orgId, nowIso, limit)).map(delOut); },
    async listDueDeliveriesAll(nowIso, limit = 25) { return (await all("SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?1 ORDER BY next_attempt_at LIMIT ?2", nowIso, limit)).map(delOut); },
    async getSiteCostDefaults(orgId) { const r = await first('SELECT settings_json FROM site_cost_defaults WHERE org_id = ?1', orgId); return r ? j(r.settings_json, null) : null; },
    async putSiteCostDefaults(orgId, settings, at) { await run('INSERT INTO site_cost_defaults (org_id, settings_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(org_id) DO UPDATE SET settings_json = ?2, updated_at = ?3', orgId, JSON.stringify(settings), at); },
    async deleteSiteCostDefaults(orgId) { await run('DELETE FROM site_cost_defaults WHERE org_id = ?1', orgId); },
    async insertOrder(o) {
      await run('INSERT INTO engineering_orders (id, created_at, org_id, org_name, services_json, name, email, phone, address, lot_label, design_name, design_link, notes, consent_at, consent_text, status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)', o.id, o.createdAt, o.orgId || null, o.orgName || null, JSON.stringify(o.services), o.name, o.email, o.phone || null, o.address || null, o.lotLabel || null, o.designName || null, o.designLink || null, o.notes || null, o.consentAt, o.consentText, o.status || 'new');
    },
    async listOrders(limit = 200) { return (await all('SELECT * FROM engineering_orders ORDER BY created_at DESC, id LIMIT ?1', limit)).map(orderOut); },
    async updateOrderStatus(id, status) { return changed(await run('UPDATE engineering_orders SET status = ?2 WHERE id = ?1', id, status)); },
  };
}

export function createMemoryLeadsStore() {
  const widgets = new Map(); const leads = new Map(); const hooks = new Map(); const deliveries = new Map(); const costs = new Map(); const orders = new Map();
  const cp = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const byNew = (a, c) => (a.createdAt < c.createdAt ? 1 : a.createdAt > c.createdAt ? -1 : a.id < c.id ? -1 : 1);
  return {
    kind: 'memory',
    async getWidget(orgId) { return cp(widgets.get(orgId) || null); },
    async putWidget(orgId, w, at) { widgets.set(orgId, { enabled: !!w.enabled, origins: [...(w.origins || [])], houseIds: [...(w.houseIds || [])], updatedAt: at }); },
    async insertLead(l) { leads.set(l.id, { phone: '', address: '', lotLabel: '', houseId: '', houseName: '', hostOrigin: '', note: '', status: 'new', ...cp(l) }); },
    async listLeads(orgId, { limit = 500 } = {}) { return [...leads.values()].filter((l) => l.orgId === orgId).sort(byNew).slice(0, limit).map(cp); },
    async getLead(orgId, id) { const l = leads.get(id); return l && l.orgId === orgId ? cp(l) : null; },
    async countLeads(orgId) { return [...leads.values()].filter((l) => l.orgId === orgId).length; },
    async findRecentLead(orgId, email, houseId, sinceIso) { return cp([...leads.values()].find((l) => l.orgId === orgId && l.email === email && (l.houseId || '') === (houseId || '') && l.createdAt >= sinceIso) || null); },
    async updateLead(orgId, id, patch) { const l = leads.get(id); if (!l || l.orgId !== orgId) return false; for (const k of ['status', 'note']) if (patch[k] !== undefined) l[k] = patch[k]; return true; },
    async deleteLead(orgId, id) { const l = leads.get(id); if (!l || l.orgId !== orgId) return false; leads.delete(id); for (const [k, d] of deliveries) if (d.leadId === id) deliveries.delete(k); return true; },
    async getWebhook(orgId) { return cp(hooks.get(orgId) || null); },
    async putWebhook(orgId, w, at) { hooks.set(orgId, { url: w.url, secret: w.secret, enabled: !!w.enabled, updatedAt: at }); },
    async deleteWebhook(orgId) { hooks.delete(orgId); },
    async insertDelivery(d) { deliveries.set(d.id, { attempts: 0, status: 'pending', lastStatus: null, lastError: '', lastAttemptAt: null, nextAttemptAt: null, ...cp(d) }); },
    async getDelivery(orgId, id) { const d = deliveries.get(id); return d && d.orgId === orgId ? cp(d) : null; },
    async updateDelivery(id, p) { const d = deliveries.get(id); if (d) Object.assign(d, { attempts: p.attempts, status: p.status, lastStatus: p.lastStatus ?? null, lastError: p.lastError || '', lastAttemptAt: p.lastAttemptAt || null, nextAttemptAt: p.nextAttemptAt || null }); },
    async listDeliveries(orgId, limit = 50) { return [...deliveries.values()].filter((d) => d.orgId === orgId).sort(byNew).slice(0, limit).map(cp); },
    async listDueDeliveries(orgId, nowIso, limit = 10) { return [...deliveries.values()].filter((d) => d.orgId === orgId && d.status === 'pending' && d.nextAttemptAt && d.nextAttemptAt <= nowIso).sort((a, c) => (a.nextAttemptAt < c.nextAttemptAt ? -1 : 1)).slice(0, limit).map(cp); },
    async listDueDeliveriesAll(nowIso, limit = 25) { return [...deliveries.values()].filter((d) => d.status === 'pending' && d.nextAttemptAt && d.nextAttemptAt <= nowIso).sort((a, c) => (a.nextAttemptAt < c.nextAttemptAt ? -1 : 1)).slice(0, limit).map(cp); },
    async getSiteCostDefaults(orgId) { return cp(costs.get(orgId) || null); },
    async putSiteCostDefaults(orgId, settings) { costs.set(orgId, cp(settings)); },
    async deleteSiteCostDefaults(orgId) { costs.delete(orgId); },
    async insertOrder(o) { orders.set(o.id, { phone: '', address: '', lotLabel: '', designName: '', designLink: '', notes: '', status: 'new', orgId: null, orgName: '', ...cp(o) }); },
    async listOrders(limit = 200) { return [...orders.values()].sort(byNew).slice(0, limit).map(cp); },
    async updateOrderStatus(id, status) { const o = orders.get(id); if (!o) return false; o.status = status; return true; },
  };
}
