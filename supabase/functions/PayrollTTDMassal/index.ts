import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (value: unknown) => String(value ?? "").trim();
const safe = (value: unknown) => text(value).normalize("NFKD").replace(/[^\x20-\x7e]/g, "?");
const safePath = (value: unknown) => text(value).normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "data";
const rupiah = (value: unknown) => `Rp ${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;
const dateOnly = (value: unknown) => text(value).split("T")[0].split(" ")[0];
const formatDate = (value: unknown) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${dateOnly(value)}T00:00:00+07:00`));
const formatDateTime = (value: Date) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(value).replace(/\./g, ":") + " WIB";

function decodePng(value: unknown, label: string): Uint8Array {
  const match = text(value).match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error(`${label} wajib berupa PNG`);
  const bytes = Uint8Array.from(atob(match[1].replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 100 || bytes.length > 1_500_000 || !header.every((b, i) => bytes[i] === b)) throw new Error(`${label} tidak valid`);
  return bytes;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function authenticate(token: unknown) {
  const clean = text(token);
  if (!clean) throw new Error("SESI_HABIS");
  const { data: session } = await db.from("Sessions").select("Type,ID_User,Expires_At").eq("Token", clean).maybeSingle();
  if (!session || text(session.Type).toLowerCase() !== "user" || new Date(session.Expires_At).getTime() < Date.now()) throw new Error("SESI_HABIS");
  const { data: user } = await db.from("Users").select("ID_User,Email,Role,SPPG,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  const role = text(user?.Role).toUpperCase().replace(/_/g, " ");
  if (!user || user.Status_Aktif !== true || !["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(role)) throw new Error("Akses ditolak");
  return { id: text(user.ID_User), email: text(user.Email), role, sppg: text(user.SPPG) };
}
async function scopedSppg(auth: any): Promise<string[] | null> {
  if (auth.role === "SUPER ADMIN") return null;
  const { data } = await db.from("Akses_Email").select("SPPG,Aktif").ilike("Email", auth.email);
  const values = [...new Set((data || []).filter((r: any) => r.Aktif === true || String(r.Aktif) === "1").map((r: any) => text(r.SPPG)).filter(Boolean))];
  return values.length ? values : [auth.sppg].filter(Boolean);
}
async function selectAll(table: string, columns: string, apply: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0;; from += 1000) {
    const result = await apply(db.from(table).select(columns)).range(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    out.push(...(result.data || []));
    if ((result.data || []).length < 1000) return out;
  }
}
async function getAllowedPublishedSlips(auth: any): Promise<any[]> {
  const sppg = await scopedSppg(auth);
  const users = await selectAll("Users", "ID_User,Nama_Lengkap,Jabatan_Divisi,SPPG", (q) => sppg ? q.in("SPPG", sppg) : q);
  const userMap = new Map(users.map((u: any) => [text(u.ID_User), u]));
  const ids = [...userMap.keys()];
  if (!ids.length) return [];
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const { data, error } = await db.from("Slip_Gaji")
      .select("ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Jumlah_Hari_Kerja,Gaji_Harian,Subtotal_Gaji,Lembur_Nominal,Bonus,Potongan,Keterangan_Potongan,Total_Gaji_Diterima,Status_Penerbitan,Diterbitkan_At,Dicetak_At,PDF_Storage_Path,PDF_SHA256,TTD_Penerima_Path,Ditandatangani_Penerima_At")
      .eq("Status_Penerbitan", "DITERBITKAN").in("ID_User", ids.slice(i, i + 400));
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows.map((r: any) => ({ ...r, _user: userMap.get(text(r.ID_User)) })).sort((a, b) => new Date(b.Diterbitkan_At || 0).getTime() - new Date(a.Diterbitkan_At || 0).getTime());
}
async function buildPdf(input: { slip: any; payroll: any; user: any; logo: Uint8Array; accountant: Uint8Array; head: Uint8Array; signedAt: Date }) {
  const { slip, payroll, user, logo, accountant, head, signedAt } = input;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoImg = await pdf.embedPng(logo);
  const accountantImg = await pdf.embedPng(accountant);
  const headImg = await pdf.embedPng(head);
  const navy = rgb(.06, .12, .24), muted = rgb(.35, .4, .48), border = rgb(.86, .89, .93), pale = rgb(.96, .97, .99), green = rgb(.05, .45, .28);
  const left = 42, right = 553, width = right - left;
  pdf.setTitle(safe(`Slip Gaji ${user.Nama_Lengkap}`));
  pdf.setCreator("Absen-SPPG TTD Massal");
  pdf.setCreationDate(signedAt); pdf.setModificationDate(signedAt);
  const lw = 66, lh = Math.min(68, lw * (logoImg.height / logoImg.width));
  page.drawImage(logoImg, { x: left, y: 765, width: lw, height: lh });
  page.drawText("SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)", { x: left + 100, y: 805, size: 11, font: bold, color: navy });
  page.drawText(safe(user.SPPG || "DARMARAJA").toUpperCase(), { x: left + 100, y: 781, size: 17, font: bold, color: navy });
  page.drawLine({ start: { x: left, y: 755 }, end: { x: right, y: 755 }, thickness: 1.2, color: navy });
  page.drawText("SLIP GAJI", { x: left, y: 721, size: 20, font: bold, color: navy });
  page.drawText(`No. ${safe(slip.ID_Slip)}`, { x: left, y: 704, size: 8.5, font: regular, color: muted });
  page.drawText(`Diperbarui ${formatDateTime(signedAt)}`, { x: right - 190, y: 704, size: 8.5, font: regular, color: muted });
  page.drawRectangle({ x: left, y: 614, width, height: 70, color: pale, borderColor: border, borderWidth: 1 });
  [["Nama", user.Nama_Lengkap], ["Jabatan / Divisi", user.Jabatan_Divisi || "-"], ["Periode", `${formatDate(slip.Periode_Mulai)} s.d. ${formatDate(slip.Periode_Akhir)}`]].forEach((row, i) => {
    const y = 662 - i * 20; page.drawText(row[0], { x: left + 14, y, size: 9, font: bold, color: muted }); page.drawText(":", { x: left + 112, y, size: 9, font: regular, color: muted }); page.drawText(safe(row[1]).slice(0, 72), { x: left + 126, y, size: 10, font: regular, color: navy });
  });
  page.drawText("RINCIAN PENGHASILAN", { x: left, y: 581, size: 10, font: bold, color: navy });
  page.drawRectangle({ x: left, y: 544, width, height: 27, color: navy });
  page.drawText("KOMPONEN", { x: left + 14, y: 554, size: 9, font: bold, color: rgb(1,1,1) });
  page.drawText("PERHITUNGAN", { x: left + 238, y: 554, size: 9, font: bold, color: rgb(1,1,1) });
  page.drawText("NOMINAL", { x: right - 76, y: 554, size: 9, font: bold, color: rgb(1,1,1) });
  const components = [["Gaji pokok", `${rupiah(slip.Gaji_Harian)} x ${Number(slip.Jumlah_Hari_Kerja)||0} hari`, Number(slip.Subtotal_Gaji)||0], ["Lembur", "Sesuai rekap", Number(slip.Lembur_Nominal)||0], ["Bonus / Tambahan", "Sesuai rekap", Number(slip.Bonus)||0], ["Potongan", safe(slip.Keterangan_Potongan || "Tidak ada keterangan"), -(Number(slip.Potongan)||0)]];
  let y = 512;
  for (let i = 0; i < components.length; i++) {
    const c: any = components[i]; if (i % 2) page.drawRectangle({ x: left, y: y - 12, width, height: 36, color: pale });
    page.drawText(c[0], { x: left + 14, y, size: 10, font: bold, color: navy }); page.drawText(String(c[1]).slice(0, 38), { x: left + 238, y, size: 9, font: regular, color: muted });
    const amount = c[2] < 0 ? `- ${rupiah(Math.abs(c[2]))}` : rupiah(c[2]); page.drawText(amount, { x: right - 14 - regular.widthOfTextAtSize(amount, 9), y, size: 9, font: regular, color: navy }); page.drawLine({ start: { x: left, y: y - 13 }, end: { x: right, y: y - 13 }, thickness: .7, color: border }); y -= 36;
  }
  page.drawRectangle({ x: left, y: 338, width, height: 54, color: rgb(.92,.98,.95), borderColor: rgb(.65,.89,.76), borderWidth: 1 });
  page.drawText("TOTAL GAJI DITERIMA", { x: left + 16, y: 359, size: 11, font: bold, color: green });
  const total = rupiah(slip.Total_Gaji_Diterima); page.drawText(total, { x: right - 16 - bold.widthOfTextAtSize(total, 16), y: 355, size: 16, font: bold, color: green });
  const columns = [{ x: left, title: "Mengetahui,", role: "AKUNTAN", name: payroll.Nama_Akuntan, image: accountantImg }, { x: 218, title: "Menyetujui,", role: "KEPALA SPPG", name: payroll.Nama_Kepala_SPPG, image: headImg }, { x: 394, title: "Penerima,", role: "PENERIMA", name: user.Nama_Lengkap, image: null }];
  for (const col of columns) {
    page.drawText(col.title, { x: col.x, y: 286, size: 8.5, font: regular, color: navy });
    if (col.image) { const scale = col.image.scaleToFit(115, 55); page.drawImage(col.image, { x: col.x + (145 - scale.width) / 2, y: 219, width: scale.width, height: scale.height }); }
    const name = safe(col.name).slice(0, 30), nw = bold.widthOfTextAtSize(name, 9); page.drawText(name, { x: col.x + Math.max(0, (145 - nw) / 2), y: 200, size: 9, font: bold, color: navy });
    page.drawLine({ start: { x: col.x, y: 190 }, end: { x: col.x + 145, y: 190 }, thickness: .8, color: muted });
    const rw = regular.widthOfTextAtSize(col.role, 7.5); page.drawText(col.role, { x: col.x + Math.max(0, (145 - rw) / 2), y: 176, size: 7.5, font: regular, color: muted });
  }
  page.drawText("Dokumen ini telah diperbarui melalui proses TTD massal. Nilai payroll tidak berubah.", { x: left, y: 82, size: 8, font: regular, color: muted });
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}
async function listAction(auth: any, data: any) {
  const all = await getAllowedPublishedSlips(auth);
  const search = text(data.search).toLowerCase();
  const filtered = search ? all.filter((r: any) => [r._user?.Nama_Lengkap, r._user?.SPPG, r.ID_Payroll, r.ID_Slip].some((v) => text(v).toLowerCase().includes(search))) : all;
  const page = Math.max(1, Number(data.page) || 1), pageSize = Math.min(2000, Math.max(10, Number(data.pageSize) || 50));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize).map((r: any) => ({ idSlip: r.ID_Slip, idPayroll: r.ID_Payroll, nama: r._user?.Nama_Lengkap || r.ID_User, sppg: r._user?.SPPG || "-", periodeMulai: r.Periode_Mulai, periodeAkhir: r.Periode_Akhir, total: r.Total_Gaji_Diterima, diterbitkanAt: r.Diterbitkan_At, dicetakAt: r.Dicetak_At, pdfPath: r.PDF_Storage_Path }));
  return { rows, total: filtered.length, page, pageSize };
}
async function startAction(auth: any, data: any) {
  const ids = [...new Set((Array.isArray(data.ids) ? data.ids : []).map(text).filter(Boolean))];
  if (!ids.length || ids.length > 2500) throw new Error("Pilih minimal satu dan maksimal 2.500 slip");
  const namaAkuntan = text(data.namaAkuntan), namaKepala = text(data.namaKepalaSppg);
  if (!namaAkuntan || !namaKepala) throw new Error("Nama Akuntan dan Kepala SPPG wajib diisi");
  const accountant = decodePng(data.tandaTanganAkuntanBase64, "Tanda tangan Akuntan"), head = decodePng(data.tandaTanganKepalaSppgBase64, "Tanda tangan Kepala SPPG");
  const allowed = new Set((await getAllowedPublishedSlips(auth)).map((r: any) => text(r.ID_Slip)));
  if (ids.some((id) => !allowed.has(id))) throw new Error("Ada slip di luar cakupan atau belum diterbitkan");
  const jobId = `TTDM_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const accountantPath = `ttd-massal/${jobId}/akuntan.png`, headPath = `ttd-massal/${jobId}/kepala-sppg.png`;
  const aUp = await db.storage.from("tanda-tangan").upload(accountantPath, accountant, { contentType: "image/png", upsert: false }); if (aUp.error) throw new Error(aUp.error.message);
  const hUp = await db.storage.from("tanda-tangan").upload(headPath, head, { contentType: "image/png", upsert: false }); if (hUp.error) { await db.storage.from("tanda-tangan").remove([accountantPath]); throw new Error(hUp.error.message); }
  const { error: jobError } = await db.from("Payroll_TTD_Massal_Job").insert({ ID_Job: jobId, Dibuat_Oleh: auth.id, Nama_Akuntan: namaAkuntan, Nama_Kepala_SPPG: namaKepala, TTD_Akuntan_Path: accountantPath, TTD_Kepala_SPPG_Path: headPath, Total_Item: ids.length, Status: "ANTRI" });
  if (jobError) throw new Error(jobError.message);
  for (let i = 0; i < ids.length; i += 500) { const { error } = await db.from("Payroll_TTD_Massal_Item").insert(ids.slice(i, i + 500).map((id) => ({ ID_Job: jobId, ID_Slip: id }))); if (error) throw new Error(error.message); }
  return { jobId, total: ids.length };
}
async function processAction(auth: any, data: any) {
  const jobId = text(data.jobId); if (!jobId) throw new Error("Job tidak ditemukan");
  const { data: job } = await db.from("Payroll_TTD_Massal_Job").select("*").eq("ID_Job", jobId).maybeSingle();
  if (!job || (auth.role !== "SUPER ADMIN" && text(job.Dibuat_Oleh) !== auth.id)) throw new Error("Job tidak ditemukan");
  const { data: items, error: itemError } = await db.from("Payroll_TTD_Massal_Item").select("ID_Slip").eq("ID_Job", jobId).eq("Status", "ANTRI").order("ID_Slip").limit(25); if (itemError) throw new Error(itemError.message);
  if (!(items || []).length) return await statusAction(auth, { jobId });
  await db.from("Payroll_TTD_Massal_Job").update({ Status: "PROSES", Updated_At: new Date().toISOString() }).eq("ID_Job", jobId);
  const [logoFile, accountantFile, headFile] = await Promise.all([db.storage.from("Logo BGN").download("LOGO_BGN.png"), db.storage.from("tanda-tangan").download(job.TTD_Akuntan_Path), db.storage.from("tanda-tangan").download(job.TTD_Kepala_SPPG_Path)]);
  if (logoFile.error || accountantFile.error || headFile.error || !logoFile.data || !accountantFile.data || !headFile.data) throw new Error("Logo atau tanda tangan tidak dapat dibaca");
  const logo = new Uint8Array(await logoFile.data.arrayBuffer()), accountant = new Uint8Array(await accountantFile.data.arrayBuffer()), head = new Uint8Array(await headFile.data.arrayBuffer());
  for (const item of items || []) {
    try {
      const { data: slip } = await db.from("Slip_Gaji").select("*").eq("ID_Slip", item.ID_Slip).eq("Status_Penerbitan", "DITERBITKAN").maybeSingle(); if (!slip) throw new Error("Slip tidak ditemukan");
      const [{ data: user }, { data: payroll }] = await Promise.all([db.from("Users").select("ID_User,Nama_Lengkap,Jabatan_Divisi,SPPG").eq("ID_User", slip.ID_User).maybeSingle(), db.from("Payroll").select("*").eq("ID_Payroll", slip.ID_Payroll).maybeSingle()]); if (!user || !payroll) throw new Error("Relasi slip tidak lengkap");
      const signedAt = new Date(); payroll.Nama_Akuntan = job.Nama_Akuntan; payroll.Nama_Kepala_SPPG = job.Nama_Kepala_SPPG;
      const bytes = await buildPdf({ slip, payroll, user, logo, accountant, head, signedAt });
      const path = text(slip.PDF_Storage_Path) || `${signedAt.getFullYear()}/${safePath(slip.ID_Payroll)}/${safePath(slip.ID_Slip)}.pdf`;
      const upload = await db.storage.from("slip-gaji").upload(path, bytes, { contentType: "application/pdf", cacheControl: "31536000", upsert: true }); if (upload.error) throw new Error(upload.error.message);
      const hash = await sha256(bytes);
      const update = await db.from("Slip_Gaji").update({ PDF_Storage_Path: path, URL_PDF_Slip: path, PDF_SHA256: hash, Dicetak_At: signedAt.toISOString() }).eq("ID_Slip", slip.ID_Slip).eq("Status_Penerbitan", "DITERBITKAN"); if (update.error) throw new Error(update.error.message);
      await db.from("Payroll").update({ Nama_Akuntan: job.Nama_Akuntan, Nama_Kepala_SPPG: job.Nama_Kepala_SPPG, TTD_Akuntan_Path: job.TTD_Akuntan_Path, TTD_Kepala_SPPG_Path: job.TTD_Kepala_SPPG_Path, Logo_BGN_Path: "Logo BGN/LOGO_BGN.png" }).eq("ID_Payroll", slip.ID_Payroll);
      await db.from("Payroll_TTD_Massal_Item").update({ Status: "SELESAI", Pesan_Error: null, Updated_At: signedAt.toISOString() }).eq("ID_Job", jobId).eq("ID_Slip", item.ID_Slip);
    } catch (error) {
      await db.from("Payroll_TTD_Massal_Item").update({ Status: "GAGAL", Pesan_Error: error instanceof Error ? error.message : String(error), Updated_At: new Date().toISOString() }).eq("ID_Job", jobId).eq("ID_Slip", item.ID_Slip);
    }
  }
  return await statusAction(auth, { jobId });
}
async function statusAction(auth: any, data: any) {
  const jobId = text(data.jobId); const { data: job } = await db.from("Payroll_TTD_Massal_Job").select("*").eq("ID_Job", jobId).maybeSingle(); if (!job || (auth.role !== "SUPER ADMIN" && text(job.Dibuat_Oleh) !== auth.id)) throw new Error("Job tidak ditemukan");
  const { data: items } = await db.from("Payroll_TTD_Massal_Item").select("Status,Pesan_Error").eq("ID_Job", jobId);
  const selesai = (items || []).filter((i: any) => i.Status === "SELESAI").length, gagal = (items || []).filter((i: any) => i.Status === "GAGAL").length, antri = (items || []).filter((i: any) => i.Status === "ANTRI").length;
  const done = antri === 0, status = done ? (gagal ? "SELESAI_DENGAN_ERROR" : "SELESAI") : "PROSES";
  await db.from("Payroll_TTD_Massal_Job").update({ Selesai_Item: selesai, Gagal_Item: gagal, Status: status, Updated_At: new Date().toISOString(), Selesai_At: done ? new Date().toISOString() : null }).eq("ID_Job", jobId);
  return { jobId, total: Number(job.Total_Item), selesai, gagal, antri, done, status, errors: (items || []).filter((i: any) => i.Status === "GAGAL").slice(0, 10).map((i: any) => i.Pesan_Error) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(body.token);
    const action = text(body.action);
    const result = action === "list" ? await listAction(auth, body) : action === "start" ? await startAction(auth, body) : action === "process" ? await processAction(auth, body) : action === "status" ? await statusAction(auth, body) : (() => { throw new Error("Aksi tidak valid"); })();
    return json({ success: true, ...result });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
