# Panduan Deploy ke Cloudflare Pages

## Prasyarat
- Akun Cloudflare (sudah ada ✓)
- Repository GitHub

## Langkah-langkah Deploy

### 1. Push Repository ke GitHub

```bash
# Jika belum ada remote GitHub
git remote add origin https://github.com/USERNAME/Absen-SPPG.git
git branch -M main
git push -u origin main
```

Ganti `USERNAME` dengan username GitHub Anda.

### 2. Hubungkan ke Cloudflare Pages

1. **Login ke Cloudflare Dashboard**: https://dash.cloudflare.com
2. **Pilih akun Anda** dari dropdown (kanan atas)
3. **Navigasi ke Pages** (sidebar kiri → Pages)
4. **Klik "Create project"** → **"Connect to Git"**
5. **Pilih GitHub** dan authorize Cloudflare
6. **Pilih repository**: `Absen-SPPG`
7. **Konfigurasi build**:
   - **Project name**: `absen-sppg` (atau nama pilihan Anda)
   - **Production branch**: `main`
   - **Framework preset**: `None` (karena ini static site)
   - **Build command**: (kosongkan)
   - **Build output directory**: `.` (dot)
8. **Klik "Save and Deploy"**

### 3. Verifikasi Domain

Setelah deploy selesai, Cloudflare akan memberikan URL:
```
https://absen-sppg.pages.dev
```

Atau gunakan custom domain jika ada.

## Untuk Update Selanjutnya

Cukup push changes ke GitHub:
```bash
git add .
git commit -m "pesan commit"
git push origin main
```

Cloudflare Pages akan otomatis redeploy.

## Troubleshooting

### Halaman tidak load
- Pastikan `_redirects` file ada di root folder
- Periksa di Cloudflare Pages dashboard → Deployments → Build logs

### API Supabase tidak merespons
- Pastikan `supabase-config.js` memiliki endpoint yang benar
- Cek CORS settings di Supabase
- Browser console (F12) untuk error details

### Custom Domain
1. Di Cloudflare Pages dashboard → Project → Custom domains
2. Ikuti instruksi untuk menambahkan domain
