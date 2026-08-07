alter table public."Master_Jabatan" add column if not exists "SPPG_Scope" text;

update public."Master_SPPG" set "Kode_SPPG" = case upper("Nama_SPPG")
  when 'DARMARAJA' then 'DRJ'
  when 'CIAWI' then 'CIA'
  when 'CINTA JAYA' then 'CTJ'
  when 'KIRISIK' then 'KRS'
  when 'PAKUALAM' then 'PKL'
  when 'RANCAH-RANCAH 02' then 'RR2'
  when 'TANJUNGMEDAR' then 'TJM'
  else upper(left(regexp_replace("Nama_SPPG", '[^A-Za-z0-9]', '', 'g'), 3))
end
where nullif(btrim(coalesce("Kode_SPPG",'')),'') is null;

-- Preserve current Master Jabatan rows as global defaults. SPPG-specific overrides can be added from the Master UI.
update public."Master_Jabatan" set "SPPG_Scope" = null where "SPPG_Scope" is null;

comment on column public."Master_SPPG"."Kode_SPPG" is 'Short contract code, e.g. DRJ -> PK/SPPG-DRJ/0001/VIII/2026.';
comment on column public."Master_Jabatan"."SPPG_Scope" is 'NULL for global master; optional SPPG-specific override.';
