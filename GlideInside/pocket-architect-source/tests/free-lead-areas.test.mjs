// Free plan set leads are shared with the builder who holds the lot's area (owner decision 25/11/2026): areas are set by the owner only, one builder
// of each type holds an area, sheds go to shed builders and houses and granny flats to house builders, nothing is emailed, no match keeps the lead for the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, saveEnquiry } from './helpers/portal-lite.mjs';
import { matchOrgForLead, cleanAreas, postcodeOf, leadTypeOf } from '../server/lib/areas.js';

const lead = (over = {}) => ({ name: 'Sam Citizen', email: `sam${Math.random().toString(36).slice(2, 8)}@example.com`, need: 'planset', consent: true, source: 'planset-free', projectName: 'Gum Tree 3', suburb: 'Tamworth', postcode: '2340', designType: 'house', consentText: 'I agree to Glide Inside sharing my details and design with the local builder who covers my area, so they can contact me about building.', lot: { address: '1 Example St, Tamworth NSW 2340' }, ...over });

async function setup() {
  const w = makeWorld();
  const hb = await w.makeOrg('Hunter House Builders', 'Hana');
  const sb = await w.makeOrg('Hastings Valley Sheds', 'Tim');
  const hb2 = await w.makeOrg('Second House Builders', 'Sue');
  return { w, hb, sb, hb2 };
}
async function tabFor(w, org) { const t = w.browser().tab(); await org.signIn(t); return t; }

test('matching: postcode, suburb, type split and no match (pure)', () => {
  const orgs = [{ id: 'a', builderType: 'house', areas: ['2340'] }, { id: 'b', builderType: 'shed', areas: ['2340', 'Calala'] }];
  assert.equal(matchOrgForLead(orgs, { postcode: '2340', designType: 'house' }).id, 'a');
  assert.equal(matchOrgForLead(orgs, { postcode: '2340', designType: 'granny1' }).id, 'a', 'granny flats go to house builders');
  assert.equal(matchOrgForLead(orgs, { postcode: '2340', designType: 'shed' }).id, 'b', 'sheds go to shed builders');
  assert.equal(matchOrgForLead(orgs, { designType: 'outbuilding', suburb: 'calala' }).id, 'b', 'outbuildings go to shed builders, suburb match ignores case');
  assert.equal(matchOrgForLead(orgs, { lot: { address: '5 Road, Tamworth NSW 2340' }, designType: 'house' }).id, 'a', 'postcode read from the lot address');
  assert.equal(matchOrgForLead(orgs, { postcode: '2999', designType: 'house' }), null);
  assert.equal(matchOrgForLead(orgs, { suburb: 'Calala', designType: 'house' }), null, 'a shed builder never gets a house lead');
  assert.equal(matchOrgForLead([{ id: 'x', areas: ['2340'], status: 'read_only' }], { postcode: '2340' }), null, 'a read only account takes no leads');
  assert.deepEqual(cleanAreas('2340, 2341\nTamworth, 2340'), ['2340', '2341', 'Tamworth']);
  assert.throws(() => cleanAreas(['23']), /not a 4 digit postcode/);
  assert.equal(postcodeOf({ suburb: 'Calala 2340' }), '2340');
  assert.equal(leadTypeOf({ designType: 'shed' }), 'shed');
});

test('areas are set from the admin API only, and a postcode held by another org of the same type is refused', async () => {
  const { w, hb, sb, hb2 } = await setup();
  assert.equal((await w.admin('POST', `/portal/admin/orgs/${hb.id}/areas`, { builderType: 'house', areas: ['2340', 'Tamworth'] })).status, 200);
  const dup = await w.admin('POST', `/portal/admin/orgs/${hb2.id}/areas`, { builderType: 'house', areas: ['2341', '2340'] });
  assert.equal(dup.status, 409, 'duplicate postcode, same builder type');
  assert.match(dup.data.error.message, /2340 is already held by Hunter House Builders/);
  assert.equal((await w.admin('POST', `/portal/admin/orgs/${sb.id}/areas`, { builderType: 'shed', areas: ['2340'] })).status, 200, 'a shed builder can hold the same postcode');
  const flip = await w.admin('POST', `/portal/admin/orgs/${sb.id}/areas`, { builderType: 'house' });
  assert.equal(flip.status, 409, 'changing the type into a clash is refused too');
  assert.equal((await w.admin('POST', `/portal/admin/orgs/${hb2.id}/areas`, { areas: ['23'] })).status, 400);
  assert.equal((await w.raw('POST', `/portal/admin/orgs/${hb2.id}/areas`, { areas: ['2999'] }, { authorization: 'Bearer wrong-token-000000000000000000' })).status, 401);
  // a builder cannot set its own areas
  const t = await tabFor(w, hb2);
  await t.patch('/portal/org/settings', { areas: ['2999'], builderType: 'shed' });
  assert.deepEqual((await w.admin('GET', '/portal/admin/orgs')).data.find((o) => o.id === hb2.id).areas, [], 'the org settings route ignores areas');
  const view = (await w.admin('GET', '/portal/admin/orgs')).data;
  assert.deepEqual(view.find((o) => o.id === hb.id).areas, ['2340', 'Tamworth']);
  assert.equal(view.find((o) => o.id === sb.id).builderType, 'shed');
  assert.equal(view.find((o) => o.id === hb2.id).builderType, 'house');
});

test('a free plan set lead lands in the Leads tab of the builder who holds the area, for the right type, and nowhere else', async () => {
  const { w, hb, sb, hb2 } = await setup();
  await w.admin('POST', `/portal/admin/orgs/${hb.id}/areas`, { builderType: 'house', areas: ['2340'] });
  await w.admin('POST', `/portal/admin/orgs/${sb.id}/areas`, { builderType: 'shed', areas: ['2340'] });
  await w.admin('POST', `/portal/admin/orgs/${hb2.id}/areas`, { builderType: 'house', areas: ['2400'] });
  const tHb = await tabFor(w, hb); const tSb = await tabFor(w, sb); const tHb2 = await tabFor(w, hb2);
  const h = await saveEnquiry(w, lead({ name: 'House Person' }));
  const g = await saveEnquiry(w, lead({ name: 'Granny Person', designType: 'granny2', projectName: 'Granny 2' }));
  const s = await saveEnquiry(w, lead({ name: 'Shed Person', designType: 'shed', projectName: 'Shed 6x9' }));
  const none = await saveEnquiry(w, lead({ name: 'Nowhere Person', postcode: '2999', suburb: 'Nowhere', lot: { address: '2 Road, Nowhere NSW 2999' } }));
  for (const r of [h, g, s, none]) assert.equal(r.status, 200, JSON.stringify(r.data));
  const hbLeads = (await tHb.get('/portal/leads')).data;
  assert.deepEqual(hbLeads.leads.map((l) => l.name).sort(), ['Granny Person', 'House Person']);
  assert.equal(hbLeads.leads[0].source, 'planset-free');
  assert.deepEqual((await tSb.get('/portal/leads')).data.leads.map((l) => l.name), ['Shed Person']);
  assert.equal((await tHb2.get('/portal/leads')).data.total, 0, 'a builder who holds another area sees none of these');
  // consent wording the visitor saw is stored with the lead
  assert.match(hbLeads.leads.find((l) => l.name === 'House Person').note, /Suburb: Tamworth/);
  assert.match(JSON.stringify(await w.store.listEnquiries()), /Shared with builder: Hunter House Builders/);
  // the owner sees every lead, matched or not
  const owner = (await w.admin('GET', '/portal/admin/enquiries')).data;
  assert.equal(owner.length, 4);
  assert.deepEqual(owner.map((e) => e.name).sort(), ['Granny Person', 'House Person', 'Nowhere Person', 'Shed Person']);
  assert.ok(owner.every((e) => e.orgName === ''), 'the owner copy still names no builder');
});

test('no match keeps the lead for the owner only, and with email on only the owner is written to', async () => {
  const sent = [];
  const w = makeWorld({ RESEND_API_KEY: 're_test', ENQUIRY_TO: 'owner@example.com', ENQUIRY_FROM: 'Glide <x@example.com>' }, async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: 'e1' }), { status: 200 }); });
  const org = await w.makeOrg('Hunter House Builders', 'Hana');
  await w.admin('POST', `/portal/admin/orgs/${org.id}/areas`, { builderType: 'house', areas: ['2340'] });
  const t = w.browser().tab(); await org.signIn(t);
  const miss = await saveEnquiry(w, lead({ postcode: '2999', lot: { address: '2 Road, Nowhere NSW 2999' } }));
  assert.equal(miss.status, 200);
  assert.equal((await t.get('/portal/leads')).data.total, 0, 'nothing for a builder who does not hold the area');
  assert.equal((await w.admin('GET', '/portal/admin/enquiries')).data.length, 1, 'the owner still has it');
  const hit = await saveEnquiry(w, lead());
  assert.equal(hit.status, 200);
  assert.equal((await t.get('/portal/leads')).data.total, 1);
  for (const m of sent) assert.deepEqual(m.body.to, ['owner@example.com'], 'no email goes to a builder or the visitor');
  assert.equal(sent.length, 2);
});

test('lead visibility is per org: a builder cannot read or change another builder\'s lead', async () => {
  const { w, hb, hb2 } = await setup();
  await w.admin('POST', `/portal/admin/orgs/${hb.id}/areas`, { builderType: 'house', areas: ['2340'] });
  const t1 = await tabFor(w, hb); const t2 = await tabFor(w, hb2);
  await saveEnquiry(w, lead());
  const l = (await t1.get('/portal/leads')).data.leads[0];
  assert.ok(l);
  assert.equal((await t2.patch(`/portal/leads/${l.id}`, { status: 'closed' })).status, 404);
  assert.equal((await t2.del(`/portal/leads/${l.id}`)).status, 404);
  assert.equal((await t1.patch(`/portal/leads/${l.id}`, { status: 'contacted' })).status, 200);
});

test('a duplicate submission is recorded once and does not give the builder a second lead', async () => {
  const { w, hb } = await setup();
  await w.admin('POST', `/portal/admin/orgs/${hb.id}/areas`, { builderType: 'house', areas: ['2340'] });
  const t = await tabFor(w, hb);
  const body = lead({ email: 'same@example.com' });
  await saveEnquiry(w, body); await saveEnquiry(w, body);
  assert.equal((await t.get('/portal/leads')).data.total, 1);
});
