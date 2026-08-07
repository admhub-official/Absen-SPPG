// @deno-types="npm:@types/qrcode@1.5.5"
import {
  PDFDocument,
  StandardFonts,
  appendBezierCurve,
  clip,
  endPath,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "npm:pdf-lib@1.17.1";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = "digital-id-cards";
const LEGACY_FUNCTION = `${SUPABASE_URL}/functions/v1/DigitalIdentity`;
const BGN_LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/Logo%20BGN/LOGO_BGN.png`;
const encoder = new TextEncoder();

type Row = Record<string, any>;
type Profile = {
  ID_User: string;
  Nama_Lengkap: string | null;
  Role: string | null;
  Jabatan_Divisi: string | null;
  SPPG: string | null;
  Yayasan: string | null;
  Tanggal_Mulai_Kerja: string | null;
  ID_Card_Unik: string | null;
  URL_Foto_Profil: string | null;
  URL_Foto_Profil_Asli: string | null;
};
type ImageAsset = { bytes: Uint8Array; type: "png" | "jpg" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function clean(value: unknown, fallback = "-") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}
function yayasan(value: unknown) {
  const text = clean(value);
  return /^yayasan\b/i.test(text) ? text : `Yayasan ${text}`;
}
function note(profile: Profile) {
  return `ID card ini resmi milik karyawan Satuan Pelayanan Pemenuhan Gizi (SPPG) ${clean(profile.SPPG)}, ${yayasan(profile.Yayasan)}, dan berlaku selama kontrak kerja masih berlaku.`;
}
function dateOnly(value: unknown) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" }).format(date);
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ID";
}
async function sha256(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fit(text: string, font: PDFFont, size: number, maxWidth: number) {
  const source = clean(text);
  if (font.widthOfTextAtSize(source, size) <= maxWidth) return source;
  let result = source;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}
function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 6) {
  const words = clean(text).split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = word; if (lines.length >= maxLines - 1) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}
function center(page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, color: ReturnType<typeof rgb>) {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size) / 2, y, size, font, color });
}
function wrapped(page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, width: number, lineHeight: number, color: ReturnType<typeof rgb>, maxLines = 6) {
  const lines = wrap(text, font, size, width, maxLines);
  lines.forEach((line, i) => page.drawText(line, { x, y: y - i * lineHeight, size, font, color }));
  return y - lines.length * lineHeight;
}
function sniff(bytes: Uint8Array, contentType = ""): "png" | "jpg" | null {
  const type = contentType.toLowerCase();
  if (type.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return "png";
  if (type.includes("jpeg") || type.includes("jpg") || (bytes[0] === 0xff && bytes[1] === 0xd8)) return "jpg";
  return null;
}
async function fetchImage(urlValue: unknown): Promise<ImageAsset | null> {
  const value = String(urlValue || "").trim(); if (!value) return null;
  try {
    const url = new URL(value); if (url.origin !== new URL(SUPABASE_URL).origin && url.origin !== "https://hadirly.org") return null;
    const response = await fetch(url, { cache: "no-store" }); if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer()); if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
    const type = sniff(bytes, response.headers.get("content-type") || ""); return type ? { bytes, type } : null;
  } catch { return null; }
}
async function embed(pdf: PDFDocument, asset: ImageAsset | null): Promise<PDFImage | null> {
  if (!asset) return null;
  try { return asset.type === "png" ? await pdf.embedPng(asset.bytes) : await pdf.embedJpg(asset.bytes); } catch { return null; }
}
function circular(page: PDFPage, image: PDFImage, x: number, y: number, size: number) {
  const r = size / 2, cx = x + r, cy = y + r, c = r * 0.552284749831;
  page.pushOperators(pushGraphicsState(), moveTo(cx + r, cy), appendBezierCurve(cx + r, cy + c, cx + c, cy + r, cx, cy + r), appendBezierCurve(cx - c, cy + r, cx - r, cy + c, cx - r, cy), appendBezierCurve(cx - r, cy - c, cx - c, cy - r, cx, cy - r), appendBezierCurve(cx + c, cy - r, cx + r, cy - c, cx + r, cy), clip(), endPath());
  const dims = image.scale(1), ratio = Math.max(size / dims.width, size / dims.height), width = dims.width * ratio, height = dims.height * ratio;
  page.drawImage(image, { x: x + (size - width) / 2, y: y + (size - height) / 2, width, height });
  page.pushOperators(popGraphicsState());
}
async function legacy(functionName: string, token: string) {
  const response = await fetch(LEGACY_FUNCTION, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ function: functionName, data: { token } }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) throw new Error(body?.message || "AUTH_FAILED");
  return body.result;
}
async function getProfile(idUser: string): Promise<Profile> {
  const result = await db.from("Users").select("ID_User,Nama_Lengkap,Role,Jabatan_Divisi,SPPG,Yayasan,Tanggal_Mulai_Kerja,ID_Card_Unik,URL_Foto_Profil,URL_Foto_Profil_Asli").eq("ID_User", idUser).single();
  if (result.error || !result.data) throw result.error || new Error("PROFILE_NOT_FOUND");
  return result.data as Profile;
}
async function build(profile: Profile, card: Row, qrPng: Uint8Array, signaturePng: Uint8Array | null) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595.28, 841.89]); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qr = await pdf.embedPng(qrPng); const photo = await embed(pdf, await fetchImage(profile.URL_Foto_Profil || profile.URL_Foto_Profil_Asli)); const logo = await embed(pdf, await fetchImage(BGN_LOGO_URL)); const signature = signaturePng ? await pdf.embedPng(signaturePng) : null;
  const navy = rgb(15/255,23/255,42/255), blue = rgb(30/255,64/255,175/255), sky = rgb(239/255,246/255,255/255), pale = rgb(248/255,250/255,252/255), border = rgb(203/255,213/255,225/255), muted = rgb(71/255,85/255,105/255), white = rgb(1,1,1);
  const mm = 72/25.4, cardW = 53.98*mm, cardH = 85.6*mm, gap = 34, frontX = (595.28-(cardW*2+gap))/2, backX = frontX+cardW+gap, cardY = 455, frontCenter = frontX+cardW/2, backCenter = backX+cardW/2;
  const name = clean(profile.Nama_Lengkap), position = clean(profile.Jabatan_Divisi) === "-" ? clean(profile.Role) : clean(profile.Jabatan_Divisi), sppg = clean(profile.SPPG), foundation = yayasan(profile.Yayasan), code = clean(profile.ID_Card_Unik), start = dateOnly(profile.Tanggal_Mulai_Kerja), ownership = note(profile);
  page.drawText("ID CARD KARYAWAN SPPG", { x: frontX, y: 785, size: 15, font: bold, color: navy }); page.drawText("Format portrait CR80 53,98 × 85,60 mm · cetak pada skala 100%.", { x: frontX, y: 766, size: 8, font: regular, color: muted });
  page.drawRectangle({ x: frontX, y: cardY, width: cardW, height: cardH, color: white, borderColor: border, borderWidth: .8 }); page.drawRectangle({ x: frontX, y: cardY+cardH-63, width: cardW, height: 63, color: sky }); page.drawRectangle({ x: frontX, y: cardY+cardH-4, width: cardW, height: 4, color: blue });
  if (logo) { const d=logo.scale(1), h=29, w=Math.min(35,(d.width/d.height)*h); page.drawImage(logo,{x:frontCenter-w/2,y:cardY+cardH-37,width:w,height:h}); }
  center(page,"SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)",bold,5.1,frontCenter,cardY+cardH-47,navy); center(page,fit(sppg,bold,7.5,cardW-14),bold,7.5,frontCenter,cardY+cardH-57,blue); center(page,fit(foundation,regular,5.2,cardW-14),regular,5.2,frontCenter,cardY+cardH-66,muted);
  const photoSize=67, photoX=frontCenter-photoSize/2, photoY=cardY+cardH-141; page.drawCircle({x:frontCenter,y:photoY+photoSize/2,size:photoSize/2+3,color:sky}); if(photo) circular(page,photo,photoX,photoY,photoSize); else { page.drawCircle({x:frontCenter,y:photoY+photoSize/2,size:photoSize/2,color:rgb(219/255,234/255,254/255)}); center(page,initials(name),bold,19,frontCenter,photoY+25,blue); }
  center(page,fit(name,bold,10,cardW-18),bold,10,frontCenter,cardY+89,navy); center(page,fit(position,regular,6.7,cardW-18),regular,6.7,frontCenter,cardY+77,muted); page.drawRectangle({x:frontX+18,y:cardY+61,width:cardW-36,height:1,color:border}); center(page,"TANGGAL MULAI BEKERJA",bold,4.7,frontCenter,cardY+49,blue); center(page,fit(start,bold,6.6,cardW-18),bold,6.6,frontCenter,cardY+38,navy);
  page.drawRectangle({x:backX,y:cardY,width:cardW,height:cardH,color:white,borderColor:border,borderWidth:.8}); page.drawRectangle({x:backX,y:cardY+cardH-66,width:cardW,height:66,color:sky}); page.drawRectangle({x:backX,y:cardY+cardH-4,width:cardW,height:4,color:blue});
  const logoSize=34, logoX=backX+12, logoY=cardY+cardH-48; if(logo) page.drawImage(logo,{x:logoX,y:logoY,width:logoSize,height:logoSize}); const tx=logoX+logoSize+8; page.drawText("SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)",{x:tx,y:cardY+cardH-23,size:4.45,font:bold,color:navy}); page.drawText(fit(sppg,bold,7.1,cardW-62),{x:tx,y:cardY+cardH-35,size:7.1,font:bold,color:blue}); page.drawText(fit(foundation,regular,4.8,cardW-62),{x:tx,y:cardY+cardH-46,size:4.8,font:regular,color:muted});
  const qrSize=82; page.drawRectangle({x:backCenter-qrSize/2-4,y:cardY+116,width:qrSize+8,height:qrSize+8,color:pale,borderColor:border,borderWidth:.5}); page.drawImage(qr,{x:backCenter-qrSize/2,y:cardY+120,width:qrSize,height:qrSize}); center(page,"KODE ID CARD",bold,4.8,backCenter,cardY+105,blue); center(page,fit(code,bold,7.3,cardW-16),bold,7.3,backCenter,cardY+94,navy);
  const noteBottom=wrapped(page,ownership,regular,4.35,backX+10,cardY+80,cardW-20,5.25,muted,5); page.drawRectangle({x:backX+12,y:Math.max(cardY+54,noteBottom-1),width:cardW-24,height:.7,color:border});
  center(page,"KEPALA SPPG",bold,4.8,backCenter,cardY+49,blue); if(signature){const d=signature.scale(1),maxW=64,maxH=27,ratio=Math.min(maxW/d.width,maxH/d.height),w=d.width*ratio,h=d.height*ratio;page.drawImage(signature,{x:backCenter-w/2,y:cardY+22,width:w,height:h});} center(page,fit(clean(card.Head_SPPG_Name,"-"),bold,6.1,cardW-18),bold,6.1,backCenter,cardY+13,navy);
  page.drawText("DEPAN",{x:frontCenter-12,y:cardY-16,size:7,font:bold,color:muted}); page.drawText("BELAKANG",{x:backCenter-18,y:cardY-16,size:7,font:bold,color:muted}); page.drawText("QR hanya valid setelah kartu disetujui dan berstatus ACTIVE.",{x:frontX,y:410,size:7,font:regular,color:muted}); return new Uint8Array(await pdf.save());
}
async function refreshCard(cardId: string) {
  const cardResult = await db.from("Digital_ID_Cards").select("*").eq("ID",cardId).eq("Status","ACTIVE").single(); if(cardResult.error||!cardResult.data) throw cardResult.error||new Error("CARD_NOT_FOUND"); const card=cardResult.data as Row; const profile=await getProfile(String(card.ID_User));
  const [qrDownload,sigDownload]=await Promise.all([db.storage.from(BUCKET).download(card.QR_PNG_Storage_Path), card.Head_SPPG_Signature_Storage_Path ? db.storage.from(BUCKET).download(card.Head_SPPG_Signature_Storage_Path) : Promise.resolve({data:null,error:null} as any)]); if(qrDownload.error||!qrDownload.data) throw qrDownload.error||new Error("QR_NOT_FOUND");
  const qrPng=new Uint8Array(await qrDownload.data.arrayBuffer()), signaturePng=sigDownload.data?new Uint8Array(await sigDownload.data.arrayBuffer()):null, pdf=await build(profile,card,qrPng,signaturePng), hash=await sha256(pdf); const upload=await db.storage.from(BUCKET).upload(String(card.ID_Card_PDF_Storage_Path),pdf,{contentType:"application/pdf",cacheControl:"0",upsert:true}); if(upload.error) throw upload.error; const update=await db.from("Digital_ID_Cards").update({ID_Card_PDF_SHA256:hash,Updated_At:new Date().toISOString()}).eq("ID",cardId); if(update.error) throw update.error; return {cardId,pdfSha256:hash};
}

Deno.serve(async (req) => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors}); if(req.method!=="POST") return new Response(JSON.stringify({success:false,message:"Gunakan POST."}),{status:405,headers:cors});
  try { const body=await req.json() as Record<string,any>, token=String(body.token||body.data?.token||""); if(!token) throw new Error("Sesi login tidak tersedia."); const action=String(body.action||body.function||""); let ids:string[]=[];
    if(action==="refreshMyActiveIdCardPdf"){const identity=await legacy("getMyDigitalIdentity",token); if(!identity?.card?.id) throw new Error("ID Card aktif tidak ditemukan."); ids=[String(identity.card.id)];}
    else if(action==="refreshApprovedIdCardPdfs"){const overview=await legacy("getIdCardAdminOverview",token), allowed=new Set((overview?.approved||[]).map((item:any)=>String(item.id))), requested=Array.isArray(body.cardIds||body.data?.cardIds)?(body.cardIds||body.data?.cardIds).map(String):[]; ids=requested.filter((id:string)=>allowed.has(id)); if(ids.length!==requested.length) throw new Error("Akses ID Card tidak valid.");}
    else throw new Error("Aksi tidak didukung.");
    const refreshed=[]; for(const id of ids) refreshed.push(await refreshCard(id)); return new Response(JSON.stringify({success:true,result:{refreshed}}),{status:200,headers:cors});
  } catch(error){return new Response(JSON.stringify({success:false,message:error instanceof Error?error.message:String(error)}),{status:400,headers:cors});}
});
