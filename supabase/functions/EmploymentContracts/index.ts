import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = "employment-contracts";
const VERIFY_ORIGIN = "https://hadirly.org";
const SIGNED_URL_SECONDS = 3600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
const clean = (value: unknown, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const multi = (value: unknown, max = 12000) => String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
const roleNorm = (value: unknown) => clean(value, 80).toUpperCase().replace(/_/g, " ");
const isActive = (value: unknown) => value === true || value === 1 || ["TRUE", "1"].includes(String(value || "").toUpperCase());
const money = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nowIso = () => new Date().toISOString();

interface SessionUser { ID_User: string; Role: string | null; Status_Aktif: unknown; SPPG?: string | null; Nama_Lengkap?: string | null }
interface ContractRow { [key: string]: unknown }

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseDate(value: unknown, label = "Tanggal"): string {
  const raw = clean(value, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw new Error(`${label} tidak valid.`);
  }
  return raw;
}

function addMonthsMinusDay(start: string, months: number | null): string | null {
  if (!months) return null;
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function fmtDate(value: unknown): string {
  const raw = clean(value, 32);
  if (!raw) return "-";
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00+07:00` : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
}

function rupiah(value: unknown): string {
  const n = money(value);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

async function authenticate(tokenValue: unknown): Promise<SessionUser> {
  const token = clean(tokenValue, 500);
  if (!token) throw new Error("SESSION_EXPIRED");
  const session = await db.from("Sessions").select("ID_User,Type,Expires_At").eq("Token", token).maybeSingle();
  if (session.error || !session.data?.ID_User || String(session.data.Type || "").toLowerCase() !== "user" || new Date(session.data.Expires_At).getTime() <= Date.now()) {
    throw new Error("SESSION_EXPIRED");
  }
  const user = await db.from("Users").select("ID_User,Role,Status_Aktif,SPPG,Nama_Lengkap").eq("ID_User", session.data.ID_User).maybeSingle();
  if (user.error || !user.data || !isActive(user.data.Status_Aktif)) throw new Error("ACCOUNT_INACTIVE");
  return user.data as SessionUser;
}

function requireAdmin(user: SessionUser) {
  if (!["ADMIN", "SUPER ADMIN"].includes(roleNorm(user.Role))) throw new Error("FORBIDDEN");
}
const isSuper = (user: SessionUser) => roleNorm(user.Role) === "SUPER ADMIN";
const adminScope = (user: SessionUser) => clean(user.SPPG, 180).toUpperCase();

async function fullUser(idUser: string) {
  const result = await db.from("Users").select("ID_User,Nama_Lengkap,NIK,Tempat_Lahir,Tanggal_Lahir,Alamat,No_Whatsapp,Email,SPPG,Yayasan,Jabatan_Divisi,Tanggal_Mulai_Kerja,Gaji_Harian,Status_Aktif").eq("ID_User", idUser).maybeSingle();
  if (result.error || !result.data) throw new Error("Karyawan tidak ditemukan.");
  if (!isActive(result.data.Status_Aktif)) throw new Error("Akun karyawan tidak aktif.");
  return result.data;
}

async function signedUrl(path: unknown): Promise<string> {
  const storagePath = clean(path, 900);
  if (!storagePath) return "";
  const result = await db.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  return result.data?.signedUrl || "";
}

async function audit(contractId: string | null, actor: string | null, action: string, detail: Record<string, unknown> = {}) {
  const result = await db.from("Employment_Contract_Audit_Log").insert({ ID_Contract: contractId, ID_User_Actor: actor, Action: action, Detail: detail });
  if (result.error) console.warn("contract audit deferred", result.error.message);
}

function enforceAdminContractScope(user: SessionUser, row: ContractRow) {
  if (isSuper(user)) return;
  if (clean(row.SPPG, 180).toUpperCase() !== adminScope(user)) throw new Error("FORBIDDEN");
}

async function contractById(id: unknown) {
  const contractId = clean(id, 80);
  const result = await db.from("Employment_Contracts").select("*").eq("ID_Contract", contractId).maybeSingle();
  if (result.error || !result.data) throw new Error("Perjanjian kerja tidak ditemukan.");
  return result.data as ContractRow;
}

function validateProfileForContract(profile: Record<string, unknown>) {
  const missing: string[] = [];
  const fields: Array<[string, string]> = [
    ["Nama_Lengkap", "Nama Lengkap"], ["NIK", "NIK"], ["Tempat_Lahir", "Tempat Lahir"],
    ["Tanggal_Lahir", "Tanggal Lahir"], ["Alamat", "Alamat"], ["No_Whatsapp", "Nomor HP"],
    ["Email", "Email"], ["SPPG", "SPPG"], ["Yayasan", "Yayasan"], ["Jabatan_Divisi", "Jabatan / Divisi"],
    ["Tanggal_Mulai_Kerja", "Tanggal Mulai Kerja"]
  ];
  for (const [field, label] of fields) if (!clean(profile[field], 500)) missing.push(label);
  if (!/^\d{16}$/.test(clean(profile.NIK, 32))) missing.push("NIK harus 16 digit");
  if (money(profile.Gaji_Harian) <= 0) missing.push("Gaji Harian");
  if (missing.length) throw new Error(`Lengkapi data sebelum membuat kontrak: ${[...new Set(missing)].join(", ")}.`);
}

async function resolveContractSources(profile: Record<string, unknown>, employmentTermId: string, templateId = "") {
  const sppgName = clean(profile.SPPG, 180);
  const sppgResult = await db.from("Master_SPPG").select("*").ilike("Nama_SPPG", sppgName).eq("Aktif", true).limit(1).maybeSingle();
  if (sppgResult.error || !sppgResult.data) throw new Error("Master SPPG belum tersedia untuk akun ini.");
  const sppg = sppgResult.data as Record<string, unknown>;
  for (const [field, label] of [["Kode_SPPG","Kode SPPG"],["Yayasan","Yayasan"],["Alamat_SPPG","Alamat SPPG"],["Nama_Mitra","Nama Mitra"],["Nama_Kepala_SPPG","Nama Kepala SPPG"]] as const) {
    if (!clean(sppg[field], 500)) throw new Error(`${label} belum dikonfigurasi di Master SPPG & Yayasan.`);
  }

  const jobName = clean(profile.Jabatan_Divisi, 180);
  const jobResult = await db.from("Master_Jabatan").select("*").ilike("Nama_Jabatan", jobName).eq("Aktif", true).limit(1).maybeSingle();
  if (jobResult.error || !jobResult.data) throw new Error(`Jabatan / Divisi '${jobName}' belum tersedia di Master Jabatan.`);
  const job = jobResult.data as Record<string, unknown>;
  const jobDescResult = await db.from("Master_Job_Description").select("*").eq("ID_Master_Jabatan", job.ID_Master_Jabatan).eq("Aktif", true).order("Version", { ascending: false }).limit(1).maybeSingle();
  if (jobDescResult.error || !jobDescResult.data) throw new Error("Master Job Description untuk jabatan ini belum diisi.");

  let hoursQuery = db.from("Master_Jam_Kerja").select("*").eq("Aktif", true).limit(1);
  hoursQuery = hoursQuery.eq("ID_Master_Jabatan", job.ID_Master_Jabatan);
  const hoursResult = await hoursQuery.maybeSingle();
  if (hoursResult.error || !hoursResult.data) throw new Error("Master Jam Kerja untuk jabatan ini belum diisi.");

  const termResult = await db.from("Master_Employment_Terms").select("*").eq("ID_Employment_Term", employmentTermId).eq("Aktif", true).maybeSingle();
  if (termResult.error || !termResult.data) throw new Error("Status kerja / jenis kontrak tidak valid.");

  let templateQuery = db.from("Master_Contract_Templates").select("*").eq("Aktif", true).lte("Effective_From", new Date().toISOString().slice(0,10)).order("Version", { ascending: false }).limit(1);
  if (templateId) templateQuery = db.from("Master_Contract_Templates").select("*").eq("ID_Template", templateId).eq("Aktif", true).limit(1);
  const templateResult = await templateQuery.maybeSingle();
  if (templateResult.error || !templateResult.data) throw new Error("Master Template Perjanjian aktif belum tersedia.");

  const compResult = await db.from("Master_Contract_Compensation").select("*").eq("Aktif", true).eq("ID_Master_Jabatan", job.ID_Master_Jabatan).limit(1).maybeSingle();
  return { sppg, job, jobDescription: jobDescResult.data, hours: hoursResult.data, term: termResult.data, template: templateResult.data, compensation: compResult.data || null };
}

function scheduleText(row: Record<string, unknown>): string {
  const masuk = clean(row.Jam_Masuk, 16);
  const pulang = clean(row.Jam_Pulang, 16);
  const clock = masuk && pulang ? `${masuk.slice(0,5)} - ${pulang.slice(0,5)}` : "Sesuai jadwal operasional";
  return `${clean(row.Hari_Kerja, 180) || "Sesuai jadwal operasional SPPG"}; Jam ${clock}${clean(row.Keterangan, 500) ? `. ${clean(row.Keterangan, 500)}` : ""}`;
}

async function createContract(user: SessionUser, data: Record<string, unknown>) {
  requireAdmin(user);
  const targetUser = await fullUser(clean(data.idUser, 120));
  if (!isSuper(user) && clean(targetUser.SPPG,180).toUpperCase() !== adminScope(user)) throw new Error("FORBIDDEN");
  validateProfileForContract(targetUser);
  const termId = clean(data.employmentTermId, 120);
  if (!termId) throw new Error("Pilih status kerja / jenis kontrak.");
  const sources = await resolveContractSources(targetUser, termId, clean(data.templateId, 100));
  const contractDate = parseDate(data.contractDate || new Date().toISOString().slice(0,10), "Tanggal kontrak");
  const startDate = parseDate(data.startDate || targetUser.Tanggal_Mulai_Kerja, "Tanggal mulai kontrak");
  const defaultMonths = Number(sources.term.Durasi_Default_Bulan || 0) || null;
  const endDate = data.endDate ? parseDate(data.endDate, "Tanggal akhir kontrak") : addMonthsMinusDay(startDate, defaultMonths);
  const sppgCode = clean(sources.sppg.Kode_SPPG, 24).toUpperCase();
  const numberResult = await db.rpc("next_employment_contract_number", { p_sppg_code: sppgCode, p_contract_date: contractDate });
  if (numberResult.error || !numberResult.data) throw new Error("Nomor kontrak gagal dibuat.");

  const snapshot = {
    nama_yayasan: clean(sources.sppg.Yayasan, 240), nama_sppg: clean(sources.sppg.Nama_SPPG, 200), kode_sppg: sppgCode,
    alamat_sppg: clean(sources.sppg.Alamat_SPPG, 1000), lokasi_sppg: clean(sources.sppg.Lokasi_SPPG, 500) || clean(sources.sppg.Alamat_SPPG, 1000),
    nama_mitra: clean(sources.sppg.Nama_Mitra, 240), nama_kepala_sppg: clean(sources.sppg.Nama_Kepala_SPPG, 240),
    nama_relawan: clean(targetUser.Nama_Lengkap, 240), nik: clean(targetUser.NIK, 32), tempat_lahir: clean(targetUser.Tempat_Lahir, 160),
    tanggal_lahir: clean(targetUser.Tanggal_Lahir, 32), ttl: `${clean(targetUser.Tempat_Lahir,160)}, ${fmtDate(targetUser.Tanggal_Lahir)}`,
    alamat: clean(targetUser.Alamat, 1200), no_hp: clean(targetUser.No_Whatsapp, 60), email: clean(targetUser.Email, 254),
    jabatan: clean(sources.job.Nama_Jabatan, 200), divisi: clean(sources.job.Divisi, 200) || clean(sources.job.Nama_Jabatan, 200),
    tanggal_mulai: startDate, status_kerja: clean(sources.term.Nama_Status_Kerja, 160), status_kontrak: clean(sources.term.Jenis_Kontrak, 60),
    masa_kontrak: endDate ? `${fmtDate(startDate)} - ${fmtDate(endDate)}` : `Sejak ${fmtDate(startDate)}`,
    akhir_kontrak: endDate, gaji_harian: money(targetUser.Gaji_Harian), gaji_pokok: money(sources.compensation?.Gaji_Pokok),
    gaji_bulanan: money(sources.compensation?.Gaji_Bulanan), insentif: money(sources.compensation?.Insentif_Default),
    job_description: multi(sources.jobDescription.Job_Description), jam_kerja: scheduleText(sources.hours),
    nomor_kontrak: String(numberResult.data), tanggal_kontrak: contractDate,
  };
  const row = {
    Contract_Number: numberResult.data, Document_Type: clean(data.documentType,40) === "ADDENDUM" ? "ADDENDUM" : "PERJANJIAN_KERJA",
    Parent_Contract_ID: clean(data.parentContractId,80) || null, ID_User: targetUser.ID_User, SPPG: snapshot.nama_sppg, SPPG_Code: sppgCode,
    Contract_Date: contractDate, Start_Date: startDate, End_Date: endDate, Work_Status: snapshot.status_kerja, Contract_Type: snapshot.status_kontrak,
    Template_ID: sources.template.ID_Template, Template_Version: sources.template.Version, Template_Content_Snapshot: sources.template.Content_JSON,
    Snapshot: snapshot, Status: "WAITING_MITRA", Signature_Progress: 0, Created_By: user.ID_User, Updated_At: nowIso(),
  };
  const insert = await db.from("Employment_Contracts").insert(row).select("*").single();
  if (insert.error) throw new Error(`Gagal membuat perjanjian: ${insert.error.message}`);
  await audit(insert.data.ID_Contract, user.ID_User, "CONTRACT_CREATED", { contractNumber: numberResult.data, targetUser: targetUser.ID_User });
  return contractResponse(insert.data);
}

async function contractResponse(row: ContractRow) {
  const snapshot = row.Snapshot as Record<string, unknown> || {};
  const pdfUrl = await signedUrl(row.Final_PDF_Storage_Path);
  return {
    id: row.ID_Contract, contractNumber: row.Contract_Number, documentType: row.Document_Type, idUser: row.ID_User,
    sppg: row.SPPG, status: row.Status, signatureProgress: row.Signature_Progress, contractDate: row.Contract_Date,
    startDate: row.Start_Date, endDate: row.End_Date, createdAt: row.Created_At, signedAt: row.Signed_At, activatedAt: row.Activated_At,
    finalPdfUrl: pdfUrl, finalPdfSha256: row.Final_PDF_SHA256 || "", snapshot,
  };
}

async function listMy(user: SessionUser) {
  const result = await db.from("Employment_Contracts").select("*").eq("ID_User", user.ID_User).order("Created_At", { ascending: false }).limit(100);
  if (result.error) throw new Error("Riwayat perjanjian gagal dimuat.");
  return await Promise.all((result.data || []).map((row) => contractResponse(row)));
}

async function listAdmin(user: SessionUser) {
  requireAdmin(user);
  let query = db.from("Employment_Contracts").select("*").order("Created_At", { ascending: false }).limit(500);
  if (!isSuper(user)) query = query.ilike("SPPG", clean(user.SPPG,180));
  const result = await query;
  if (result.error) throw new Error("Daftar perjanjian gagal dimuat.");
  const contracts = await Promise.all((result.data || []).map((row) => contractResponse(row)));
  let uq = db.from("Users").select("ID_User,Nama_Lengkap,NIK,SPPG,Jabatan_Divisi,Status_Aktif").eq("Status_Aktif", true).order("Nama_Lengkap");
  if (!isSuper(user)) uq = uq.ilike("SPPG", clean(user.SPPG,180));
  const users = await uq;
  return { contracts, users: users.data || [] };
}

async function getDetail(user: SessionUser, idValue: unknown) {
  const row = await contractById(idValue);
  if (row.ID_User !== user.ID_User) {
    requireAdmin(user); enforceAdminContractScope(user, row);
  }
  const sig = await db.from("Employment_Contract_Signatures").select("Signer_Role,Signer_Name,Signed_At,Accepted_Statement").eq("ID_Contract", row.ID_Contract).order("Signed_At");
  return { ...(await contractResponse(row)), template: row.Template_Content_Snapshot, signatures: sig.data || [] };
}

function dataUrlBytes(value: unknown): Uint8Array {
  const raw = String(value || "");
  const match = raw.match(/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Format tanda tangan tidak valid.");
  const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
  if (bytes.length < 120 || bytes.length > 2_500_000) throw new Error("Ukuran tanda tangan tidak valid.");
  return bytes;
}

async function uploadSignature(contractId: string, signerRole: string, bytes: Uint8Array) {
  const path = `signatures/${contractId}/${signerRole.toLowerCase()}-${crypto.randomUUID()}.png`;
  const upload = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: false });
  if (upload.error) throw new Error(`TTD gagal disimpan: ${upload.error.message}`);
  return path;
}

function replaceVars(text: string, snapshot: Record<string, unknown>): string {
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, key) => {
    const value = snapshot[key];
    if (["gaji_harian","gaji_pokok","gaji_bulanan","insentif"].includes(key)) return rupiah(value);
    if (["tanggal_mulai","akhir_kontrak","tanggal_kontrak"].includes(key)) return fmtDate(value);
    return String(value ?? "-");
  });
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) { out.push(""); continue; }
    const bullet = paragraph.trim().startsWith("•") ? "• " : "";
    const source = paragraph.trim().replace(/^•\s*/, "");
    let line = bullet;
    for (const word of source.split(/\s+/)) {
      const candidate = line && line !== bullet ? `${line} ${word}` : `${bullet}${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width || line === bullet) line = candidate;
      else { out.push(line); line = `${bullet ? "  " : ""}${word}`; }
    }
    if (line) out.push(line);
  }
  return out;
}

function drawLines(page: PDFPage, lines: string[], font: PDFFont, size: number, x: number, y: number, width: number, lineHeight: number) {
  let cursor = y;
  for (const line of lines) {
    if (cursor < 52) break;
    page.drawText(line, { x, y: cursor, size, font, color: rgb(0.12,0.16,0.23), maxWidth: width });
    cursor -= line ? lineHeight : lineHeight * 0.65;
  }
  return cursor;
}

async function downloadSignatureImages(contractId: string, pdf: PDFDocument) {
  const result = await db.from("Employment_Contract_Signatures").select("Signer_Role,Signer_Name,Signature_Storage_Path,Signed_At").eq("ID_Contract", contractId);
  if (result.error) throw new Error("Data tanda tangan gagal dimuat.");
  const map: Record<string, { name: string; signedAt: string; image: Awaited<ReturnType<PDFDocument["embedPng"]>> }> = {};
  for (const row of result.data || []) {
    const file = await db.storage.from(BUCKET).download(row.Signature_Storage_Path);
    if (file.error) throw new Error("File tanda tangan tidak tersedia.");
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const image = await pdf.embedPng(bytes);
    map[row.Signer_Role] = { name: row.Signer_Name, signedAt: row.Signed_At, image };
  }
  return map;
}

async function buildFinalPdf(row: ContractRow, token: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const snapshot = row.Snapshot as Record<string, unknown>;
  const template = row.Template_Content_Snapshot as { articles?: Array<{number:number;title:string;body:string}> };
  const W = 595.28, H = 841.89, M = 48, contentW = W - M * 2;
  const header = (page: PDFPage, title: string, subtitle = "") => {
    page.drawText(title, { x:M, y:H-58, size:15, font:bold, color:rgb(0.08,0.18,0.38) });
    if (subtitle) page.drawText(subtitle, { x:M, y:H-78, size:9, font:regular, color:rgb(0.4,0.45,0.52) });
    page.drawLine({ start:{x:M,y:H-88}, end:{x:W-M,y:H-88}, thickness:1, color:rgb(0.82,0.86,0.92) });
  };
  const field = (page: PDFPage, label: string, value: string, y: number) => {
    page.drawText(label, {x:M,y,size:9,font:bold,color:rgb(0.25,0.3,0.4)});
    const lines = wrap(regular, value || "-", 9.2, 320);
    drawLines(page, lines.slice(0,3), regular, 9.2, M+155, y, 320, 13);
  };

  const cover = pdf.addPage([W,H]);
  header(cover, "SURAT PERJANJIAN KERJA", String(row.Contract_Number));
  cover.drawText("RELAWAN / KARYAWAN SPPG · PROGRAM MAKAN BERGIZI GRATIS (MBG)", {x:M,y:H-116,size:9.5,font:bold,color:rgb(0.12,0.25,0.5)});
  cover.drawText("PIHAK PERTAMA", {x:M,y:H-154,size:11,font:bold});
  let y = H-177;
  for (const [label,key] of [["Nama Yayasan","nama_yayasan"],["Nama SPPG","nama_sppg"],["Kode SPPG","kode_sppg"],["Alamat SPPG","alamat_sppg"],["Nama Mitra","nama_mitra"],["Nama Kepala SPPG","nama_kepala_sppg"]]) { field(cover,label,String(snapshot[key]||"-"),y); y-=28; }
  cover.drawText("PIHAK KEDUA", {x:M,y:y-4,size:11,font:bold}); y-=30;
  for (const [label,key] of [["Nama","nama_relawan"],["NIK","nik"],["Tempat/Tanggal Lahir","ttl"],["Alamat","alamat"],["Nomor HP","no_hp"],["Email","email"],["Jabatan","jabatan"],["Divisi","divisi"],["Tanggal Mulai Kerja","tanggal_mulai"],["Status / Kontrak","status_kontrak"],["Masa Kontrak","masa_kontrak"],["Upah Harian","gaji_harian"],["Insentif","insentif"]]) {
    const v = ["gaji_harian","insentif"].includes(key) ? rupiah(snapshot[key]) : key === "tanggal_mulai" ? fmtDate(snapshot[key]) : String(snapshot[key]||"-"); field(cover,label,v,y); y-=26;
  }

  for (const article of template.articles || []) {
    const page = pdf.addPage([W,H]);
    header(page, `PASAL ${article.number} — ${article.title}`, String(row.Contract_Number));
    const body = replaceVars(article.body || "", snapshot);
    const lines = wrap(regular, body, 10.3, contentW);
    drawLines(page, lines, regular, 10.3, M, H-120, contentW, 16);
    page.drawText(`Template v${row.Template_Version} · ${snapshot.nama_sppg || "SPPG"}`, {x:M,y:28,size:7.5,font:regular,color:rgb(0.5,0.55,0.62)});
  }

  const signaturePage = pdf.addPage([W,H]);
  header(signaturePage, "TANDA TANGAN DIGITAL", String(row.Contract_Number));
  signaturePage.drawText("Para pihak menyatakan telah membaca, memahami, dan menyetujui isi perjanjian ini.", {x:M,y:H-122,size:9.5,font:regular,color:rgb(0.25,0.3,0.38)});
  const signatures = await downloadSignatureImages(String(row.ID_Contract), pdf);
  const roles = [["MITRA","MITRA"],["KEPALA_SPPG","KEPALA SPPG"],["KARYAWAN","RELAWAN / KARYAWAN"]] as const;
  let sy = H-190;
  for (const [key,label] of roles) {
    const sig = signatures[key];
    signaturePage.drawText(label, {x:M,y:sy,size:10,font:bold,color:rgb(0.1,0.25,0.5)});
    if (sig) {
      const scale = Math.min(150/sig.image.width, 55/sig.image.height);
      signaturePage.drawImage(sig.image, {x:M+160,y:sy-38,width:sig.image.width*scale,height:sig.image.height*scale});
      signaturePage.drawText(sig.name, {x:M+160,y:sy-56,size:9.5,font:bold});
      signaturePage.drawText(fmtDate(sig.signedAt), {x:M+160,y:sy-70,size:7.5,font:regular,color:rgb(0.45,0.5,0.58)});
    }
    sy -= 125;
  }
  const verifyUrl = `${VERIFY_ORIGIN}/verify-contract.html?t=${encodeURIComponent(token)}`;
  const qrData = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: "H", margin: 1, width: 420 });
  const qrBytes = Uint8Array.from(atob(qrData.split(",")[1]), (c) => c.charCodeAt(0));
  const qr = await pdf.embedPng(qrBytes);
  signaturePage.drawImage(qr, {x:W-M-105,y:55,width:105,height:105});
  signaturePage.drawText("QR VERIFIKASI DOKUMEN", {x:M,y:115,size:8,font:bold,color:rgb(0.1,0.25,0.5)});
  signaturePage.drawText(`Nomor: ${row.Contract_Number}`, {x:M,y:96,size:8.5,font:regular});
  signaturePage.drawText("Dokumen final dikunci setelah seluruh pihak menandatangani.", {x:M,y:79,size:7.5,font:regular,color:rgb(0.45,0.5,0.58)});
  return await pdf.save();
}

async function finalizeContract(row: ContractRow, actorUserId: string) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const pdfBytes = await buildFinalPdf(row, token);
  const pdfHash = await sha256Hex(pdfBytes);
  const path = `contracts/${row.ID_User}/${row.ID_Contract}/contract-final.pdf`;
  const upload = await db.storage.from(BUCKET).upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upload.error) throw new Error(`PDF final gagal disimpan: ${upload.error.message}`);

  await db.from("Employment_Contracts").update({ Status: "SUPERSEDED", Updated_At: nowIso() })
    .eq("ID_User", row.ID_User).eq("Status", "ACTIVE").neq("ID_Contract", row.ID_Contract);

  const update = await db.from("Employment_Contracts").update({
    Status: "ACTIVE", Signature_Progress: 3, Final_PDF_Storage_Path: path, Final_PDF_SHA256: pdfHash,
    Public_Token_Hash: tokenHash, Verification_Hint: token.slice(-6), Signed_At: nowIso(), Activated_At: nowIso(), Updated_At: nowIso(),
  }).eq("ID_Contract", row.ID_Contract);
  if (update.error) throw new Error(`Finalisasi perjanjian gagal: ${update.error.message}`);
  await audit(String(row.ID_Contract), actorUserId, "CONTRACT_FINALIZED", { pdfHash, path });
}

async function signContract(user: SessionUser, data: Record<string, unknown>) {
  const row = await contractById(data.contractId);
  const status = clean(row.Status, 40);
  let signerRole = "";
  let signerName = "";
  let nextStatus = "";
  let accepted = false;
  if (status === "WAITING_MITRA") {
    requireAdmin(user); enforceAdminContractScope(user,row); signerRole = "MITRA"; signerName = clean(data.signerName, 240) || clean((row.Snapshot as Record<string,unknown>)?.nama_mitra,240); nextStatus = "WAITING_HEAD";
  } else if (status === "WAITING_HEAD") {
    requireAdmin(user); enforceAdminContractScope(user,row); signerRole = "KEPALA_SPPG"; signerName = clean(data.signerName, 240) || clean((row.Snapshot as Record<string,unknown>)?.nama_kepala_sppg,240); nextStatus = "WAITING_EMPLOYEE";
  } else if (status === "WAITING_EMPLOYEE") {
    if (row.ID_User !== user.ID_User) throw new Error("FORBIDDEN"); signerRole = "KARYAWAN"; signerName = clean(user.Nama_Lengkap,240); nextStatus = "SIGNED"; accepted = data.acceptedStatement === true;
    if (!accepted) throw new Error("Anda wajib menyatakan telah membaca dan menyetujui perjanjian sebelum menandatangani.");
  } else throw new Error("Perjanjian tidak sedang menunggu tanda tangan.");
  if (!signerName) throw new Error("Nama penandatangan wajib tersedia.");
  const bytes = dataUrlBytes(data.signatureDataUrl);
  const path = await uploadSignature(String(row.ID_Contract), signerRole, bytes);
  const insert = await db.from("Employment_Contract_Signatures").insert({
    ID_Contract: row.ID_Contract, Signer_Role: signerRole, Signer_User_ID: user.ID_User, Signer_Name: signerName,
    Signature_Storage_Path: path, Accepted_Statement: accepted, Client_Metadata: { userAgent: clean(data.userAgent,500), source:"web-app" },
  });
  if (insert.error) throw new Error(`Tanda tangan gagal disimpan: ${insert.error.message}`);
  const progress = signerRole === "MITRA" ? 1 : signerRole === "KEPALA_SPPG" ? 2 : 3;
  const update = await db.from("Employment_Contracts").update({ Status: nextStatus, Signature_Progress: progress, Updated_At: nowIso() }).eq("ID_Contract", row.ID_Contract).eq("Status", status);
  if (update.error) throw new Error(`Status tanda tangan gagal diperbarui: ${update.error.message}`);
  await audit(String(row.ID_Contract), user.ID_User, `SIGNED_${signerRole}`, { signerName, progress });
  if (signerRole === "KARYAWAN") {
    const refreshed = await contractById(row.ID_Contract);
    await finalizeContract(refreshed, user.ID_User);
  }
  return await getDetail(user, row.ID_Contract);
}

async function cancelContract(user: SessionUser, data: Record<string, unknown>) {
  requireAdmin(user); const row = await contractById(data.contractId); enforceAdminContractScope(user,row);
  if (["ENDED","CANCELLED","SUPERSEDED"].includes(clean(row.Status,40))) throw new Error("Perjanjian sudah tidak aktif.");
  const reason = clean(data.reason, 500); if (reason.length < 5) throw new Error("Alasan pembatalan wajib diisi.");
  const update = await db.from("Employment_Contracts").update({ Status:"CANCELLED",Cancelled_At:nowIso(),Cancelled_By:user.ID_User,Cancellation_Reason:reason,Updated_At:nowIso() }).eq("ID_Contract",row.ID_Contract);
  if (update.error) throw new Error("Perjanjian gagal dibatalkan."); await audit(String(row.ID_Contract),user.ID_User,"CONTRACT_CANCELLED",{reason}); return {success:true};
}

async function endContract(user: SessionUser, data: Record<string, unknown>) {
  requireAdmin(user); const row = await contractById(data.contractId); enforceAdminContractScope(user,row);
  if (row.Status !== "ACTIVE") throw new Error("Hanya perjanjian aktif yang dapat diakhiri.");
  const update = await db.from("Employment_Contracts").update({Status:"ENDED",Ended_At:nowIso(),Updated_At:nowIso()}).eq("ID_Contract",row.ID_Contract);
  if (update.error) throw new Error("Perjanjian gagal diakhiri."); await audit(String(row.ID_Contract),user.ID_User,"CONTRACT_ENDED",{}); return {success:true};
}

async function masterData(user: SessionUser) {
  requireAdmin(user);
  const tables = ["Master_SPPG","Master_Jabatan","Master_Job_Description","Master_Jam_Kerja","Master_Employment_Terms","Master_Contract_Compensation","Master_SOP_References","Master_Contract_Templates"];
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    let q = db.from(table).select("*").limit(1000);
    if (table === "Master_SPPG" && !isSuper(user)) q = q.ilike("Nama_SPPG", clean(user.SPPG,180));
    const rows = await q; if (rows.error) throw new Error(`Master ${table} gagal dimuat.`); result[table] = rows.data || [];
  }
  return result;
}

function id(prefix: string) { return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0,8)}`; }
async function saveMaster(user: SessionUser, data: Record<string, unknown>) {
  requireAdmin(user);
  const type = clean(data.masterType,80).toUpperCase();
  const r = (data.record && typeof data.record === "object" ? data.record : {}) as Record<string,unknown>;
  const actor = user.ID_User;
  let table = "", key = "", payload: Record<string,unknown> = {};
  if (type === "SPPG") {
    table="Master_SPPG"; key="ID_Master_SPPG"; const name=clean(r.Nama_SPPG,180); if(!name) throw new Error("Nama SPPG wajib diisi.");
    if(!isSuper(user) && name.toUpperCase()!==adminScope(user)) throw new Error("ADMIN hanya dapat mengubah Master SPPG miliknya.");
    payload={ID_Master_SPPG:clean(r.ID_Master_SPPG,160)||id("SPPG"),Nama_SPPG:name,Kode_SPPG:clean(r.Kode_SPPG,24).toUpperCase(),Yayasan:clean(r.Yayasan,240),Alamat_SPPG:multi(r.Alamat_SPPG,1200),Lokasi_SPPG:clean(r.Lokasi_SPPG,500),Nama_Mitra:clean(r.Nama_Mitra,240),Nama_Kepala_SPPG:clean(r.Nama_Kepala_SPPG,240),Aktif:r.Aktif!==false,Updated_At:nowIso(),Updated_By:actor};
  } else if(type==="JABATAN") {
    table="Master_Jabatan"; key="ID_Master_Jabatan"; payload={ID_Master_Jabatan:clean(r.ID_Master_Jabatan,160)||id("JBT"),Nama_Jabatan:clean(r.Nama_Jabatan,200),Kode_Jabatan:clean(r.Kode_Jabatan,40),Divisi:clean(r.Divisi,200),Aktif:r.Aktif!==false,Updated_At:nowIso(),Updated_By:actor}; if(!payload.Nama_Jabatan) throw new Error("Nama jabatan wajib diisi.");
  } else if(type==="JOB_DESCRIPTION") {
    table="Master_Job_Description"; key="ID_Job_Description"; payload={ID_Job_Description:clean(r.ID_Job_Description,160)||id("JOB"),ID_Master_Jabatan:clean(r.ID_Master_Jabatan,160),Nama_Jabatan:clean(r.Nama_Jabatan,200),Job_Description:multi(r.Job_Description),Version:Math.max(1,Number(r.Version)||1),SPPG_Scope:isSuper(user)?clean(r.SPPG_Scope,180)||null:clean(user.SPPG,180),Aktif:r.Aktif!==false,Updated_At:nowIso(),Updated_By:actor}; if(!payload.ID_Master_Jabatan||!payload.Job_Description) throw new Error("Jabatan dan Job Description wajib diisi.");
  } else if(type==="JAM_KERJA") {
    table="Master_Jam_Kerja"; key="ID_Jam_Kerja"; payload={ID_Jam_Kerja:clean(r.ID_Jam_Kerja,160)||id("JAM"),ID_Master_Jabatan:clean(r.ID_Master_Jabatan,160)||null,Nama_Jabatan:clean(r.Nama_Jabatan,200),Divisi:clean(r.Divisi,200),Hari_Kerja:clean(r.Hari_Kerja,240)||"Sesuai jadwal operasional SPPG",Jam_Masuk:clean(r.Jam_Masuk,16)||null,Jam_Pulang:clean(r.Jam_Pulang,16)||null,Keterangan:multi(r.Keterangan,1000),SPPG_Scope:isSuper(user)?clean(r.SPPG_Scope,180)||null:clean(user.SPPG,180),Aktif:r.Aktif!==false,Updated_At:nowIso(),Updated_By:actor}; if(!payload.ID_Master_Jabatan) throw new Error("Pilih jabatan untuk jam kerja.");
  } else if(type==="EMPLOYMENT_TERM") {
    table="Master_Employment_Terms"; key="ID_Employment_Term"; const ct=clean(r.Jenis_Kontrak,30).toUpperCase(); if(!["PKWT","PKWTT","RELAWAN","LAINNYA"].includes(ct)) throw new Error("Jenis kontrak tidak valid."); payload={ID_Employment_Term:clean(r.ID_Employment_Term,160)||id("TERM"),Nama_Status_Kerja:clean(r.Nama_Status_Kerja,160),Jenis_Kontrak:ct,Durasi_Default_Bulan:r.Durasi_Default_Bulan?Number(r.Durasi_Default_Bulan):null,Keterangan:multi(r.Keterangan,1000),SPPG_Scope:isSuper(user)?clean(r.SPPG_Scope,180)||null:clean(user.SPPG,180),Aktif:r.Aktif!==false,Updated_At:nowIso(),Updated_By:actor};
  } else if(type==="COMPENSATION") {
    table="Master_Contract_Compensation"; key="ID_Compensation"; payload={ID_Compensation:clean(r.ID_Compensation,160)||id("COMP"),ID_Master_Jabatan:clean(r.ID_Master_Jabatan,160)||null,Nama_Jabatan:clean(r.Nama_Jabatan,200),Jenis_Kontrak:clean(r.Jenis_Kontrak,40),Gaji_Pokok:money(r.Gaji_Pokok)||null,Gaji_Bulanan:money(r.Gaji_Bulanan)||null,Insentif_Default:money(r.Insentif_Default),Keterangan:multi(r.Keterangan,1000),SPPG_Scope:isSuper(user)?clean(r.SPPG_Scope,180)||null:clean(user.SPPG,180),Aktif:r.Aktif!==false,Updated_At:nowIso(),Updated_By:actor};
  } else if(type==="SOP") {
    table="Master_SOP_References"; key="ID_SOP"; payload={ID_SOP:clean(r.ID_SOP,160)||id("SOP"),Kode_SOP:clean(r.Kode_SOP,80),Nama_SOP:clean(r.Nama_SOP,240),Deskripsi:multi(r.Deskripsi,2500),Urutan:Number(r.Urutan)||0,SPPG_Scope:isSuper(user)?clean(r.SPPG_Scope,180)||null:clean(user.SPPG,180),Aktif:r.Aktif!==false,Updated_At:nowIso(),Updated_By:actor}; if(!payload.Nama_SOP) throw new Error("Nama SOP wajib diisi.");
  } else if(type==="TEMPLATE") {
    table="Master_Contract_Templates"; key="ID_Template"; const existing=clean(r.ID_Template,80); const content=typeof r.Content_JSON==="object"?r.Content_JSON:null; if(!content) throw new Error("Isi template wajib tersedia."); payload={...(existing?{ID_Template:existing}:{}),Nama_Template:clean(r.Nama_Template,200)||"PK SPPG MBG",Version:Math.max(1,Number(r.Version)||1),Document_Type:"PERJANJIAN_KERJA",Title:clean(r.Title,400),Content_JSON:content,SPPG_Scope:isSuper(user)?clean(r.SPPG_Scope,180)||null:clean(user.SPPG,180),Aktif:r.Aktif!==false,Effective_From:parseDate(r.Effective_From||new Date().toISOString().slice(0,10),"Tanggal berlaku"),Updated_At:nowIso(),Updated_By:actor};
  } else throw new Error("Jenis master tidak didukung.");
  const upsert = await db.from(table).upsert(payload, { onConflict:key }).select("*").single();
  if(upsert.error) throw new Error(`Master gagal disimpan: ${upsert.error.message}`); await audit(null,user.ID_User,"MASTER_UPDATED",{type,key:upsert.data?.[key]}); return upsert.data;
}

async function verify(tokenValue: unknown) {
  const token = clean(tokenValue,200); if(token.length<30) throw new Error("TOKEN_INVALID"); const hash=await sha256Hex(token);
  const result = await db.from("Employment_Contracts").select("Contract_Number,SPPG,Status,Signed_At,Template_Version,Final_PDF_SHA256,Snapshot").eq("Public_Token_Hash",hash).eq("Status","ACTIVE").maybeSingle();
  if(result.error||!result.data) throw new Error("TOKEN_INVALID"); const s=result.data.Snapshot as Record<string,unknown>;
  return {valid:true,contractNumber:result.data.Contract_Number,nama:String(s?.nama_relawan||"-"),sppg:result.data.SPPG,jabatan:String(s?.jabatan||"-"),signedAt:result.data.Signed_At,status:result.data.Status,templateVersion:result.data.Template_Version,documentHash:String(result.data.Final_PDF_SHA256||"")};
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ success:false,error:"Method tidak didukung." },405);
  try {
    const body = await request.json() as Record<string,unknown>;
    const fn = clean(body.function || body.action,100);
    const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string,unknown>;
    if (fn === "verifyEmploymentContract") return json({success:true,result:await verify(data.token || body.token)});
    const user = await authenticate(data.token || body.token);
    let result: unknown;
    if(fn==="getMyEmploymentContracts") result=await listMy(user);
    else if(fn==="getEmploymentContractDetail") result=await getDetail(user,data.contractId);
    else if(fn==="getAdminEmploymentContracts") result=await listAdmin(user);
    else if(fn==="getContractMasterData") result=await masterData(user);
    else if(fn==="saveContractMaster") result=await saveMaster(user,data);
    else if(fn==="createEmploymentContract") result=await createContract(user,data);
    else if(fn==="signEmploymentContract") result=await signContract(user,data);
    else if(fn==="cancelEmploymentContract") result=await cancelContract(user,data);
    else if(fn==="endEmploymentContract") result=await endContract(user,data);
    else return json({success:false,error:"Aksi perjanjian tidak didukung."},422);
    return json({success:true,result});
  } catch(error) {
    const raw=error instanceof Error?error.message:String(error);
    if(raw==="SESSION_EXPIRED") return json({success:false,error:"Sesi telah berakhir. Silakan login kembali."},401);
    if(raw==="ACCOUNT_INACTIVE"||raw==="FORBIDDEN") return json({success:false,error:raw==="FORBIDDEN"?"Anda tidak memiliki akses ke data ini.":"Akun tidak aktif."},403);
    if(raw==="TOKEN_INVALID") return json({success:false,error:"Perjanjian tidak valid atau sudah tidak aktif."},404);
    const status=/wajib|belum|tidak valid|tidak tersedia|Lengkapi|Pilih|Hanya|sedang|sudah/i.test(raw)?422:500;
    console.error(JSON.stringify({code:"EMPLOYMENT_CONTRACT_ERROR",function:clean((await Promise.resolve("") as unknown),1),error:raw}));
    return json({success:false,error:status===500?"Layanan Perjanjian Kerja gagal memproses permintaan.":raw},status);
  }
});
