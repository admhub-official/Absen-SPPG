(() => {
  if (window.SuperAdminDashboard) return;
  const state = { loading: false, loadedAt: 0, data: null };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const role = () => String(window.AppState?.user?.Role || window.AppState?.user?.role || '').trim().toUpperCase().replace(/_/g, ' ');
  const isSuper = () => role() === 'SUPER ADMIN';
  const num = (v) => new Intl.NumberFormat('id-ID').format(Number(v) || 0);
  const money = (v) => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v)||0);
  const svg = (name) => {
    const paths={
      sppg:'<path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h2m2 0h2M9 14h2m2 0h2M9 18h6"/>',
      attendance:'<path d="M9 11l3 3L22 4"/><path d="M21 12a9 9 0 1 1-5.3-8.2"/>',
      payroll:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
      admins:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6m3-3h-6"/>',
      users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
      pending:'<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>',
      complaint:'<path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
      warning:'<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
      refresh:'<path d="M20 6v6h-6M4 18v-6h6"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m2 6a7 7 0 0 0 12 2.5L20 15"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.warning}</svg>`;
  };
  const qcount=(q,k)=>Array.isArray(q?.[k])?q[k].length:Number(q?.[k]||0);
  const dashboard=()=>document.getElementById('view-dashboard');
  function root(create=true){let node=document.getElementById('super-admin-overview');if(!node&&create){const view=dashboard();if(!view)return null;node=document.createElement('section');node.id='super-admin-overview';node.className='sa-overview';view.prepend(node);}return node;}
  function active(){const view=dashboard();return Boolean(isSuper()&&view&&!view.classList.contains('hidden'));}

  function render(data){
    if(!active())return;
    const view=dashboard();
    view.classList.add('super-admin-dashboard-active');
    const node=root();
    if(!node)return;
    const totals=data?.totals||{},quality=data?.quality||{},rows=Array.isArray(data?.bySppg)?data.bySppg:[];
    const employees=rows.reduce((s,r)=>s+Number(r.employees||0),0);
    const pendingSlips=rows.reduce((s,r)=>s+Number(r.pendingSlips||0),0);
    const openComplaints=rows.reduce((s,r)=>s+Number(r.openComplaints||0),0);
    const activeRows=rows.filter(r=>Number(r.employees||0)>0);
    const ranked=[...activeRows].sort((a,b)=>Number(b.attendanceRate||0)-Number(a.attendanceRate||0));
    const best=ranked[0]||null;
    const lowest=ranked.length?ranked[ranked.length-1]:null;
    const issues=[
      ['Nama duplikat',qcount(quality,'duplicateNames'),'Perlu verifikasi identitas'],
      ['Divisi kosong',qcount(quality,'withoutDivision'),'Lengkapi jabatan/divisi'],
      ['Gaji belum diatur',qcount(quality,'withoutSalary'),'Lengkapi gaji harian'],
      ['Rekening belum lengkap',qcount(quality,'withoutBank'),'Lengkapi data pembayaran'],
      ['Slip tanpa PDF',qcount(quality,'slipsWithoutPdf'),'Periksa penerbitan slip'],
      ['Sesi akun nonaktif',qcount(quality,'inactiveWithSession'),'Cabut sesi yang tersisa']
    ];
    const issueTotal=issues.reduce((s,x)=>s+Number(x[1]||0),0);
    const sorted=[...rows].sort((a,b)=>Number(a.attendanceRate||0)-Number(b.attendanceRate||0));
    const attentionTotal=issueTotal+pendingSlips+openComplaints;

    node.innerHTML=`
      <header class="sa-hero">
        <div class="sa-hero__content">
          <span class="sa-eyebrow">PUSAT KENDALI SUPER ADMIN</span>
          <h1>Dashboard Global Lintas SPPG</h1>
          <p>Perbandingan kehadiran, payroll, kualitas data, dan tindak lanjut seluruh unit dalam satu tampilan.</p>
        </div>
        <div class="sa-hero__meta">
          <span class="sa-health ${attentionTotal?'has-issues':'is-healthy'}"><i></i>${attentionTotal?`${num(attentionTotal)} tindak lanjut`:'Semua indikator baik'}</span>
          <button type="button" class="sa-refresh" data-sa-refresh>${svg('refresh')}<span>Muat Ulang</span></button>
        </div>
      </header>

      <div class="sa-kpis sa-kpis--six">
        ${[
          ['sppg','SPPG aktif',num(totals.sppg ?? rows.length),'Unit dalam pengawasan'],
          ['users','Total karyawan',num(employees),'Karyawan seluruh SPPG'],
          ['attendance','Kehadiran hari ini',`${num(totals.attendanceRate)}%`,'Rata-rata seluruh unit'],
          ['payroll','Total payroll',money(totals.payrollTotal),'Akumulasi slip diterbitkan'],
          ['pending','Slip menunggu TTD',num(pendingSlips),'Perlu tindakan penerima'],
          ['complaint','Pengaduan terbuka',num(openComplaints),'Belum selesai ditangani']
        ].map(([type,label,value,note])=>`<article class="sa-kpi sa-kpi--${type}"><div class="sa-kpi__icon">${svg(type)}</div><div class="sa-kpi__body"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div></article>`).join('')}
      </div>

      <section class="sa-insights">
        <article class="sa-insight sa-insight--best"><span>KEHADIRAN TERBAIK</span><strong>${esc(best?.sppg||'-')}</strong><b>${num(best?.attendanceRate||0)}%</b><small>${num(best?.employees||0)} karyawan</small></article>
        <article class="sa-insight sa-insight--watch"><span>PERLU DIPANTAU</span><strong>${esc(lowest?.sppg||'-')}</strong><b>${num(lowest?.attendanceRate||0)}%</b><small>${num(lowest?.employees||0)} karyawan</small></article>
        <article class="sa-insight sa-insight--admin"><span>ADMIN / AKUNTAN AKTIF</span><strong>${num(totals.admins)}</strong><b>akun</b><small>Pengelola operasional</small></article>
        <article class="sa-insight sa-insight--quality"><span>KUALITAS DATA</span><strong>${num(issueTotal)}</strong><b>temuan</b><small>Memerlukan pembenahan</small></article>
      </section>

      <div class="sa-layout">
        <section class="sa-panel sa-panel--wide">
          <div class="sa-panel__head"><div><span class="sa-panel__eyebrow">PERFORMA UNIT</span><h2>Perbandingan SPPG</h2><p>Klik nama SPPG pada dashboard utama untuk membuka data user dan drill-down.</p></div><span class="sa-panel__count">${num(rows.length)} unit</span></div>
          ${rows.length?`<div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>SPPG</th><th>Karyawan</th><th>Kehadiran</th><th>Punch lengkap</th><th>Payroll</th><th>TTD tertunda</th><th>Pengaduan</th></tr></thead><tbody>${sorted.map(r=>{const a=Number(r.attendanceRate||0),level=a>=90?'good':a>=70?'warning':'danger';return `<tr><td><strong class="sa-unit-name">${esc(r.sppg||'-')}</strong></td><td>${num(r.employees)}</td><td><div class="sa-progress sa-progress--${level}"><span><i style="width:${Math.max(0,Math.min(100,a))}%"></i></span><b class="${level}">${num(a)}%</b></div></td><td>${num(r.completePunchRate)}%</td><td>${money(r.payrollTotal)}</td><td><span class="sa-status ${Number(r.pendingSlips)?'warning':'neutral'}">${num(r.pendingSlips)}</span></td><td><span class="sa-status ${Number(r.openComplaints)?'danger':'neutral'}">${num(r.openComplaints)}</span></td></tr>`}).join('')}</tbody></table></div>`:'<div class="sa-empty">Belum ada data SPPG untuk ditampilkan.</div>'}
        </section>

        <aside class="sa-panel sa-panel--attention">
          <div class="sa-panel__head"><div><span class="sa-panel__eyebrow">PRIORITAS OPERASIONAL</span><h2>Perlu perhatian</h2></div><span class="sa-panel__count ${attentionTotal?'danger':''}">${num(attentionTotal)}</span></div>
          <div class="sa-action-summary">
            <div><span>Slip menunggu TTD</span><strong>${num(pendingSlips)}</strong></div>
            <div><span>Pengaduan terbuka</span><strong>${num(openComplaints)}</strong></div>
          </div>
          <div class="sa-issue-list">${issues.map(([label,count,note])=>`<article class="sa-issue ${Number(count)?'has-issue':''}"><div class="sa-issue__icon">${svg('warning')}</div><div><strong>${esc(label)}</strong><small>${esc(note)}</small></div><b>${num(count)}</b></article>`).join('')}</div>
        </aside>
      </div>
      <footer class="sa-updated">Data diperbarui ${new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date())}</footer>`;
    node.querySelector('[data-sa-refresh]')?.addEventListener('click',()=>load(true));
  }

  function loading(){if(!active())return;const node=root();if(node)node.innerHTML='<div class="sa-loading"><span></span><div><strong>Menyiapkan dashboard global</strong><small>Mengambil ringkasan seluruh SPPG…</small></div></div>';}
  function failure(error){const node=root(false);if(!node)return;node.innerHTML=`<div class="sa-error"><div>${svg('warning')}</div><strong>Dashboard global belum dapat dimuat</strong><p>${esc(error?.message||'Terjadi kesalahan saat mengambil data.')}</p><button type="button" data-sa-retry>Coba lagi</button></div>`;node.querySelector('[data-sa-retry]')?.addEventListener('click',()=>load(true));}
  async function load(force=false){if(!active()||state.loading||typeof window.apiCall!=='function')return;if(!force&&state.data&&Date.now()-state.loadedAt<120000){if(!root(false)?.dataset.rendered){render(state.data);root(false).dataset.rendered='1';}return;}state.loading=true;loading();try{state.data=await window.apiCall('getSuperAdminOverviewV3',{token:window.AppState?.token||localStorage.getItem('auth_token')})||{};state.loadedAt=Date.now();render(state.data);root(false).dataset.rendered='1';}catch(e){failure(e)}finally{state.loading=false}}
  function cleanup(){if(isSuper())return;root(false)?.remove();dashboard()?.classList.remove('super-admin-dashboard-active');state.data=null;state.loadedAt=0;}
  function schedule(){[0,150,500,1200].forEach(ms=>setTimeout(()=>isSuper()?load():cleanup(),ms));}
  function init(){schedule();window.addEventListener('hashchange',schedule);window.addEventListener('absen:app-ready',schedule);window.addEventListener('absen:session-changed',schedule);document.addEventListener('click',e=>{if(e.target.closest('[data-view="dashboard"]'))setTimeout(()=>load(),100)});}
  window.SuperAdminDashboard=Object.freeze({load,refresh:()=>load(true)});
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();