// Builds one export of the largest residential house (or the commercial fixture) and prints time and memory. Use under a heap cap to approximate a Worker:
//   T=pdf|glb|html|obj|dxf W=w319|double|commercial node --expose-gc --max-old-space-size=64 tools/export-memory/measure.mjs
// A run that is killed (exit 134, "heap out of memory") needs more heap than the cap. HOUSES=<json> overrides the house list.
import fs from 'node:fs';
const S=new URL('../../', import.meta.url).pathname.replace(/\/$/, ''), type=process.env.T||'pdf', which=process.env.W||'w319';
const { jsPDF } = await import(S+'/node_modules/jspdf/dist/jspdf.node.min.js');
const { buildExport } = await import(S+'/src/premium/exporters/index.js');
const catalogue = await import(S+'/src/catalogue/index.js').then(m=>m.catalogue??m.default??m);
let project;
if(which==='commercial'){const {commercialProject}=await import(S+'/tests/helpers/commercial-fixture.mjs');project=commercialProject({plain:false});}
else if(which==='double'){const {createFromTemplate}=await import(S+'/src/catalogue/templates.js');project=createFromTemplate('house_double');}
else project=JSON.parse(fs.readFileSync(process.env.HOUSES || '/home/claude/wt-integrate2/GlideInside/golive/builder-houses/hunter-homes.json','utf8'))[0].project;
const t0=Date.now(),c0=process.cpuUsage();
const r=await buildExport(type,structuredClone(project),{jsPDF,loadJsPDF:async()=>jsPDF,catalogue,terms:{version:'1.1',acceptedAt:new Date().toISOString()},config:{}});
const c=process.cpuUsage(c0);const m=process.memoryUsage();
console.log(JSON.stringify({type,which,bytes:r.bytes.length,wallMs:Date.now()-t0,cpuMs:Math.round((c.user+c.system)/1000),extMB:Math.round(m.external/1048576),abMB:Math.round(m.arrayBuffers/1048576)}));
