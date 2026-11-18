// APPROVED KNOWLEDGE for the Glide Inside concierge. Every fact here is taken from the live site pages (home, pricing, for-builders,
// commercial, how-accurate-is-it, privacy) as at 15/11/2026. Nothing else may be stated. Update this file only when the site changes,
// and only with wording the site already uses. Rules for this file: no prices that the site does not publish, no feasibility, approval
// or planning promises, no engineering fees, no builder or competitor brand names, no dashes, never the word "compliant".

export const CONTACT = { email: 'hello@glideinside.com.au', phone: '0477 207 027' };

/** Where the concierge may send people. Relative to the site root. */
export const LINKS = {
  enquiry: { label: 'Send an enquiry', href: '/#enquiry' },
  demo: { label: 'Book a demo (form)', href: '/book-a-demo/' },
  tool: { label: 'Open Glide Inside Residential', href: '/plan-studio/app/' },
  commercial: { label: 'Glide Inside Commercial', href: '/commercial/' },
  builders: { label: 'For builders', href: '/for-builders/' },
  pricing: { label: 'Pricing', href: '/pricing/' },
  accuracy: { label: 'How accurate is it', href: '/how-accurate-is-it/' },
  subdivision: { label: 'Subdivisions', href: '/subdivision/' },
};

export const INTENTS = {
  homeowner: { id: 'homeowner', label: 'Homeowner', bookingType: 'homeowner', blurb: 'Putting a house on your block.', qualifier: { q: 'What are you planning?', options: [['house', 'A new house'], ['granny', 'A granny flat or shed'], ['unsure', 'Not sure yet']] } },
  builder: { id: 'builder', label: 'Builder', bookingType: 'builder', blurb: 'Your designs on every client\'s real lot.', qualifier: { q: 'Which best describes you?', options: [['custom', 'Custom builder'], ['volume', 'Volume builder'], ['other', 'Something else']] } },
  developer: { id: 'developer', label: 'Developer or estate', bookingType: 'developer', blurb: 'Commercial layouts and subdivision concepts.', qualifier: { q: 'What are you looking at?', options: [['commercial', 'Commercial or industrial lot'], ['subdivision', 'A subdivision'], ['both', 'Both']] } },
  agent: { id: 'agent', label: 'Real estate agent', bookingType: 'agent', blurb: 'See the tools and ask how they might fit.', qualifier: { q: 'What do you sell?', options: [['land', 'Land'], ['homes', 'Homes'], ['both', 'Both']] } },
};

/** Opening line per intent (deterministic). */
export const INTENT_OPENERS = {
  homeowner: 'Glide Inside Residential lets you type an address, see your lot and its indicative setbacks in 3D, and place a house on it. Drawing and viewing are free. What would you like to know?',
  builder: 'Glide Inside gives each of your clients a private login to place your own designs on their real lot. There is a free 14 day trial. What would you like to know?',
  developer: 'Glide Inside Commercial lays out industrial and commercial units on a real lot, and we also prepare subdivision concepts by quote. What would you like to know?',
  agent: 'I can explain what Glide Inside does, or pass a call back request to Jayden. What would you like to know?',
};

export const FAQ = [
  { id: 'what', re: /\bwhat (is|does|do) (glide ?inside|this (tool|site|product|app|software|website)|it do)\b|\bhow does (it|this|glide ?inside) work\b|\btell me about (glide ?inside|the tool|this tool)\b/i,
    a: 'Glide Inside Residential lets you type an address in NSW or Queensland and load the lot, its neighbours, the aerial, contours and indicative setbacks. You place a house, walk through it in 3D and take away a concept plan set. Glide Inside Commercial does industrial and commercial unit layouts. Glide Inside is a trading name of JCE Infrastructure Pty Ltd.', links: ['tool', 'accuracy'] },
  { id: 'cost-homeowner', re: /\b(cost|price|pricing|how much|pay|free|plan pack)\b(?!.*\b(builder|login|commercial|subscription|subdivision|engineer))/i,
    a: 'Drawing and viewing are free with no sign up. A Plan Pack is A$30 per job including GST and unlocks a PDF plan set, a DXF, 3D model files, an offline interactive HTML file and 500 AI credits for that job. A 3D fly-through and complex renderings are A$10 each, made by the Glide Inside team and ordered by email.', links: ['pricing'] },
  { id: 'cost-builder', re: /\b(builder|builders|login|logins|trial)\b.*\b(cost|price|pricing|how much|pay|free|trial)\b|\b(cost|price|pricing|how much|pay)\b.*\b(builder|builders|client logins?)\b|\bfree trial\b/i,
    a: 'Builders start with a free 14 day trial for their own staff. After that it is A$20 per job (including GST), where a job is one new project, confirmed on screen before it is created. Client logins are free and there is no monthly fee. Capped monthly plans (A$119, A$219 and A$419 with 10, 20 and 40 jobs) are coming soon. AI credit top ups are A$10 per 300 credits.', links: ['builders', 'pricing'] },
  { id: 'cost-commercial', re: /\b(commercial|developer)\b.*\b(cost|price|pricing|how much|subscription|per month)\b|\b(cost|price|how much)\b.*\b(commercial|developer subscription)\b/i,
    a: 'Glide Inside Commercial is in beta. Commercial Developer is A$50 per month including GST: unlimited commercial plan set PDFs (sheets C000 to C103), DXF drawings and 150 AI assistant messages each month. Extra messages are A$15 for 100. It renews monthly and you can cancel anytime. Yield, value and cost figures are estimates only.', links: ['commercial', 'pricing'] },
  { id: 'cost-subdivision', re: /\bsubdivision|subdivide|estate\b.*\b(cost|price|quote|how much)\b|\b(cost|price|quote|how much)\b.*\bsubdivision/i,
    a: 'Subdivision concepts and 3D site models are priced by quote because they depend on the site. The director is a qualified civil engineer and can assist with preliminary subdivision feasibility. You can ask for a quote through the enquiry form or request a call back.', links: ['subdivision', 'enquiry'] },
  { id: 'approved', re: /\b(approved|approval|council approv|da\b|development application|construction drawings?|ncc|national construction code)\b/i,
    a: 'No. Glide Inside outputs are concept designs. They are not construction drawings or development application documents, and they are not checked against planning controls or the National Construction Code. Check everything with your council and suitably qualified people.', links: ['accuracy'] },
  { id: 'accuracy', re: /\b(accura|survey|boundary|data source|where does .* data|setbacks? (are|accura|right))/i,
    a: 'Lot boundaries come from the NSW and Queensland cadastre and are drawn to the recorded boundary, cropped and redrawn. They are not a survey. Setbacks are indicative, taken from council documents where held and otherwise the NSW Housing Code or the Queensland Development Code, and can be wrong or out of date. Confirm with your council.', links: ['accuracy'] },
  { id: 'areas', re: /\b(where|which (areas?|states?|regions?)|nsw|queensland|qld|victoria|vic|sa\b|wa\b|tas)\b.*\b(work|cover|available|support)|\bcoverage\b/i,
    a: 'Glide Inside is built for regional New South Wales and Queensland. Lot data comes from NSW Spatial Services and the State of Queensland. Zoning is looked up for NSW only, so check zoning with the council in Queensland.', links: ['accuracy'] },
  { id: 'granny', re: /\b(granny flat|secondary dwelling|shed|duplex)\b/i,
    a: 'Yes, Glide Inside Residential has starting plans for granny flats, duplexes, 4 bedroom houses, sheds and extensions. In NSW a secondary dwelling is generally limited to 60 square metres of floor area outside rural zones, but rules vary by zone and council (general information as at 15/11/2026). Concept plans are not approval documents.', links: ['tool'] },
  { id: 'export', re: /\b(export|pdf|dxf|plan set|3d model|glb|obj|download)\b/i,
    a: 'A Plan Pack (A$30 per job) unlocks an A3 PDF plan set drawn to scale, a DXF for CAD, 3D model files in GLB and OBJ and an interactive HTML file that opens offline. You can export again as often as you like for 12 months. Plan sets are concept only.', links: ['pricing'] },
  { id: 'account', re: /\b(account|sign ?up|log ?in|register|password)\b/i,
    a: 'No account is needed to draw. Your work saves in your browser. When you pay, Stripe collects your email and it is used to restore your purchase. Builders and their clients use private portal logins.', links: ['tool'] },
  { id: 'engineering', re: /\b(engineer(ing)?|footings?|stormwater|site classification|jce)\b/i,
    a: 'Glide Inside is run by JCE Infrastructure Pty Ltd, a civil and hydraulic engineering consultancy. Engineering input is provided by JCE under a separate engagement, and not every service is available in every area. I cannot give fees or quotes. Please send an enquiry and the team will reply.', links: ['enquiry'] },
  { id: 'privacy', re: /\b(privacy|my data|personal information|stored|anthropic|data safe)\b/i,
    a: 'This assistant is AI. I do not keep a transcript of our chat. If you request a call back, your name, phone number, email and note are sent to Jayden at Glide Inside so he can call you, and a copy is kept so the request is not lost. Marketing is opt in and never ticked for you. The privacy policy has the full detail.', links: [] },
  { id: 'contact', re: /\b(contact (you|us|the team|someone)|your (email|phone( number)?)|phone number|email address|speak to|talk to|call (you|us|back)|real person|human)\b/i,
    a: `You can email ${CONTACT.email} or call ${CONTACT.phone}. You can also request a call back here: Jayden will call you, usually within one business day after you send the request.`, links: ['enquiry', 'demo'] },
];

/** Topics the assistant must not advise on. Deterministic refusal, then handoff. */
export const REFUSALS = [
  { id: 'feasibility', re: /\bguarantee|\b(can|could|may) i\b[^?.]*\b(build|subdivide|develop|extend|add)\b|\b(will|would)\b[^?.]*\b(approv|get through|pass|be allowed|be accepted|be permitted)|\bam i allowed\b|\bis it (allowed|legal|permitted)\b|\bwill (i|we) be able to\b/i,
    a: 'I cannot say whether something can be built, approved or subdivided, and I cannot guarantee setbacks. Those depend on your site, your council and the rules at the time. The tool shows an indicative envelope only. Please check with your council, or send us an enquiry.', links: ['accuracy', 'enquiry'] },
  { id: 'fees', re: /\b(engineering|engineer|jce|drafting|design|stormwater|footing)\b.*\b(fee|fees|quote|quotation|price|cost|charge|rate)\b|\b(fee|fees|quote|quotation|hourly rate)\b.*\b(engineer|engineering|jce|drafting)\b/i,
    a: 'I cannot give engineering fees or quotes. Engineering is provided by JCE Infrastructure under a separate engagement. Please send an enquiry and the team will reply.', links: ['enquiry'] },
  { id: 'advice', re: /\b(legal advice|planning advice|certif(y|ication)|sign off|is (this|it) (legal|safe|structurally)|structural(ly)? (sound|ok))\b/i,
    a: 'I cannot give planning, legal or engineering certification advice. Glide Inside outputs are concept only. Please speak to your council and suitably qualified people, or send us an enquiry.', links: ['enquiry'] },
];

/** The plain text block given to the model. Keep it short: it is paid for on every uncached request. */
export function knowledgeText() {
  return [
    'Glide Inside is a trading name of JCE Infrastructure Pty Ltd. Products: Glide Inside Residential and Glide Inside Commercial. Built for regional NSW and Queensland.',
    'Residential: type an address, load lot boundary, neighbours, aerial, contours and indicative setbacks; place a house, 2D and 3D, walk through; concept plan set. Starting plans: granny flats, duplexes, 4 bedroom houses, sheds, extensions. Free to draw and view, no sign up.',
    'Residential prices (incl. GST): Plan Pack A$30 per job (PDF set A3 to scale, DXF, GLB and OBJ, offline HTML, 500 AI credits, re-export for 12 months). Add-ons A$10 each: 3D fly-through, complex renderings (ordered by email).',
    'Builders: private portal, own house designs, own colours and logo, a login per client, clients place the builder\'s designs on their real lot. Free 14 day trial for staff, no card. A$20 per job (one new project, confirmed before it is created), client logins free, no monthly fee, capped plans A$119 / A$219 / A$419 with 10 / 20 / 40 jobs coming soon. AI top ups A$10 per 300 credits. Optional send to JCE for an engineering and DA plans quote, only if the builder leaves it on and the client consents.',
    'Commercial (beta): industrial and commercial unit layouts on a real lot, roller doors, mezzanines, indicative parking. Commercial Developer A$50 per month incl. GST: unlimited plan set PDFs (C000 to C103), DXF, 150 AI messages a month, extra 100 for A$15. Yield, value and cost figures are estimates only, not valuation or financial advice.',
    'Subdivision concepts and 3D site models: priced by quote. The director is a qualified civil engineer (BEng Civil Hons, MIEAust) and can assist with preliminary subdivision feasibility.',
    'Limits: concept only, not a survey, not a development application, not construction drawings, not checked against planning controls or the NCC. Setbacks indicative, from council documents where held, else NSW Housing Code or Queensland Development Code. Zoning looked up for NSW only. Boundaries drawn to the recorded cadastre. Engineering by JCE is a separate engagement.',
    'Contact: hello@glideinside.com.au, 0477 207 027.',
  ].join('\n');
}

/** Deterministic answer. Returns { id, answer, links } or null. Refusals are checked first, then the FAQ. */
export function answerFromKnowledge(text) {
  const t = String(text || '');
  for (const r of REFUSALS) if (r.re.test(t)) return { id: `refusal:${r.id}`, answer: r.a, links: r.links, refusal: true };
  for (const f of FAQ) if (f.re.test(t)) return { id: `faq:${f.id}`, answer: f.a, links: f.links };
  return null;
}

/** Wanting to book. Deterministic, so a booking request never needs the model. */
export const BOOKING_WORDS = /\b(book|booking|appointment|schedule|demo|demonstration|presentation|meeting|consult(ation)?|call back|time to talk|chat with (someone|a person))\b/i;
