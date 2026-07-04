# Setup Cloudflare API Credentials

## Langkah 1: Generate API Token

1. **Login ke Cloudflare**: https://dash.cloudflare.com
2. **Navigasi ke**: Account Settings (kiri bawah) → API Tokens
3. **Buat token baru**: Klik "Create Token"
4. **Gunakan template**: "Edit Cloudflare Workers"
5. **Permissions** yang dibutuhkan:
   - Account → Cloudflare Pages → Edit
   - Account → Account Settings → Read

6. **Continue to summary** dan copy token (hanya tampil 1x!)

## Langkah 2: Dapatkan Account ID & Zone ID

### Account ID:
1. Di Cloudflare Dashboard, buka halaman manapun
2. URL format: `https://dash.cloudflare.com/[ACCOUNT_ID]/...`
3. Copy bagian Account ID dari URL

### Zone ID:
1. **Hanya diperlukan jika punya custom domain**
2. Jika hanya pakai `.pages.dev`, bisa kosongkan atau skip

## Langkah 3: Setup Local Environment

### 3a. Copy template file:
```bash
cp .env.example .env
```

### 3b. Edit `.env` dengan credentials:
```
CLOUDFLARE_API_TOKEN=your_actual_api_token
CLOUDFLARE_ACCOUNT_ID=your_actual_account_id
CLOUDFLARE_ZONE_ID=your_zone_id_jika_ada_custom_domain
```

### 3c. Jangan commit `.env`!
File sudah di `.gitignore`, tapi pastikan dengan:
```bash
git status
```
`.env` seharusnya TIDAK ada di output

## Langkah 4: Install & Authenticate

```bash
# Install Wrangler CLI
npm install -g wrangler

# Authenticate (opsional, kalau .env sudah ada)
wrangler login
```

## Langkah 5: Verify Connection

```bash
# Test koneksi ke Cloudflare
wrangler whoami
```

Output seharusnya menampilkan account info Anda.

## Penggunaan Selanjutnya

Dengan setup ini, bisa:

```bash
# Deploy langsung dari CLI (alternative GitHub)
wrangler pages deploy .

# Manage project
wrangler pages project list

# View deployment logs
wrangler pages deployment list
```

---

## ⚠️ SECURITY TIPS

- **Jangan push `.env` ke Git!** (sudah di `.gitignore`)
- **Jangan share API token** via Slack/chat
- **Rotate token regularly** di Cloudflare dashboard
- Untuk CI/CD (GitHub Actions), gunakan GitHub Secrets

---

## Troubleshooting

### "Unauthorized" error?
- Pastikan API token masih aktif
- Regenerate token jika perlu

### "Account not found"?
- Verify Account ID benar
- Check di URL Cloudflare dashboard

### Cannot read `.env` file?
- Pastikan file sudah di root folder (`./env`)
- Cek permission file
