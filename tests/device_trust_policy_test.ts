const read=(path:string)=>Deno.readTextFile(path);

Deno.test('Device Trust policy defaults to disabled',async()=>{
  const migration=await read('supabase/migrations/20260804095000_device_trust_policy_defaults.sql');
  if(!migration.includes("'ATTENDANCE_DEVICE_ENFORCEMENT'"))throw new Error('Device Trust flag key missing');
  if(!/ATTENDANCE_DEVICE_ENFORCEMENT'[\s\S]*?false/.test(migration))throw new Error('Device Trust must default to disabled');
  for(const key of ['requireTrusted','showMyDevicesWhenDisabled','enabledSppg','disabledSppg']){
    if(!migration.includes(key))throw new Error(`Device Trust config missing ${key}`);
  }
});

Deno.test('Super Admin settings expose a dedicated Device Trust tab',async()=>{
  const page=await read('src/pages/release/release-operations-page.js');
  for(const value of ['data-release-tab="device"','Kebijakan Device Trust','ATTENDANCE_DEVICE_ENFORCEMENT','requireTrusted','enabledSppg','disabledSppg']){
    if(!page.includes(value))throw new Error(`Device Trust settings missing ${value}`);
  }
  if(!page.includes("role()==='SUPER ADMIN'"))throw new Error('Device Trust writes must remain Super Admin only');
  if(!page.includes('workspace.replaceChildren()'))throw new Error('Tab workspace must clear inactive content');
});

Deno.test('Device Trust settings use compact responsive styling',async()=>{
  const bootstrap=await read('src/app/bootstrap.js');
  const css=await read('src/styles/device-trust-policy.css');
  if(!bootstrap.includes('device-trust-policy.css'))throw new Error('Bootstrap must load Device Trust policy styles');
  if(!css.includes('.compact-form-grid'))throw new Error('Compact Device Trust layout missing');
  if(!css.includes('@media(max-width:640px)'))throw new Error('Mobile Device Trust layout missing');
});
