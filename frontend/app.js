(function () {
  const API_BASE = window.SOMO_API_BASE || (window.location.origin + '/api');
  const TOKEN_KEY = 'somo_token';
  const USER_KEY = 'somo_user';

  const SURCHARGE_OPTIONS = [
    { id: 'rush', label: 'Same-day rush', amount: 15 },
    { id: 'fragile', label: 'Fragile handling', amount: 10 },
    { id: 'afterhours', label: 'After-hours (past 8pm)', amount: 12 },
  ];
  const STATUS_OPTIONS = ['Requested', 'Requires approval', 'Approved', 'Assigned', 'Delivered'];
  const STATUS_CLASS = {
    Requested: 'b-requested',
    'Requires approval': 'b-approval',
    Approved: 'b-assigned',
    Assigned: 'b-assigned',
    Delivered: 'b-delivered',
  };

  let session = null; // { token, user: { username, role, companyName, phone } }
  let params = { base: 10, rate: 6, minFare: 25, minPct: 85, opsPhone: '' };
  let selectedSurcharges = new Set();
  let mapsKey = null;
  let mapsReady = false;
  let newAccountRole = 'merchant';
  let otherKeys = [];

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => 'GHS ' + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isAdmin = () => session && session.user.role === 'admin';
  const isOpsOrAdmin = () => session && (session.user.role === 'admin' || session.user.role === 'ops');

  function toast(msg) {
    const t = $('somo-toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2400);
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // ---------- API helper ----------
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
    const res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function saveSession(token, user) {
    session = { token, user };
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function loadSessionFromStorage() {
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    if (token && userRaw) {
      try { session = { token, user: JSON.parse(userRaw) }; return true; } catch (e) {}
    }
    return false;
  }
  function clearSession() {
    session = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  // ---------- phone / message helpers ----------
  function normalizePhone(raw) {
    if (!raw) return '';
    let digits = String(raw).replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    if (digits.startsWith('0')) digits = '233' + digits.slice(1); // Ghana default country code
    return digits;
  }
  function waLink(phone, message) {
    const p = normalizePhone(phone);
    if (!p) return null;
    return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
  }
  function smsLink(phone, message) {
    const p = normalizePhone(phone);
    if (!p) return null;
    return `sms:+${p}?body=${encodeURIComponent(message)}`;
  }
  function shortId(id) {
    const parts = (id || '').split('_');
    return (parts[1] || id || '').slice(-5);
  }

  // ---------- boot / auth ----------
  async function boot() {
    if (loadSessionFromStorage()) {
      try {
        await api('/auth/me'); // validates token is still good
        $('auth-overlay').classList.remove('show');
        afterLogin();
        return;
      } catch (e) {
        clearSession();
      }
    }
    try {
      const status = await api('/auth/bootstrap-status');
      if (!status.hasAccounts) {
        $('auth-setup-pane').style.display = 'block';
        $('auth-login-pane').style.display = 'none';
      } else {
        $('auth-setup-pane').style.display = 'none';
        $('auth-login-pane').style.display = 'block';
      }
    } catch (e) {
      toast('Could not reach the server — check that the backend is running.');
    }
    $('auth-overlay').classList.add('show');
  }

  $('setup-submit').addEventListener('click', async () => {
    const username = $('setup-username').value.trim();
    const phone = $('setup-phone').value.trim();
    const pw = $('setup-password').value;
    const pw2 = $('setup-password2').value;
    const err = $('setup-error');
    err.classList.remove('show');
    if (!username || !pw) { err.textContent = 'Enter a username and password.'; err.classList.add('show'); return; }
    if (!phone) { err.textContent = 'Phone number is required for admin accounts.'; err.classList.add('show'); return; }
    if (pw !== pw2) { err.textContent = 'Passwords do not match.'; err.classList.add('show'); return; }
    try {
      const data = await api('/auth/setup', { method: 'POST', body: { username, phone, password: pw } });
      saveSession(data.token, data.user);
      $('auth-overlay').classList.remove('show');
      toast('Admin account created');
      afterLogin();
    } catch (e) {
      err.textContent = e.message; err.classList.add('show');
    }
  });

  $('login-submit').addEventListener('click', async () => {
    const username = $('login-username').value.trim();
    const pw = $('login-password').value;
    const err = $('login-error');
    err.classList.remove('show');
    if (!username || !pw) { err.textContent = 'Enter your username and password.'; err.classList.add('show'); return; }
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username, password: pw } });
      saveSession(data.token, data.user);
      $('auth-overlay').classList.remove('show');
      toast('Welcome back, ' + data.user.companyName);
      afterLogin();
    } catch (e) {
      err.textContent = e.message; err.classList.add('show');
    }
  });

  $('somo-logout-btn').addEventListener('click', () => {
    clearSession();
    $('login-username').value = ''; $('login-password').value = '';
    $('auth-setup-pane').style.display = 'none';
    $('auth-login-pane').style.display = 'block';
    $('auth-overlay').classList.add('show');
    $('somo-merchant-badge').style.display = 'none';
  });

  function afterLogin() {
    $('somo-merchant-badge').style.display = 'flex';
    $('somo-merchant-name').textContent = session.user.companyName;
    const tag = $('somo-role-tag');
    tag.textContent = session.user.role;
    tag.className = 'somo-role-tag ' + session.user.role;
    if (session.user.role === 'merchant') $('f-customer').value = session.user.companyName;
    applyRoleToTabs();
    document.querySelector('.somo-tab[data-pane="new"]').click();
    loadParams();
  }

  // ---------- surcharge checkboxes ----------
  function renderSurcharges() {
    const wrap = $('f-surcharges');
    wrap.innerHTML = '';
    SURCHARGE_OPTIONS.forEach((opt) => {
      const label = document.createElement('label');
      label.className = 'somo-check';
      label.innerHTML = `<input type="checkbox" value="${opt.id}"> ${opt.label} (+GHS ${opt.amount})`;
      const input = label.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) { selectedSurcharges.add(opt.id); label.classList.add('checked'); }
        else { selectedSurcharges.delete(opt.id); label.classList.remove('checked'); }
        recalcPrice();
      });
      wrap.appendChild(label);
    });
  }

  // ---------- price preview (server recalculates authoritatively on submit) ----------
  function recalcPrice() {
    const distance = parseFloat($('f-distance').value) || 0;
    const distCap = Math.min(distance, 20);
    $('route-fill').style.width = (distCap / 20 * 100) + '%';
    $('route-dist').textContent = distance.toFixed(1) + ' km';
    const base = params.base + params.rate * distance;
    const surchargeTotal = [...selectedSurcharges].reduce((sum, id) => {
      const opt = SURCHARGE_OPTIONS.find((o) => o.id === id);
      return sum + (opt ? opt.amount : 0);
    }, 0);
    const recommended = Math.max(params.minFare, base) + surchargeTotal;
    const minimum = recommended * (params.minPct / 100);
    $('p-recommended').textContent = fmt(recommended);
    $('p-minimum').textContent = fmt(minimum);
    $('p-breakdown').textContent = `GHS ${params.base} + ${params.rate}/km × ${distance.toFixed(1)}km`;
    if (!$('f-agreed').value) $('f-agreed').value = recommended.toFixed(2);
    checkApproval();
  }
  function checkApproval() {
    const recommended = parseFloat($('p-recommended').textContent.replace('GHS', '').replace(/,/g, '')) || 0;
    const minimum = parseFloat($('p-minimum').textContent.replace('GHS', '').replace(/,/g, '')) || 0;
    const agreed = parseFloat($('f-agreed').value) || 0;
    $('approval-flag').classList.toggle('show', agreed > 0 && agreed < minimum);
  }
  $('f-distance').addEventListener('input', recalcPrice);
  $('f-agreed').addEventListener('input', checkApproval);
  $('f-type').addEventListener('change', recalcPrice);

  // ---------- tabs ----------
  function applyRoleToTabs() {
    $('tab-riders').style.display = isOpsOrAdmin() ? '' : 'none';
    $('tab-pricing').style.display = isAdmin() ? '' : 'none';
    $('tab-accounts').style.display = isAdmin() ? '' : 'none';
    $('tab-settings').style.display = isAdmin() ? '' : 'none';
    $('log-title').textContent = isOpsOrAdmin() ? 'All deliveries' : 'My delivery log';
    $('log-scope-note').textContent = isOpsOrAdmin() ? (session.user.role + ' view — every merchant') : 'visible only to you';
  }
  document.querySelectorAll('.somo-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (!session) return;
      if (tab.dataset.pane === 'riders' && !isOpsOrAdmin()) return;
      if (['pricing', 'accounts', 'settings'].includes(tab.dataset.pane) && !isAdmin()) return;
      document.querySelectorAll('.somo-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.somo-pane').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('pane-' + tab.dataset.pane).classList.add('active');
      if (tab.dataset.pane === 'log') loadLog();
      if (tab.dataset.pane === 'riders') loadRiders();
      if (tab.dataset.pane === 'accounts') loadAccounts();
      if (tab.dataset.pane === 'settings') loadAppSettingsIntoForm();
      if (tab.dataset.pane === 'pricing') loadParams();
    });
  });

  // ---------- Google Maps integration ----------
  function disableMapsFeatures() {
    mapsReady = false;
    $('btn-calc-distance').disabled = true;
    $('maps-hint').style.display = 'block';
  }
  function loadGoogleMaps(key) {
    if (document.getElementById('somo-gmaps-script')) return;
    window.initSomoMaps = function () {
      mapsReady = true;
      $('btn-calc-distance').disabled = false;
      $('maps-hint').style.display = 'none';
      try {
        new google.maps.places.Autocomplete($('f-pickup'), { componentRestrictions: { country: 'gh' } });
        new google.maps.places.Autocomplete($('f-dropoff'), { componentRestrictions: { country: 'gh' } });
      } catch (e) {}
      toast('Google Maps connected');
    };
    const script = document.createElement('script');
    script.id = 'somo-gmaps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=initSomoMaps`;
    script.async = true;
    script.onerror = () => toast('Could not load Google Maps — check the API key in Settings');
    document.head.appendChild(script);
  }
  $('btn-calc-distance').addEventListener('click', () => {
    if (!mapsReady) { toast('Google Maps is not ready yet'); return; }
    const pickup = $('f-pickup').value.trim();
    const dropoff = $('f-dropoff').value.trim();
    if (!pickup || !dropoff) { toast('Enter both pickup and drop-off first'); return; }
    const service = new google.maps.DistanceMatrixService();
    const btn = $('btn-calc-distance');
    btn.disabled = true; btn.textContent = 'Calculating…';
    service.getDistanceMatrix({
      origins: [pickup], destinations: [dropoff],
      travelMode: google.maps.TravelMode.DRIVING, unitSystem: google.maps.UnitSystem.METRIC,
    }, (response, status) => {
      btn.disabled = false; btn.textContent = 'Get from Maps';
      if (status === 'OK' && response.rows[0] && response.rows[0].elements[0] && response.rows[0].elements[0].status === 'OK') {
        const km = response.rows[0].elements[0].distance.value / 1000;
        $('f-distance').value = km.toFixed(1);
        recalcPrice();
        toast('Distance filled from Google Maps');
      } else {
        toast('Could not calculate that route — enter distance manually');
      }
    });
  });

  // ---------- pricing params ----------
  async function loadParams() {
    try {
      const data = await api('/pricing');
      params = data.params;
    } catch (e) { /* keep defaults */ }
    if ($('pp-base')) {
      $('pp-base').value = params.base; $('pp-rate').value = params.rate;
      $('pp-minfare').value = params.minFare; $('pp-minpct').value = params.minPct;
      $('pp-opsphone').value = params.opsPhone || '';
    }
    recalcPrice();
  }
  const savePricingBtn = $('save-pricing');
  if (savePricingBtn) savePricingBtn.addEventListener('click', async () => {
    const body = {
      base: parseFloat($('pp-base').value) || 0, rate: parseFloat($('pp-rate').value) || 0,
      minFare: parseFloat($('pp-minfare').value) || 0, minPct: parseFloat($('pp-minpct').value) || 0,
      opsPhone: $('pp-opsphone').value.trim(),
    };
    try {
      const data = await api('/pricing', { method: 'POST', body });
      params = data.params;
      toast('Pricing parameters saved for all merchants');
      recalcPrice();
    } catch (e) { toast(e.message); }
  });

  // ---------- riders ----------
  async function loadRiders() {
    const wrap = $('riders-content');
    wrap.innerHTML = '<div class="somo-loading">Loading riders…</div>';
    try {
      const data = await api('/riders');
      renderRiders(data.riders);
    } catch (e) { wrap.innerHTML = '<div class="somo-empty"><div class="big">Couldn\'t load riders</div></div>'; }
  }
  function renderRiders(riders) {
    const wrap = $('riders-content');
    if (riders.length === 0) {
      wrap.innerHTML = '<div class="somo-empty"><div class="big">No riders added yet</div>Add your internal fleet above to start assigning deliveries.</div>';
      return;
    }
    const cards = riders.map((r) => `
      <div class="somo-rider-card">
        <div>
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="phone">${escapeHtml(r.phone)}</div>
          <div class="phone">${escapeHtml(r.model || '—')} · ${escapeHtml(r.regNumber || '—')}</div>
        </div>
        <select class="somo-status-select" data-rider="${r.id}">
          <option value="Available" ${r.status === 'Available' ? 'selected' : ''}>Available</option>
          <option value="On delivery" ${r.status === 'On delivery' ? 'selected' : ''}>On delivery</option>
          <option value="Offline" ${r.status === 'Offline' ? 'selected' : ''}>Offline</option>
        </select>
      </div>`).join('');
    wrap.innerHTML = `<div class="somo-riders-grid">${cards}</div>`;
    wrap.querySelectorAll('select[data-rider]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api('/riders/' + sel.dataset.rider, { method: 'PATCH', body: { status: sel.value } });
          toast('Rider status updated');
        } catch (e) { toast(e.message); }
      });
    });
  }
  $('add-rider').addEventListener('click', async () => {
    const name = $('rider-name').value.trim();
    const phone = $('rider-phone').value.trim();
    const regNumber = $('rider-reg').value.trim();
    const model = $('rider-model').value.trim();
    if (!name) { toast('Enter a rider name'); return; }
    if (!phone) { toast('Phone number is required for riders'); return; }
    if (!regNumber) { toast('Motorbike registration number is required'); return; }
    if (!model) { toast('Motorbike model is required'); return; }
    try {
      await api('/riders', { method: 'POST', body: { name, phone, regNumber, model } });
      $('rider-name').value = ''; $('rider-phone').value = ''; $('rider-reg').value = ''; $('rider-model').value = '';
      toast('Rider added');
      loadRiders();
    } catch (e) { toast(e.message); }
  });

  // ---------- accounts ----------
  document.querySelectorAll('.somo-role-opt[data-newrole]').forEach((opt) => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.somo-role-opt[data-newrole]').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      newAccountRole = opt.dataset.newrole;
      $('new-company-field').style.display = newAccountRole === 'merchant' ? 'block' : 'none';
    });
  });
  $('create-account').addEventListener('click', async () => {
    const username = $('new-username').value.trim();
    const phone = $('new-phone').value.trim();
    const password = $('new-password').value;
    const company = $('new-company').value.trim();
    if (!username) { toast('Enter a username'); return; }
    if (!phone) { toast('Phone number is required'); return; }
    if (newAccountRole === 'merchant' && !company) { toast('Enter the merchant/company name'); return; }
    try {
      const data = await api('/accounts', { method: 'POST', body: { username, phone, password, role: newAccountRole, companyName: company } });
      $('new-username').value = ''; $('new-password').value = ''; $('new-company').value = ''; $('new-phone').value = '';
      showReveal('Account created', `${data.account.username} / ${data.password}`);
      loadAccounts();
    } catch (e) { toast(e.message); }
  });
  function showReveal(title, value) {
    $('reveal-title').textContent = title;
    $('reveal-value').textContent = value;
    $('reveal-modal').classList.add('show');
  }
  $('reveal-close').addEventListener('click', () => $('reveal-modal').classList.remove('show'));

  async function loadAccounts() {
    const wrap = $('accounts-content');
    wrap.innerHTML = '<div class="somo-loading">Loading accounts…</div>';
    try {
      const data = await api('/accounts');
      renderAccounts(data.accounts);
    } catch (e) { wrap.innerHTML = '<div class="somo-empty"><div class="big">Couldn\'t load accounts</div></div>'; }
  }
  function renderAccounts(accounts) {
    const wrap = $('accounts-content');
    if (accounts.length === 0) { wrap.innerHTML = '<div class="somo-empty"><div class="big">No accounts yet</div></div>'; return; }
    wrap.innerHTML = accounts.map((a) => `
      <div class="somo-account-card" style="margin-bottom:10px;">
        <div>
          <div class="name">${escapeHtml(a.companyName || a.username)} <span class="somo-role-tag ${a.role}" style="margin-left:6px;">${a.role}</span></div>
          <div class="sub">@${escapeHtml(a.username)} · ${escapeHtml(a.phone || 'no phone on file')} · ${a.active === false ? 'inactive' : 'active'}</div>
        </div>
        <div class="right">
          <button class="somo-mini-btn" data-reset="${a.username}">Reset password</button>
          <button class="somo-mini-btn" data-toggle="${a.username}">${a.active === false ? 'Reactivate' : 'Deactivate'}</button>
        </div>
      </div>`).join('');
    wrap.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const data = await api('/accounts/' + btn.dataset.reset, { method: 'PATCH', body: { resetPassword: true } });
          showReveal('Password reset', `${data.account.username} / ${data.password}`);
        } catch (e) { toast(e.message); }
      });
    });
    wrap.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const wantActive = btn.textContent.trim() === 'Reactivate';
        try {
          await api('/accounts/' + btn.dataset.toggle, { method: 'PATCH', body: { active: wantActive } });
          toast(wantActive ? 'Account reactivated' : 'Account deactivated');
          loadAccounts();
        } catch (e) { toast(e.message); }
      });
    });
  }

  // ---------- app settings (logo + API keys) ----------
  function applyLogo(dataUrlOrEmpty) {
    [$('brand-mark-header'), $('brand-mark-auth')].forEach((el) => {
      if (!el) return;
      el.innerHTML = dataUrlOrEmpty
        ? `<img src="${dataUrlOrEmpty}" style="width:100%; height:100%; object-fit:cover; border-radius:9px;">`
        : 'SX';
    });
    const preview = $('logo-preview');
    if (preview) preview.innerHTML = dataUrlOrEmpty ? `<img src="${dataUrlOrEmpty}" style="width:100%; height:100%; object-fit:cover;">` : 'SX';
  }
  function renderOtherKeys() {
    const wrap = $('other-keys-list');
    if (!wrap) return;
    wrap.innerHTML = otherKeys.map((k, i) => `
      <div class="somo-row2" style="margin-bottom:10px;">
        <input class="somo-input" placeholder="Key name (e.g. Africa's Talking username)" value="${escapeHtml(k.name)}" data-otherkey-name="${i}">
        <div style="display:flex; gap:8px;">
          <input class="somo-input" placeholder="Key value" type="password" value="${escapeHtml(k.value)}" data-otherkey-value="${i}" style="flex:1;">
          <button class="somo-mini-btn" data-otherkey-remove="${i}">✕</button>
        </div>
      </div>`).join('');
    wrap.querySelectorAll('[data-otherkey-name]').forEach((inp) => inp.addEventListener('input', () => { otherKeys[+inp.dataset.otherkeyName].name = inp.value; }));
    wrap.querySelectorAll('[data-otherkey-value]').forEach((inp) => inp.addEventListener('input', () => { otherKeys[+inp.dataset.otherkeyValue].value = inp.value; }));
    wrap.querySelectorAll('[data-otherkey-remove]').forEach((btn) => btn.addEventListener('click', () => {
      otherKeys.splice(+btn.dataset.otherkeyRemove, 1);
      renderOtherKeys();
    }));
  }
  const addOtherKeyBtn = $('add-other-key');
  if (addOtherKeyBtn) addOtherKeyBtn.addEventListener('click', () => { otherKeys.push({ name: '', value: '' }); renderOtherKeys(); });

  async function loadAppSettingsIntoForm() {
    try {
      const data = await api('/settings');
      const s = data.settings;
      if ($('set-maps-key')) $('set-maps-key').value = s.mapsApiKey || '';
      if ($('set-whatsapp-key')) $('set-whatsapp-key').value = s.whatsappOtpKey || '';
      if ($('set-sms-key')) $('set-sms-key').value = s.smsApiKey || '';
      otherKeys = Array.isArray(s.otherKeys) ? s.otherKeys.slice() : [];
      renderOtherKeys();
      applyLogo(s.logoDataUrl || '');
    } catch (e) { toast(e.message); }
  }
  const saveApiKeysBtn = $('save-api-keys');
  if (saveApiKeysBtn) saveApiKeysBtn.addEventListener('click', async () => {
    const mapsApiKey = $('set-maps-key').value.trim();
    const whatsappOtpKey = $('set-whatsapp-key').value.trim();
    const smsApiKey = $('set-sms-key').value.trim();
    const cleanOtherKeys = otherKeys.filter((k) => k.name.trim() || k.value.trim());
    try {
      await api('/settings', { method: 'POST', body: { mapsApiKey, whatsappOtpKey, smsApiKey, otherKeys: cleanOtherKeys } });
      toast('API keys saved for the whole portal');
      if (mapsApiKey && mapsApiKey !== mapsKey) { mapsKey = mapsApiKey; loadGoogleMaps(mapsKey); }
      else if (!mapsApiKey) { mapsKey = null; disableMapsFeatures(); }
    } catch (e) { toast(e.message); }
  });
  const saveLogoBtn = $('save-logo');
  if (saveLogoBtn) saveLogoBtn.addEventListener('click', async () => {
    const fileInput = $('logo-file');
    const file = fileInput.files && fileInput.files[0];
    if (!file) { toast('Choose an image file first'); return; }
    if (file.size > 900 * 1024) { toast('Please use a smaller image (under ~900KB)'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      try {
        await api('/settings', { method: 'POST', body: { logoDataUrl: dataUrl } });
        applyLogo(dataUrl);
        toast('Logo saved for the whole portal');
      } catch (e) { toast(e.message); }
    };
    reader.readAsDataURL(file);
  });
  const removeLogoBtn = $('remove-logo');
  if (removeLogoBtn) removeLogoBtn.addEventListener('click', async () => {
    try {
      await api('/settings', { method: 'POST', body: { logoDataUrl: '' } });
      applyLogo('');
      $('logo-file').value = '';
      toast('Logo removed');
    } catch (e) { toast(e.message); }
  });

  // ---------- notification triggers (WhatsApp / SMS deep links) ----------
  function notifyContactHtml(who, phone, message) {
    if (!phone) {
      return `<div class="somo-notify-contact"><div class="who">${escapeHtml(who)}</div><div class="unavailable">No phone number on file — nothing to send.</div></div>`;
    }
    const wa = waLink(phone, message);
    const sms = smsLink(phone, message);
    return `
      <div class="somo-notify-contact">
        <div class="who">${escapeHtml(who)}</div>
        <div class="num">${escapeHtml(phone)}</div>
        <div class="btns">
          <a class="wa" href="${wa}" target="_blank" rel="noopener">Open WhatsApp</a>
          <a class="sms" href="${sms}">Open SMS</a>
        </div>
      </div>`;
  }
  function openNotifyModal(record) {
    const wrap = $('notify-content');
    const sid = shortId(record.id);
    const hasRider = !!record.riderId;

    const opsMessage = hasRider
      ? `SomoExpress order #${sid} assigned. Rider: ${record.riderName} (${record.riderPhone}). Customer: ${record.customer}. Route: ${record.pickup} -> ${record.dropoff}.`
      : `New SomoExpress delivery request #${sid}: ${record.customer} — ${record.pickup} -> ${record.dropoff} (${record.distance.toFixed(1)}km). Declared value GHS ${record.declaredValue}. Recommended GHS ${record.recommended.toFixed(2)}, agreed GHS ${record.agreed.toFixed(2)}. Please assign a rider.`;
    const riderMessage = `New SomoExpress delivery assigned to you. Order #${sid}. Pickup: ${record.pickup}. Drop-off: ${record.dropoff}. Customer: ${record.customer}. Declared value: GHS ${record.declaredValue}. Type: ${record.type}. Please confirm pickup.`;
    const merchantMessage = `Your SomoExpress delivery (order #${sid}) has been assigned to rider ${record.riderName}, phone ${record.riderPhone}, riding a ${record.riderModel || 'motorbike'} (reg. ${record.riderReg || 'n/a'}). Pickup location: ${record.pickup}. Drop-off: ${record.dropoff}.`;

    let html = notifyContactHtml('Ops team', params.opsPhone, opsMessage);
    if (hasRider) {
      html += notifyContactHtml('Rider — ' + record.riderName, record.riderPhone, riderMessage);
      html += notifyContactHtml('Merchant — ' + record.customer, record.merchantPhone, merchantMessage);
    } else {
      html += `<div class="somo-notify-contact"><div class="who">Rider &amp; merchant</div><div class="unavailable">Assign a rider to this order to notify the rider and the merchant.</div></div>`;
    }
    wrap.innerHTML = html;
    $('notify-modal').classList.add('show');
  }
  $('notify-close').addEventListener('click', () => $('notify-modal').classList.remove('show'));

  // ---------- submit delivery request ----------
  $('submit-request').addEventListener('click', async () => {
    const pickup = $('f-pickup').value.trim();
    const dropoff = $('f-dropoff').value.trim();
    const distance = parseFloat($('f-distance').value) || 0;
    const customer = $('f-customer').value.trim() || (session ? session.user.companyName : 'Unknown');
    const type = $('f-type').value;
    const agreed = parseFloat($('f-agreed').value) || 0;
    const declaredValue = parseFloat($('f-value').value) || 0;
    if (!pickup || !dropoff || !distance) { toast('Add pickup, drop-off and distance first'); return; }
    if (!$('f-value').value || declaredValue <= 0) { toast('Declared value of the item is required'); return; }

    const btn = $('submit-request');
    btn.disabled = true; btn.textContent = 'Logging…';
    try {
      const data = await api('/deliveries', {
        method: 'POST',
        body: { pickup, dropoff, distance, type, surcharges: [...selectedSurcharges], declaredValue, agreed, customer },
      });
      toast(data.delivery.status === 'Requires approval' ? 'Logged — flagged for approval' : 'Delivery request logged');
      $('f-pickup').value = ''; $('f-dropoff').value = ''; $('f-distance').value = ''; $('f-agreed').value = ''; $('f-value').value = '';
      selectedSurcharges.clear();
      document.querySelectorAll('.somo-check').forEach((c) => { c.classList.remove('checked'); c.querySelector('input').checked = false; });
      recalcPrice();
      openNotifyModal(data.delivery);
    } catch (e) { toast(e.message); }
    btn.disabled = false; btn.textContent = 'Log delivery request';
  });

  // ---------- delivery log ----------
  async function loadLog() {
    const wrap = $('log-content');
    wrap.innerHTML = '<div class="somo-loading">Loading log…</div>';
    try {
      const data = await api('/deliveries');
      let riders = [];
      if (isOpsOrAdmin()) {
        try { riders = (await api('/riders')).riders; } catch (e) {}
      }
      renderLog(data.deliveries, riders);
    } catch (e) { wrap.innerHTML = '<div class="somo-empty"><div class="big">Couldn\'t load the log</div>Try switching tabs again.</div>'; }
  }
  function renderLog(records, riders) {
    const wrap = $('log-content');
    if (records.length === 0) {
      wrap.innerHTML = '<div class="somo-empty"><div class="big">No deliveries logged yet</div>' +
        (isOpsOrAdmin() ? 'Nothing has been requested by any merchant yet.' : 'Requests you submit will show up here — visible only to you.') + '</div>';
      return;
    }
    const ridersOptions = riders.map((r) => `<option value="${r.id}" data-name="${escapeHtml(r.name)}" data-phone="${escapeHtml(r.phone || '')}" data-reg="${escapeHtml(r.regNumber || '')}" data-model="${escapeHtml(r.model || '')}">${escapeHtml(r.name)} — ${escapeHtml(r.regNumber || 'no reg')} (${r.status})</option>`).join('');

    let rows = records.map((r) => {
      const d = new Date(r.date);
      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const statusCell = isOpsOrAdmin()
        ? `<select class="somo-status-select" data-id="${r.id}" data-field="status">${STATUS_OPTIONS.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`
        : `<span class="somo-badge ${STATUS_CLASS[r.status] || 'b-requested'}">${r.status}</span>`;
      const riderCell = isOpsOrAdmin()
        ? `<select class="somo-status-select" data-id="${r.id}" data-field="rider"><option value="">Unassigned</option>${ridersOptions.replace(`value="${r.riderId}"`, `value="${r.riderId}" selected`)}</select>`
        : `${r.riderName ? `${escapeHtml(r.riderName)}<br><span style="color:var(--muted); font-family:var(--font-mono); font-size:11.5px;">${escapeHtml(r.riderPhone || '')} · ${escapeHtml(r.riderModel || '')} ${escapeHtml(r.riderReg || '')}</span>` : '<span style="color:var(--muted);">Not yet assigned</span>'}`;
      const notifyCell = isOpsOrAdmin() ? `<button class="somo-notify-btn" data-notify="${r.id}">🔔 Notify</button>` : '';
      return `
        <tr>
          <td style="color:var(--muted); white-space:nowrap;">${dateStr}</td>
          ${isOpsOrAdmin() ? `<td>${escapeHtml(r.customer)}</td>` : ''}
          <td>${escapeHtml(r.pickup)} → ${escapeHtml(r.dropoff)}</td>
          <td class="somo-price-cell">${r.distance.toFixed(1)} km</td>
          <td>${escapeHtml(r.type)}</td>
          <td class="somo-price-cell">GHS ${(r.declaredValue || 0).toFixed(0)}</td>
          <td class="somo-price-cell">${fmt(r.recommended)}</td>
          <td class="somo-price-cell" style="color:var(--amber);">${fmt(r.agreed)}</td>
          <td>${statusCell}</td>
          <td>${riderCell}</td>
          ${isOpsOrAdmin() ? `<td>${notifyCell}</td>` : ''}
        </tr>`;
    }).join('');
    wrap.innerHTML = `
      <div class="somo-table-wrap">
        <table class="somo-table">
          <thead><tr>
            <th>Date</th>${isOpsOrAdmin() ? '<th>Customer</th>' : ''}<th>Route</th><th>Distance</th><th>Type</th>
            <th>Value</th><th>Recommended</th><th>Agreed</th><th>Status</th><th>Rider</th>${isOpsOrAdmin() ? '<th>Alerts</th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    if (isOpsOrAdmin()) {
      const recordById = Object.fromEntries(records.map((r) => [r.id, r]));
      wrap.querySelectorAll('select[data-field="status"]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            await api('/deliveries/' + sel.dataset.id, { method: 'PATCH', body: { status: sel.value } });
            toast('Status updated');
          } catch (e) { toast(e.message); }
        });
      });
      wrap.querySelectorAll('select[data-field="rider"]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const riderId = sel.value;
          try {
            const data = await api('/deliveries/' + sel.dataset.id, { method: 'PATCH', body: { riderId } });
            toast(riderId ? `Assigned to ${data.delivery.riderName}` : 'Rider unassigned');
            loadLog();
            if (riderId) openNotifyModal(data.delivery);
          } catch (e) { toast(e.message); }
        });
      });
      wrap.querySelectorAll('[data-notify]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const rec = recordById[btn.dataset.notify];
          if (rec) openNotifyModal(rec);
        });
      });
    }
  }

  // ---------- init ----------
  renderSurcharges();
  disableMapsFeatures();
  loadPublicSettings();
  boot();

  async function loadPublicSettings() {
    try {
      const data = await api('/settings/public');
      applyLogo(data.logoDataUrl || '');
      if (data.mapsApiKey) { mapsKey = data.mapsApiKey; loadGoogleMaps(mapsKey); }
    } catch (e) { /* backend may not be reachable yet — boot() will surface that */ }
  }
})();
