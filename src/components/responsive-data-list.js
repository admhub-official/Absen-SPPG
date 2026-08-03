const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export function renderResponsiveDataList(container,{columns=[],rows=[],rowKey='id',emptyMessage='Belum ada data',onSelect}={}){
 if(!container)return;
 if(!rows.length){container.innerHTML=`<div class="app-state app-state-empty">${esc(emptyMessage)}</div>`;return;}
 const head=columns.map(c=>`<th>${esc(c.label)}</th>`).join('');
 const body=rows.map((row,i)=>`<tr data-row="${i}" tabindex="0">${columns.map(c=>`<td data-label="${esc(c.label)}">${esc(typeof c.value==='function'?c.value(row):row[c.key])}</td>`).join('')}</tr>`).join('');
 container.innerHTML=`<div class="responsive-data-list"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
 container.querySelectorAll('[data-row]').forEach(el=>{const open=()=>onSelect?.(rows[Number(el.dataset.row)],rowKey);el.addEventListener('click',open);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});});
}
