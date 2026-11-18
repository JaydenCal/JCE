import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { toEngineeringPDF } from '../src/premium/exporters/eng/index.js';
const root = new URL('../../', import.meta.url).pathname;
const houses = JSON.parse(fs.readFileSync(root + 'golive/builder-houses/hunter-homes.json', 'utf8'));
const logo = 'data:image/png;base64,' + fs.readFileSync('/tmp/sample-logo.png').toString('base64');
const builder = { name: 'Sample Homes Pty Ltd', logo, details: { licence: '123456C', abn: '51 824 753 556', address: 'Unit 4, 118 Industrial Drive, Thornton NSW 2322', phone: '02 5550 0100', email: 'hello@samplehomes.com.au', website: 'www.samplehomes.com.au' }, client: { name: 'Jordan and Sam Example' } };
const bytes = await toEngineeringPDF(houses[0].project, { jsPDF, builder, date: new Date(2026, 10, 18) });
fs.writeFileSync('/tmp/eng-builder.pdf', Buffer.from(bytes));
