-- Master Perjanjian Kerja: normalisasi Jabatan/Divisi dan seed berbasis dokumen
-- Sumber:
-- 1) MENEJMAN SOP SPPG (jadwal dan uraian operasional)
-- 2) Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis Tata Kelola MBG TA 2026

create or replace function public.normalize_master_jabatan_contract()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_slug text;
begin
  new."Nama_Jabatan" := btrim(regexp_replace(coalesce(new."Nama_Jabatan", ''), '\s+', ' ', 'g'));
  if new."Nama_Jabatan" = '' then
    raise exception 'Jabatan atau Divisi wajib diisi';
  end if;

  -- Dalam aplikasi Hadirly, Jabatan dan Divisi adalah satu identitas kerja.
  new."Divisi" := new."Nama_Jabatan";
  v_slug := upper(regexp_replace(new."Nama_Jabatan", '[^A-Za-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'JABATAN'; end if;
  new."Kode_Jabatan" := left('JBT-' || v_slug, 40);
  new."Updated_At" := now();
  return new;
end;
$$;

drop trigger if exists trg_normalize_master_jabatan_contract on public."Master_Jabatan";
create trigger trg_normalize_master_jabatan_contract
before insert or update of "Nama_Jabatan"
on public."Master_Jabatan"
for each row execute function public.normalize_master_jabatan_contract();

-- Normalisasi master yang sudah ada tanpa menghapus atau mengganti identitas record.
update public."Master_Jabatan"
set "Nama_Jabatan" = "Nama_Jabatan";

-- Tambahkan nomenklatur resmi Juknis yang belum ada. Trigger membuat Divisi dan Kode otomatis.
insert into public."Master_Jabatan" ("Nama_Jabatan", "Aktif", "SPPG_Scope")
select v.nama, true, null
from (values
  ('PENGAWAS GIZI'),
  ('PENGAWAS KEUANGAN'),
  ('PENGAWAS SANITASI'),
  ('JURU MASAK'),
  ('PACKING'),
  ('DISTRIBUSI'),
  ('ADMIN PUSAT')
) as v(nama)
where not exists (
  select 1 from public."Master_Jabatan" j where upper(btrim(j."Nama_Jabatan")) = upper(v.nama)
);

-- Job description canonical dari Juknis/SOP.
with canonical(nama, deskripsi) as (
  values
  ('KEPALA SPPG', $txt$
1. Melakukan fungsi approver VA atas pengajuan transaksi perwakilan Yayasan sesuai ketentuan.
2. Memastikan seluruh kegiatan operasional harian SPPG dari produksi sampai distribusi dan melakukan evaluasi mingguan.
3. Memastikan standar kualitas bahan baku, makanan, pelayanan, sanitasi lingkungan, pergudangan, serta pengendalian hama.
4. Memeriksa dan memverifikasi pengadaan bahan baku berdasarkan kualitas, keamanan, dan kewajaran harga.
5. Menciptakan suasana kerja kondusif dan menjaga hubungan baik dengan Perwakilan Yayasan serta pemangku kepentingan sekitar SPPG.
6. Mengembangkan kinerja tim, menetapkan jadwal kerja, dan mengelola konflik.
7. Memastikan kecukupan stok bahan baku dan peralatan.
8. Mengendalikan anggaran operasional, bahan baku, dan insentif.
9. Melaksanakan survei mingguan kualitas dan harga bahan baku bersama tim.
10. Menyampaikan rekomendasi perbaikan fasilitas dan melaksanakan asset management.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026, Bagian 4.9.2.$txt$),
  ('PENGAWAS GIZI', $txt$
1. Menyusun menu bergizi seimbang sesuai ketentuan, termasuk perhitungan zat gizi.
2. Memberikan konsultasi, edukasi gizi, dan peningkatan pengetahuan kepada relawan maupun penerima manfaat.
3. Memastikan makanan memenuhi standar gizi BGN.
4. Melakukan monitoring dan evaluasi pada bagian persiapan, pengolahan, dan pemorsian.
5. Melaksanakan pengendalian mutu (quality control) makanan setiap hari.
6. Mengawasi dan mencatat contoh makanan/food sample untuk keamanan pangan setiap hari.
7. Mendukung edukasi gizi, keamanan pangan, dan pemantauan status gizi sesuai ketentuan.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PENGAWAS KEUANGAN', $txt$
1. Berkoordinasi dengan Kepala SPPG menyusun rencana anggaran belanja harian.
2. Bersama Juru Masak memastikan pemesanan, pembelian, pemanfaatan, dan ketersediaan bahan baku.
3. Mengelola keuangan termasuk kas kecil, pencatatan, penyimpanan bukti, rekonsiliasi, dan pelaporan.
4. Menyampaikan pelaporan keuangan harian, dua mingguan, dan bulanan sesuai ketentuan.
5. Mengatur jadwal kerja giliran/shift relawan.
6. Memastikan pencatatan kegiatan harian masing-masing petugas.
7. Memastikan pencatatan food waste organik dan anorganik.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PENGAWAS SANITASI', $txt$
1. Melakukan inspeksi mingguan seluruh area SPPG sesuai wilayah/zonasi.
2. Melakukan inspeksi kualitas bahan pangan secara berkala sesuai jadwal kunjungan.
3. Memastikan alat masak, alat penyaji, dan peralatan distribusi higienis serta berfungsi baik.
4. Mengawasi penerapan SOP kebersihan, cuci tangan, pakaian kerja, dan penggunaan APD.
5. Memastikan sistem pembuangan limbah dan suplai air bersih sesuai standar.
6. Menyusun laporan audit sanitasi untuk monitoring, evaluasi, dan pelaporan ke KPPG.
7. Berkoordinasi dengan Puskesmas, Dinas Kesehatan, dan Dinas Ketahanan Pangan untuk inspeksi/pembinaan.
8. Memastikan CCTV pada wilayah pengawasan berfungsi dan aktif.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026.$txt$),
  ('JURU MASAK', $txt$
1. Menyusun menu bersama Pengawas Gizi.
2. Memimpin dan mengatur tim memasak secara efisien.
3. Menyiapkan bahan sesuai resep dan memastikan kualitas serta kebersihannya.
4. Memasak makanan sesuai standar gizi yang ditetapkan.
5. Bersama Pengawas Keuangan memeriksa jumlah, kualitas, persediaan bahan baku, dan melaporkan kebutuhan kepada Kepala SPPG.
6. Menjaga standar kebersihan ruang pengolahan dan mutu rasa/kualitas makanan.
7. Berkomunikasi dengan personel SPPG untuk kelancaran proses memasak dan waktu penyajian.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026.$txt$),
  ('ASISTEN LAPANGAN', $txt$
1. Menjalin hubungan dengan pihak eksternal khususnya satuan pendidikan.
2. Memastikan proses produksi berjalan lancar dan selesai sesuai waktu.
3. Memastikan ketersediaan bahan baku produksi.
4. Memutakhirkan jumlah porsi yang diproduksi dan didistribusikan setiap hari.
5. Menjaga hubungan dengan satuan pendidikan secara harmonis dan proaktif.
6. Melakukan monitoring dan evaluasi pada packaging, distribusi, kebersihan, dan pencucian alat makan.
7. Mengatur pengeluaran operasional kegiatan seperti bensin, gas, dan kebutuhan terkait.
8. Melakukan quality control, pencatatan, dan penimbangan bahan baku yang masuk.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PERSIAPAN BAHAN MAKANAN', $txt$
1. Memastikan ketersediaan bahan baku.
2. Membersihkan, mengupas, dan memotong sayuran serta bumbu.
3. Menghitung dan mencatat kebutuhan bahan baku terhadap jumlah porsi.
4. Menghitung dan mencatat sampah dari bahan yang digunakan.
5. Membersihkan lingkungan kerja di sekitar ruangan.
6. Memastikan bahan baku yang digunakan higienis.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PENGOLAHAN BAHAN MAKANAN', $txt$
1. Produksi nasi: memastikan ketersediaan nasi dan stok beras, mencatat hasil produksi/porsi, memastikan pencucian beras higienis, serta membersihkan alat dan area kerja.
2. Produksi sayur: memastikan bahan baku dan ketersediaan sayur saat pemorsian, mencatat kapasitas produksi dan penggunaan bumbu, serta membersihkan alat/area kerja.
3. Produksi lauk: memastikan bahan baku dan ketersediaan lauk saat pemorsian, mencatat kapasitas produksi dan penggunaan bumbu, memeriksa bahan baku lauk dari pemasok, serta membersihkan alat/area kerja.
4. Pengolahan makanan basah dilakukan di fasilitas SPPG untuk menjaga keamanan pangan dan standar gizi.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PEMORSIAN', $txt$
1. Memastikan ketersediaan peralatan makan beserta tutupnya.
2. Memastikan ketersediaan makanan seperti susu, nasi, lauk, sayur, dan buah.
3. Melakukan quality control buah termasuk sortir dan penimbangan saat datang.
4. Memastikan alat makan terisi lengkap dan porsi sesuai kelompok penerima manfaat.
5. Menjaga area kerja rapi, bersih, dan higienis.
6. Melakukan stok opname bahan seperti susu/buah dan asset management alat makan.
7. Membersihkan peralatan pemorsian dan lingkungan sebelum meninggalkan area kerja.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PACKING', $txt$
1. Memastikan area kerja rapi, bersih, dan higienis.
2. Melaksanakan packing sesuai tata susun operasional dan memastikan perlengkapan packing tersedia.
3. Memindahkan makanan dari ruang packing ke ruang distribusi sesuai susunan yang ditetapkan.
4. Memastikan makanan tidak tumpah.
5. Membersihkan peralatan packing dan lingkungan kerja sebelum ditinggalkan.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('DISTRIBUSI', $txt$
1. Memastikan kendaraan bersih, rapi, higienis, aman, dan terkunci saat ditinggalkan.
2. Memasukkan makanan ke kendaraan dan mendistribusikannya ke lokasi penerima manfaat.
3. Memastikan makanan tidak tumpah atau rusak selama distribusi.
4. Memastikan MBG diterima penanggung jawab satuan pendidikan/Posyandu sesuai jumlah dan bukti yang ditetapkan.
5. Mendukung uji organoleptik pada saat penerimaan sebelum konsumsi sesuai ketentuan.
6. Mengambil alat makan kotor dan mengantarkannya ke tempat pencucian serta membawa kembali alat makan bersih ke unit pelayanan.
7. Membawa, mengisi, mengamankan, dan menyerahkan surat jalan.
8. Dalam satu tim distribusi terdapat pengemudi utama dan pengemudi cadangan/pengganti yang mampu mengemudikan kendaraan distribusi.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PETUGAS KEBERSIHAN', $txt$
1. Memastikan dan bertanggung jawab atas kebersihan seluruh area unit pelayanan.
2. Memastikan sampah dibuang pada tempatnya dan tempat sampah bersih ketika pulang.
3. Melakukan cleaning pada setiap bagian di unit pelayanan.
4. Menjaga kebersihan peralatan/fasilitas seperti kipas angin, freezer, dan safety shoes.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$),
  ('PETUGAS KEAMANAN', $txt$
1. Menjaga keamanan dan ketertiban di SPPG.
2. Mengamankan akses keluar masuk personel, pemasok, dan tamu.
3. Melakukan inspeksi keamanan lingkungan dan personel SPPG.
4. Memastikan tidak ada barang masuk atau keluar tanpa izin Kepala SPPG.
5. Berkoordinasi dengan aparat keamanan setempat.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026.$txt$),
  ('PENCUCI ALAT MAKAN', $txt$
1. Memastikan alat makan kotor datang sesuai jumlah porsi yang ditentukan.
2. Memisahkan sisa nasi/sayur, kemudian menimbang dan mencatat food waste.
3. Membilas alat makan dan tutup kotor dengan air panas.
4. Mencuci menggunakan sabun cair, menggosok dengan spons, dan membilas dua kali dengan air bersih.
5. Memastikan alat makan yang telah dicuci bersih, rapi, diikat, dan higienis.
6. Memastikan alat makan bersih diambil dan dibawa kembali oleh pengemudi ke unit pelayanan.
7. Menjaga sanitasi tempat pencucian agar bersih, tidak bau, tidak tersumbat, dan tidak mencemari lingkungan.
Sumber: Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025, Juknis MBG TA 2026; MENEJMAN SOP SPPG.$txt$)
),
aliases(alias, canonical_name) as (
  values
  ('KEPALA SPPG','KEPALA SPPG'),
  ('AHLI GIZI','PENGAWAS GIZI'), ('PENGAWAS GIZI','PENGAWAS GIZI'),
  ('AKUNTAN','PENGAWAS KEUANGAN'), ('PENGAWAS KEUANGAN','PENGAWAS KEUANGAN'),
  ('PENGAWAS SANITASI','PENGAWAS SANITASI'),
  ('KEPALA DAPUR','JURU MASAK'), ('JURU MASAK','JURU MASAK'),
  ('ASISTEN LAPANGAN','ASISTEN LAPANGAN'),
  ('PERSIAPAN','PERSIAPAN BAHAN MAKANAN'), ('DIVISI PERSIAPAN','PERSIAPAN BAHAN MAKANAN'),
  ('PERSIAPAN BAHAN MAKANAN','PERSIAPAN BAHAN MAKANAN'), ('KOORDINATOR BAHAN MAKANAN','PERSIAPAN BAHAN MAKANAN'),
  ('PENGOLAHAN BAHAN MAKANAN','PENGOLAHAN BAHAN MAKANAN'), ('DIVISI PRODUKSI','PENGOLAHAN BAHAN MAKANAN'),
  ('KOORDINATOR PENGOLAHAN BAHAN MAKANAN','PENGOLAHAN BAHAN MAKANAN'),
  ('PEMORSIAN','PEMORSIAN'), ('DIVISI PEMORSIAN','PEMORSIAN'), ('KOORDINATOR PEMORSIAN','PEMORSIAN'),
  ('PACKING','PACKING'),
  ('DISTRIBUSI','DISTRIBUSI'), ('DIVISI DISTRIBUSI','DISTRIBUSI'), ('DRIVER','DISTRIBUSI'),
  ('ASISTEN DRIVER','DISTRIBUSI'), ('KOORDINATOR DISTRIBUSI','DISTRIBUSI'),
  ('PETUGAS KEBERSIHAN','PETUGAS KEBERSIHAN'), ('DIVISI KEBERSIHAN','PETUGAS KEBERSIHAN'),
  ('PETUGAS KEAMANAN','PETUGAS KEAMANAN'), ('SECURITY','PETUGAS KEAMANAN'),
  ('PENCUCI ALAT MAKAN','PENCUCI ALAT MAKAN'), ('DIVISI OMPRENG','PENCUCI ALAT MAKAN'),
  ('KOORDINATOR PENCUCI ALAT MAKAN','PENCUCI ALAT MAKAN')
)
insert into public."Master_Job_Description" (
  "ID_Job_Description", "ID_Master_Jabatan", "Nama_Jabatan", "Job_Description", "Version", "SPPG_Scope", "Aktif", "Updated_At"
)
select
  'JOB_DOC2026_' || substr(md5(j."ID_Master_Jabatan"), 1, 16),
  j."ID_Master_Jabatan", j."Nama_Jabatan", c.deskripsi, 1, null, true, now()
from public."Master_Jabatan" j
join aliases a on upper(btrim(j."Nama_Jabatan")) = a.alias
join canonical c on c.nama = a.canonical_name
where not exists (
  select 1 from public."Master_Job_Description" d
  where d."ID_Master_Jabatan" = j."ID_Master_Jabatan" and d."SPPG_Scope" is null and d."Aktif" = true
);

-- Jadwal dari MENEJMAN SOP SPPG. Posisi tanpa jam eksplisit tetap diberi row master
-- dengan keterangan mengikuti pembagian jam kerja/rotasi agar tidak mengarang waktu.
with schedules(alias, masuk, pulang, hari, keterangan) as (
  values
  ('AHLI GIZI', time '03:00', time '11:00', 'Setiap hari operasional SPPG', 'Jadwal sumber: Ahli Gizi 03.00-11.00 WIB.'),
  ('PENGAWAS GIZI', time '03:00', time '11:00', 'Setiap hari operasional SPPG', 'Jadwal sumber: Ahli Gizi 03.00-11.00 WIB.'),
  ('AKUNTAN', time '08:00', time '16:00', 'Setiap hari operasional SPPG', 'Jadwal sumber: penerimaan bahan baku 08.00-16.00 WIB oleh Akuntan/Pengawas Keuangan.'),
  ('PENGAWAS KEUANGAN', time '08:00', time '16:00', 'Setiap hari operasional SPPG', 'Jadwal sumber: penerimaan bahan baku 08.00-16.00 WIB oleh Akuntan/Pengawas Keuangan.'),
  ('PERSIAPAN', time '16:00', time '00:00', 'Sesuai jadwal operasional SPPG', 'Jadwal persiapan/pre-cut/thawing 16.00-00.00 WIB.'),
  ('DIVISI PERSIAPAN', time '16:00', time '00:00', 'Sesuai jadwal operasional SPPG', 'Jadwal persiapan/pre-cut/thawing 16.00-00.00 WIB.'),
  ('PERSIAPAN BAHAN MAKANAN', time '16:00', time '00:00', 'Sesuai jadwal operasional SPPG', 'Jadwal persiapan/pre-cut/thawing 16.00-00.00 WIB.'),
  ('KOORDINATOR BAHAN MAKANAN', time '16:00', time '00:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal tahap persiapan bahan 16.00-00.00 WIB.'),
  ('PENGOLAHAN BAHAN MAKANAN', time '00:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Jadwal proses pengolahan 00.00-08.00 WIB.'),
  ('DIVISI PRODUKSI', time '00:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal proses pengolahan 00.00-08.00 WIB.'),
  ('KOORDINATOR PENGOLAHAN BAHAN MAKANAN', time '00:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal proses pengolahan 00.00-08.00 WIB.'),
  ('JURU MASAK', time '00:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti tahapan proses pengolahan 00.00-08.00 WIB.'),
  ('KEPALA DAPUR', time '00:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti tahapan proses pengolahan 00.00-08.00 WIB.'),
  ('PEMORSIAN', time '03:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Jadwal pemorsian 03.00-08.00 WIB.'),
  ('DIVISI PEMORSIAN', time '03:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Jadwal pemorsian 03.00-08.00 WIB.'),
  ('KOORDINATOR PEMORSIAN', time '03:00', time '08:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal pemorsian 03.00-08.00 WIB.'),
  ('DISTRIBUSI', time '07:00', time '14:00', 'Sesuai jadwal operasional SPPG', 'Jadwal distribusi/pengiriman 07.00-14.00 WIB.'),
  ('DIVISI DISTRIBUSI', time '07:00', time '14:00', 'Sesuai jadwal operasional SPPG', 'Jadwal distribusi/pengiriman 07.00-14.00 WIB.'),
  ('DRIVER', time '07:00', time '14:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal distribusi/pengiriman 07.00-14.00 WIB.'),
  ('ASISTEN DRIVER', time '07:00', time '14:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal distribusi/pengiriman 07.00-14.00 WIB.'),
  ('KOORDINATOR DISTRIBUSI', time '07:00', time '14:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal distribusi/pengiriman 07.00-14.00 WIB.'),
  ('PENCUCI ALAT MAKAN', time '13:00', time '21:00', 'Sesuai jadwal operasional SPPG', 'Jadwal pencucian alat masak dan ompreng 13.00-21.00 WIB.'),
  ('DIVISI OMPRENG', time '13:00', time '21:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal pencucian alat makan 13.00-21.00 WIB.'),
  ('KOORDINATOR PENCUCI ALAT MAKAN', time '13:00', time '21:00', 'Sesuai jadwal operasional SPPG', 'Mengikuti jadwal pencucian alat makan 13.00-21.00 WIB.'),
  ('PACKING', null::time, null::time, 'Sesuai pembagian jam kerja dan rotasi SPPG', 'Dokumen tidak menetapkan jam khusus Packing; mengikuti pembagian jam kerja/rotasi yang ditetapkan.'),
  ('KEPALA SPPG', null::time, null::time, 'Setiap hari operasional SPPG', 'Juknis menetapkan pegawai DIPA BGN Pusat bekerja paling sedikit 8 jam per hari; jam spesifik mengikuti pembagian/rotasi.'),
  ('PENGAWAS SANITASI', null::time, null::time, 'Sesuai jadwal kunjungan/zonasi', 'Inspeksi mingguan seluruh area; inspeksi kualitas bahan pangan setiap 3 hari atau menyesuaikan kunjungan.'),
  ('ASISTEN LAPANGAN', null::time, null::time, 'Sesuai pembagian jam kerja dan rotasi SPPG', 'Dokumen tidak menetapkan jam khusus Asisten Lapangan; mengikuti pembagian jam kerja/rotasi.'),
  ('PETUGAS KEBERSIHAN', null::time, null::time, 'Sesuai pembagian jam kerja dan rotasi SPPG', 'Dokumen tidak menetapkan jam khusus Petugas Kebersihan; mengikuti pembagian jam kerja/rotasi.'),
  ('DIVISI KEBERSIHAN', null::time, null::time, 'Sesuai pembagian jam kerja dan rotasi SPPG', 'Mengikuti pembagian jam kerja/rotasi Petugas Kebersihan.'),
  ('PETUGAS KEAMANAN', null::time, null::time, 'Sesuai pembagian jam kerja dan rotasi SPPG', 'Dokumen tidak menetapkan jam khusus Petugas Keamanan; mengikuti pembagian jam kerja/rotasi.'),
  ('SECURITY', null::time, null::time, 'Sesuai pembagian jam kerja dan rotasi SPPG', 'Mengikuti pembagian jam kerja/rotasi Petugas Keamanan.')
)
insert into public."Master_Jam_Kerja" (
  "ID_Jam_Kerja", "ID_Master_Jabatan", "Nama_Jabatan", "Divisi", "Hari_Kerja", "Jam_Masuk", "Jam_Pulang", "Keterangan", "SPPG_Scope", "Aktif", "Updated_At"
)
select
  'JAM_DOC2026_' || substr(md5(j."ID_Master_Jabatan"), 1, 16),
  j."ID_Master_Jabatan", j."Nama_Jabatan", j."Nama_Jabatan", s.hari, s.masuk, s.pulang,
  s.keterangan || ' Sumber: MENEJMAN SOP SPPG dan/atau Keputusan Kepala BGN RI Nomor 401.1 Tahun 2025.',
  null, true, now()
from public."Master_Jabatan" j
join schedules s on upper(btrim(j."Nama_Jabatan")) = s.alias
where not exists (
  select 1 from public."Master_Jam_Kerja" h
  where h."ID_Master_Jabatan" = j."ID_Master_Jabatan" and h."SPPG_Scope" is null and h."Aktif" = true
);

-- Perkaya 15 SOP yang sudah menjadi bagian template kontrak dengan isi yang didukung dokumen.
update public."Master_SOP_References" set "Deskripsi" = case "Kode_SOP"
when 'SOP-01' then 'Penerimaan/pemeriksaan bahan baku dilakukan dengan verifikasi jumlah, kondisi, kualitas, keamanan, pencatatan dan penimbangan. MENEJMAN SOP SPPG mencantumkan tahap penerimaan bahan baku pukul 08.00-16.00 WIB oleh Akuntan; Juknis mewajibkan bahan segar, bermutu baik dan aman.'
when 'SOP-02' then 'Pengelolaan penyimpanan/persediaan memastikan kecukupan stok serta mutu bahan pangan tetap terjaga. Kepala SPPG, Pengawas Keuangan dan Juru Masak melakukan kontrol persediaan sesuai tugas masing-masing.'
when 'SOP-03' then 'Persiapan bahan meliputi memastikan ketersediaan bahan baku; membersihkan, mengupas dan memotong sayur/bumbu; menghitung kebutuhan dan food waste; membersihkan area kerja; serta memastikan bahan higienis.'
when 'SOP-04' then 'Pengolahan mencakup produksi nasi, sayur dan lauk; kontrol bahan/stok, pencatatan kapasitas produksi dan penggunaan bumbu, higiene bahan, serta pembersihan alat dan lingkungan. Makanan basah diproses di fasilitas SPPG untuk menjaga keamanan pangan dan standar gizi.'
when 'SOP-05' then 'Pengendalian mutu dilakukan setiap hari terhadap bahan baku dan makanan. Pengawas Gizi melakukan quality control dan pencatatan food sample; SPPG menyiapkan 2 porsi sampel per batch yang disimpan di lemari pendingin selama 3 hari sesuai Juknis.'
when 'SOP-06' then 'Pemorsian memastikan alat makan dan seluruh komponen makanan tersedia, melakukan QC buah, memastikan kelengkapan dan ketepatan porsi, menjaga area higienis, stok opname, asset management, serta pembersihan alat/area.'
when 'SOP-07' then 'Packing dilakukan pada area yang rapi, bersih dan higienis; perlengkapan packing harus tersedia; makanan dipindahkan ke area distribusi dengan aman dan tidak tumpah; alat serta lingkungan dibersihkan setelah pekerjaan.'
when 'SOP-08' then 'Distribusi memastikan kendaraan bersih, higienis dan aman; makanan dikirim tanpa tumpah/rusak dan diterima sesuai jumlah; mendukung uji organoleptik; mengelola pengambilan/pengembalian alat makan dan surat jalan.'
when 'SOP-09' then 'Pencucian alat makan mencakup pemisahan dan pencatatan sisa makanan, pembilasan air panas, pencucian sabun cair dan spons, pembilasan dua kali dengan air bersih, serta memastikan alat bersih, rapi, higienis dan area pencucian tidak mencemari lingkungan.'
when 'SOP-10' then 'Kebersihan lingkungan mencakup seluruh area SPPG, tempat sampah, cleaning tiap bagian, serta kebersihan fasilitas/peralatan seperti kipas angin, freezer dan safety shoes.'
when 'SOP-11' then 'Higiene dan sanitasi mencakup kebersihan tenaga kerja, cuci tangan, pakaian kerja/APD, higiene alat masak/penyaji/distribusi, suplai air bersih, pembuangan limbah, inspeksi berkala, dan pelaporan audit sanitasi.'
when 'SOP-12' then 'Keamanan pangan mencakup pengambilan dan penyimpanan food sample, kepemilikan SLHS dan Sertifikat Halal sesuai ketentuan, rapid test berkala, bahan baku aman, air pencucian, alat food grade, higiene tenaga kerja, kendaraan tertutup, dan lingkungan bebas pencemaran.'
when 'SOP-13' then 'K3 diterapkan melalui pembagian jam kerja dan rotasi untuk menjaga keselamatan, penggunaan APD/pakaian kerja yang sesuai, pemeliharaan peralatan agar berfungsi baik, dan pelaksanaan pekerjaan sesuai prosedur.'
when 'SOP-14' then 'Pengelolaan limbah meliputi pemisahan, penimbangan dan pencatatan food waste organik/anorganik serta memastikan sistem pembuangan limbah tidak mencemari lingkungan dan sesuai standar sanitasi.'
when 'SOP-15' then 'Administrasi dan pelaporan meliputi pencatatan kegiatan harian, bukti pengeluaran dan rekonsiliasi, laporan keuangan harian, dua mingguan dan bulanan, serta pelaporan pelaksanaan kegiatan MBG secara berkala sesuai Juknis.'
else "Deskripsi" end,
"Updated_At" = now()
where "Kode_SOP" between 'SOP-01' and 'SOP-15';

-- Referensi tambahan dari dokumen sumber agar dapat dipantau dari menu Master > SOP / Referensi.
insert into public."Master_SOP_References" ("ID_SOP","Kode_SOP","Nama_SOP","Deskripsi","Urutan","SPPG_Scope","Aktif","Updated_At")
values
('REF_BGN_401_1_2025','REF-BGN-401.1-2025','Juknis Tata Kelola MBG Tahun Anggaran 2026','Keputusan Kepala Badan Gizi Nasional Republik Indonesia Nomor 401.1 Tahun 2025 tentang Petunjuk Teknis Tata Kelola Penyelenggaraan Program Makan Bergizi Gratis Tahun Anggaran 2026. Digunakan sebagai referensi resmi struktur, tugas, keamanan pangan, pelaporan, dan tata kelola SPPG.',90,null,true,now()),
('REF_ORG_SPPG_2026','REF-ORG-SPPG-2026','Struktur & Alokasi Personel SPPG','Juknis menetapkan komposisi maksimal 52 personel: Kepala SPPG 1; Pengawas Gizi 1; Pengawas Keuangan 1; Pengawas Sanitasi 1 per 5 SPPG; Juru Masak 1; Asisten Lapangan 1; Persiapan Bahan Makanan 4; Pengolahan Bahan Makanan 10; Pemorsian 9; Packing 1; Distribusi 4; Petugas Kebersihan 2; Pencuci Alat Makan 14; Petugas Keamanan 2.',91,null,true,now()),
('REF_WORK_SPPG_2026','REF-JAM-SPPG-2026','Ketentuan Jam Kerja & Rotasi SPPG','Juknis mewajibkan setiap petugas melaksanakan tugas sesuai pembagian jam kerja dan rotasi. Pegawai yang dibiayai DIPA BGN Pusat wajib hadir pada setiap hari operasional dan bekerja paling sedikit 8 jam per hari. Hari operasional SPPG TA 2026 ditetapkan 313 hari dengan skema 6 hari kerja per minggu.',92,null,true,now())
on conflict ("ID_SOP") do update set
  "Kode_SOP"=excluded."Kode_SOP", "Nama_SOP"=excluded."Nama_SOP", "Deskripsi"=excluded."Deskripsi",
  "Urutan"=excluded."Urutan", "Aktif"=true, "Updated_At"=now();

comment on function public.normalize_master_jabatan_contract() is
'Keeps Master_Jabatan as one canonical Jabatan atau Divisi value and generates Kode_Jabatan automatically.';
