// @deno-types="npm:@types/qrcode@1.5.5"
import QRCode from "npm:qrcode@1.5.4";
import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  StandardFonts,
  appendBezierCurve,
  clip,
  endPath,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "npm:pdf-lib@1.17.1";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type AuthenticatedUser,
  authenticateUserSession,
} from "../_shared/auth.ts";
import {
  corsHeaders,
  createRequestId,
  isOriginAllowed,
  jsonResponse,
} from "../_shared/http.ts";
import { requiredString, ValidationError } from "../_shared/validation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(
  SUPABASE_URL,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const BUCKET = "digital-id-cards";
const SIGNED_URL_SECONDS = 60 * 60;
const VERIFY_BASE_URL = "https://hadirly.org/verify-id.html";
const BGN_LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/Logo%20BGN/LOGO_BGN.png`;
const CORS_OPTIONS = {
  allowedOriginsEnv: Deno.env.get("ABSEN_ALLOWED_ORIGINS") || "",
  productionOrigin: "https://hadirly.org",
  previewSuffix: ".pages.dev",
  localOrigins: [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ],
};

const encoder = new TextEncoder();
type DataRow = Record<string, any>;
type UserProfile = {
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
  Status_Aktif: boolean | null;
};
type ImageAsset = { bytes: Uint8Array; type: "png" | "jpg" };
type ApprovalData = {
  headName: string;
  signaturePng: Uint8Array | null;
};
type CardArtifacts = {
  qrPng: Uint8Array;
  qrPdf: Uint8Array;
  idCardPdf: Uint8Array;
  idCardPdfSha256: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRole(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/_/g, " ");
}

function cleanText(value: unknown, fallback = "-"): string {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  return result || fallback;
}

function normalizeComparable(value: unknown): string {
  return cleanText(value, "").toLocaleUpperCase("id-ID");
}

function pathSegment(value: unknown): string {
  return String(value || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function yayasanLabel(value: unknown): string {
  const text = cleanText(value);
  if (text === "-") return "Yayasan -";
  return /^yayasan\b/i.test(text) ? text : `Yayasan ${text}`;
}

function officialOwnershipNote(profile: UserProfile): string {
  return `ID card ini resmi milik karyawan Satuan Pelayanan Pemenuhan Gizi (SPPG) ${cleanText(profile.SPPG)}, ${yayasanLabel(profile.Yayasan)}, dan berlaku selama kontrak kerja masih berlaku.`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function formatDateId(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\./g, ":");
}

function formatDateOnlyId(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "ID";
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const normalized = cleanText(text);
  if (font.widthOfTextAtSize(normalized, size) <= maxWidth) return normalized;
  let result = normalized;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines = 6,
): string[] {
  const words = cleanText(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").length;
    if (consumed < cleanText(text).length) {
      lines[maxLines - 1] = fitText(`${lines[maxLines - 1]}…`, font, size, maxWidth);
    }
  }
  return lines;
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  centerX: number,
  y: number,
  color: ReturnType<typeof rgb>,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - width / 2, y, size, font, color });
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  color: ReturnType<typeof rgb>,
  maxLines = 6,
): number {
  const lines = wrapText(text, font, size, maxWidth, maxLines);
  lines.forEach((line, index) => {
    page.drawText(line, { x, y: y - index * lineHeight, size, font, color });
  });
  return y - lines.length * lineHeight;
}

async function fetchKnownImage(value: string | null | undefined): Promise<ImageAsset | null> {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowedOrigins = new Set([new URL(SUPABASE_URL).origin, "https://hadirly.org"]);
    if (!allowedOrigins.has(url.origin)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
    if (type.includes("png")) return { bytes, type: "png" };
    if (type.includes("jpeg") || type.includes("jpg")) return { bytes, type: "jpg" };
    return null;
  } catch {
    return null;
  }
}

async function embedImage(pdf: PDFDocument, asset: ImageAsset | null): Promise<PDFImage | null> {
  if (!asset) return null;
  try {
    return asset.type === "png" ? await pdf.embedPng(asset.bytes) : await pdf.embedJpg(asset.bytes);
  } catch {
    return null;
  }
}

function drawCircularImage(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  size: number,
): void {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  const c = r * 0.552284749831;
  page.pushOperators(
    pushGraphicsState(),
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + c, cx + c, cy + r, cx, cy + r),
    appendBezierCurve(cx - c, cy + r, cx - r, cy + c, cx - r, cy),
    appendBezierCurve(cx - r, cy - c, cx - c, cy - r, cx, cy - r),
    appendBezierCurve(cx + c, cy - r, cx + r, cy - c, cx + r, cy),
    clip(),
    endPath(),
  );

  const dimensions = image.scale(1);
  const ratio = Math.max(size / dimensions.width, size / dimensions.height);
  const width = dimensions.width * ratio;
  const height = dimensions.height * ratio;
  page.drawImage(image, {
    x: x + (size - width) / 2,
    y: y + (size - height) / 2,
    width,
    height,
  });
  page.pushOperators(popGraphicsState());
  page.drawCircle({
    x: cx,
    y: cy,
    size: r,
    borderColor: rgb(226 / 255, 232 / 255, 240 / 255),
    borderWidth: 1,
  });
}

function signatureBytes(value: unknown): Uint8Array {
  const raw = requiredString(value, "signatureDataUrl", { min: 50, max: 3_000_000 });
  const match = raw.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new ValidationError("Format TTD harus PNG dari kanvas tanda tangan.", "signatureDataUrl");
  let binary = "";
  try {
    binary = atob(match[1]);
  } catch {
    throw new ValidationError("Data TTD tidak valid.", "signatureDataUrl");
  }
  if (binary.length < 80 || binary.length > 1_500_000) {
    throw new ValidationError("Ukuran TTD tidak valid.", "signatureDataUrl");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getProfile(idUser: string): Promise<UserProfile> {
  const result = await db
    .from("Users")
    .select(
      "ID_User,Nama_Lengkap,Role,Jabatan_Divisi,SPPG,Yayasan,Tanggal_Mulai_Kerja,ID_Card_Unik,URL_Foto_Profil,URL_Foto_Profil_Asli,Status_Aktif",
    )
    .eq("ID_User", idUser)
    .maybeSingle();
  if (result.error || !result.data) throw new Error("ACCOUNT_INACTIVE");
  return result.data as UserProfile;
}

async function getProfiles(ids: string[]): Promise<Map<string, UserProfile>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const result = await db
    .from("Users")
    .select(
      "ID_User,Nama_Lengkap,Role,Jabatan_Divisi,SPPG,Yayasan,Tanggal_Mulai_Kerja,ID_Card_Unik,URL_Foto_Profil,URL_Foto_Profil_Asli,Status_Aktif",
    )
    .in("ID_User", unique);
  if (result.error) throw result.error;
  return new Map((result.data || []).map((row) => [String(row.ID_User), row as UserProfile]));
}

async function ensureIdCardCode(profile: UserProfile): Promise<UserProfile> {
  if (cleanText(profile.ID_Card_Unik, "") !== "") return profile;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const hash = await sha256Hex(`${profile.ID_User}:${Date.now()}:${randomToken()}:${attempt}`);
    const code = `HAD-${hash.slice(0, 12).toUpperCase()}`;
    const update = await db
      .from("Users")
      .update({ ID_Card_Unik: code, Updated_At: nowIso() })
      .eq("ID_User", profile.ID_User)
      .select(
        "ID_User,Nama_Lengkap,Role,Jabatan_Divisi,SPPG,Yayasan,Tanggal_Mulai_Kerja,ID_Card_Unik,URL_Foto_Profil,URL_Foto_Profil_Asli,Status_Aktif",
      )
      .maybeSingle();
    if (!update.error && update.data) return update.data as UserProfile;
    if (update.error?.code !== "23505") throw update.error;
  }
  throw new Error("ID_CARD_CODE_FAILED");
}

async function getCardByStatus(idUser: string, status: "ACTIVE" | "PENDING"): Promise<DataRow | null> {
  const result = await db
    .from("Digital_ID_Cards")
    .select("*")
    .eq("ID_User", idUser)
    .eq("Status", status)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as DataRow | null;
}

async function nextVersion(idUser: string): Promise<number> {
  const result = await db
    .from("Digital_ID_Cards")
    .select("Version")
    .eq("ID_User", idUser)
    .order("Version", { ascending: false })
    .limit(1);
  if (result.error) throw result.error;
  return Number(result.data?.[0]?.Version || 0) + 1;
}

async function signedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const result = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (result.error) throw result.error;
  return result.data?.signedUrl || null;
}

async function responseFor(profile: UserProfile, activeCard: DataRow | null, pendingCard: DataRow | null) {
  const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
  const urls = activeCard
    ? await Promise.all([
      signedUrl(activeCard.QR_PNG_Storage_Path),
      signedUrl(activeCard.QR_PDF_Storage_Path),
      signedUrl(activeCard.ID_Card_PDF_Storage_Path),
      signedUrl(activeCard.Head_SPPG_Signature_Storage_Path),
    ])
    : [null, null, null, null];

  return {
    hasCard: Boolean(activeCard),
    hasPending: Boolean(pendingCard),
    status: pendingCard ? "PENDING" : activeCard ? "ACTIVE" : "NONE",
    profile: {
      idUser: profile.ID_User,
      namaLengkap: cleanText(profile.Nama_Lengkap),
      role: normalizeRole(profile.Role) || "USER",
      jabatan: cleanText(profile.Jabatan_Divisi),
      sppg: cleanText(profile.SPPG),
      yayasan: cleanText(profile.Yayasan),
      yayasanLabel: yayasanLabel(profile.Yayasan),
      tanggalMulaiKerja: profile.Tanggal_Mulai_Kerja,
      tanggalMulaiKerjaLabel: formatDateOnlyId(profile.Tanggal_Mulai_Kerja),
      idCardCode: cleanText(profile.ID_Card_Unik),
      fotoUrl: profile.URL_Foto_Profil || profile.URL_Foto_Profil_Asli || null,
      officialNote: officialOwnershipNote(profile),
    },
    pending: pendingCard
      ? {
        id: pendingCard.ID,
        version: Number(pendingCard.Version),
        status: pendingCard.Status,
        requestedAt: pendingCard.Requested_At || pendingCard.Generated_At,
        requestedAtLabel: formatDateId(pendingCard.Requested_At || pendingCard.Generated_At),
      }
      : null,
    card: activeCard
      ? {
        id: activeCard.ID,
        version: Number(activeCard.Version),
        status: activeCard.Status,
        generatedAt: activeCard.Generated_At,
        generatedAtLabel: formatDateId(activeCard.Generated_At),
        approvedAt: activeCard.Approved_At || activeCard.Generated_At,
        approvedAtLabel: formatDateId(activeCard.Approved_At || activeCard.Generated_At),
        headSppgName: cleanText(activeCard.Head_SPPG_Name, ""),
        headSppgSignatureUrl: urls[3],
        verificationCount: Number(activeCard.Verification_Count || 0),
        lastVerifiedAt: activeCard.Last_Verified_At,
        pdfSha256: activeCard.ID_Card_PDF_SHA256,
        qrPngUrl: urls[0],
        qrPdfUrl: urls[1],
        idCardPdfUrl: urls[2],
        signedUrlExpiresAt: expiresAt,
      }
      : null,
  };
}

async function auditBestEffort(
  activity: string,
  actorId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await db.from("Audit_Log").insert({
      ID_Log: `AUD_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      Waktu: nowIso(),
      ID_User_Pelaku: actorId,
      Jenis_Aktivitas: activity,
      Detail: detail,
    });
    if (result.error) throw result.error;
  } catch (error) {
    console.error(JSON.stringify({
      code: "DIGITAL_ID_AUDIT_DEFERRED",
      activity,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function buildIdCardPdf(
  profile: UserProfile,
  qrPng: Uint8Array,
  generatedAt: string,
  approval: ApprovalData | null = null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qr = await pdf.embedPng(qrPng);
  const photoAsset = await fetchKnownImage(profile.URL_Foto_Profil || profile.URL_Foto_Profil_Asli);
  const logoAsset = await fetchKnownImage(BGN_LOGO_URL);
  const photo = await embedImage(pdf, photoAsset);
  const logo = await embedImage(pdf, logoAsset);
  const signature = approval?.signaturePng ? await pdf.embedPng(approval.signaturePng) : null;

  const navy = rgb(15 / 255, 23 / 255, 42 / 255);
  const blue = rgb(30 / 255, 64 / 255, 175 / 255);
  const sky = rgb(239 / 255, 246 / 255, 255 / 255);
  const pale = rgb(248 / 255, 250 / 255, 252 / 255);
  const border = rgb(203 / 255, 213 / 255, 225 / 255);
  const muted = rgb(71 / 255, 85 / 255, 105 / 255);
  const green = rgb(5 / 255, 150 / 255, 105 / 255);
  const amber = rgb(180 / 255, 83 / 255, 9 / 255);
  const white = rgb(1, 1, 1);
  const mm = 72 / 25.4;
  const cardW = 53.98 * mm;
  const cardH = 85.6 * mm;
  const gap = 34;
  const totalW = cardW * 2 + gap;
  const frontX = (595.28 - totalW) / 2;
  const backX = frontX + cardW + gap;
  const cardY = 455;
  const name = cleanText(profile.Nama_Lengkap);
  const role = normalizeRole(profile.Role) || "USER";
  const position = cleanText(profile.Jabatan_Divisi) === "-" ? role : cleanText(profile.Jabatan_Divisi);
  const sppg = cleanText(profile.SPPG);
  const foundation = yayasanLabel(profile.Yayasan);
  const code = cleanText(profile.ID_Card_Unik);
  const startDate = formatDateOnlyId(profile.Tanggal_Mulai_Kerja);
  const note = officialOwnershipNote(profile);

  page.drawText("ID CARD KARYAWAN SPPG", {
    x: frontX,
    y: 785,
    size: 15,
    font: bold,
    color: navy,
  });
  page.drawText("Format portrait CR80 53,98 × 85,60 mm · cetak pada skala 100%.", {
    x: frontX,
    y: 766,
    size: 8,
    font: regular,
    color: muted,
  });

  // FRONT — portrait employee card.
  page.drawRectangle({
    x: frontX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: white,
    borderColor: border,
    borderWidth: 0.8,
  });
  page.drawRectangle({ x: frontX, y: cardY + cardH - 63, width: cardW, height: 63, color: sky });
  page.drawRectangle({ x: frontX, y: cardY, width: cardW, height: 47, color: pale });
  page.drawRectangle({ x: frontX, y: cardY + cardH - 4, width: cardW, height: 4, color: blue });

  const frontCenter = frontX + cardW / 2;
  if (logo) {
    const dims = logo.scale(1);
    const logoH = 29;
    const logoW = Math.min(35, (dims.width / dims.height) * logoH);
    page.drawImage(logo, {
      x: frontCenter - logoW / 2,
      y: cardY + cardH - 37,
      width: logoW,
      height: logoH,
    });
  }
  drawCenteredText(page, "SATUAN PELAYANAN PEMENUHAN GIZI (SPPG)", bold, 5.1, frontCenter, cardY + cardH - 47, navy);
  drawCenteredText(page, fitText(sppg, bold, 7.5, cardW - 14), bold, 7.5, frontCenter, cardY + cardH - 57, blue);
  drawCenteredText(page, fitText(foundation, regular, 5.2, cardW - 14), regular, 5.2, frontCenter, cardY + cardH - 66, muted);

  const photoSize = 67;
  const photoX = frontCenter - photoSize / 2;
  const photoY = cardY + cardH - 141;
  page.drawCircle({ x: frontCenter, y: photoY + photoSize / 2, size: photoSize / 2 + 3, color: sky });
  if (photo) {
    drawCircularImage(page, photo, photoX, photoY, photoSize);
  } else {
    page.drawCircle({ x: frontCenter, y: photoY + photoSize / 2, size: photoSize / 2, color: rgb(219 / 255, 234 / 255, 254 / 255) });
    drawCenteredText(page, initials(name), bold, 19, frontCenter, photoY + 25, blue);
  }

  drawCenteredText(page, fitText(name, bold, 10, cardW - 18), bold, 10, frontCenter, cardY + 89, navy);
  drawCenteredText(page, fitText(position, regular, 6.7, cardW - 18), regular, 6.7, frontCenter, cardY + 77, muted);
  page.drawRectangle({ x: frontX + 18, y: cardY + 56, width: cardW - 36, height: 1, color: border });
  drawCenteredText(page, "TANGGAL MULAI BEKERJA", bold, 4.7, frontCenter, cardY + 45, blue);
  drawCenteredText(page, fitText(startDate, bold, 6.6, cardW - 18), bold, 6.6, frontCenter, cardY + 34, navy);
  drawWrappedText(page, note, regular, 4.35, frontX + 10, cardY + 23, cardW - 20, 5.3, muted, 4);

  // BACK — QR, official note and Head of SPPG approval.
  page.drawRectangle({
    x: backX,
    y: cardY,
    width: cardW,
    height: cardH,
    color: white,
    borderColor: border,
    borderWidth: 0.8,
  });
  page.drawRectangle({ x: backX, y: cardY + cardH - 40, width: cardW, height: 40, color: navy });
  page.drawRectangle({ x: backX, y: cardY + cardH - 44, width: cardW, height: 4, color: blue });
  const backCenter = backX + cardW / 2;
  drawCenteredText(page, "VERIFIKASI ID CARD", bold, 8.2, backCenter, cardY + cardH - 22, white);
  drawCenteredText(page, "SPPG · BADAN GIZI NASIONAL", regular, 4.7, backCenter, cardY + cardH - 32, rgb(191 / 255, 219 / 255, 254 / 255));

  const qrSize = 82;
  page.drawRectangle({ x: backCenter - qrSize / 2 - 4, y: cardY + 120, width: qrSize + 8, height: qrSize + 8, color: pale, borderColor: border, borderWidth: 0.5 });
  page.drawImage(qr, { x: backCenter - qrSize / 2, y: cardY + 124, width: qrSize, height: qrSize });
  drawCenteredText(page, "KODE ID CARD", bold, 4.8, backCenter, cardY + 109, blue);
  drawCenteredText(page, fitText(code, bold, 7.3, cardW - 16), bold, 7.3, backCenter, cardY + 98, navy);

  const noteBottom = drawWrappedText(page, note, regular, 4.4, backX + 10, cardY + 84, cardW - 20, 5.4, muted, 5);
  page.drawRectangle({ x: backX + 12, y: Math.max(cardY + 49, noteBottom - 1), width: cardW - 24, height: 0.7, color: border });

  if (approval) {
    drawCenteredText(page, "KEPALA SPPG", bold, 4.8, backCenter, cardY + 43, blue);
    if (signature) {
      const dims = signature.scale(1);
      const maxW = 64;
      const maxH = 29;
      const ratio = Math.min(maxW / dims.width, maxH / dims.height);
      const width = dims.width * ratio;
      const height = dims.height * ratio;
      page.drawImage(signature, { x: backCenter - width / 2, y: cardY + 18, width, height });
    }
    drawCenteredText(page, fitText(approval.headName, bold, 6.1, cardW - 18), bold, 6.1, backCenter, cardY + 9, navy);
    drawCenteredText(page, "DISETUJUI", bold, 4.4, backCenter, cardY + 2.5, green);
  } else {
    drawCenteredText(page, "KEPALA SPPG", bold, 4.8, backCenter, cardY + 43, blue);
    drawCenteredText(page, "MENUNGGU PERSETUJUAN", bold, 5.7, backCenter, cardY + 27, amber);
    drawCenteredText(page, "TTD akan muncul setelah ADMIN menyetujui pengajuan.", regular, 4.1, backCenter, cardY + 17, muted);
    drawCenteredText(page, formatDateId(generatedAt), regular, 4.1, backCenter, cardY + 8, muted);
  }

  page.drawText("DEPAN", { x: frontX + cardW / 2 - 12, y: cardY - 16, size: 7, font: bold, color: muted });
  page.drawText("BELAKANG", { x: backX + cardW / 2 - 18, y: cardY - 16, size: 7, font: bold, color: muted });
  page.drawText("QR hanya valid setelah kartu disetujui dan berstatus ACTIVE.", {
    x: frontX,
    y: 410,
    size: 7,
    font: regular,
    color: muted,
  });

  return new Uint8Array(await pdf.save());
}

async function buildQrPdf(
  profile: UserProfile,
  qrPng: Uint8Array,
  generatedAt: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qr = await pdf.embedPng(qrPng);
  const logoAsset = await fetchKnownImage(BGN_LOGO_URL);
  const logo = await embedImage(pdf, logoAsset);
  const navy = rgb(15 / 255, 23 / 255, 42 / 255);
  const blue = rgb(30 / 255, 64 / 255, 175 / 255);
  const pale = rgb(239 / 255, 246 / 255, 255 / 255);
  const muted = rgb(71 / 255, 85 / 255, 105 / 255);
  const name = cleanText(profile.Nama_Lengkap);
  const code = cleanText(profile.ID_Card_Unik);

  page.drawRectangle({ x: 70, y: 105, width: 455, height: 630, color: pale });
  if (logo) page.drawImage(logo, { x: 98, y: 662, width: 42, height: 42 });
  page.drawText("BADAN GIZI NASIONAL", { x: 152, y: 690, size: 15, font: bold, color: navy });
  page.drawText(`SPPG ${cleanText(profile.SPPG)}`, { x: 152, y: 670, size: 10, font: bold, color: blue });
  page.drawText(yayasanLabel(profile.Yayasan), { x: 152, y: 654, size: 8, font: regular, color: muted });
  page.drawImage(qr, { x: 172, y: 350, width: 250, height: 250 });
  page.drawText(fitText(name, bold, 18, 390), { x: 102, y: 310, size: 18, font: bold, color: navy });
  page.drawText(code, { x: 102, y: 282, size: 13, font: bold, color: blue });
  page.drawText(`${cleanText(profile.Jabatan_Divisi)} · Mulai ${formatDateOnlyId(profile.Tanggal_Mulai_Kerja)}`, {
    x: 102,
    y: 255,
    size: 9,
    font: regular,
    color: muted,
  });
  page.drawText("QR aktif setelah ID Card disetujui Kepala SPPG melalui akun ADMIN.", {
    x: 102, y: 215, size: 9, font: regular, color: navy,
  });
  page.drawText(`Pengajuan dibuat ${formatDateId(generatedAt)}`, {
    x: 102, y: 190, size: 8, font: regular, color: muted,
  });
  drawWrappedText(page, officialOwnershipNote(profile), regular, 7.5, 102, 160, 390, 10, muted, 4);

  return new Uint8Array(await pdf.save());
}

async function buildArtifacts(
  profile: UserProfile,
  publicToken: string,
  generatedAt: string,
): Promise<CardArtifacts> {
  const verificationUrl = `${VERIFY_BASE_URL}?t=${encodeURIComponent(publicToken)}`;
  const qrBuffer = await QRCode.toBuffer(verificationUrl, {
    type: "png",
    errorCorrectionLevel: "H",
    margin: 2,
    width: 768,
    color: { dark: "#0F172A", light: "#FFFFFF" },
  });
  const qrPng = new Uint8Array(qrBuffer);
  const idCardPdf = await buildIdCardPdf(profile, qrPng, generatedAt, null);
  const qrPdf = await buildQrPdf(profile, qrPng, generatedAt);
  return {
    qrPng,
    qrPdf,
    idCardPdf,
    idCardPdfSha256: await sha256Hex(idCardPdf),
  };
}

async function uploadArtifacts(paths: Record<string, string>, artifacts: CardArtifacts): Promise<void> {
  const uploads = [
    db.storage.from(BUCKET).upload(paths.qrPng, artifacts.qrPng, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: false,
    }),
    db.storage.from(BUCKET).upload(paths.qrPdf, artifacts.qrPdf, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    }),
    db.storage.from(BUCKET).upload(paths.idCardPdf, artifacts.idCardPdf, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    }),
  ];
  const results = await Promise.all(uploads);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

async function removeArtifacts(paths: string[]): Promise<void> {
  try {
    await db.storage.from(BUCKET).remove(paths);
  } catch (error) {
    console.error(JSON.stringify({
      code: "DIGITAL_ID_ARTIFACT_CLEANUP_DEFERRED",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function getMyDigitalIdentity(auth: AuthenticatedUser) {
  const profile = await ensureIdCardCode(await getProfile(auth.idUser));
  const [activeCard, pendingCard] = await Promise.all([
    getCardByStatus(auth.idUser, "ACTIVE"),
    getCardByStatus(auth.idUser, "PENDING"),
  ]);
  return await responseFor(profile, activeCard, pendingCard);
}

async function generateMyDigitalIdentity(
  auth: AuthenticatedUser,
  force: boolean,
  confirmation: unknown,
) {
  let profile = await ensureIdCardCode(await getProfile(auth.idUser));
  const [existing, pending] = await Promise.all([
    getCardByStatus(auth.idUser, "ACTIVE"),
    getCardByStatus(auth.idUser, "PENDING"),
  ]);
  if (pending) return await responseFor(profile, existing, pending);
  if (existing && !force) return await responseFor(profile, existing, null);
  if (force && String(confirmation || "").trim().toUpperCase() !== "REGENERATE") {
    throw new ValidationError("Konfirmasi pengajuan ulang tidak valid.", "confirmation");
  }

  const generatedAt = nowIso();
  const version = await nextVersion(auth.idUser);
  const publicToken = randomToken();
  const tokenHash = await sha256Hex(publicToken);
  const cardId = crypto.randomUUID();
  const basePath = `${pathSegment(auth.idUser)}/v${version}/${cardId}`;
  const paths = {
    qrPng: `${basePath}/qr-code.png`,
    qrPdf: `${basePath}/qr-code.pdf`,
    idCardPdf: `${basePath}/id-card.pdf`,
  };
  const artifacts = await buildArtifacts(profile, publicToken, generatedAt);
  await uploadArtifacts(paths, artifacts);

  try {
    const insert = await db.from("Digital_ID_Cards").insert({
      ID: cardId,
      ID_User: auth.idUser,
      Version: version,
      Status: "PENDING",
      Public_Token_Hash: tokenHash,
      Token_Hint: publicToken.slice(-6),
      QR_PNG_Storage_Path: paths.qrPng,
      QR_PDF_Storage_Path: paths.qrPdf,
      ID_Card_PDF_Storage_Path: paths.idCardPdf,
      ID_Card_PDF_SHA256: artifacts.idCardPdfSha256,
      Payload_Version: 2,
      Generated_By: auth.idUser,
      Generated_At: generatedAt,
      Requested_At: generatedAt,
      Requested_By: auth.idUser,
      Updated_At: generatedAt,
      Metadata: {
        card_size: "CR80_PORTRAIT",
        approval_workflow: 1,
        verification_origin: "hadirly.org",
        profile_snapshot: {
          name: cleanText(profile.Nama_Lengkap),
          role: normalizeRole(profile.Role),
          position: cleanText(profile.Jabatan_Divisi),
          sppg: cleanText(profile.SPPG),
          yayasan: cleanText(profile.Yayasan),
          start_date: profile.Tanggal_Mulai_Kerja,
          id_card_code: cleanText(profile.ID_Card_Unik),
        },
      },
    });
    if (insert.error) throw insert.error;
  } catch (error) {
    await removeArtifacts(Object.values(paths));
    const pendingAfterRace = await getCardByStatus(auth.idUser, "PENDING").catch(() => null);
    const errorCode = (error as { code?: string })?.code;
    if (pendingAfterRace && errorCode === "23505") {
      return await responseFor(profile, existing, pendingAfterRace);
    }
    throw error;
  }

  await auditBestEffort(force ? "REQUEST_DIGITAL_ID_RENEWAL" : "REQUEST_DIGITAL_ID", auth.idUser, {
    idUser: auth.idUser,
    cardId,
    version,
    status: "PENDING",
    pdfSha256: artifacts.idCardPdfSha256,
  });

  profile = await getProfile(auth.idUser);
  const pendingCard = await getCardByStatus(auth.idUser, "PENDING");
  return await responseFor(profile, existing, pendingCard);
}

function requireIdCardAdmin(auth: AuthenticatedUser): void {
  if (!new Set(["ADMIN", "SUPER ADMIN"]).has(auth.role)) throw new Error("FORBIDDEN");
}

function adminCanAccessProfile(auth: AuthenticatedUser, adminProfile: UserProfile, profile: UserProfile): boolean {
  if (auth.role === "SUPER ADMIN") return true;
  const adminSppg = normalizeComparable(adminProfile.SPPG);
  const userSppg = normalizeComparable(profile.SPPG);
  return Boolean(adminSppg && userSppg && adminSppg === userSppg);
}

async function getIdCardAdminOverview(auth: AuthenticatedUser) {
  requireIdCardAdmin(auth);
  const adminProfile = await getProfile(auth.idUser);
  const [pendingResult, activeResult] = await Promise.all([
    db.from("Digital_ID_Cards").select("*").eq("Status", "PENDING").order("Requested_At", { ascending: true }).limit(500),
    db.from("Digital_ID_Cards").select("*").eq("Status", "ACTIVE").order("Approved_At", { ascending: false, nullsFirst: false }).limit(500),
  ]);
  if (pendingResult.error) throw pendingResult.error;
  if (activeResult.error) throw activeResult.error;
  const rows = [...(pendingResult.data || []), ...(activeResult.data || [])] as DataRow[];
  const profiles = await getProfiles(rows.map((row) => String(row.ID_User)));

  const pending: Record<string, unknown>[] = [];
  for (const card of pendingResult.data || []) {
    const profile = profiles.get(String(card.ID_User));
    if (!profile || !adminCanAccessProfile(auth, adminProfile, profile)) continue;
    pending.push({
      id: card.ID,
      idUser: profile.ID_User,
      namaLengkap: cleanText(profile.Nama_Lengkap),
      jabatan: cleanText(profile.Jabatan_Divisi),
      sppg: cleanText(profile.SPPG),
      yayasan: cleanText(profile.Yayasan),
      tanggalMulaiKerjaLabel: formatDateOnlyId(profile.Tanggal_Mulai_Kerja),
      idCardCode: cleanText(profile.ID_Card_Unik),
      version: Number(card.Version),
      requestedAt: card.Requested_At || card.Generated_At,
      requestedAtLabel: formatDateId(card.Requested_At || card.Generated_At),
    });
  }

  const approved: Record<string, unknown>[] = [];
  for (const card of activeResult.data || []) {
    const profile = profiles.get(String(card.ID_User));
    if (!profile || !adminCanAccessProfile(auth, adminProfile, profile)) continue;
    approved.push({
      id: card.ID,
      idUser: profile.ID_User,
      namaLengkap: cleanText(profile.Nama_Lengkap),
      jabatan: cleanText(profile.Jabatan_Divisi),
      sppg: cleanText(profile.SPPG),
      yayasan: cleanText(profile.Yayasan),
      idCardCode: cleanText(profile.ID_Card_Unik),
      version: Number(card.Version),
      headSppgName: cleanText(card.Head_SPPG_Name, ""),
      approvedAt: card.Approved_At || card.Generated_At,
      approvedAtLabel: formatDateId(card.Approved_At || card.Generated_At),
      idCardPdfUrl: await signedUrl(card.ID_Card_PDF_Storage_Path),
    });
  }

  return {
    pendingCount: pending.length,
    approvedCount: approved.length,
    pending,
    approved,
  };
}

async function approveOneCard(
  auth: AuthenticatedUser,
  card: DataRow,
  profile: UserProfile,
  headName: string,
  signaturePng: Uint8Array,
): Promise<void> {
  const approvedAt = nowIso();
  const qrDownload = await db.storage.from(BUCKET).download(card.QR_PNG_Storage_Path);
  if (qrDownload.error || !qrDownload.data) throw qrDownload.error || new Error("QR_NOT_FOUND");
  const qrPng = new Uint8Array(await qrDownload.data.arrayBuffer());
  const approvedPdf = await buildIdCardPdf(profile, qrPng, approvedAt, { headName, signaturePng });
  const pdfSha256 = await sha256Hex(approvedPdf);
  const pdfPath = String(card.ID_Card_PDF_Storage_Path);
  const basePath = pdfPath.replace(/\/id-card\.pdf$/i, "");
  const signaturePath = `${basePath}/head-sppg-signature.png`;

  const uploads = await Promise.all([
    db.storage.from(BUCKET).upload(signaturePath, signaturePng, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: true,
    }),
    db.storage.from(BUCKET).upload(pdfPath, approvedPdf, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true,
    }),
  ]);
  const failed = uploads.find((item) => item.error);
  if (failed?.error) throw failed.error;

  const approval = await db.rpc("approve_digital_id_card", {
    p_card_id: card.ID,
    p_approved_by: auth.idUser,
    p_head_name: headName,
    p_signature_path: signaturePath,
    p_pdf_sha256: pdfSha256,
    p_approved_at: approvedAt,
  });
  if (approval.error) throw approval.error;

  const legacyUpdate = await db.from("Users").update({
    URL_ID_Card_PDF: card.ID_Card_PDF_Storage_Path,
    Link_PDF_QR: card.QR_PDF_Storage_Path,
    QR_Code_File_ID: card.QR_PNG_Storage_Path,
    Updated_At: approvedAt,
  }).eq("ID_User", profile.ID_User);
  if (legacyUpdate.error) {
    console.error(JSON.stringify({
      code: "DIGITAL_ID_LEGACY_SYNC_DEFERRED",
      idUser: profile.ID_User,
      error: legacyUpdate.error.message,
    }));
  }

  await auditBestEffort("APPROVE_DIGITAL_ID", auth.idUser, {
    cardId: card.ID,
    idUser: profile.ID_User,
    sppg: cleanText(profile.SPPG),
    headSppgName: headName,
    pdfSha256,
  });
}

async function approveIdCardRequests(auth: AuthenticatedUser, payload: Record<string, unknown>) {
  requireIdCardAdmin(auth);
  const adminProfile = await getProfile(auth.idUser);
  const rawIds = Array.isArray(payload.cardIds) ? payload.cardIds : [];
  const cardIds = [...new Set(rawIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!cardIds.length) throw new ValidationError("Pilih minimal satu pengajuan ID Card.", "cardIds");
  if (cardIds.length > 100) throw new ValidationError("Maksimal 100 pengajuan dalam sekali persetujuan.", "cardIds");
  const headName = requiredString(payload.headName, "headName", { min: 3, max: 120 });
  const signaturePng = signatureBytes(payload.signatureDataUrl);

  const cardsResult = await db
    .from("Digital_ID_Cards")
    .select("*")
    .in("ID", cardIds)
    .eq("Status", "PENDING");
  if (cardsResult.error) throw cardsResult.error;
  const cards = (cardsResult.data || []) as DataRow[];
  if (!cards.length) throw new Error("CARD_NOT_PENDING");
  const profiles = await getProfiles(cards.map((card) => String(card.ID_User)));

  const accessible = cards.filter((card) => {
    const profile = profiles.get(String(card.ID_User));
    return Boolean(profile && adminCanAccessProfile(auth, adminProfile, profile));
  });
  if (accessible.length !== cards.length || cards.length !== cardIds.length) throw new Error("FORBIDDEN");

  const approved: string[] = [];
  const failed: Array<{ id: string; message: string }> = [];
  for (const card of accessible) {
    const profile = profiles.get(String(card.ID_User));
    if (!profile) continue;
    try {
      await approveOneCard(auth, card, profile, headName, signaturePng);
      approved.push(String(card.ID));
    } catch (error) {
      failed.push({ id: String(card.ID), message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!approved.length && failed.length) throw new Error(`APPROVAL_FAILED:${failed[0].message}`);
  return {
    approvedCount: approved.length,
    approvedIds: approved,
    failedCount: failed.length,
    failed,
    pendingCount: (await getIdCardAdminOverview(auth)).pendingCount,
  };
}

async function verifyDigitalIdentity(payload: Record<string, unknown>) {
  const publicToken = requiredString(payload.token, "token", { min: 40, max: 200 });
  const tokenHash = await sha256Hex(publicToken);
  const cardResult = await db
    .from("Digital_ID_Cards")
    .select("ID,ID_User,Version,Status,Generated_At,Approved_At,Verification_Count")
    .eq("Public_Token_Hash", tokenHash)
    .eq("Status", "ACTIVE")
    .maybeSingle();
  if (cardResult.error) throw cardResult.error;
  if (!cardResult.data) return { valid: false, status: "INVALID" };

  const profile = await getProfile(String(cardResult.data.ID_User)).catch(() => null);
  if (!profile || profile.Status_Aktif === false) {
    return { valid: false, status: "INACTIVE" };
  }

  const verifiedAt = nowIso();
  const count = Number(cardResult.data.Verification_Count || 0) + 1;
  const update = await db.from("Digital_ID_Cards").update({
    Verification_Count: count,
    Last_Verified_At: verifiedAt,
    Updated_At: verifiedAt,
  }).eq("ID", cardResult.data.ID).eq("Status", "ACTIVE");
  if (update.error) {
    console.error(JSON.stringify({
      code: "DIGITAL_ID_VERIFY_COUNTER_DEFERRED",
      cardId: cardResult.data.ID,
      error: update.error.message,
    }));
  }

  return {
    valid: true,
    status: "ACTIVE",
    card: {
      name: cleanText(profile.Nama_Lengkap),
      role: normalizeRole(profile.Role) || "USER",
      position: cleanText(profile.Jabatan_Divisi),
      sppg: cleanText(profile.SPPG),
      yayasan: cleanText(profile.Yayasan),
      idCardCode: cleanText(profile.ID_Card_Unik),
      version: Number(cardResult.data.Version),
      generatedAt: cardResult.data.Generated_At,
      generatedAtLabel: formatDateId(cardResult.data.Generated_At),
      approvedAt: cardResult.data.Approved_At,
      approvedAtLabel: formatDateId(cardResult.data.Approved_At),
      verifiedAt,
    },
  };
}

function resolveRequest(body: Record<string, unknown>) {
  const action = String(body.function || body.action || "").trim();
  const payload = body.data && typeof body.data === "object"
    ? body.data as Record<string, unknown>
    : body;
  return { action, payload };
}

Deno.serve(async (req) => {
  const requestId = createRequestId("DID");
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin, CORS_OPTIONS);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: origin && isOriginAllowed(origin, CORS_OPTIONS) ? 204 : 403,
      headers,
    });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, code: "METHOD_NOT_ALLOWED", message: "Gunakan POST.", requestId },
      405,
      requestId,
      headers,
    );
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const { action, payload } = resolveRequest(body);
    if (action === "verifyDigitalIdentity") {
      const result = await verifyDigitalIdentity(payload);
      return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
    }

    const auth = await authenticateUserSession(db, payload.token);
    let result: unknown;
    if (action === "getMyDigitalIdentity") {
      result = await getMyDigitalIdentity(auth);
    } else if (action === "generateMyDigitalIdentity") {
      result = await generateMyDigitalIdentity(auth, false, null);
    } else if (action === "regenerateMyDigitalIdentity") {
      result = await generateMyDigitalIdentity(auth, true, payload.confirmation);
    } else if (action === "getIdCardAdminOverview") {
      result = await getIdCardAdminOverview(auth);
    } else if (action === "approveIdCardRequests") {
      result = await approveIdCardRequests(auth, payload);
    } else {
      throw new ValidationError("Aksi identitas digital tidak didukung.", "action");
    }

    return jsonResponse({ success: true, result, requestId }, 200, requestId, headers);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Terjadi kesalahan saat memproses identitas digital.";

    if (error instanceof ValidationError) {
      status = 422;
      code = error.code;
      message = error.message;
    } else if (rawMessage === "SESSION_EXPIRED") {
      status = 401;
      code = rawMessage;
      message = "Sesi telah berakhir. Silakan login kembali.";
    } else if (rawMessage === "ACCOUNT_INACTIVE") {
      status = 403;
      code = rawMessage;
      message = "Akun tidak aktif atau tidak ditemukan.";
    } else if (rawMessage === "FORBIDDEN") {
      status = 403;
      code = rawMessage;
      message = "Anda tidak memiliki akses ke pengajuan ID Card tersebut.";
    } else if (rawMessage === "ID_CARD_CODE_FAILED") {
      status = 409;
      code = rawMessage;
      message = "Kode ID Card belum dapat dibuat. Silakan coba kembali.";
    } else if (rawMessage === "CARD_NOT_PENDING") {
      status = 409;
      code = rawMessage;
      message = "Pengajuan sudah diproses atau tidak lagi berstatus menunggu persetujuan.";
    } else if (rawMessage.startsWith("APPROVAL_FAILED:")) {
      status = 500;
      code = "APPROVAL_FAILED";
      message = "Persetujuan ID Card gagal diselesaikan. Silakan coba kembali.";
    }

    console.error(JSON.stringify({ requestId, code, error: rawMessage }));
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
