/* ============================================================
   ARRZ MARKET — admin.js
   Dashboard admin: auth guard (Supabase Auth), tab switching,
   CRUD akun/tawaran/pengajuan/transaksi/kategori, pengaturan
   situs, realtime notif. Migrasi: semua panggilan /api/* diganti
   query Supabase langsung (RLS membatasi ke role admin).
   ============================================================ */

(function () {
  const shell = document.querySelector('[data-admin-shell]');
  if (!shell) return; // bukan halaman admin.html

  let categoriesCache = [];

  // ── Auth guard (Supabase Auth + role admin di tabel profiles) ─
  async function checkAuth() {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        window.location.href = 'login.html';
        return false;
      }
      const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error || !profile || profile.role !== 'admin') {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
        return false;
      }
      shell.style.display = '';
      return true;
    } catch (e) {
      window.location.href = 'login.html';
      return false;
    }
  }

  // Kalau sesi berakhir/logout dari tab lain, ikut terlempar ke login.
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = 'login.html';
  });

  // ── Logout ───────────────────────────────────────────────────
  document.querySelector('[data-logout-btn]')?.addEventListener('click', async () => {
    try {
      await supabaseClient.auth.signOut();
    } finally {
      window.location.href = 'login.html';
    }
  });

  // ── Tab switching ────────────────────────────────────────────
  const tabButtons = document.querySelectorAll('[data-tab-btn]');
  const tabPanels = document.querySelectorAll('[data-tab-panel]');
  const loadedTabs = new Set();

  function switchTab(tabName) {
    tabButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tabBtn === tabName));
    tabPanels.forEach((panel) => {
      panel.style.display = panel.dataset.tabPanel === tabName ? '' : 'none';
    });
    loadTabData(tabName);
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tabBtn));
  });

  function loadTabData(tabName) {
    switch (tabName) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'accounts':
        loadAccountsTable();
        if (!loadedTabs.has('categories-cache')) loadCategoriesCache();
        break;
      case 'offers':
        loadOffersTable();
        break;
      case 'sell-requests':
        loadSellRequestsTable();
        break;
      case 'transactions':
        loadTransactionsTable();
        break;
      case 'categories':
        loadCategoriesTable();
        break;
      case 'settings':
        loadSettingsForm();
        break;
    }
  }

  // ── Dashboard stats ──────────────────────────────────────────
  async function loadDashboard() {
    const grid = document.querySelector('[data-dashboard-stats]');
    try {
      const countOf = (table, eqCol, eqVal) => {
        let q = supabaseClient.from(table).select('id', { count: 'exact', head: true });
        if (eqCol) q = q.eq(eqCol, eqVal);
        return q;
      };
      const [totalAccounts, availableAccounts, soldAccounts, pendingSellRequests, pendingOffers, totalTransactions] =
        await Promise.all([
          countOf('accounts'),
          countOf('accounts', 'status', 'AVAILABLE'),
          countOf('accounts', 'status', 'SOLD'),
          countOf('sell_requests', 'status', 'PENDING'),
          countOf('offers', 'status', 'PENDING'),
          countOf('transactions'),
        ]);

      const values = [
        totalAccounts.count || 0,
        availableAccounts.count || 0,
        soldAccounts.count || 0,
        pendingSellRequests.count || 0,
        pendingOffers.count || 0,
        totalTransactions.count || 0,
      ];
      grid.querySelectorAll('.stat-card__value').forEach((el, idx) => (el.textContent = values[idx] ?? '—'));
    } catch (e) {
      ARRZ.toast(e.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════
  // CARI AKUN (Dashboard) — cari lewat Kode Akun acak sistem
  // (contoh: ARZ-7F3K9X), bukan lagi kode berurutan seperti ACC-00019.
  // ══════════════════════════════════════════════════════════
  const lookupForm = document.querySelector('[data-account-lookup-form]');
  const lookupResult = document.querySelector('[data-account-lookup-result]');

  lookupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = lookupForm.querySelector('button[type="submit"]');
    const rawCode = lookupForm.querySelector('[name="code"]').value.trim();
    if (!rawCode) {
      ARRZ.toast('Masukkan kode akun terlebih dahulu.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Mencari...';
    lookupResult.innerHTML = '';

    try {
      const { data, error } = await supabaseClient
        .from('accounts')
        .select('*, account_images(id, image_url, is_primary), categories(name)')
        .ilike('account_code', rawCode)
        .maybeSingle();
      if (error) throw error;

      if (!data) {
        lookupResult.innerHTML = `<div class="admin-empty" style="padding:14px 0;">Akun dengan kode "${ARRZ.escapeAttr(rawCode)}" tidak ditemukan.</div>`;
        return;
      }

      const primary = (data.account_images || []).find((i) => i.is_primary) || data.account_images?.[0];
      lookupResult.innerHTML = `
        <div class="admin-lookup-card">
          ${primary ? `<img class="table-thumb" style="width:56px; height:56px;" src="${ARRZ.escapeAttr(primary.image_url)}" alt="" />` : `<div class="table-thumb" style="width:56px; height:56px;"></div>`}
          <div style="flex:1; min-width:0;">
            <div class="mono" style="font-weight:700;">${ARRZ.escapeAttr(data.account_code)}</div>
            <div style="font-weight:600;">${ARRZ.escapeAttr(data.name)} — ${ARRZ.escapeAttr(data.platform)}</div>
            <div style="font-size:0.85rem; color:var(--ink-soft);">${ARRZ.formatRupiah(data.price)} · <span class="badge ${data.status === 'SOLD' ? 'badge--sold' : 'badge--available'}">${data.status}</span></div>
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-lookup-edit="${data.id}">Buka / Edit</button>
        </div>`;

      lookupResult.querySelector('[data-lookup-edit]')?.addEventListener('click', () => {
        switchTab('accounts');
        openAccountDrawer(data.id);
      });
    } catch (err) {
      ARRZ.toast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Cari Akun';
    }
  });

  // ── Kategori cache (dipakai dropdown akun) ──────────────────
  async function loadCategoriesCache() {
    try {
      const { data, error } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
      if (error) throw error;
      categoriesCache = data || [];
      loadedTabs.add('categories-cache');
      const select = document.getElementById('acc-category');
      if (select) {
        select.innerHTML =
          '<option value="">Pilih kategori</option>' +
          categoriesCache.map((c) => `<option value="${c.id}">${ARRZ.escapeAttr(c.name)}</option>`).join('');
      }
    } catch (e) {
      // diamkan, dropdown tetap kosong
    }
  }

  // ══════════════════════════════════════════════════════════
  // AKUN
  // ══════════════════════════════════════════════════════════

  let accountsCache = [];
  const accountsSearchInput = document.querySelector('[data-accounts-table-search]');

  function matchesAccountSearch(acc, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    return (
      (acc.account_code || '').toLowerCase().includes(q) ||
      (acc.name || '').toLowerCase().includes(q) ||
      (acc.username || '').toLowerCase().includes(q)
    );
  }

  function renderAccountsTable(rows) {
    const tbody = document.querySelector('[data-accounts-table]');
    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">Tidak ada akun yang cocok.</td></tr>`;
      return;
    }
    renderAccountsRows(rows, tbody);
  }

  accountsSearchInput?.addEventListener('input', () => {
    renderAccountsTable(accountsCache.filter((acc) => matchesAccountSearch(acc, accountsSearchInput.value)));
  });

  async function loadAccountsTable() {
    const tbody = document.querySelector('[data-accounts-table]');
    tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">Memuat...</td></tr>`;
    try {
      const { data: all, error } = await supabaseClient
        .from('accounts')
        .select('*, account_images(id, image_url, is_primary)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;

      accountsCache = all || [];

      if (!all || all.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">Belum ada akun. Klik "+ Tambah Akun" untuk memulai.</td></tr>`;
        return;
      }

      const filtered = accountsSearchInput?.value
        ? accountsCache.filter((acc) => matchesAccountSearch(acc, accountsSearchInput.value))
        : accountsCache;

      renderAccountsRows(filtered, tbody);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">Data belum dapat dimuat. Silakan coba lagi.</td></tr>`;
    }
  }

  // Dipisah dari loadAccountsTable supaya bisa dipakai ulang saat
  // hasil pencarian (client-side filter) di-render tanpa fetch ulang.
  function renderAccountsRows(all, tbody) {
    try {
      tbody.innerHTML = all
        .map((acc) => {
          const primary = (acc.account_images || []).find((i) => i.is_primary) || acc.account_images?.[0];
          return `
          <tr data-account-row="${acc.id}">
            <td>${primary ? `<img class="table-thumb" src="${ARRZ.escapeAttr(primary.image_url)}" alt="" />` : `<div class="table-thumb"></div>`}</td>
            <td class="mono">${ARRZ.escapeAttr(acc.account_code || '')}</td>
            <td>${ARRZ.escapeAttr(acc.name)}</td>
            <td>${ARRZ.escapeAttr(acc.platform)}</td>
            <td class="mono">${ARRZ.formatRupiah(acc.price)}</td>
            <td><span class="badge ${acc.status === 'SOLD' ? 'badge--sold' : 'badge--available'}">${acc.status}</span></td>
            <td>${acc.featured ? '<span class="badge badge--featured">Featured</span>' : '-'}</td>
            <td class="admin-table__actions">
              <button class="btn btn-sm" data-edit-account="${acc.id}">Edit</button>
              <button class="btn btn-sm" data-toggle-status="${acc.id}" data-current-status="${acc.status}">${acc.status === 'SOLD' ? 'Tandai Available' : 'Tandai Sold'}</button>
              <button class="btn btn-sm" style="background:var(--danger-soft); color:var(--danger);" data-delete-account="${acc.id}">Hapus</button>
            </td>
          </tr>`;
        })
        .join('');

      tbody.querySelectorAll('[data-edit-account]').forEach((btn) => {
        btn.addEventListener('click', () => openAccountDrawer(btn.dataset.editAccount));
      });
      tbody.querySelectorAll('[data-toggle-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const newStatus = btn.dataset.currentStatus === 'SOLD' ? 'AVAILABLE' : 'SOLD';
          try {
            const { error } = await supabaseClient.from('accounts').update({ status: newStatus }).eq('id', btn.dataset.toggleStatus);
            if (error) throw error;
            ARRZ.toast('Status akun diperbarui.', 'success');
            loadAccountsTable();
            loadDashboard();
          } catch (e) {
            ARRZ.toast(e.message, 'error');
          }
        });
      });
      tbody.querySelectorAll('[data-delete-account]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Hapus akun ini secara permanen?')) return;
          try {
            const { error } = await supabaseClient.from('accounts').delete().eq('id', btn.dataset.deleteAccount);
            if (error) throw error;
            ARRZ.toast('Akun dihapus.', 'success');
            loadAccountsTable();
            loadDashboard();
          } catch (e) {
            ARRZ.toast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">Data belum dapat dimuat. Silakan coba lagi.</td></tr>`;
    }
  }

  // ── Drawer tambah/edit akun ─────────────────────────────────
  const drawer = document.querySelector('[data-account-drawer]');
  const accountForm = document.querySelector('[data-account-form]');
  const drawerTitle = document.querySelector('[data-drawer-title]');
  const imagesGrid = document.querySelector('[data-account-images]');
  let pendingNewImages = [];
  let editingAccountId = null;

  function openAccountDrawer(accountId = null) {
    editingAccountId = accountId;
    pendingNewImages = [];
    accountForm.reset();
    imagesGrid.innerHTML = '';
    drawerTitle.textContent = accountId ? 'Edit Akun' : 'Tambah Akun';

    if (categoriesCache.length === 0) loadCategoriesCache();

    if (accountId) {
      supabaseClient
        .from('accounts')
        .select('*, account_images(id, image_url, is_primary)')
        .eq('id', accountId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error || !data) throw error || new Error('Akun tidak ditemukan.');
          accountForm.id.value = data.id;
          accountForm.name.value = data.name;
          accountForm.platform.value = data.platform;
          accountForm.category_id.value = data.category_id || '';
          accountForm.price.value = data.price;
          accountForm.username.value = data.username || '';
          accountForm.description.value = data.description || '';
          accountForm.details.value = data.details || '';
          accountForm.features.value = data.features || '';
          accountForm.status.value = data.status;
          accountForm.featured.checked = Boolean(data.featured);
          renderExistingImages(data.account_images || [], data.id);
        })
        .catch((e) => ARRZ.toast(e.message, 'error'));
    }

    drawer.classList.add('is-open');
  }

  function closeAccountDrawer() {
    drawer.classList.remove('is-open');
  }

  document.querySelector('[data-open-account-drawer]')?.addEventListener('click', () => openAccountDrawer());
  document.querySelector('[data-close-drawer]')?.addEventListener('click', closeAccountDrawer);
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) closeAccountDrawer();
  });

  async function removeExistingImage(imageId, btnEl) {
    try {
      const { error } = await supabaseClient.from('account_images').delete().eq('id', imageId);
      if (error) throw error;
      btnEl.closest('.image-manage-item').remove();
      ARRZ.toast('Foto dihapus.', 'success');
    } catch (e) {
      ARRZ.toast(e.message, 'error');
    }
  }

  function renderExistingImages(images) {
    imagesGrid.innerHTML = images
      .map(
        (img) => `
      <div class="image-manage-item ${img.is_primary ? 'is-primary' : ''}" data-existing-image="${img.id}">
        <img src="${ARRZ.escapeAttr(img.image_url)}" alt="" />
        <button type="button" class="image-manage-item__remove" data-remove-existing-image="${img.id}">×</button>
      </div>`
      )
      .join('');

    imagesGrid.querySelectorAll('[data-remove-existing-image]').forEach((btn) => {
      btn.addEventListener('click', () => removeExistingImage(btn.dataset.removeExistingImage, btn));
    });
  }

  function renderPendingImages() {
    const pendingHtml = pendingNewImages
      .map(
        (item, idx) => `
      <div class="image-manage-item" data-pending-image="${idx}">
        <img src="${item.previewUrl}" alt="" />
        <button type="button" class="image-manage-item__remove" data-remove-pending-image="${idx}">×</button>
      </div>`
      )
      .join('');
    const existingHtml = Array.from(imagesGrid.querySelectorAll('[data-existing-image]'))
      .map((el) => el.outerHTML)
      .join('');
    imagesGrid.innerHTML = existingHtml + pendingHtml;

    imagesGrid.querySelectorAll('[data-remove-pending-image]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingNewImages.splice(Number(btn.dataset.removePendingImage), 1);
        renderPendingImages();
      });
    });
    imagesGrid.querySelectorAll('[data-remove-existing-image]').forEach((btn) => {
      btn.addEventListener('click', () => removeExistingImage(btn.dataset.removeExistingImage, btn));
    });
  }

  const accountDropzone = document.querySelector('[data-account-dropzone]');
  const accountPhotoInput = document.querySelector('[data-account-photo-input]');

  accountDropzone?.addEventListener('click', () => accountPhotoInput.click());
  accountDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    accountDropzone.classList.add('is-dragover');
  });
  accountDropzone?.addEventListener('dragleave', () => accountDropzone.classList.remove('is-dragover'));
  accountDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    accountDropzone.classList.remove('is-dragover');
    handleAccountPhotos(e.dataTransfer.files);
  });
  accountPhotoInput?.addEventListener('change', () => {
    handleAccountPhotos(accountPhotoInput.files);
    accountPhotoInput.value = '';
  });

  function handleAccountPhotos(fileList) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    for (const file of Array.from(fileList)) {
      if (!validTypes.includes(file.type)) {
        ARRZ.toast(`${file.name}: format tidak didukung.`, 'error');
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        ARRZ.toast(`${file.name}: ukuran melebihi 5MB.`, 'error');
        continue;
      }
      pendingNewImages.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    renderPendingImages();
  }

  function extFromMime(mime) {
    switch (mime) {
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        return 'bin';
    }
  }

  // Upload langsung ke Supabase Storage (bucket account-images/accounts/),
  // lalu insert baris account_images. Menggantikan POST /api/uploads?context=accounts.
  async function uploadPendingImages(accountId) {
    if (pendingNewImages.length === 0) return;
    const hasExistingImages = imagesGrid.querySelectorAll('[data-existing-image]').length > 0;

    let uploadedCount = 0;
    for (let i = 0; i < pendingNewImages.length; i++) {
      const { file } = pendingNewImages[i];
      const ext = extFromMime(file.type);
      const path = `accounts/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

      const { error: uploadErr } = await supabaseClient.storage
        .from('account-images')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadErr) {
        ARRZ.toast(`${file.name}: gagal diunggah (${uploadErr.message}).`, 'error');
        continue;
      }
      const { data: publicUrlData } = supabaseClient.storage.from('account-images').getPublicUrl(path);
      if (!publicUrlData?.publicUrl) continue;

      const { error: insertErr } = await supabaseClient.from('account_images').insert({
        account_id: accountId,
        image_url: publicUrlData.publicUrl,
        is_primary: !hasExistingImages && uploadedCount === 0,
      });
      if (insertErr) throw insertErr;
      uploadedCount++;
    }
    pendingNewImages = [];
  }

  accountForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = accountForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';

    try {
      const payload = {
        name: accountForm.name.value.trim(),
        platform: accountForm.platform.value.trim(),
        category_id: accountForm.category_id.value || null,
        price: Number(accountForm.price.value),
        username: accountForm.username.value.trim(),
        description: accountForm.description.value.trim(),
        details: accountForm.details.value.trim(),
        features: accountForm.features.value.trim(),
        status: accountForm.status.value,
        featured: accountForm.featured.checked,
      };

      let accountId = editingAccountId;

      if (accountId) {
        const { error } = await supabaseClient.from('accounts').update(payload).eq('id', accountId);
        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient.from('accounts').insert(payload).select('id').single();
        if (error) throw error;
        accountId = data.id;
      }

      await uploadPendingImages(accountId);

      ARRZ.toast('Akun berhasil disimpan.', 'success');
      closeAccountDrawer();
      loadAccountsTable();
      loadDashboard();
    } catch (err) {
      ARRZ.toast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Simpan Akun';
    }
  });

  // ══════════════════════════════════════════════════════════
  // TAWARAN
  // ══════════════════════════════════════════════════════════

  let currentOffersFilter = '';

  async function loadOffersTable() {
    const tbody = document.querySelector('[data-offers-table]');
    tbody.innerHTML = `<tr><td colspan="7" class="admin-empty">Memuat...</td></tr>`;
    try {
      let query = supabaseClient
        .from('offers')
        .select('*, accounts(name, account_code, platform)')
        .order('created_at', { ascending: false });
      if (currentOffersFilter) query = query.eq('status', currentOffersFilter);
      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="admin-empty">Tidak ada tawaran.</td></tr>`;
        return;
      }

      tbody.innerHTML = data
        .map(
          (offer) => `
        <tr>
          <td>${ARRZ.escapeAttr(offer.accounts?.name || '-')}</td>
          <td class="mono">${ARRZ.formatRupiah(offer.original_price)}</td>
          <td class="mono">${ARRZ.formatRupiah(offer.offer_price)}</td>
          <td>${ARRZ.escapeAttr(offer.buyer_name)}</td>
          <td class="mono">${ARRZ.escapeAttr(offer.buyer_whatsapp)}</td>
          <td><span class="badge badge--neutral">${offer.status}</span></td>
          <td class="admin-table__actions">
            ${offer.status === 'PENDING' ? `
              <button class="btn btn-sm" data-offer-action="${offer.id}" data-offer-status="ACCEPTED">Terima</button>
              <button class="btn btn-sm" data-offer-action="${offer.id}" data-offer-status="REJECTED">Tolak</button>
            ` : ''}
            ${offer.status === 'ACCEPTED' ? `<button class="btn btn-sm" data-offer-action="${offer.id}" data-offer-status="COMPLETED">Selesai</button>` : ''}
          </td>
        </tr>`
        )
        .join('');

      tbody.querySelectorAll('[data-offer-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const { error } = await supabaseClient
              .from('offers')
              .update({ status: btn.dataset.offerStatus })
              .eq('id', btn.dataset.offerAction);
            if (error) throw error;
            ARRZ.toast('Status tawaran diperbarui.', 'success');
            loadOffersTable();
            loadDashboard();
          } catch (e) {
            ARRZ.toast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="admin-empty">Data belum dapat dimuat. Silakan coba lagi.</td></tr>`;
    }
  }

  document.querySelectorAll('[data-offers-filter] .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-offers-filter] .tab-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentOffersFilter = btn.dataset.status;
      loadOffersTable();
    });
  });

  // ══════════════════════════════════════════════════════════
  // PENGAJUAN JUAL
  // ══════════════════════════════════════════════════════════

  let currentSellRequestsFilter = '';

  async function loadSellRequestsTable() {
    const tbody = document.querySelector('[data-sell-requests-table]');
    tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Memuat...</td></tr>`;
    try {
      let query = supabaseClient.from('sell_requests').select('*').order('created_at', { ascending: false });
      if (currentSellRequestsFilter) query = query.eq('status', currentSellRequestsFilter);
      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Tidak ada pengajuan.</td></tr>`;
        return;
      }

      tbody.innerHTML = data
        .map(
          (req) => `
        <tr>
          <td>${ARRZ.escapeAttr(req.account_name)}<br/><span style="font-size:0.78rem; color:var(--ink-soft);">${ARRZ.escapeAttr(req.platform)}</span></td>
          <td>${ARRZ.escapeAttr(req.seller_name)}</td>
          <td class="mono">${ARRZ.escapeAttr(req.seller_whatsapp)}</td>
          <td class="mono">${req.desired_price ? ARRZ.formatRupiah(req.desired_price) : '-'}</td>
          <td><span class="badge badge--neutral">${req.status}</span></td>
          <td class="admin-table__actions">
            ${req.status === 'PENDING' ? `<button class="btn btn-sm" data-sr-action="${req.id}" data-sr-status="REVIEW">Review</button>` : ''}
            ${req.status !== 'ACCEPTED' && req.status !== 'REJECTED' ? `
              <button class="btn btn-sm" data-sr-action="${req.id}" data-sr-status="ACCEPTED">Terima</button>
              <button class="btn btn-sm" data-sr-action="${req.id}" data-sr-status="REJECTED">Tolak</button>
            ` : ''}
            ${req.status === 'ACCEPTED' ? `<button class="btn btn-sm btn-primary" data-sr-convert="${req.id}">+ Marketplace</button>` : ''}
          </td>
        </tr>`
        )
        .join('');

      tbody.querySelectorAll('[data-sr-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const { error } = await supabaseClient
              .from('sell_requests')
              .update({ status: btn.dataset.srStatus })
              .eq('id', btn.dataset.srAction);
            if (error) throw error;
            ARRZ.toast('Status pengajuan diperbarui.', 'success');
            loadSellRequestsTable();
            loadDashboard();
          } catch (e) {
            ARRZ.toast(e.message, 'error');
          }
        });
      });

      tbody.querySelectorAll('[data-sr-convert]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Tambahkan pengajuan ini sebagai akun baru di marketplace?')) return;
          try {
            await convertSellRequestToAccount(btn.dataset.srConvert);
            ARRZ.toast('Akun berhasil ditambahkan ke marketplace.', 'success');
            loadSellRequestsTable();
            loadDashboard();
          } catch (e) {
            ARRZ.toast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Data belum dapat dimuat. Silakan coba lagi.</td></tr>`;
    }
  }

  // Dulu POST /api/sell-requests/:id/convert (server). Sekarang beberapa
  // langkah Supabase berurutan (aman karena hanya admin yang lolos RLS).
  async function convertSellRequestToAccount(sellRequestId) {
    const { data: sellRequest, error: fetchErr } = await supabaseClient
      .from('sell_requests')
      .select('*')
      .eq('id', sellRequestId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!sellRequest) throw new Error('Pengajuan tidak ditemukan.');
    if (sellRequest.status !== 'ACCEPTED') {
      throw new Error('Pengajuan harus berstatus ACCEPTED sebelum ditambahkan ke marketplace.');
    }

    const { data: account, error: insertErr } = await supabaseClient
      .from('accounts')
      .insert({
        name: sellRequest.account_name,
        platform: sellRequest.platform,
        category_id: sellRequest.category_id,
        username: sellRequest.username,
        price: sellRequest.desired_price || 0,
        description: sellRequest.description,
        details: sellRequest.details,
        features: sellRequest.features,
        status: 'AVAILABLE',
        featured: false,
      })
      .select('*')
      .single();
    if (insertErr) throw insertErr;

    if (Array.isArray(sellRequest.photo_urls) && sellRequest.photo_urls.length > 0) {
      const imageRows = sellRequest.photo_urls.map((url, idx) => ({
        account_id: account.id,
        image_url: url,
        is_primary: idx === 0,
      }));
      const { error: imgErr } = await supabaseClient.from('account_images').insert(imageRows);
      if (imgErr) console.error('[convertSellRequestToAccount] gagal salin gambar:', imgErr.message);
    }

    return account;
  }

  document.querySelectorAll('[data-sell-requests-filter] .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-sell-requests-filter] .tab-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentSellRequestsFilter = btn.dataset.status;
      loadSellRequestsTable();
    });
  });

  // ══════════════════════════════════════════════════════════
  // TRANSAKSI
  // ══════════════════════════════════════════════════════════

  let currentTransactionsFilter = '';

  async function loadTransactionsTable() {
    const tbody = document.querySelector('[data-transactions-table]');
    tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Memuat...</td></tr>`;
    try {
      let query = supabaseClient
        .from('transactions')
        .select('*, accounts(name, account_code, platform)')
        .order('created_at', { ascending: false });
      if (currentTransactionsFilter) query = query.eq('status', currentTransactionsFilter);
      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Tidak ada transaksi.</td></tr>`;
        return;
      }

      tbody.innerHTML = data
        .map(
          (tx) => `
        <tr>
          <td>${ARRZ.escapeAttr(tx.accounts?.name || '-')}</td>
          <td>${ARRZ.escapeAttr(tx.buyer_name)}</td>
          <td class="mono">${ARRZ.escapeAttr(tx.buyer_whatsapp)}</td>
          <td class="mono">${ARRZ.formatRupiah(tx.price)}</td>
          <td>
            <select data-tx-status-select="${tx.id}" style="padding:6px 8px; font-size:0.82rem;">
              <option value="PENDING" ${tx.status === 'PENDING' ? 'selected' : ''}>Pending</option>
              <option value="PROCESSING" ${tx.status === 'PROCESSING' ? 'selected' : ''}>Diproses</option>
              <option value="COMPLETED" ${tx.status === 'COMPLETED' ? 'selected' : ''}>Selesai</option>
              <option value="CANCELLED" ${tx.status === 'CANCELLED' ? 'selected' : ''}>Dibatalkan</option>
            </select>
          </td>
          <td></td>
        </tr>`
        )
        .join('');

      // Catatan: saat status diubah ke COMPLETED, trigger database
      // (sync_account_on_transaction_complete, lihat supabase_migration.sql)
      // otomatis menandai account terkait sebagai SOLD — tidak perlu lagi
      // dua langkah manual seperti di server Express dulu.
      tbody.querySelectorAll('[data-tx-status-select]').forEach((select) => {
        select.addEventListener('change', async () => {
          try {
            const { error } = await supabaseClient
              .from('transactions')
              .update({ status: select.value })
              .eq('id', select.dataset.txStatusSelect);
            if (error) throw error;
            ARRZ.toast('Status transaksi diperbarui.', 'success');
            if (select.value === 'COMPLETED') loadAccountsTable();
            loadDashboard();
          } catch (e) {
            ARRZ.toast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="admin-empty">Data belum dapat dimuat. Silakan coba lagi.</td></tr>`;
    }
  }

  document.querySelectorAll('[data-transactions-filter] .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-transactions-filter] .tab-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentTransactionsFilter = btn.dataset.status;
      loadTransactionsTable();
    });
  });

  // ══════════════════════════════════════════════════════════
  // KATEGORI
  // ══════════════════════════════════════════════════════════

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  async function loadCategoriesTable() {
    const tbody = document.querySelector('[data-categories-table]');
    tbody.innerHTML = `<tr><td colspan="3" class="admin-empty">Memuat...</td></tr>`;
    try {
      const { data, error } = await supabaseClient.from('categories').select('*').order('name', { ascending: true });
      if (error) throw error;
      categoriesCache = data || [];

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="admin-empty">Belum ada kategori.</td></tr>`;
        return;
      }

      tbody.innerHTML = data
        .map(
          (cat) => `
        <tr>
          <td>${ARRZ.escapeAttr(cat.name)}</td>
          <td class="mono">${ARRZ.escapeAttr(cat.slug)}</td>
          <td class="admin-table__actions">
            <button class="btn btn-sm" style="background:var(--danger-soft); color:var(--danger);" data-delete-category="${cat.id}">Hapus</button>
          </td>
        </tr>`
        )
        .join('');

      tbody.querySelectorAll('[data-delete-category]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Hapus kategori ini?')) return;
          try {
            const { error } = await supabaseClient.from('categories').delete().eq('id', btn.dataset.deleteCategory);
            if (error) throw error;
            ARRZ.toast('Kategori dihapus.', 'success');
            loadCategoriesTable();
          } catch (e) {
            ARRZ.toast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="3" class="admin-empty">Data belum dapat dimuat. Silakan coba lagi.</td></tr>`;
    }
  }

  document.querySelector('[data-add-category-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const cleanName = form.name.value.trim();
      const { error } = await supabaseClient.from('categories').insert({ name: cleanName, slug: slugify(cleanName) });
      if (error) {
        if (error.code === '23505') throw new Error('Kategori dengan nama tersebut sudah ada.');
        throw error;
      }
      ARRZ.toast('Kategori ditambahkan.', 'success');
      form.reset();
      loadCategoriesTable();
    } catch (e) {
      ARRZ.toast(e.message, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════════════════
  // PENGATURAN
  // ══════════════════════════════════════════════════════════

  async function loadSettingsForm() {
    const form = document.querySelector('[data-settings-form]');
    try {
      const { data, error } = await supabaseClient.from('site_settings').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      form.site_name.value = data?.site_name || '';
      form.admin_whatsapp.value = data?.admin_whatsapp || '';
      form.footer_text.value = data?.footer_text || '';
      form.wa_template_buy.value = data?.wa_template_buy || '';
      form.wa_template_offer.value = data?.wa_template_offer || '';
      form.wa_template_sell.value = data?.wa_template_sell || '';
    } catch (e) {
      ARRZ.toast(e.message, 'error');
    }
  }

  document.querySelector('[data-settings-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';
    try {
      const { error } = await supabaseClient
        .from('site_settings')
        .update({
          site_name: form.site_name.value.trim(),
          admin_whatsapp: form.admin_whatsapp.value.trim(),
          footer_text: form.footer_text.value.trim(),
          wa_template_buy: form.wa_template_buy.value,
          wa_template_offer: form.wa_template_offer.value,
          wa_template_sell: form.wa_template_sell.value,
        })
        .eq('id', 1);
      if (error) throw error;
      ARRZ.toast('Pengaturan disimpan.', 'success');
    } catch (e) {
      ARRZ.toast(e.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Simpan Pengaturan';
    }
  });

  // ══════════════════════════════════════════════════════════
  // Realtime notifikasi (dulu Socket.IO admin-room)
  // ══════════════════════════════════════════════════════════

  function initRealtime() {
    const activeTab = () => document.querySelector('[data-tab-btn].is-active')?.dataset.tabBtn;

    const channel = supabaseClient
      .channel('arrz-market-admin')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'offers' }, () => {
        ARRZ.toast('Tawaran baru masuk!', 'info');
        loadDashboard();
        if (activeTab() === 'offers') loadOffersTable();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'offers' }, () => {
        if (activeTab() === 'offers') loadOffersTable();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sell_requests' }, () => {
        ARRZ.toast('Pengajuan jual akun baru masuk!', 'info');
        loadDashboard();
        if (activeTab() === 'sell-requests') loadSellRequestsTable();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sell_requests' }, () => {
        if (activeTab() === 'sell-requests') loadSellRequestsTable();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, () => {
        ARRZ.toast('Ada permintaan pembelian baru!', 'info');
        loadDashboard();
        if (activeTab() === 'transactions') loadTransactionsTable();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, () => {
        if (activeTab() === 'transactions') loadTransactionsTable();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => {
        if (activeTab() === 'accounts') loadAccountsTable();
        if (activeTab() === 'dashboard') loadDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
        if (activeTab() === 'categories') loadCategoriesTable();
      })
      .subscribe();

    window.addEventListener('beforeunload', () => {
      supabaseClient.removeChannel(channel);
    });
  }

  // ── Init ─────────────────────────────────────────────────────
  (async function init() {
    const ok = await checkAuth();
    if (!ok) return;
    switchTab('dashboard');
    initRealtime();
  })();
})();
