import { assert } from "jsr:@std/assert@1";
const read=(path:string)=>Deno.readTextFile(path);
Deno.test("legacy frontend shell is externalized and cacheable",async()=>{
  const index=await read("index.html"),js=await read("src/legacy/index-app.js"),css=await read("src/legacy/index-shell.css"),sw=await read("sw.js"),config=await read("supabase-config.js");
  assert(index.includes('./src/legacy/index-shell.css'));assert(index.includes('./src/legacy/index-app.js'));
  assert(!index.includes('<style>'));assert(!index.includes('const APP_CONFIG='));
  assert(js.includes("const FACEAPI_CDN_URL='https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js'"));
  assert(!/<script[^>]+face-api/i.test(index));
  assert(js.includes('let CropDrawFrame=0'));assert(js.includes('requestAnimationFrame'));
  assert(!js.includes('canvas.width=size;canvas.height=size;'));
  assert(sw.includes("'./src/legacy/index-shell.css'"));assert(sw.includes("'./src/legacy/index-app.js'"));
  assert(!config.includes('installLegacyFrontendPerformanceGuards'));
  assert(new TextEncoder().encode(index).length<200000);assert(css.length>1000);
});
Deno.test("frequently rerendered legacy lists use delegated events",async()=>{
  const js=await read("src/legacy/index-app.js");
  for(const forbidden of ["tbody.querySelectorAll('.attendance-row-check').forEach","container.querySelectorAll('[data-user-index]').forEach","container.querySelectorAll('[data-log-index]').forEach","body.querySelectorAll('.payroll-row-check').forEach","body.querySelectorAll('.payroll-money-input').forEach","body.querySelectorAll('[data-setting-key]').forEach","accessBody.querySelectorAll('.config-delete-access').forEach","body.querySelectorAll('.config-role-select').forEach","list.querySelectorAll('.complaint-card').forEach"]){assert(!js.includes(forbidden),`per-render listener remains: ${forbidden}`);}
  for(const required of ["$('#absen-table-body')?.addEventListener('change'","$('#users-grid-container')?.addEventListener('click'","$('#log-list-container')?.addEventListener('click'","$('#admin-payroll-body')?.addEventListener('change'","$('#payroll-adjustment-body')?.addEventListener('input'","$('#admin-complaint-list')?.addEventListener('click'"]){assert(js.includes(required),`delegated listener missing: ${required}`);}
});
