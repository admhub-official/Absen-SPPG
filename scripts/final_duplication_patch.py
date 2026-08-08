from pathlib import Path
import re

p=Path('index.html')
s=p.read_text(encoding='utf-8')


def replace_once(old,new,label):
    global s
    count=s.count(old)
    if count!=1: raise RuntimeError(f'{label}: expected 1 match, found {count}')
    s=s.replace(old,new,1)


def replace_func(name,new_source):
    global s
    for prefix in ('async function ','function '):
        needle=prefix+name+'('
        if needle in s: break
    else: raise RuntimeError(f'{name}: declaration missing')
    pos=s.index(needle)
    line_start=s.rfind('\n',0,pos)+1
    indent=s[line_start:pos]
    brace=s.index('{',pos)
    marker='\n'+indent+'}'
    close=s.find(marker,brace)
    if close<0: raise RuntimeError(f'{name}: close missing')
    end=close+len(marker)
    if end<len(s) and s[end]=='\n': end+=1
    s=s[:line_start]+new_source.rstrip()+'\n'+s[end:]

anchor="""function bindAccessibleActivation(element,handler){
  if(!element)return;
  element.addEventListener('click',handler);
  element.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();handler(event);
  });
}
function parseDateValue(value){"""
replacement="""function bindAccessibleActivation(element,handler){
  if(!element)return;
  element.addEventListener('click',handler);
  element.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();handler(event);
  });
}
function dismissModal(modalId){document.getElementById(modalId)?.classList.remove('active');}
function bindPaginationControls({prevId,nextId,canPrev,canNext,onPrev,onNext}){
  document.getElementById(prevId)?.addEventListener('click',()=>{if(canPrev())onPrev();});
  document.getElementById(nextId)?.addEventListener('click',()=>{if(canNext())onNext();});
}
function skeletonCardsMarkup(count=1){
  const card='<div class="skel-card"><div class="skel skel-avatar"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>';
  return Array(count).fill(card).join('');
}
function skeletonRowsMarkup(count=1){
  const row='<div class="skel-row"><div class="skel skel-avatar"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>';
  return Array(count).fill(row).join('');
}
function tableMessageMarkup(message,style=''){
  const styleAttr=style?` style="${style}"`:'';
  return `<div class="table-empty"${styleAttr}>${escapeHtml(message)}</div>`;
}
function parseDateValue(value){"""
replace_once(anchor,replacement,'helper insertion')

# Common loading/error rendering.
s,count=re.subn(r"  container\.innerHTML = Array\(8\)\.fill\(`<div class=\"skel-card\">.*?</div>`\)\.join\(''\);","  container.innerHTML = skeletonCardsMarkup(8);",s,count=1,flags=re.S)
if count!=1: raise RuntimeError(f'user skeleton count={count}')
replace_once("    container.innerHTML = `<div class=\"table-empty\" style=\"grid-column:1/-1\">Gagal memuat data: ${e.message}</div>`;","    container.innerHTML = tableMessageMarkup(`Gagal memuat data: ${e.message}`,'grid-column:1/-1');",'user load error')
log_start=s.index('async function loadAdminLog(){')
log_end=s.index('\n}\n\nfunction filterAndRenderLog',log_start)+2
log=s[log_start:log_end]
log,count=re.subn(r"  container\.innerHTML = `.*?`;\n  try \{","  container.innerHTML = skeletonRowsMarkup(3);\n  try {",log,count=1,flags=re.S)
if count!=1: raise RuntimeError(f'log skeleton count={count}')
log=log.replace("    container.innerHTML = `<div class=\"table-empty\">Gagal memuat log: ${e.message}</div>`;","    container.innerHTML = tableMessageMarkup(`Gagal memuat log: ${e.message}`);")
s=s[:log_start]+log+s[log_end:]

# One accessible activation helper for both dynamic cards and log rows.
s,count=re.subn(r"  container\.querySelectorAll\('\[data-user-index\]'\)\.forEach\(row=>\{\n\s*const open=.*?\n\s*\}\);","  container.querySelectorAll('[data-user-index]').forEach(row=>bindAccessibleActivation(row,()=>openUserDetail(Number(row.dataset.userIndex))));",s,count=1,flags=re.S)
if count!=1: raise RuntimeError(f'user activation count={count}')
s,count=re.subn(r"  container\.querySelectorAll\('\[data-log-index\]'\)\.forEach\(item=>\{.*?\n  \}\);","  container.querySelectorAll('[data-log-index]').forEach(item=>bindAccessibleActivation(item,()=>openLogDetail(Number(item.dataset.logIndex))));",s,count=1,flags=re.S)
if count!=1: raise RuntimeError(f'log activation count={count}')

replace_func('formatWaktu',"""function formatWaktu(v){
  const d=parseDateValue(v);if(!d)return v||'-';
  return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
}""")
replace_func('formatDateTime',"""function formatDateTime(value){
  const date=parseDateValue(value);return date?date.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'-';
}""")
replace_func('profilePasswordErrorMessage',"function profilePasswordErrorMessage(error,fallback){return parseApiError(error,fallback).message;}")
replace_func('handleConfirmDeleteUser',"""async function handleConfirmDeleteUser(reason){
  const u=AdminState.selectedUser;if(!u)return;
  const userId=u.ID_User;
  await withBusyButton($('#btn-admin-delete-user'),'<div class="spinner" style="width:18px;height:18px;border-width:2px"></div>',async()=>{
    try{
      const r=await apiCall('deleteData',{token:AppState.token,menu:'users',id:userId,reason});
      if(r&&r.success){showAlert('User berhasil dihapus','success');dismissModal('modal-admin-delete-user');AdminState.selectedUser=null;switchView('admin-users');loadAdminUsers();}
      else showAlert(r?.message||'Gagal menghapus user','error');
    }catch(error){showAlert(parseApiError(error).message,'error');}
  });
}""")

replace_once("  $('#btn-close-admin-update-user')?.addEventListener('click',()=>$('#modal-admin-update-user').classList.remove('active'));\n  $('#btn-cancel-admin-update-user')?.addEventListener('click',()=>$('#modal-admin-update-user').classList.remove('active'));","  bindClicks(['btn-close-admin-update-user','btn-cancel-admin-update-user'],()=>dismissModal('modal-admin-update-user'));",'admin modal pair')
replace_once("  $('#btn-close-log-detail')?.addEventListener('click',()=>$('#modal-log-detail').classList.remove('active'));\n  $('#btn-close-log-detail-footer')?.addEventListener('click',()=>$('#modal-log-detail').classList.remove('active'));","  bindClicks(['btn-close-log-detail','btn-close-log-detail-footer'],()=>dismissModal('modal-log-detail'));",'log modal pair')

# Replace the whole pagination registration section, avoiding whitespace-sensitive matching.
section_start=s.index('  // Admin: pagination\n')
section_end=s.index("  $('#btn-open-edit-profil').addEventListener",section_start)
pagination="""  // Admin: pagination
  bindPaginationControls({prevId:'absen-prev-btn',nextId:'absen-next-btn',canPrev:()=>AdminState.absenPage>1,canNext:()=>AdminState.absenPage<Math.ceil(AdminState.absenTotal/AdminState.absenPageSize),onPrev:()=>{AdminState.absenPage--;loadAdminAbsen();},onNext:()=>{AdminState.absenPage++;loadAdminAbsen();}});
  bindPaginationControls({prevId:'users-prev-btn',nextId:'users-next-btn',canPrev:()=>AdminState.userPage>1,canNext:()=>AdminState.userPage<Math.ceil(AdminState.userTotal/AdminState.userPageSize),onPrev:()=>{AdminState.userPage--;loadAdminUsers();},onNext:()=>{AdminState.userPage++;loadAdminUsers();}});
  bindPaginationControls({prevId:'log-prev-btn',nextId:'log-next-btn',canPrev:()=>AdminState.logPage>1,canNext:()=>AdminState.logPage<Math.max(1,Math.ceil(AdminState.filteredLogs.length/AdminState.logPageSize)),onPrev:()=>{AdminState.logPage--;renderLogList();},onNext:()=>{AdminState.logPage++;renderLogList();}});
"""
s=s[:section_start]+pagination+s[section_end:]

p.write_text(s,encoding='utf-8')

# Force installed clients to acquire the final consolidated shell.
release=Path('src/app/release-version.js')
r=release.read_text(encoding='utf-8')
if '26.11.55' not in r or 'absen-sppg-hadirly-v96' not in r: raise RuntimeError('unexpected release baseline')
release.write_text(r.replace('26.11.55','26.11.56').replace('absen-sppg-hadirly-v96','absen-sppg-hadirly-v97'),encoding='utf-8')
for test in Path('tests').glob('*.ts'):
    q=test.read_text(encoding='utf-8').replace('26.11.55','26.11.56').replace('absen-sppg-hadirly-v96','absen-sppg-hadirly-v97')
    test.write_text(q,encoding='utf-8')

h=Path('tests/codebase_hygiene_test.ts')
q=h.read_text(encoding='utf-8')
if 'frontend residual duplication is centralized' not in q:
    q += '''\n\nDeno.test("frontend residual duplication is centralized", async () => {\n  const index = await read("index.html");\n  for (const helper of ["function bindPaginationControls(","function dismissModal(modalId)","function skeletonCardsMarkup(count=1)","function skeletonRowsMarkup(count=1)","function tableMessageMarkup(message,style='')"]) {\n    if (!index.includes(helper)) throw new Error(`residual shared helper missing ${helper}`);\n  }\n  for (const obsolete of ["row.addEventListener('click',open);row.addEventListener('keydown'","item.addEventListener('click',open);","$('#absen-prev-btn')?.addEventListener","$('#users-prev-btn')?.addEventListener","$('#log-prev-btn')?.addEventListener"]) {\n    if (index.includes(obsolete)) throw new Error(`duplicated frontend pattern remains ${obsolete}`);\n  }\n  if (!index.includes("function profilePasswordErrorMessage(error,fallback){return parseApiError(error,fallback).message;}")) throw new Error("profile password errors must use canonical parser");\n  if (!index.includes("container.innerHTML = skeletonCardsMarkup(8)") || !index.includes("container.innerHTML = skeletonRowsMarkup(3)")) throw new Error("loading skeleton markup must use shared helpers");\n});\n'''
h.write_text(q,encoding='utf-8')
print('residual duplication patch prepared')
