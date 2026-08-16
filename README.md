# ARRZ MARKET — Pure Supabase + Static Frontend + Vercel

Marketplace jual beli akun digital. Tidak ada lagi server Node.js yang
berjalan terus-menerus — semua backend (database, auth, realtime, storage)
ditangani Supabase, frontend murni HTML/CSS/vanilla JS static.

```
Browser → Supabase Client → PostgreSQL
Browser → Supabase Realtime
Browser → Supabase Storage
Browser → Supabase Auth
```

## 1. Buat project Supabase

Di [supabase.com](https://supabase.com), buat project baru. Catat
**Project URL** dan **anon public key** dari Project Settings → API.

## 2. Jalankan skema database

Buka Supabase → SQL Editor, jalankan berurutan:

1. `supabase/schema.sql` — skema tabel dasar (accounts, categories, offers,
   sell_requests, transactions, site_settings, account_images).
2. `supabase/migration_pure_supabase.sql` — migrasi ke pure Supabase:
   tabel `profiles` (role admin/user), RLS baru per tabel, trigger auto-SOLD
   saat transaksi COMPLETED, publication realtime, bucket + policy Storage.

## 3. Isi konfigurasi Supabase di frontend

Edit `public/js/supabase-client.js`, isi `SUPABASE_URL` dan
`SUPABASE_ANON_KEY` dari langkah 1. **Jangan pernah** memasukkan
`service_role` key ke file manapun di folder `public/`.

## 4. Buat user admin pertama

1. Supabase → Authentication → Add user (isi email + password).
2. Jalankan di SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where id = 'UUID_USER_TADI';
   ```
3. Login lewat `public/login.html` pakai email + password tadi.

## 5. Jalankan lokal / deploy

```bash
npm run dev     # serve folder public/ secara lokal (butuh `npx serve`)
```

Deploy ke Vercel: hubungkan repo, Vercel otomatis membaca `vercel.json`
(`outputDirectory: public`) — tidak perlu build step, tidak perlu env
server karena semua konfigurasi ada di `public/js/supabase-client.js`.

## Struktur proyek

```
arrz-market/
├── vercel.json                  # deploy static dari folder public/
├── supabase/
│   ├── schema.sql                # skema tabel dasar
│   └── migration_pure_supabase.sql  # RLS admin, trigger, realtime, storage
└── public/
    ├── index.html, shop.html, product.html, sell.html,
    │   login.html, faq.html, how-it-works.html, admin.html
    ├── css/
    └── js/
        ├── supabase-client.js     # konfigurasi Supabase client (SUPABASE_URL/ANON_KEY)
        ├── wa-templates.js        # template pesan WhatsApp (dulu di server)
        ├── app.js                 # util bersama: toast, navbar, settings, homepage
        ├── shop.js, product.js, sell.js   # query Supabase langsung per halaman
        ├── admin.js                # dashboard admin (Supabase Auth + CRUD + realtime)
        └── realtime.js             # Supabase Realtime publik (ganti Socket.IO)
```

## Arsitektur (sebelum → sesudah)

| Sebelum | Sesudah |
|---|---|
| Express routes (`/api/accounts`, dst) | Query `supabaseClient.from(...)` langsung dari browser |
| Socket.IO (`io.emit`, `socket.on`) | Supabase Realtime (`postgres_changes`) |
| express-session + bcrypt admin | Supabase Auth + tabel `profiles.role` |
| multer → filesystem `uploads/` | Upload langsung ke Supabase Storage (`account-images`) |
| Validasi & keamanan di Express middleware | Row Level Security (RLS) di PostgreSQL |
