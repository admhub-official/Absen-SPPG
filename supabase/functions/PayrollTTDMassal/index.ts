import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const clean = (value: unknown) => String(value ?? "").trim();
const safe = (value: unknown) => clean(value).normalize("NFKD").replace(/[^\x20-\x7e]/g, "?");
const rupiah = (value: unknown) => `Rp ${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;
const dateOnly = (value: unknown) => clean(value).split("T")[0].split(" ")[0];
const formatDate = (value: unknown) => new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric",
}).format(new Date(`${dateOnly(value)}T00:00:00+07:00`));
const formatDateTime = (value: Date) => new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
}).format(value).replace(/\./g, ":") + " WIB";

function decodePng(value: unknown, label: string): Uint8Array {
  const match = clean(value).match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error(`${label} wajib berupa PNG`);
  const bytes = Uint8Array.from(atob(match[1].replace(/\s/g, "")), (character) => character.charCodeAt(0));
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 100 || bytes.length > 1_500_000 || !header.every((byte, index) => bytes[index] === byte)) {
    throw new Error(`${label} tidak valid`);
  }
  return bytes;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function authenticate(token: unknown) {
  const value = clean(token);
  if (!value) throw new Error("SESI_HABIS");
  const { data: session } = await db.from("Sessions")
    .select("Type,ID_User,Expires_At").eq("Token", value).maybeSingle();
  if (!session || clean(session.Type).toLowerCase() !== "user" || new Date(session.Expires_At).getTime() < Date.now()) {
    throw new Error("SESI_HABIS");
  }
  const { data: user } = await db.from("Users")
    .select("ID_User,Email,Role,SPPG,Status_Aktif").eq("ID_User", session.ID_User).maybeSingle();
  const role = clean(user?.Role).toUpperCase().replace(/_/g, " ");
  if (!user || user.Status_Aktif !== true || !["ADMIN", "SUPER ADMIN", "AKUNTAN"].includes(role)) {
    throw new Error("Akses ditolak");
  }
  return { id: clean(user.ID_User), email: clean(user.Email), role, sppg: clean(user.SPPG) };
}
async function scopedSppg(auth: any): Promise<string[] | null> {
  if (auth.role === "SUPER ADMIN") return null;
  const { data } = await db.from("Akses_Email").select("SPPG,Aktif").ilike("Email", auth.email);
  const values = [...new Set((data || [])
    .filter((row: any) => row.Aktif === true || String(row.Aktif) === "1")
    .map((row: any) => clean(row.SPPG)).filter(Boolean))];
  return values.length ? values : [auth.sppg].filter(Boolean);
}
async function selectAll(table: string, columns: string, apply: (query: any) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0;; from += 1000) {
    const result = await apply(db.from(table).select(columns)).range(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}
async function getPendingSlips(auth: any): Promise<any[]> {
  const sppg = await scopedSppg(auth);
  const users = await selectAll("Users", "ID_User,Nama_Lengkap,Jabatan_Divisi,SPPG",
    (query) => sppg ? query.in("SPPG", sppg) : query);
  const userMap = new Map(users.map((user: any) => [clean(user.ID_User), user]));
  const userIds = [...userMap.keys()];
  const rows: any[] = [];
  for (let index = 0; index < userIds.length; index += 300) {
    const chunk = userIds.slice(index, index + 300);
    rows.push(...await selectAll(
      "Slip_Gaji",
      "ID_Slip,ID_Payroll,ID_User,Periode_Mulai,Periode_Akhir,Jumlah_Hari_Kerja,Gaji_Harian,Subtotal_Gaji,Lembur_Nominal,Bonus,Potongan,Keterangan_Potongan,Total_Gaji_Diterima,Diterbitkan_At,Dicetak_At,PDF_Storage_Path,TTD_Massal_At",
      (query) => query.eq("Status_Penerbitan", "DITERBITKAN").is("TTD_Massal_At", null).in("ID_User", chunk),
    ));
  }
  return rows.map((row: any) => ({ ...row, _user: userMap.get(clean(row.ID_User)) }))
    .sort((a, b) => new Date(b.Diterbitkan_At || 0).getTime() - new Date(a.Diterbitkan_At || 0).getTime());
}

async function buildPendingRecipientPdf(input: {
  slip: any; payroll: any; user: any; logo: Uint8Array;
  accountant: Uint8Array; head: Uint8Array; signedAt: Date;
}): Promise<Uint8Array> {
  const { slip, payroll, user, logo, accountant, head, signedAt } = input;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await pdf.embedPng(logo);
  const accountantImage = await pdf.embedPng(accountant);
  const headImage = await pdf.embedPng(head);
  const navy = rgb(.06, .12, .24), muted = rgb(.35, .4, .48), border = rgb(.86, .89, .93);
  const pale = rgb(.96, .97, .99), green = rgb(.05, .45, .28), amber = rgb(.68, .38, .02);
  const left = 42, right = 553, width = right - left;
  pdf.setTitle(safe(`Slip Gaji ${user.Nama_Lengkap}`));
  pdf.setCreator("Absen-SPPG TTD Massal");
  pdf.setCreationDate(signedAt); pdf.setModificationDate(signedAt);
  const logoScale = logoImage.scaleToFit(66, 68);
  page.drawImage(logoImage, { x: left, y: 765, width: logoScale.width, height: logoScale.height });
  page.drawText("SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)", { x: left + 100, y: 805, size: 11, font: bold, color: navy });
  page.drawText(safe(user.SPPG || "DARMARAJA").toUpperCase(), { x: left + 100, y: 781, size: 17, font: bold, color: navy });
  page.drawLine({ start: { x: left, y: 755 }, end: { x: right, y: 755 }, thickness: 1.2, color: navy });
  page.drawText("SLIP GAJI", { x: left, y: 721, size: 20, font: bold, color: navy });
  page.drawText(`No. ${safe(slip.ID_Slip)}`, { x: left, y: 704, size: 8.5, font: regular, color: muted });
  page.drawText(`Diperbarui ${formatDateTime(signedAt)}`, { x: right - 190, y: 704, size: 8.5, font: regular, color: muted });
  page.drawRectangle({ x: left, y: 614, width, height: 70, color: pale, borderColor: border, borderWidth: 1 });
  const identityRows = [
    ["Nama", user.Nama_Lengkap],
    ["Jabatan / Divisi", user.Jabatan_Divisi || "-"],
    ["Periode", `${formatDate(slip.Periode_Mulai)} s.d. ${formatDate(slip.Periode_Akhir)}`],
  ];
  identityRows.forEach((row, index) => {
    const y = 662 - index * 20;
    page.drawText(String(row[0]), { x: left + 14, y, size: 9, font: bold, color: muted });
    page.drawText(":", { x: left + 112, y, size: 9, font: regular, color: muted });
    page.drawText(safe(row[1]).slice(0, 72), { x: left + 126, y, size: 10, font: regular, color: navy });
  });
  page.drawText("RINCIAN PENGHASILAN", { x: left, y: 581, size: 10, font: bold, color: navy });
  page.drawRectangle({ x: left, y: 544, width, height: 27, color: navy });
  page.drawText("KOMPONEN", { x: left + 14, y: 554, size: 9, font: bold, color: rgb(1,1,1) });
  page.drawText("PERHITUNGAN", { x: left + 238, y: 554, size: 9, font: bold, color: rgb(1,1,1) });
  page.drawText("NOMINAL", { x: right - 76, y: 554, size: 9, font: bold, color: rgb(1,1,1) });
  const components: any[] = [
    ["Gaji pokok", `${rupiah(slip.Gaji_Harian)} x ${Number(slip.Jumlah_Hari_Kerja) || 0} hari`, Number(slip.Subtotal_Gaji) || 0],
    ["Lembur", "Sesuai rekap", Number(slip.Lembur_Nominal) || 0],
    ["Bonus / Tambahan", "Sesuai rekap", Number(slip.Bonus) || 0],
    ["Potongan", safe(slip.Keterangan_Potongan || "Tidak ada keterangan"), -(Number(slip.Potongan) || 0)],
  ];
  let componentY = 512;
  components.forEach((component, index) => {
    if (index % 2) page.drawRectangle({ x: left, y: componentY - 12, width, height: 36, color: pale });
    page.drawText(component[0], { x: left + 14, y: componentY, size: 10, font: bold, color: navy });
    page.drawText(String(component[1]).slice(0, 38), { x: left + 238, y: componentY, size: 9, font: regular, color: muted });
    const amount = component[2] < 0 ? `- ${rupiah(Math.abs(component[2]))}` : rupiah(component[2]);
    page.drawText(amount, { x: right - 14 - regular.widthOfTextAtSize(amount, 9), y: componentY, size: 9, font: regular, color: navy });
    page.drawLine({ start: { x: left, y: componentY - 13 }, end: { x: right, y: componentY - 13 }, thickness: .7, color: border });
    componentY -= 36;
  });
  page.drawRectangle({ x: left, y: 338, width, height: 54, color: rgb(.92,.98,.95), borderColor: rgb(.65,.89,.76), borderWidth: 1 });
  page.drawText("TOTAL GAJI DITERIMA", { x: left + 16, y: 359, size: 11, font: bold, color: green });
  const total = rupiah(slip.Total_Gaji_Diterima);
  page.drawText(total, { x: right - 16 - bold.widthOfTextAtSize(total, 16), y: 355, size: 16, font: bold, color: green });
  const columns = [
    { x: left, title: "Mengetahui,", role: "AKUNTAN", name: payroll.Nama_Akuntan, image: accountantImage },
    { x: 218, title: "Menyetujui,", role: "KEPALA SPPG", name: payroll.Nama_Kepala_SPPG, image: headImage },
    { x: 394, title: "Penerima,", role: "MENUNGGU TTD", name: user.Nama_Lengkap, image: null },
  ];
  columns.forEach((column) => {
    page.drawText(column.title, { x: column.x, y: 286, size: 8.5, font: regular, color: navy });
    if (column.image) {
      const scale = column.image.scaleToFit(115, 55);
      page.drawImage(column.image, { x: column.x + (145 - scale.width) / 2, y: 219, width: scale.width, height: scale.height });
    } else {
      page.drawText("Belum ditandatangani", { x: column.x + 24, y: 239, size: 8, font: regular, color: amber });
    }
    const name = safe(column.name).slice(0, 30);
    page.drawText(name, { x: column.x + Math.max(0, (145 - bold.widthOfTextAtSize(name, 9)) / 2), y: 200, size: 9, font: bold, color: navy });
    page.drawLine({ start: { x: column.x, y: 190 }, end: { x: column.x + 145, y: 190 }, thickness: .8, color: muted });
    page.drawText(column.role, { x: column.x + Math.max(0, (145 - regular.widthOfTextAtSize(column.role, 7.5)) / 2), y: 176, size: 7.5, font: regular, color: muted });
  });
  page.drawText("Menunggu tanda tangan penerima melalui akun masing-masing. Nilai payroll tidak berubah.", {
    x: left, y: 82, size: 8, font: regular, color: muted,
  });
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function listAction(auth: any, data: any) {
  const all = await getPendingSlips(auth);
  const search = clean(data.search).toLowerCase();
  const filtered = search ? all.filter((row: any) =>
    [row._user?.Nama_Lengkap, row._user?.SPPG, row.ID_Payroll, row.ID_Slip]
      .some((value) => clean(value).toLowerCase().includes(search))) : all;
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(2500, Math.max(10, Number(data.pageSize) || 50));
  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize).map((row: any) => ({
      idSlip: row.ID_Slip, idPayroll: row.ID_Payroll, nama: row._user?.Nama_Lengkap || row.ID_User,
      sppg: row._user?.SPPG || "-", periodeMulai: row.Periode_Mulai, periodeAkhir: row.Periode_Akhir,
      total: row.Total_Gaji_Diterima, diterbitkanAt: row.Diterbitkan_At, dicetakAt: row.Dicetak_At,
      pdfPath: row.PDF_Storage_Path,
    })),
    total: filtered.length, page, pageSize,
  };
}
async function startAction(auth: any, data: any) {
  const ids = [...new Set((Array.isArray(data.ids) ? data.ids : []).map(clean).filter(Boolean))];
  if (!ids.length || ids.length > 2500) throw new Error("Pilih minimal satu dan maksimal 2.500 slip");
  const accountantName = clean(data.namaAkuntan), headName = clean(data.namaKepalaSppg);
  if (!accountantName || !headName) throw new Error("Nama Akuntan dan Kepala SPPG wajib diisi");
  const accountant = decodePng(data.tandaTanganAkuntanBase64, "Tanda tangan Akuntan");
  const head = decodePng(data.tandaTanganKepalaSppgBase64, "Tanda tangan Kepala SPPG");
  const allowed = new Set((await getPendingSlips(auth)).map((row: any) => clean(row.ID_Slip)));
  if (ids.some((id) => !allowed.has(id))) throw new Error("Ada slip di luar cakupan atau sudah selesai TTD massal");
  const jobId = `TTDM_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const accountantPath = `ttd-massal/${jobId}/akuntan.png`;
  const headPath = `ttd-massal/${jobId}/kepala-sppg.png`;
  const logoPath = `ttd-massal/${jobId}/logo-bgn.png`;
  const { data: logoBlob, error: logoReadError } = await db.storage.from("Logo BGN").download("LOGO_BGN.png");
  if (logoReadError || !logoBlob) throw new Error("Logo BGN tidak dapat dibaca");
  const logo = new Uint8Array(await logoBlob.arrayBuffer());
  const uploads = await Promise.all([
    db.storage.from("tanda-tangan").upload(accountantPath, accountant, { contentType: "image/png", upsert: false }),
    db.storage.from("tanda-tangan").upload(headPath, head, { contentType: "image/png", upsert: false }),
    db.storage.from("tanda-tangan").upload(logoPath, logo, { contentType: "image/png", upsert: false }),
  ]);
  const uploadError = uploads.find((result) => result.error)?.error;
  if (uploadError) {
    await db.storage.from("tanda-tangan").remove([accountantPath, headPath, logoPath]);
    throw new Error(uploadError.message);
  }
  const { error: jobError } = await db.from("Payroll_TTD_Massal_Job").insert({
    ID_Job: jobId, Dibuat_Oleh: auth.id, Nama_Akuntan: accountantName,
    Nama_Kepala_SPPG: headName, TTD_Akuntan_Path: accountantPath,
    TTD_Kepala_SPPG_Path: headPath, Total_Item: ids.length, Status: "ANTRI",
  });
  if (jobError) throw new Error(jobError.message);
  for (let index = 0; index < ids.length; index += 500) {
    const { error } = await db.from("Payroll_TTD_Massal_Item")
      .insert(ids.slice(index, index + 500).map((id) => ({ ID_Job: jobId, ID_Slip: id })));
    if (error) throw new Error(error.message);
  }
  return { jobId, total: ids.length };
}
async function statusAction(auth: any, data: any) {
  const jobId = clean(data.jobId);
  const { data: job } = await db.from("Payroll_TTD_Massal_Job").select("*").eq("ID_Job", jobId).maybeSingle();
  if (!job || (auth.role !== "SUPER ADMIN" && clean(job.Dibuat_Oleh) !== auth.id)) throw new Error("Job tidak ditemukan");
  const counts = await Promise.all(["SELESAI", "GAGAL", "ANTRI"].map((status) =>
    db.from("Payroll_TTD_Massal_Item").select("ID_Slip", { count: "exact", head: true })
      .eq("ID_Job", jobId).eq("Status", status)));
  const completed = Number(counts[0].count || 0), failed = Number(counts[1].count || 0), queued = Number(counts[2].count || 0);
  const done = queued === 0;
  const status = done ? (failed ? "SELESAI_DENGAN_ERROR" : "SELESAI") : "PROSES";
  await db.from("Payroll_TTD_Massal_Job").update({
    Selesai_Item: completed, Gagal_Item: failed, Status: status,
    Updated_At: new Date().toISOString(), Selesai_At: done ? new Date().toISOString() : null,
  }).eq("ID_Job", jobId);
  return { jobId, total: Number(job.Total_Item), selesai: completed, gagal: failed, antri: queued, done, status };
}
async function latestAction(auth: any) {
  let query = db.from("Payroll_TTD_Massal_Job").select("ID_Job,Status,Created_At")
    .in("Status", ["ANTRI", "PROSES"]).order("Created_At", { ascending: false }).limit(1);
  if (auth.role !== "SUPER ADMIN") query = query.eq("Dibuat_Oleh", auth.id);
  const { data } = await query.maybeSingle();
  return data ? await statusAction(auth, { jobId: data.ID_Job }) : { active: false };
}
async function processAction(auth: any, data: any) {
  const jobId = clean(data.jobId);
  const { data: job } = await db.from("Payroll_TTD_Massal_Job").select("*").eq("ID_Job", jobId).maybeSingle();
  if (!job || (auth.role !== "SUPER ADMIN" && clean(job.Dibuat_Oleh) !== auth.id)) throw new Error("Job tidak ditemukan");
  const { data: items, error: itemError } = await db.from("Payroll_TTD_Massal_Item")
    .select("ID_Slip").eq("ID_Job", jobId).eq("Status", "ANTRI").order("ID_Slip").limit(25);
  if (itemError) throw new Error(itemError.message);
  if (!(items || []).length) return await statusAction(auth, { jobId });
  await db.from("Payroll_TTD_Massal_Job").update({ Status: "PROSES", Updated_At: new Date().toISOString() }).eq("ID_Job", jobId);
  const logoPath = `ttd-massal/${jobId}/logo-bgn.png`;
  const [logoFile, accountantFile, headFile] = await Promise.all([
    db.storage.from("tanda-tangan").download(logoPath),
    db.storage.from("tanda-tangan").download(job.TTD_Akuntan_Path),
    db.storage.from("tanda-tangan").download(job.TTD_Kepala_SPPG_Path),
  ]);
  if (logoFile.error || accountantFile.error || headFile.error || !logoFile.data || !accountantFile.data || !headFile.data) {
    throw new Error("Logo atau tanda tangan tidak dapat dibaca");
  }
  const logo = new Uint8Array(await logoFile.data.arrayBuffer());
  const accountant = new Uint8Array(await accountantFile.data.arrayBuffer());
  const head = new Uint8Array(await headFile.data.arrayBuffer());
  const completedIds: string[] = [];
  for (const item of items || []) {
    try {
      const { data: slip } = await db.from("Slip_Gaji").select("*")
        .eq("ID_Slip", item.ID_Slip).eq("Status_Penerbitan", "DITERBITKAN").is("TTD_Massal_At", null).maybeSingle();
      if (!slip) throw new Error("Slip tidak ditemukan atau sudah selesai");
      const [{ data: user }, { data: payroll }] = await Promise.all([
        db.from("Users").select("ID_User,Nama_Lengkap,Jabatan_Divisi,SPPG").eq("ID_User", slip.ID_User).maybeSingle(),
        db.from("Payroll").select("*").eq("ID_Payroll", slip.ID_Payroll).maybeSingle(),
      ]);
      if (!user || !payroll) throw new Error("Relasi slip tidak lengkap");
      const signedAt = new Date();
      payroll.Nama_Akuntan = job.Nama_Akuntan;
      payroll.Nama_Kepala_SPPG = job.Nama_Kepala_SPPG;
      const bytes = await buildPendingRecipientPdf({ slip, payroll, user, logo, accountant, head, signedAt });
      const path = clean(slip.PDF_Storage_Path);
      if (!path) throw new Error("Path PDF aktif kosong");
      const { error: uploadError } = await db.storage.from("slip-gaji").upload(path, bytes, {
        contentType: "application/pdf", cacheControl: "31536000", upsert: true,
      });
      if (uploadError) throw new Error(uploadError.message);
      const { data: updated, error: updateError } = await db.from("Slip_Gaji").update({
        Status_Penerbitan: "MENUNGGU_TTD_PENERIMA",
        PDF_SHA256: await sha256(bytes), Dicetak_At: signedAt.toISOString(),
        TTD_Penerima_Path: null, Ditandatangani_Penerima_At: null,
        TTD_Massal_At: signedAt.toISOString(), TTD_Massal_Job_ID: jobId, TTD_Massal_Oleh: auth.id,
      }).eq("ID_Slip", slip.ID_Slip).eq("Status_Penerbitan", "DITERBITKAN").is("TTD_Massal_At", null)
        .select("ID_Slip").maybeSingle();
      if (updateError || !updated) throw new Error("Status slip gagal diperbarui");
      await db.from("Payroll").update({
        Status_Penerbitan: "MENUNGGU_TTD_PENERIMA",
        Nama_Akuntan: job.Nama_Akuntan, Nama_Kepala_SPPG: job.Nama_Kepala_SPPG,
        TTD_Akuntan_Path: job.TTD_Akuntan_Path, TTD_Kepala_SPPG_Path: job.TTD_Kepala_SPPG_Path,
        Logo_BGN_Path: logoPath,
      }).eq("ID_Payroll", slip.ID_Payroll);
      await db.from("Payroll_TTD_Massal_Item").update({
        Status: "SELESAI", Pesan_Error: null, Updated_At: signedAt.toISOString(),
      }).eq("ID_Job", jobId).eq("ID_Slip", item.ID_Slip);
      completedIds.push(clean(item.ID_Slip));
    } catch (error) {
      await db.from("Payroll_TTD_Massal_Item").update({
        Status: "GAGAL", Pesan_Error: error instanceof Error ? error.message : String(error),
        Updated_At: new Date().toISOString(),
      }).eq("ID_Job", jobId).eq("ID_Slip", item.ID_Slip);
    }
  }
  return { ...(await statusAction(auth, { jobId })), completedIds };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await request.json().catch(() => ({}));
    const auth = await authenticate(body.token);
    const action = clean(body.action);
    const result = action === "list" ? await listAction(auth, body)
      : action === "start" ? await startAction(auth, body)
      : action === "process" ? await processAction(auth, body)
      : action === "status" ? await statusAction(auth, body)
      : action === "latest" ? await latestAction(auth)
      : (() => { throw new Error("Aksi tidak valid"); })();
    return respond({ success: true, ...result });
  } catch (error) {
    return respond({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
