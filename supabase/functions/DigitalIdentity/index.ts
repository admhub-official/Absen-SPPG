// @deno-types="npm:@types/qrcode@1.5.5"
import QRCode from "npm:qrcode@1.5.4";
import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  StandardFonts,
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
const APP_ICON_URL = `${SUPABASE_URL}/storage/v1/object/public/icon%20aplikasi/icon%20aplikasi.png`;
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
  ID_Card_Unik: string | null;
  URL_Foto_Profil: string | null;
  URL_Foto_Profil_Asli: string | null;
  Status_Aktif: boolean | null;
};
type ImageAsset = { bytes: Uint8Array; type: "png" | "jpg" };

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

function pathSegment(value: unknown): string {
  return String(value || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
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

function formatDateId(value: string): string {
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

async function getProfile(idUser: string): Promise<UserProfile> {
  const result = await db
    .from("Users")
    .select(
      "ID_User,Nama_Lengkap,Role,Jabatan_Divisi,SPPG,Yayasan,ID_Card_Unik,URL_Foto_Profil,URL_Foto_Profil_Asli,Status_Aktif",
    )
    .eq("ID_User", idUser)
    .maybeSingle();
  if (result.error || !result.data) throw new Error("ACCOUNT_INACTIVE");
  return result.data as UserProfile;
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
        "ID_User,Nama_Lengkap,Role,Jabatan_Divisi,SPPG,Yayasan,ID_Card_Unik,URL_Foto_Profil,URL_Foto_Profil_Asli,Status_Aktif",
      )
      .maybeSingle();
    if (!update.error && update.data) return update.data as UserProfile;
    if (update.error?.code !== "23505") throw update.error;
  }
  throw new Error("ID_CARD_CODE_FAILED");
}

async function getActiveCard(idUser: string): Promise<DataRow | null> {
  const result = await db
    .from("Digital_ID_Cards")
    .select("*")
    .eq("ID_User", idUser)
    .eq("Status", "ACTIVE")
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

async function responseFor(profile: UserProfile, card: DataRow | null) {
  const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
  const urls = card
    ? await Promise.all([
      signedUrl(card.QR_PNG_Storage_Path),
      signedUrl(card.QR_PDF_Storage_Path),
      signedUrl(card.ID_Card_PDF_Storage_Path),
    ])
    : [null, null, null];

  return {
    hasCard: Boolean(card),
    profile: {
      idUser: profile.ID_User,
      namaLengkap: cleanText(profile.Nama_Lengkap),
      role: normalizeRole(profile.Role) || "USER",
      jabatan: cleanText(profile.Jabatan_Divisi),
      sppg: cleanText(profile.SPPG),
      yayasan: cleanText(profile.Yayasan),
      idCardCode: cleanText(profile.ID_Card_Unik),
      fotoUrl: profile.URL_Foto_Profil || profile.URL_Foto_Profil_Asli || null,
    },
    card: card
      ? {
        id: card.ID,
        version: Number(card.Version),
        status: card.Status,
        generatedAt: card.Generated_At,
        generatedAtLabel: formatDateId(card.Generated_At),
        verificationCount: Number(card.Verification_Count || 0),
        lastVerifiedAt: card.Last_Verified_At,
        pdfSha256: card.ID_Card_PDF_SHA256,
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
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qr = await pdf.embedPng(qrPng);
  const photoAsset = await fetchKnownImage(profile.URL_Foto_Profil || profile.URL_Foto_Profil_Asli);
  const logoAsset = await fetchKnownImage(APP_ICON_URL);
  const photo = await embedImage(pdf, photoAsset);
  const logo = await embedImage(pdf, logoAsset);

  const navy = rgb(15 / 255, 23 / 255, 42 / 255);
  const blue = rgb(37 / 255, 99 / 255, 235 / 255);
  const pale = rgb(239 / 255, 246 / 255, 255 / 255);
  const border = rgb(203 / 255, 213 / 255, 225 / 255);
  const muted = rgb(71 / 255, 85 / 255, 105 / 255);
  const white = rgb(1, 1, 1);
  const mm = 72 / 25.4;
  const cardW = 85.6 * mm;
  const cardH = 53.98 * mm;
  const cardX = (595.28 - cardW) / 2;
  const frontY = 530;
  const backY = 315;
  const name = cleanText(profile.Nama_Lengkap);
  const role = normalizeRole(profile.Role) || "USER";
  const position = cleanText(profile.Jabatan_Divisi);
  const sppg = cleanText(profile.SPPG);
  const code = cleanText(profile.ID_Card_Unik);

  page.drawText("KARTU IDENTITAS DIGITAL", {
    x: cardX,
    y: 790,
    size: 15,
    font: bold,
    color: navy,
  });
  page.drawText("Cetak pada skala 100%. Garis tipis menunjukkan ukuran kartu CR80 (85,60 × 53,98 mm).", {
    x: cardX,
    y: 771,
    size: 8,
    font: regular,
    color: muted,
  });

  // Front side.
  page.drawRectangle({
    x: cardX,
    y: frontY,
    width: cardW,
    height: cardH,
    color: navy,
    borderColor: border,
    borderWidth: 0.75,
  });
  page.drawRectangle({
    x: cardX,
    y: frontY,
    width: 11,
    height: cardH,
    color: blue,
  });
  page.drawRectangle({
    x: cardX + 11,
    y: frontY,
    width: cardW - 11,
    height: cardH * 0.67,
    color: white,
  });

  if (logo) {
    page.drawImage(logo, { x: cardX + 20, y: frontY + cardH - 35, width: 23, height: 23 });
  } else {
    page.drawCircle({ x: cardX + 31, y: frontY + cardH - 23, size: 11, color: blue });
    page.drawText("H", { x: cardX + 26.5, y: frontY + cardH - 28, size: 12, font: bold, color: white });
  }
  page.drawText("Hadirly", {
    x: cardX + 49,
    y: frontY + cardH - 21,
    size: 12,
    font: bold,
    color: white,
  });
  page.drawText("ABSENSI & PAYROLL DIGITAL", {
    x: cardX + 49,
    y: frontY + cardH - 32,
    size: 5.5,
    font: regular,
    color: rgb(191 / 255, 219 / 255, 254 / 255),
  });

  const photoX = cardX + 21;
  const photoY = frontY + 27;
  const photoW = 53;
  const photoH = 68;
  page.drawRectangle({ x: photoX, y: photoY, width: photoW, height: photoH, color: pale, borderColor: border, borderWidth: 0.5 });
  if (photo) {
    const dimensions = photo.scale(1);
    const ratio = Math.max(photoW / dimensions.width, photoH / dimensions.height);
    const width = dimensions.width * ratio;
    const height = dimensions.height * ratio;
    page.drawImage(photo, {
      x: photoX + (photoW - width) / 2,
      y: photoY + (photoH - height) / 2,
      width,
      height,
    });
  } else {
    page.drawText(initials(name), {
      x: photoX + 13,
      y: photoY + 26,
      size: 19,
      font: bold,
      color: blue,
    });
  }

  const textX = cardX + 84;
  const textMax = cardW - 155;
  page.drawText(fitText(name, bold, 12, textMax), {
    x: textX,
    y: frontY + 79,
    size: 12,
    font: bold,
    color: navy,
  });
  page.drawText(fitText(position === "-" ? role : position, regular, 7.5, textMax), {
    x: textX,
    y: frontY + 65,
    size: 7.5,
    font: regular,
    color: muted,
  });
  page.drawText("SPPG", { x: textX, y: frontY + 48, size: 5.5, font: bold, color: blue });
  page.drawText(fitText(sppg, bold, 8, textMax), {
    x: textX,
    y: frontY + 37,
    size: 8,
    font: bold,
    color: navy,
  });
  page.drawText("ID CARD", { x: textX, y: frontY + 21, size: 5.5, font: bold, color: blue });
  page.drawText(fitText(code, bold, 8.5, textMax), {
    x: textX,
    y: frontY + 9,
    size: 8.5,
    font: bold,
    color: navy,
  });
  page.drawImage(qr, {
    x: cardX + cardW - 63,
    y: frontY + 9,
    width: 52,
    height: 52,
  });

  page.drawText("DEPAN", { x: cardX + cardW + 8, y: frontY + cardH / 2, size: 7, font: bold, color: muted, rotate: undefined });

  // Back side.
  page.drawRectangle({
    x: cardX,
    y: backY,
    width: cardW,
    height: cardH,
    color: white,
    borderColor: border,
    borderWidth: 0.75,
  });
  page.drawRectangle({ x: cardX, y: backY, width: 16, height: cardH, color: navy });
  page.drawText("VERIFIKASI IDENTITAS", {
    x: cardX + 28,
    y: backY + cardH - 25,
    size: 10,
    font: bold,
    color: navy,
  });
  page.drawText("Pindai QR untuk memeriksa status kartu secara langsung.", {
    x: cardX + 28,
    y: backY + cardH - 38,
    size: 6.5,
    font: regular,
    color: muted,
  });
  page.drawImage(qr, { x: cardX + 28, y: backY + 26, width: 82, height: 82 });
  page.drawText("Kode", { x: cardX + 126, y: backY + 92, size: 5.5, font: bold, color: blue });
  page.drawText(fitText(code, bold, 9, cardW - 140), {
    x: cardX + 126,
    y: backY + 79,
    size: 9,
    font: bold,
    color: navy,
  });
  page.drawText("Pemegang", { x: cardX + 126, y: backY + 61, size: 5.5, font: bold, color: blue });
  page.drawText(fitText(name, regular, 7.5, cardW - 140), {
    x: cardX + 126,
    y: backY + 49,
    size: 7.5,
    font: regular,
    color: navy,
  });
  page.drawText("Diterbitkan", { x: cardX + 126, y: backY + 32, size: 5.5, font: bold, color: blue });
  page.drawText(fitText(formatDateId(generatedAt), regular, 6.5, cardW - 140), {
    x: cardX + 126,
    y: backY + 21,
    size: 6.5,
    font: regular,
    color: muted,
  });
  page.drawText("QR tidak berisi password, nomor rekening, atau data biometrik.", {
    x: cardX + 28,
    y: backY + 10,
    size: 5.5,
    font: regular,
    color: muted,
  });
  page.drawText("BELAKANG", { x: cardX + cardW + 8, y: backY + cardH / 2, size: 7, font: bold, color: muted });

  page.drawText("Dokumen dibuat otomatis oleh Hadirly. Validasi terbaru selalu tersedia melalui QR Code.", {
    x: cardX,
    y: 275,
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
  const navy = rgb(15 / 255, 23 / 255, 42 / 255);
  const blue = rgb(37 / 255, 99 / 255, 235 / 255);
  const pale = rgb(219 / 255, 234 / 255, 254 / 255);
  const muted = rgb(71 / 255, 85 / 255, 105 / 255);
  const name = cleanText(profile.Nama_Lengkap);
  const code = cleanText(profile.ID_Card_Unik);

  page.drawRectangle({ x: 70, y: 105, width: 455, height: 630, color: pale });
  page.drawText("Hadirly", { x: 98, y: 685, size: 24, font: bold, color: navy });
  page.drawText("QR CODE IDENTITAS DIGITAL", { x: 98, y: 653, size: 12, font: bold, color: blue });
  page.drawImage(qr, { x: 172, y: 350, width: 250, height: 250 });
  page.drawText(fitText(name, bold, 18, 390), { x: 102, y: 310, size: 18, font: bold, color: navy });
  page.drawText(code, { x: 102, y: 282, size: 13, font: bold, color: blue });
  page.drawText(`${normalizeRole(profile.Role) || "USER"} · SPPG ${cleanText(profile.SPPG)}`, {
    x: 102,
    y: 255,
    size: 10,
    font: regular,
    color: muted,
  });
  page.drawText("Pindai QR Code untuk memastikan kartu masih aktif dan sesuai dengan pemegangnya.", {
    x: 102,
    y: 215,
    size: 9,
    font: regular,
    color: navy,
  });
  page.drawText(`Diterbitkan ${formatDateId(generatedAt)}`, {
    x: 102,
    y: 190,
    size: 8,
    font: regular,
    color: muted,
  });
  page.drawText("QR Code ini bukan kredensial login dan tidak menyimpan password atau data biometrik.", {
    x: 102,
    y: 150,
    size: 7.5,
    font: regular,
    color: muted,
  });

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
  const idCardPdf = await buildIdCardPdf(profile, qrPng, generatedAt);
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
  const card = await getActiveCard(auth.idUser);
  return await responseFor(profile, card);
}

async function generateMyDigitalIdentity(
  auth: AuthenticatedUser,
  force: boolean,
  confirmation: unknown,
) {
  let profile = await ensureIdCardCode(await getProfile(auth.idUser));
  const existing = await getActiveCard(auth.idUser);
  if (existing && !force) return await responseFor(profile, existing);
  if (force && String(confirmation || "").trim().toUpperCase() !== "REGENERATE") {
    throw new ValidationError("Konfirmasi regenerasi tidak valid.", "confirmation");
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

  let oldRevoked = false;
  try {
    if (existing) {
      const revoke = await db.from("Digital_ID_Cards").update({
        Status: "REVOKED",
        Revoked_At: generatedAt,
        Revoked_By: auth.idUser,
        Revocation_Reason: "USER_REGENERATED",
        Updated_At: generatedAt,
      }).eq("ID", existing.ID).eq("Status", "ACTIVE");
      if (revoke.error) throw revoke.error;
      oldRevoked = true;
    }

    const insert = await db.from("Digital_ID_Cards").insert({
      ID: cardId,
      ID_User: auth.idUser,
      Version: version,
      Status: "ACTIVE",
      Public_Token_Hash: tokenHash,
      Token_Hint: publicToken.slice(-6),
      QR_PNG_Storage_Path: paths.qrPng,
      QR_PDF_Storage_Path: paths.qrPdf,
      ID_Card_PDF_Storage_Path: paths.idCardPdf,
      ID_Card_PDF_SHA256: artifacts.idCardPdfSha256,
      Payload_Version: 1,
      Generated_By: auth.idUser,
      Generated_At: generatedAt,
      Updated_At: generatedAt,
      Metadata: {
        card_size: "CR80",
        verification_origin: "hadirly.org",
        profile_snapshot: {
          name: cleanText(profile.Nama_Lengkap),
          role: normalizeRole(profile.Role),
          position: cleanText(profile.Jabatan_Divisi),
          sppg: cleanText(profile.SPPG),
          id_card_code: cleanText(profile.ID_Card_Unik),
        },
      },
    });
    if (insert.error) throw insert.error;
  } catch (error) {
    if (oldRevoked && existing) {
      await db.from("Digital_ID_Cards").update({
        Status: "ACTIVE",
        Revoked_At: null,
        Revoked_By: null,
        Revocation_Reason: null,
        Updated_At: nowIso(),
      }).eq("ID", existing.ID);
    }
    await removeArtifacts(Object.values(paths));

    const activeAfterRace = await getActiveCard(auth.idUser).catch(() => null);
    const errorCode = (error as { code?: string })?.code;
    if (activeAfterRace && errorCode === "23505") {
      return await responseFor(profile, activeAfterRace);
    }
    throw error;
  }

  // Keep legacy user columns compatible without storing expiring signed URLs.
  const legacyUpdate = await db.from("Users").update({
    URL_ID_Card_PDF: paths.idCardPdf,
    Link_PDF_QR: paths.qrPdf,
    QR_Code_File_ID: paths.qrPng,
    Updated_At: generatedAt,
  }).eq("ID_User", auth.idUser);
  if (legacyUpdate.error) {
    console.error(JSON.stringify({
      code: "DIGITAL_ID_LEGACY_SYNC_DEFERRED",
      idUser: auth.idUser,
      error: legacyUpdate.error.message,
    }));
  }

  await auditBestEffort(force ? "REGENERATE_DIGITAL_ID" : "GENERATE_DIGITAL_ID", auth.idUser, {
    idUser: auth.idUser,
    cardId,
    version,
    pdfSha256: artifacts.idCardPdfSha256,
  });

  profile = await getProfile(auth.idUser);
  const card = await getActiveCard(auth.idUser);
  return await responseFor(profile, card);
}

async function verifyDigitalIdentity(payload: Record<string, unknown>) {
  const publicToken = requiredString(payload.token, "token", { min: 40, max: 200 });
  const tokenHash = await sha256Hex(publicToken);
  const cardResult = await db
    .from("Digital_ID_Cards")
    .select("ID,ID_User,Version,Status,Generated_At,Verification_Count")
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
      idCardCode: cleanText(profile.ID_Card_Unik),
      version: Number(cardResult.data.Version),
      generatedAt: cardResult.data.Generated_At,
      generatedAtLabel: formatDateId(cardResult.data.Generated_At),
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
    } else if (rawMessage === "ID_CARD_CODE_FAILED") {
      status = 409;
      code = rawMessage;
      message = "Kode ID Card belum dapat dibuat. Silakan coba kembali.";
    }

    console.error(JSON.stringify({ requestId, code, error: rawMessage }));
    return jsonResponse({ success: false, code, message, requestId }, status, requestId, headers);
  }
});
