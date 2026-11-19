const authView = document.querySelector('#auth-view');
const appView = document.querySelector('#app-view');
const bootScreen = document.querySelector('#boot-screen');
const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const verificationForm = document.querySelector('#verification-form');
const adminAccessForm = document.querySelector('#admin-access-form');
const authMessage = document.querySelector('#auth-message');
const accountNotice = document.querySelector('#account-notice');
const accountNoticeTitle = document.querySelector('#account-notice-title');
const accountNoticeReason = document.querySelector('#account-notice-reason');
const accountNoticeContact = document.querySelector('#account-notice-contact');
const accountNoticeWhatsapp = document.querySelector('#account-notice-whatsapp');
const accountNoticeBack = document.querySelector('#account-notice-back');
const ADMIN_WHATSAPP_URL = 'https://wa.me/6289688206739';
const ADMIN_TELEGRAM_URL = 'https://t.me/Wilykun1994';
const toast = document.querySelector('#toast');
let currentUser = null;
let verificationIdentifier = '';
let selectedMode = null;
let workerAutoStart = false;
let toastTimer;
let pairingPollTimer;
let pairingCountdownTimer;
let lastPairingStatus = null;
let pairingCooldownTimer;
let pairingCooldownUntil = 0;
let verificationCooldownTimer;
let verificationCooldownUntil = 0;
let logPollTimer;
let storySaveTimer;
let storySaveQueue = Promise.resolve();
let storySaveRevision = 0;

const APPEARANCE_STORAGE_KEY = 'readsw-console-theme';
const AUTH_MODE_STORAGE_KEY = 'readsw-console-auth-mode';
const LAST_PAGE_STORAGE_KEY = 'readsw-console-last-page';
function savedAuthMode() {
  try {
    return window.sessionStorage.getItem(AUTH_MODE_STORAGE_KEY) === 'register' ? 'register' : 'login';
  } catch {
    return 'login';
  }
}

function applyAppearanceTheme(theme, persist = false) {
  const selectedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selectedTheme;
  document.querySelectorAll('input[name="appearance-theme"]').forEach((input) => {
    input.checked = input.value === selectedTheme;
    input.closest('.theme-option')?.classList.toggle('is-selected', input.checked);
  });
  if (persist) {
    try { window.localStorage.setItem(APPEARANCE_STORAGE_KEY, selectedTheme); } catch { /* Theme still applies for this page load. */ }
  }
}
let savedAppearanceTheme = 'dark';
try { savedAppearanceTheme = window.localStorage.getItem(APPEARANCE_STORAGE_KEY) || 'dark'; } catch { /* Use the default dark theme if storage is unavailable. */ }
applyAppearanceTheme(savedAppearanceTheme);
document.addEventListener('change', (event) => {
  const themeInput = event.target.closest?.('input[name="appearance-theme"]');
  if (themeInput && ['dark', 'light'].includes(themeInput.value)) applyAppearanceTheme(themeInput.value, true);
});

// Menu hamburger: sidebar jadi panel dropdown (port dari preview v11).
const menuToggle = document.querySelector('#menu-toggle');
const sidebar = document.querySelector('#app-sidebar');

function setMenu(open) {
  if (!menuToggle || !sidebar) return;
  sidebar.classList.toggle('is-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
}

menuToggle?.addEventListener('click', () => {
  setMenu(!sidebar.classList.contains('is-open'));
});
document.addEventListener('click', (event) => {
  if (!sidebar?.classList.contains('is-open')) return;
  if (sidebar.contains(event.target) || menuToggle?.contains(event.target)) return;
  // Ketukan di atas overlay modal (misalnya tombol Tutup pada notifikasi menu
  // terkunci) bukan ketukan di luar menu: menunya harus tetap terbuka.
  if (event.target.closest?.('#emoji-notice-overlay, .confirm-overlay')) return;
  setMenu(false);
});
document.addEventListener('keydown', (event) => {
  // Escape saat overlay modal terbuka hanya menutup overlay itu, bukan menunya.
  if (event.key === 'Escape' && !document.querySelector('#emoji-notice-overlay:not(.hidden)') && !document.querySelector('.confirm-overlay')) setMenu(false);
});

const modeNames = {
  readonly: 'Read Only',
  readonly_readsw: 'Read Only + ReadSW',
  online24: 'Online 24 Jam',
};
const modeDescriptions = {
  readonly: 'Tandai story sebagai dilihat tanpa reaksi emoji otomatis.',
  readonly_readsw: 'Tandai story sebagai dilihat lalu kirim emoji pilihan dengan delay acak.',
  online24: 'Kirim presence available berkala selama host persisten aktif.',
};
const DEFAULT_STORY_SETTINGS = { autoReaction: true, delayMinSeconds: 1, delayMaxSeconds: 20, emojiPoolVersion: 2, emojiOptions: ['💚'], emojiPool: ['💚'] };

const motivationQuote = document.querySelector('#motivation-quote');
const motivationLines = [
  'Mulai dari satu langkah kecil; konsistensi membuatnya berarti.',
  'Pelan-pelan tetap maju. Yang penting, terus bergerak.',
  'Hal besar sering tumbuh dari kebiasaan sederhana.',
  'Rapikan rencana, jaga fokus, lalu lanjutkan dengan tenang.',
  'Kamu tidak harus sempurna untuk mulai berkembang.',
  'Hari ini kesempatan baru untuk mencoba lagi.',
];
let motivationTimer;
let lastMotivationIndex = -1;

function startMotivationQuote() {
  if (!motivationQuote || authView.classList.contains('hidden')) return;
  clearTimeout(motivationTimer);
  let nextIndex = Math.floor(Math.random() * motivationLines.length);
  if (motivationLines.length > 1 && nextIndex === lastMotivationIndex) {
    nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (motivationLines.length - 1))) % motivationLines.length;
  }
  lastMotivationIndex = nextIndex;
  const quote = motivationLines[nextIndex];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reducedMotion) {
    motivationQuote.textContent = quote;
    motivationTimer = setTimeout(startMotivationQuote, 7000);
    return;
  }
  let character = 0;
  motivationQuote.textContent = '';
  const typeNextCharacter = () => {
    if (authView.classList.contains('hidden')) return;
    character += 1;
    motivationQuote.textContent = quote.slice(0, character);
    if (character < quote.length) {
      motivationTimer = setTimeout(typeNextCharacter, 34);
    } else {
      motivationTimer = setTimeout(startMotivationQuote, 4700);
    }
  };
  typeNextCharacter();
}
startMotivationQuote();

for (const id of ['#story-delay-min', '#story-delay-max']) {
  const select = document.querySelector(id);
  for (let second = 1; second <= 20; second += 1) {
    const option = document.createElement('option');
    option.value = String(second);
    option.textContent = `${second} detik`;
    select.append(option);
  }
}

function renderEmojiPool(options, selectedPool) {
  const grid = document.querySelector('#story-emoji-grid');
  const selected = new Set(Array.isArray(selectedPool) ? selectedPool : []);
  grid.replaceChildren();
  const unique = [...new Set(Array.isArray(options) ? options : [])];
  if (!unique.length) {
    const empty = document.createElement('small');
    empty.className = 'emoji-empty';
    empty.textContent = 'Belum ada emoji. Tambahkan satu di bawah.';
    grid.append(empty);
    return;
  }
  for (const emoji of unique) {
    const item = document.createElement('div');
    item.className = 'emoji-item';
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'emoji-choice';
    choice.dataset.emoji = emoji;
    choice.textContent = emoji;
    choice.setAttribute('aria-pressed', String(selected.has(emoji)));
    choice.setAttribute('aria-label', `${emoji} ${selected.has(emoji) ? 'aktif' : 'nonaktif'}`);
    choice.classList.toggle('selected', selected.has(emoji));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'emoji-remove';
    remove.dataset.removeEmoji = emoji;
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Hapus emoji ${emoji} dari akun ini`);
    item.append(choice, remove);
    grid.append(item);
  }
}

function applyStorySettings(settings, mode = selectedMode) {
  const raw = settings || {};
  const legacyDefault = raw.emojiPoolVersion !== 2 && !Array.isArray(raw.emojiOptions)
    && Array.isArray(raw.emojiPool) && raw.emojiPool.length === 1 && raw.emojiPool[0] === '❤️';
  const values = { ...DEFAULT_STORY_SETTINGS, ...raw };
  if (legacyDefault) {
    values.emojiOptions = ['💚'];
    values.emojiPool = ['💚'];
    values.emojiPoolVersion = 2;
  }
  const min = Math.min(20, Math.max(1, Number(values.delayMinSeconds) || 1));
  const max = Math.min(20, Math.max(min, Number(values.delayMaxSeconds) || 20));
  document.querySelector('#story-delay-min').value = String(min);
  document.querySelector('#story-delay-max').value = String(max);
  const reaction = document.querySelector('#story-reaction-enabled');
  reaction.checked = mode === 'readonly_readsw' && (typeof values.autoReaction === 'boolean' ? values.autoReaction : true);
  reaction.disabled = false;
  const options = Array.isArray(values.emojiOptions) ? values.emojiOptions : values.emojiPool;
  renderEmojiPool(options, Array.isArray(values.emojiPool) ? values.emojiPool : DEFAULT_STORY_SETTINGS.emojiPool);
  syncStoryEmojiNotice();
}

function readStorySettings() {
  return {
    autoReaction: document.querySelector('#story-reaction-enabled').checked,
    delayMinSeconds: Number(document.querySelector('#story-delay-min').value),
    delayMaxSeconds: Number(document.querySelector('#story-delay-max').value),
    randomDelay: true,
    emojiPoolVersion: 2,
    emojiOptions: [...document.querySelectorAll('.emoji-choice')].map((button) => button.dataset.emoji),
    emojiPool: [...document.querySelectorAll('.emoji-choice.selected')].map((button) => button.dataset.emoji),
  };
}

// Notifikasi reaksi di layar (overlay di tengah layar, bukan notifikasi bawaan
// browser dan bukan kartu di bawah pengaturan): muncul saat mode Read Only +
// ReadSW tidak bisa mengirim reaksi sama sekali — tidak ada emoji dan reaksi
// otomatis mati, jadi bot hanya menandai story sebagai dibaca (ReadSW biasa).
// Sekali ditutup, notifikasi tidak muncul lagi sampai keadaannya hilang lalu
// Notifikasi di layar (overlay di tengah layar, bukan notifikasi bawaan browser
// dan bukan kartu di bawah pengaturan): satu komponen bersama untuk semua
// pemberitahuan yang harus terlihat — peringatan reaksi emoji dan pengingat
// tautan WhatsApp. Sekali ditutup, notifikasi tidak muncul lagi sampai
// keadaannya hilang lalu muncul kembali. Tombol aksi menutup notifikasi lalu
// menjalankan aksi konteksnya (mengarahkan ke kolom emoji, atau membuka
// halaman Pairing).
let emojiNoticeDismissed = false;
let noticeContext = null;
// Versi yang tawaran muat ulangnya sudah ditutup, supaya tawaran yang sama
// tidak muncul lagi tiap heartbeat sampai ada versi yang lebih baru.
let newVersionPrompted = null;
// Akun Kontrol Bot yang notifikasinya sudah ditutup selagi keadaannya masih
// aktif — ditutup per akun supaya admin tidak diganggu berulang kali.
const botControlEmojiNoticeDismissed = new Set();
function showNoticeOverlay({ title, text, context, addTarget, addLabel, onAdd, icon }) {
  const overlay = document.querySelector('#emoji-notice-overlay');
  if (!overlay) return;
  const nextContext = { ...(context || {}), addTarget: addTarget || null, onAdd: onAdd || null };
  // Notifikasi yang sama sudah tampil: jangan ambil alih fokus pengguna dengan
  // menampilkannya ulang (misalnya saat daftar Kontrol Bot diperbarui tiap 15 detik).
  if (!overlay.classList.contains('hidden')
    && noticeContext?.kind === nextContext.kind
    && noticeContext?.userId === nextContext.userId
    && noticeContext?.feature === nextContext.feature
    && noticeContext?.version === nextContext.version) return;
  document.querySelector('#emoji-notice-title').textContent = title;
  document.querySelector('#emoji-notice-text').textContent = text;
  const iconElement = overlay.querySelector('.notice-icon');
  if (iconElement) iconElement.textContent = icon || '!';
  const addButton = overlay.querySelector('[data-emoji-notice-add]');
  if (addButton) {
    // addLabel null berarti notifikasi ini tanpa tombol aksi (misalnya
    // pemberitahuan menu terkunci): sembunyikan tombol utamanya.
    addButton.classList.toggle('hidden', addLabel === null);
    if (addLabel !== null) addButton.textContent = addLabel || 'Tambah emoji';
  }
  noticeContext = nextContext;
  overlay.classList.remove('hidden');
  if (addLabel === null) overlay.querySelector('[data-emoji-notice-close]')?.focus();
  else addButton?.focus();
}
function hideNoticeOverlay() {
  document.querySelector('#emoji-notice-overlay')?.classList.add('hidden');
  noticeContext = null;
}
function dismissNoticeOverlay() {
  if (noticeContext?.kind === 'botcontrol' && noticeContext.userId) {
    botControlEmojiNoticeDismissed.add(noticeContext.userId);
  } else if (noticeContext?.kind === 'link') {
    botLinkNoticeDismissed = true;
  } else if (noticeContext?.kind === 'locked') {
    // Tanpa ingatan: notifikasi menu terkunci tampil lagi tiap kali menunya diketuk.
  } else if (noticeContext?.kind === 'rankovertake') {
    // Tanpa ingatan: tiap salip baru tampil lagi, dan menutup kartu ini
    // tidak boleh mematikan pengingat reaksi emoji (cabang else di bawah).
  } else if (noticeContext?.kind === 'rankclimb') {
    // Tanpa ingatan: tiap naik peringkat baru tampil lagi, dan menutup kartu
    // ini tidak boleh mematikan pengingat reaksi emoji (cabang else di bawah).
  } else if (noticeContext?.kind === 'accountactivitylogin') {
    // Tanpa ingatan: tiap login baru tampil lagi, dan menutup kartu ini
    // tidak boleh mematikan pengingat reaksi emoji (cabang else di bawah).
  } else if (noticeContext?.kind === 'version') {
    // Ingat versi yang sudah ditawarkan supaya tidak mengganggu tiap heartbeat.
    newVersionPrompted = noticeContext.version || null;
  } else {
    emojiNoticeDismissed = true;
  }
  hideNoticeOverlay();
}
function syncStoryEmojiNotice() {
  // Pengingat tautan lebih penting: member yang belum tertaut tidak bisa
  // menjalankan bot sama sekali, jadi notifikasi reaksinya menunggu sampai
  // WhatsApp tertaut.
  if (isBotLockedForMember()) return;
  const active = selectedMode === 'readonly_readsw'
    && document.querySelector('#story-reaction-enabled')?.checked !== true
    && document.querySelectorAll('.emoji-choice.selected').length === 0;
  if (!active) {
    emojiNoticeDismissed = false;
    if (noticeContext?.kind === 'self' || !noticeContext) hideNoticeOverlay();
    return;
  }
  if (emojiNoticeDismissed) return;
  showNoticeOverlay({
    title: 'Reaksi emoji tidak aktif',
    text: 'Tidak ada emoji dan reaksi otomatis mati — bot hanya menandai story sebagai dibaca, tanpa mengirim reaksi. Tambahkan emoji dan nyalakan reaksi otomatis bila mau ada reaksi.',
    context: { kind: 'self' },
    addTarget: document.querySelector('#story-emoji-input'),
  });
}

// Membuka kartu Kontrol Bot seorang member (dipakai tombol "Tambah emoji" di
// notifikasi supaya kolom emoji member itu terlihat dan bisa difokuskan).
function openBotControlCard(userId) {
  expandedBotControlUserId = userId;
  botControlUsersList.querySelectorAll('.member-account-item').forEach((item) => {
    const button = item.querySelector('[data-botcontrol-toggle]');
    const panel = item.querySelector('.member-account-details');
    const isOpen = Boolean(button && button.dataset.userId === userId);
    button?.setAttribute('aria-expanded', String(isOpen));
    button?.setAttribute('aria-label', `${isOpen ? 'Tutup' : 'Buka'} kontrol bot @${button?.dataset.username || ''}`);
    const label = button?.querySelector('.member-account-toggle-label');
    if (label) label.textContent = isOpen ? 'Tutup kontrol' : 'Kontrol bot';
    if (panel) panel.hidden = !isOpen;
    item.classList.toggle('is-open', isOpen);
  });
}

document.querySelector('#emoji-notice-overlay')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) dismissNoticeOverlay();
  const closeButton = event.target.closest('[data-emoji-notice-close]');
  if (closeButton) dismissNoticeOverlay();
  const addButton = event.target.closest('[data-emoji-notice-add]');
  if (addButton) {
    // Tangkap konteks dulu: dismissNoticeOverlay mengosongkan konteksnya.
    const target = noticeContext?.addTarget;
    const userId = noticeContext?.userId;
    const kind = noticeContext?.kind;
    const onAdd = noticeContext?.onAdd;
    dismissNoticeOverlay();
    if (typeof onAdd === 'function') { onAdd(); return; }
    if (kind === 'botcontrol' && userId) openBotControlCard(userId);
    if (target && document.contains(target)) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => target.focus({ preventScroll: true }), 250);
    }
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('#emoji-notice-overlay')?.classList.contains('hidden')) dismissNoticeOverlay();
});

function isSingleEmoji(value) {
  const emoji = String(value || '').trim().normalize('NFC');
  if (!emoji || emoji.length > 32 || /[\p{Letter}\p{White_Space}]/u.test(emoji)) return false;
  const graphemes = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(emoji)]
    : [...emoji].map((segment) => ({ segment }));
  return graphemes.length === 1 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u.test(emoji);
}

function parseEmojiBatch(value) {
  const parts = String(value || '').split(/[\s,，、;；]+/u).filter(Boolean);
  const emojis = [];
  const invalid = [];
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  for (const part of parts) {
    if (isSingleEmoji(part)) {
      emojis.push(part.normalize('NFC'));
      continue;
    }
    const clusters = segmenter ? [...segmenter.segment(part)].map((item) => item.segment) : [...part];
    if (clusters.length > 1 && clusters.every(isSingleEmoji)) emojis.push(...clusters.map((emoji) => emoji.normalize('NFC')));
    else invalid.push(part);
  }
  return { emojis: [...new Set(emojis)], invalid };
}

applyStorySettings(DEFAULT_STORY_SETTINGS, null);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* API errors are rendered generically */ }
  if (!response.ok) {
    const error = new Error(payload.error || 'Permintaan belum berhasil.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function setAuthMessage(text, success = false) {
  authMessage.textContent = text;
  authMessage.classList.toggle('hidden', !text);
  authMessage.classList.toggle('success', success);
  authMessage.classList.toggle('is-banned', /diblokir oleh admin/i.test(text));
}

// Panel pemberitahuan untuk akun yang diblokir atau dihapus: form login disembunyikan dan diganti panel berisi alasan plus kontak admin untuk pengajuan buka blokir atau pertanyaan.
function showAccountNotice(kind, reason) {
  const deleted = kind === 'deleted';
  accountNoticeTitle.textContent = deleted ? 'Maaf, akun Anda telah dihapus oleh admin.' : 'Maaf, akun Anda diblokir.';
  const cleanReason = String(reason || '').trim();
  accountNoticeReason.textContent = cleanReason ? `Alasan: ${cleanReason}` : '';
  accountNoticeReason.classList.toggle('hidden', !cleanReason);
  accountNoticeContact.textContent = deleted
    ? 'Untuk informasi lebih lanjut, hubungi admin:'
    : 'Untuk pengajuan buka blokir, hubungi admin:';
  accountNoticeWhatsapp.href = `${ADMIN_WHATSAPP_URL}?text=${encodeURIComponent(deleted
    ? 'Halo, saya ingin menanyakan akun saya yang dihapus.'
    : 'Halo, saya ingin mengajukan buka blokir akun saya.')}`;
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  verificationForm.classList.add('hidden');
  document.querySelector('#auth-switch')?.classList.add('hidden');
  setAuthMessage('');
  accountNotice.classList.remove('hidden');
}

function hideAccountNotice() {
  accountNotice.classList.add('hidden');
  document.querySelector('#auth-switch')?.classList.remove('hidden');
}

accountNoticeBack?.addEventListener('click', () => {
  hideAccountNotice();
  setAuthMode('login');
});

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// Dialog konfirmasi buatan panel menggantikan window.confirm bawaan browser agar tampilannya menyatu dengan tema panel dan muat di layar HP, dengan tombol Batal sebagai pilihan aman bila dialog ditutup.
function showConfirm({ title, message, confirmLabel = 'Oke', cancelLabel = 'Batal', danger = false }) {
  return new Promise((resolve) => {
    const previousOverflow = document.body.style.overflow;
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    const titleElement = document.createElement('h3');
    titleElement.className = 'confirm-title';
    titleElement.textContent = title;
    const messageElement = document.createElement('p');
    messageElement.className = 'confirm-message';
    messageElement.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'button-secondary';
    cancelButton.textContent = cancelLabel;
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = danger ? 'button-danger' : 'button-primary';
    confirmButton.textContent = confirmLabel;
    actions.append(cancelButton, confirmButton);
    dialog.append(titleElement, messageElement, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    const close = (result) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      resolve(result);
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKeyDown, true);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(false); });
    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    cancelButton.focus();
  });
}

function setAuthSubmitLoading(button, context, loading) {
  if (!button) return;
  if (loading) {
    if (!button.dataset.defaultContent) button.dataset.defaultContent = button.innerHTML;
    const labels = {
      login: 'Memeriksa akun…',
      register: 'Membuat akun…',
      verification: 'Mengaktifkan akun…',
    };
    button.classList.add('is-loading', `is-loading-${context}`);
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.innerHTML = `<span class="auth-button-spinner" aria-hidden="true"></span><span>${labels[context] || 'Memproses…'}</span>`;
    return;
  }
  button.classList.remove('is-loading', 'is-loading-login', 'is-loading-register', 'is-loading-verification');
  button.removeAttribute('aria-busy');
  button.disabled = false;
  if (button.dataset.defaultContent) button.innerHTML = button.dataset.defaultContent;
}

function waitForAuthAnimation(task, duration = 3000) {
  const startedAt = Date.now();
  return Promise.resolve(task).then(async (result) => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, duration - (Date.now() - startedAt))));
    return result;
  }, async (error) => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, duration - (Date.now() - startedAt))));
    throw error;
  });
}

function setLogoutLoading(button, loading) {
  if (!button) return;
  if (loading) {
    if (!button.dataset.defaultContent) button.dataset.defaultContent = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-logging-out');
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="logout-button-spinner" aria-hidden="true">↻</span><span>Keluar…</span>';
    return;
  }
  button.disabled = false;
  button.classList.remove('is-logging-out');
  button.removeAttribute('aria-busy');
  if (button.dataset.defaultContent) button.innerHTML = button.dataset.defaultContent;
}

function setAuthMode(mode) {
  const registering = mode === 'register';
  hideAccountNotice();
  clearVerificationCooldown();
  try { window.sessionStorage.setItem(AUTH_MODE_STORAGE_KEY, registering ? 'register' : 'login'); } catch { /* Mode tetap berjalan tanpa storage. */ }
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.querySelector('.auth-panel')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  authView.classList.toggle('is-registering', registering);
  loginForm.classList.toggle('hidden', registering);
  registerForm.classList.toggle('hidden', !registering);
  verificationForm.classList.add('hidden');
  adminAccessForm?.classList.add('hidden');
  document.querySelector('#auth-eyebrow').textContent = registering ? 'MULAI DARI SINI' : 'SELAMAT DATANG KEMBALI';
  document.querySelector('#auth-title').textContent = registering ? 'Buat akun baru' : 'Masuk ke akunmu';
  document.querySelector('#auth-subtitle').textContent = registering
    ? 'Akun baru dibuat setelah kode verifikasi berhasil.'
    : 'Lanjutkan mengatur dashboard bot kamu.';
  document.querySelector('#auth-switch').innerHTML = registering
    ? 'Sudah punya akun? <button type="button" data-action="show-login">Masuk</button>'
    : 'Belum punya akun? <button type="button" data-action="show-register">Daftar</button>';
  setAuthMessage('');
  if (!registering) document.querySelectorAll('[data-password-toggle]').forEach((toggle) => setPasswordVisibility(toggle, false));
  if (registering) {
    registerPasswordInput.value = '';
    registerConfirmPasswordInput.value = '';
    updatePasswordStrength();
    updatePasswordConfirmation();
  }
}

function showVerificationForm(payload) {
  hideAccountNotice();
  clearVerificationCooldown();
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  adminAccessForm?.classList.add('hidden');
  verificationForm.classList.remove('hidden');
  document.querySelector('#auth-eyebrow').textContent = 'SATU LANGKAH LAGI';
  document.querySelector('#auth-title').textContent = 'Verifikasi akunmu';
  document.querySelector('#auth-subtitle').textContent = 'Masukkan kode CAPTCHA 5 karakter sebelum masuk ke dashboard.';
  setVerificationPrompt(payload);
  document.querySelector('#auth-switch').innerHTML = 'Perlu melanjutkan pendaftaran? <button type="button" data-action="show-register">Kembali ke formulir</button>';
  setAuthMessage('Pendaftaran tersimpan sementara. Akun permanen baru dibuat setelah kode verifikasi benar.');
}

function showAdminAccessForm(identifier) {
  hideAccountNotice();
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  verificationForm.classList.add('hidden');
  adminAccessForm?.classList.remove('hidden');
  document.querySelector('#auth-eyebrow').textContent = 'SATU LANGKAH LAGI';
  document.querySelector('#auth-title').textContent = 'Kode akses admin';
  document.querySelector('#auth-subtitle').textContent = 'Verifikasi berhasil. Masukkan kode akses untuk membuat akun admin.';
  document.querySelector('#auth-switch').innerHTML = 'Perlu melanjutkan pendaftaran? <button type="button" data-action="show-register">Kembali ke formulir</button>';
  setAuthMessage('Verifikasi berhasil. Akun admin baru dibuat setelah kode akses benar.');
  document.querySelector('#admin-access-code')?.focus();
}

function setVerificationPrompt(payload) {
  if (!payload?.prompt) return false;
  document.querySelector('#verification-prompt').textContent = payload.prompt;
  const input = document.querySelector('#verification-code');
  input.value = '';
  input.disabled = false;
  return true;
}

function clearVerificationCooldown() {
  if (verificationCooldownTimer) clearInterval(verificationCooldownTimer);
  verificationCooldownTimer = null;
  verificationCooldownUntil = 0;
  const status = document.querySelector('#verification-cooldown');
  const input = document.querySelector('#verification-code');
  const button = verificationForm.querySelector('button[type="submit"]');
  if (status) {
    status.textContent = '';
    status.classList.add('hidden');
    status.classList.remove('is-ready');
  }
  if (input) input.disabled = false;
  if (button && !button.classList.contains('is-loading')) {
    button.disabled = false;
    if (button.dataset.defaultContent) button.innerHTML = button.dataset.defaultContent;
  }
}

function startVerificationCooldown(until) {
  const deadline = Number(until);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
  clearInterval(verificationCooldownTimer);
  verificationCooldownUntil = deadline;
  const status = document.querySelector('#verification-cooldown');
  const input = document.querySelector('#verification-code');
  const button = verificationForm.querySelector('button[type="submit"]');
  if (!button.dataset.defaultContent) button.dataset.defaultContent = button.innerHTML;
  status.classList.remove('hidden', 'is-ready');
  const update = () => {
    const remaining = Math.max(0, Math.ceil((verificationCooldownUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(verificationCooldownTimer);
      verificationCooldownTimer = null;
      verificationCooldownUntil = 0;
      input.disabled = false;
      button.disabled = false;
      button.innerHTML = button.dataset.defaultContent;
      status.textContent = 'Jeda selesai. Masukkan kode baru yang tampil.';
      status.classList.add('is-ready');
      setAuthMessage('Jeda selesai. Kamu bisa mencoba lagi dengan kode terbaru.', true);
      input.focus();
      return;
    }
    input.disabled = true;
    button.disabled = true;
    button.innerHTML = `Tunggu ${remaining} detik`;
    status.textContent = `Jeda percobaan aktif. Coba lagi dalam ${remaining} detik.`;
  };
  update();
  verificationCooldownTimer = setInterval(update, 250);
}

function setPasswordVisibility(toggle, visible) {
  const input = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!input) return;
  const label = toggle.dataset.passwordLabel || 'kata sandi';
  const action = visible ? 'Sembunyikan' : 'Tampilkan';
  input.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.setAttribute('aria-label', `${action} ${label}`);
  toggle.title = `${action} ${label}`;
}

async function pasteIntoField(button) {
  const input = document.getElementById(button.dataset.pasteTarget);
  if (!input) return;
  try {
    if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
    const clipboardText = await navigator.clipboard.readText();
    if (!clipboardText) {
      showToast('Clipboard kosong. Salin teks terlebih dahulu.');
      return;
    }
    input.value = input.id === 'pairing-phone'
      ? clipboardText.replace(/\D/g, '').slice(0, 15)
      : clipboardText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    showToast(input.id === 'pairing-phone' ? 'Nomor ditempel. Periksa kode negara dan digitnya.' : 'Kata sandi ditempel.');
  } catch {
    showToast('Clipboard tidak diizinkan browser. Tekan lama kolom lalu pilih Tempel.');
    input.focus();
  }
}

document.querySelectorAll('[data-paste-target]').forEach((button) => {
  button.addEventListener('click', () => { void pasteIntoField(button); });
});

document.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
  toggle.addEventListener('click', () => setPasswordVisibility(toggle, toggle.getAttribute('aria-pressed') !== 'true'));
});

const registerPasswordInput = registerForm.querySelector('[name="password"]');
const registerConfirmPasswordInput = registerForm.querySelector('[name="confirmPassword"]');
const registerPasswordMatchHint = document.querySelector('#register-password-match');
const registerPasswordStrength = document.querySelector('#register-password-strength');
const registerPasswordStrengthBars = [...registerPasswordStrength.querySelectorAll('.password-strength-bars i')];
const registerPasswordStrengthLabel = registerPasswordStrength.querySelector('.password-strength-label');

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: 'Mulai ketik kata sandi' };
  let score = 0;
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/].filter((pattern) => pattern.test(password)).length;
  if (password.length >= 12) score = 1;
  if (password.length >= 12 && categories >= 2) score = 2;
  if (password.length >= 14 && categories >= 3) score = 3;
  if (password.length >= 16 && categories === 4 && !/(.)\1{2,}|1234|password|qwerty/i.test(password)) score = 4;
  return { score, label: ['Mulai ketik kata sandi', 'Lemah', 'Sedang', 'Kuat', 'Sangat kuat'][score] };
}

function updatePasswordStrength() {
  const { score, label } = getPasswordStrength(registerPasswordInput.value);
  registerPasswordStrength.dataset.score = String(score);
  registerPasswordStrengthLabel.textContent = label;
  registerPasswordStrengthBars.forEach((bar, index) => bar.classList.toggle('is-filled', index < score));
}

function updatePasswordConfirmation() {
  const hasConfirmation = registerConfirmPasswordInput.value.length > 0;
  const matches = hasConfirmation && registerPasswordInput.value === registerConfirmPasswordInput.value;
  registerConfirmPasswordInput.setCustomValidity(hasConfirmation && !matches ? 'Kata sandi belum cocok.' : '');
  registerPasswordMatchHint.classList.toggle('is-match', matches);
  registerPasswordMatchHint.classList.toggle('is-mismatch', hasConfirmation && !matches);
  registerPasswordMatchHint.textContent = !hasConfirmation
    ? 'Masukkan ulang kata sandi yang sama.'
    : matches ? 'Kata sandi cocok.' : 'Kata sandi belum cocok.';
}
updatePasswordStrength();
registerPasswordInput.addEventListener('input', updatePasswordConfirmation);
registerPasswordInput.addEventListener('input', updatePasswordStrength);
registerConfirmPasswordInput.addEventListener('input', updatePasswordConfirmation);

function initials(value) {
  const parts = String(value || 'R').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => Array.from(part)[0] || '').join('').toUpperCase() || 'R';
}

function prettyDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function prettyDateTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Belum ada aktivitas';
  return `${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value))} WIB`;
}

function formatRelativeAgo(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time) || time <= 0) return null;
  const diff = Date.now() - time;
  if (diff < 45 * 1000) return 'baru saja';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} menit yang lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} jam ${rest} menit yang lalu` : `${hours} jam yang lalu`;
  }
  const days = Math.floor(hours / 24);
  return `${days} hari yang lalu`;
}

function formatPanelActivityNote(user) {
  if (user.panelActive) return 'Sedang online di web sekarang.';
  const ago = formatRelativeAgo(user.lastSeen);
  if (!ago) return 'Belum pernah membuka panel web.';
  return `Terakhir online di web ${ago}.`;
}

function modeSummary(mode) {
  return modeDescriptions[mode] || 'Pilih preferensi bot untuk menyimpannya.';
}

// Carousel horizontal kartu mode di HP (<=560px): kartu digeser ke samping dengan
// snap, titik indikator mengikuti kartu yang terlihat, dan kartu yang terbuka
// mengikuti kartu yang terlihat. Di desktop carousel tidak aktif dan kartu tetap
// accordion vertikal seperti biasa.
const planCarouselMedia = window.matchMedia('(max-width: 560px)');
const planCarouselGrid = document.querySelector('.plan-grid[data-page-view="mode"]');
const planCarouselDots = document.querySelector('.plan-carousel-dots');
let planCarouselScrollTimer = null;
function planCarouselActive() {
  return planCarouselMedia.matches && !!planCarouselGrid;
}
function planCarouselCards() {
  return [...document.querySelectorAll('.plan-card')];
}
function planCarouselVisibleCards() {
  return planCarouselCards().filter((card) => !card.classList.contains('is-filtered-out'));
}
function planCarouselCardTargetLeft(card) {
  const gridRect = planCarouselGrid.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  return planCarouselGrid.scrollLeft + (cardRect.left - gridRect.left);
}
function scrollToPlanCard(card, behavior = 'smooth') {
  if (!planCarouselActive() || !card) return;
  planCarouselGrid.scrollTo({ left: planCarouselCardTargetLeft(card), behavior });
}
function planCarouselMostVisibleCard() {
  const visible = planCarouselVisibleCards();
  if (!visible.length) return null;
  const left = planCarouselGrid.scrollLeft;
  return visible.reduce((best, card) => (Math.abs(planCarouselCardTargetLeft(card) - left) < Math.abs(planCarouselCardTargetLeft(best) - left) ? card : best));
}
function syncPlanCarouselDots() {
  if (!planCarouselDots) return;
  const visible = planCarouselVisibleCards();
  const active = planCarouselMostVisibleCard();
  const showDots = planCarouselActive() && visible.length >= 2;
  planCarouselDots.classList.toggle('is-hidden', !showDots);
  const cards = planCarouselCards();
  [...planCarouselDots.querySelectorAll('.plan-carousel-dot')].forEach((dot) => {
    const card = cards[Number(dot.dataset.planDot)];
    dot.toggleAttribute('hidden', !card || card.classList.contains('is-filtered-out'));
    const isActive = showDots && card === active;
    dot.classList.toggle('is-active', isActive);
    if (isActive) dot.setAttribute('aria-current', 'true'); else dot.removeAttribute('aria-current');
  });
}
function syncPlanCarouselOpenCard() {
  if (!planCarouselActive()) return;
  const card = planCarouselMostVisibleCard();
  if (!card || !card.classList.contains('is-collapsed')) return;
  planAccordionUserTouched = true;
  planCarouselCards().forEach((other) => setPlanCardOpen(other, false));
  setPlanCardOpen(card, true);
}
function syncPlanCarouselPosition() {
  if (!planCarouselActive()) return;
  const openCard = planCarouselCards().find((card) => !card.classList.contains('is-collapsed'))
    || planCarouselCards().find((card) => card.classList.contains('selected'))
    || planCarouselVisibleCards()[0];
  if (openCard) scrollToPlanCard(openCard, 'auto');
  syncPlanCarouselDots();
}
planCarouselGrid?.addEventListener('scroll', () => {
  window.clearTimeout(planCarouselScrollTimer);
  planCarouselScrollTimer = window.setTimeout(() => {
    syncPlanCarouselDots();
    syncPlanCarouselOpenCard();
  }, 120);
}, { passive: true });
planCarouselGrid?.addEventListener('scrollend', () => {
  window.clearTimeout(planCarouselScrollTimer);
  syncPlanCarouselDots();
  syncPlanCarouselOpenCard();
});
document.querySelector('.plan-carousel-dots')?.addEventListener('click', (event) => {
  const dot = event.target.closest('.plan-carousel-dot');
  if (!dot) return;
  const card = planCarouselCards()[Number(dot.dataset.planDot)];
  if (!card || card.classList.contains('is-filtered-out')) return;
  scrollToPlanCard(card, 'smooth');
});

// Pencarian + pil kategori Fitur Bot: memfilter 6 item (3 kartu mode, 2 delay,
// 1 emoji) berdasarkan kategori dan kata kunci, dan menyesuaikan carousel HP
// (kartu tersembunyi tidak ikut snap maupun titik indikator).
let fiturbotFilterCategory = 'all';
let fiturbotFilterQuery = '';
function fiturbotFilterCounts() {
  const counts = { all: 0, mode: 0, delay: 0, emoji: 0 };
  document.querySelectorAll('[data-fiturbot-item]').forEach((item) => {
    counts.all += 1;
    if (Object.hasOwn(counts, item.dataset.fiturbotCategory)) counts[item.dataset.fiturbotCategory] += 1;
  });
  return counts;
}
function updateFiturbotFilterCounts() {
  const counts = fiturbotFilterCounts();
  document.querySelectorAll('[data-fiturbot-filters] [data-filter-count]').forEach((countEl) => {
    const key = countEl.dataset.filterCount;
    if (Object.hasOwn(counts, key)) countEl.textContent = String(counts[key]);
  });
}
function fiturbotItemMatches(item) {
  if (fiturbotFilterCategory !== 'all' && item.dataset.fiturbotCategory !== fiturbotFilterCategory) return false;
  if (!fiturbotFilterQuery) return true;
  return (item.dataset.fiturbotSearch || '').includes(fiturbotFilterQuery);
}
function applyFiturbotFilter() {
  const items = [...document.querySelectorAll('[data-fiturbot-item]')];
  let visibleCount = 0;
  items.forEach((item) => {
    const match = fiturbotItemMatches(item);
    item.classList.toggle('is-filtered-out', !match);
    if (match) visibleCount += 1;
  });
  // Kolom pemilih emoji mengikuti saklar reaksi emoji: tampil hanya bila saklarnya lolos filter.
  const reactionSwitch = document.querySelector('.story-reaction-switch[data-fiturbot-item]');
  document.querySelector('.emoji-pool-field')?.classList.toggle('is-filtered-out', !!reactionSwitch?.classList.contains('is-filtered-out'));
  // Seksi Delay & emoji hanya tampil bila ada pengaturannya yang lolos filter.
  const storyCard = document.querySelector('.story-settings-card[data-page-view="mode"]');
  const storyVisible = items.some((item) => item.closest('.story-settings-card') && !item.classList.contains('is-filtered-out'));
  storyCard?.classList.toggle('is-filtered-out', !storyVisible);
  // Wadah kartu disembunyikan bila tidak ada kartu yang lolos filter.
  const cardsVisible = items.some((item) => item.classList.contains('plan-card') && !item.classList.contains('is-filtered-out'));
  planCarouselGrid?.classList.toggle('is-filtered-out', !cardsVisible);
  // Bila kartu yang terbuka ikut tersembunyi, buka kartu pertama yang masih terlihat.
  const openCard = planCarouselCards().find((card) => !card.classList.contains('is-collapsed'));
  if (openCard?.classList.contains('is-filtered-out')) {
    const firstVisible = planCarouselVisibleCards()[0];
    planCarouselCards().forEach((other) => setPlanCardOpen(other, false));
    if (firstVisible) setPlanCardOpen(firstVisible, true);
  }
  document.querySelector('#fiturbot-filter-empty')?.toggleAttribute('hidden', visibleCount !== 0);
  updateFiturbotFilterCounts();
  syncPlanCarouselDots();
  const visibleOpenCard = planCarouselCards().find((card) => !card.classList.contains('is-collapsed') && !card.classList.contains('is-filtered-out'));
  if (visibleOpenCard) scrollToPlanCard(visibleOpenCard, 'auto');
}
document.querySelector('#fiturbot-search')?.addEventListener('input', (event) => {
  fiturbotFilterQuery = String(event.target.value || '').trim().toLowerCase();
  applyFiturbotFilter();
});
document.querySelector('[data-fiturbot-filters]')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-fiturbot-filter]');
  if (!button) return;
  fiturbotFilterCategory = button.dataset.fiturbotFilter;
  document.querySelectorAll('[data-fiturbot-filters] .filter-pill').forEach((pill) => {
    const active = pill === button;
    pill.classList.toggle('is-active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
  applyFiturbotFilter();
});
applyFiturbotFilter();

// Kartu mode Fitur Bot tampil sebagai accordion: hanya satu kartu terbuka dalam
// satu waktu, dan penanda status di header kartu selalu mengikuti class selected
// yang sama dengan tombol Aktif di dalam kartu.
let planAccordionUserTouched = false;
function setPlanCardOpen(card, open) {
  card.classList.toggle('is-collapsed', !open);
  card.querySelector('.plan-card-toggle')?.setAttribute('aria-expanded', String(open));
}
function renderPlanCardStatuses() {
  document.querySelectorAll('.plan-card').forEach((card) => {
    const status = card.querySelector('[data-plan-status]');
    if (!status) return;
    const active = card.classList.contains('selected');
    status.classList.toggle('is-active', active);
    status.textContent = active ? '✓ Aktif' : 'Tidak aktif';
  });
}
function syncPlanAccordionDefault() {
  // Pilihan buka/tutup pengguna tidak pernah ditimpa: sinkronisasi bawaan hanya
  // berjalan sebelum pengguna menyentuh accordion untuk pertama kali.
  if (planAccordionUserTouched) return;
  const cards = [...document.querySelectorAll('.plan-card')];
  if (!cards.length) return;
  const openCard = cards.find((card) => card.classList.contains('selected'))
    || cards.find((card) => card.classList.contains('plan-featured'))
    || cards[0];
  cards.forEach((card) => setPlanCardOpen(card, card === openCard));
  // Di HP, carousel langsung diposisikan ke kartu yang terbuka bawaan tanpa animasi kasar.
  scrollToPlanCard(openCard, 'auto');
  syncPlanCarouselDots();
}

function applyBot(bot) {
  selectedMode = bot?.mode === 'online24' ? 'readonly' : bot?.mode || null;
  const online24 = bot?.online24 === true || bot?.mode === 'online24';
  workerAutoStart = bot?.autoStart === true;
  applyStorySettings(bot?.storySettings || DEFAULT_STORY_SETTINGS, selectedMode);
  document.querySelectorAll('[data-plan-card]').forEach((card) => {
    card.classList.toggle('selected', card.dataset.planCard === selectedMode);
    const button = card.querySelector('.select-plan');
    if (button) {
      const active = card.dataset.planCard === selectedMode;
      button.innerHTML = active ? 'Aktif <span>✓</span>' : 'Aktifkan <span>→</span>';
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? `${modeNames[card.dataset.planCard]} sedang aktif` : `Aktifkan ${modeNames[card.dataset.planCard]}`);
      // Tombol Aktifkan selalu hijau primer di semua kartu: bedanya dengan kartu
      // aktif terlihat dari label "Aktif ✓" dan garis hijau kartu yang terpilih.
      button.classList.add('button-primary');
      button.classList.remove('button-secondary');
    }
  });
  const onlineCard = document.querySelector('[data-online-addon]');
  const onlineButton = onlineCard?.querySelector('[data-online24-toggle]');
  onlineCard?.classList.toggle('selected', online24);
  if (onlineButton) {
    onlineButton.innerHTML = online24 ? 'Aktif <span>✓</span>' : 'Aktifkan <span>→</span>';
    onlineButton.setAttribute('aria-pressed', String(online24));
    onlineButton.setAttribute('aria-label', online24 ? 'Online 24 Jam sedang aktif' : 'Aktifkan Online 24 Jam');
    onlineButton.classList.add('button-primary');
    onlineButton.classList.remove('button-secondary');
  }
  // Penanda status di header kartu accordion selalu mengikuti state mode yang
  // sama dengan tombol di dalam kartu, dan kartu mode yang aktif terbuka bawaan.
  renderPlanCardStatuses();
  syncPlanAccordionDefault();
  document.querySelector('#current-mode').textContent = selectedMode
    ? `${modeNames[selectedMode]}${online24 ? ' + Online 24 Jam' : ''}`
    : 'Belum dipilih';
  document.querySelector('#mode-summary').textContent = selectedMode
    ? `${modeSummary(selectedMode)}${online24 ? ' Presence online berkala aktif selama host berjalan.' : ''}`
    : modeSummary(selectedMode);
  document.querySelector('#saved-label').textContent = bot?.updatedAt
    ? `Preferensi disimpan · ${prettyDate(bot.updatedAt)}`
    : 'Belum ada perubahan';
}

// Pengingat untuk member biasa yang WhatsApp-nya belum tertaut: fitur bot
// belum aktif, dan menautkan WhatsApp adalah satu-satunya jalan mengaktifkannya.
// Admin (Admin Utama dan admin biasa) tidak pernah melihat notifikasi ini dan
// pengaturannya tidak pernah dikunci. Status tautan dibaca dari penanda yang
// sama dengan lencana koneksi, jadi notifikasi ini muncul dan hilang realtime
// mengikuti poll status pairing. Notifikasinya tampil sebagai overlay di tengah
// layar (komponen yang sama dengan notifikasi reaksi), bukan kartu di bawah.
let botLinkNoticeDismissed = false;
function isBotLockedForMember() {
  return Boolean(currentUser) && currentUser.role !== 'admin' && document.body.dataset.whatsappLinked === 'false';
}
function showLinkNoticeOverlay() {
  showNoticeOverlay({
    title: 'WhatsApp belum tertaut',
    text: 'Fitur bot belum aktif untuk akun ini. Tautkan WhatsApp dulu — begitu tertaut, Read Only + ReadSW dan Online 24 Jam otomatis aktif.',
    context: { kind: 'link' },
    addLabel: 'Buka Pairing WhatsApp',
    onAdd: () => setWorkspacePage('pairing'),
  });
}
function syncBotLinkNotice() {
  const locked = isBotLockedForMember();
  document.querySelectorAll('.select-plan, [data-online24-toggle]').forEach((button) => {
    button.classList.toggle('is-locked', locked);
    button.setAttribute('aria-disabled', String(locked));
  });
  document.querySelectorAll('#story-delay-min, #story-delay-max, #story-reaction-enabled, #story-emoji-input, #story-emoji-add, #save-story-settings, #story-emoji-grid button').forEach((control) => {
    control.disabled = locked;
  });
  if (!locked) {
    botLinkNoticeDismissed = false;
    if (noticeContext?.kind === 'link') hideNoticeOverlay();
    return;
  }
  if (botLinkNoticeDismissed) return;
  // Notifikasi hanya muncul saat member sedang berada di halaman Fitur Bot —
  // di halaman lain (misalnya dashboard setelah login) notifikasinya tidak
  // menutupi layar dan menunggu sampai member masuk ke Fitur Bot.
  if (activeWorkspacePage !== 'mode') return;
  showLinkNoticeOverlay();
}
function showBotLinkNotice() {
  // Tampilan eksplisit — dipakai saat member mencoba masuk Fitur Bot atau
  // mengetuk tombol mode yang terkunci: tampilkan walau notifikasinya sempat
  // ditutup dan walau member belum berada di halaman Fitur Bot.
  botLinkNoticeDismissed = false;
  showLinkNoticeOverlay();
}

// Menu terkunci untuk member (Backup / Kontrol Bot): tampilkan notifikasi di
// tengah layar, bukan toast kecil. Admin (Admin Utama dan admin biasa) tidak
// pernah melihat notifikasi ini karena mereka bisa membuka kedua halaman itu.
function showLockedNotice(featureName) {
  showNoticeOverlay({
    title: `${featureName} hanya untuk admin`,
    text: `${featureName} hanya bisa dibuka Admin Utama dan admin biasa. Akun member tidak bisa memakai fitur ini — hubungi admin bila butuh bantuan.`,
    context: { kind: 'locked', feature: featureName },
    addLabel: null,
  });
}

let workerRuntimeTimer = null;
function formatWorkerRuntime(startedAt) {
  const timestamp = Number(startedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  const totalSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    days ? `${days} hari` : '',
    hours ? `${hours} jam` : '',
    minutes ? `${minutes} mnt` : '',
    `${seconds} dtk`,
  ].filter(Boolean).join(' ');
}
function updateWorkerRuntimeDisplays() {
  document.querySelectorAll('[data-worker-runtime]').forEach((element) => {
    if (element.classList.contains('member-worker-runtime') && !element.dataset.workerRuntime) {
      element.textContent = 'Belum aktif';
      return;
    }
    const duration = formatWorkerRuntime(element.dataset.workerRuntime);
    if (element.id === 'bot-worker-runtime') {
      element.textContent = `Runtime bot: ${duration}`;
    } else if (element.dataset.runtimePrefix) {
      element.textContent = `${element.dataset.runtimePrefix} · ${duration}`;
    } else {
      element.textContent = duration;
    }
  });
}
function ensureWorkerRuntimeTicker() {
  updateWorkerRuntimeDisplays();
  if (!workerRuntimeTimer) workerRuntimeTimer = window.setInterval(updateWorkerRuntimeDisplays, 1000);
}

let expandedAdminUserId = null;
const adminUsersList = document.querySelector('#admin-users');
const adminBackupStatus = document.querySelector('#admin-backup-status');
function setAdminBackupStatus(message, isError = false) {
  if (!adminBackupStatus) return;
  adminBackupStatus.textContent = message;
  adminBackupStatus.classList.toggle('is-error', isError);
}
function backupBytesLabel(bytes) {
  const value = Number(bytes) || 0;
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`;
}
async function loadAdminBackupSnapshots() {
  const list = document.querySelector('#admin-backup-snapshots');
  if (!list || currentUser?.role !== 'admin') return;
  try {
    const { snapshots = [] } = await api('/api/admin/backup/snapshots');
    list.replaceChildren();
    if (!snapshots.length) {
      list.textContent = 'Belum ada restore point otomatis.';
      return;
    }
    const items = document.createElement('ul');
    for (const snapshot of snapshots) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/api/admin/backup/snapshot?name=${encodeURIComponent(snapshot.name)}`;
      link.textContent = `Unduh ${snapshot.name}`;
      const detail = document.createElement('span');
      detail.textContent = ` · ${backupBytesLabel(snapshot.bytes)} · ${new Date(snapshot.createdAt).toLocaleString('id-ID')}`;
      item.append(link, detail);
      items.append(item);
    }
    list.append(items);
  } catch (error) {
    list.textContent = error.message;
    if (error.status === 401) showAuth();
  }
}
document.querySelector('#admin-backup-refresh-snapshots')?.addEventListener('click', () => void loadAdminBackupSnapshots());
function setTelegramConfigPill(which, state) {
  const pill = document.querySelector(which === 'token' ? '#admin-backup-telegram-token-pill' : '#admin-backup-telegram-chatid-pill');
  if (!pill) return;
  const labels = { idle: 'Belum diperiksa', checking: 'Memeriksa…', valid: 'Valid', invalid: 'Tidak valid' };
  pill.dataset.state = state;
  pill.textContent = labels[state] || labels.idle;
}

function telegramTargetParts(parts) {
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (typeof part === 'string') {
      fragment.append(part);
    } else {
      const span = document.createElement('span');
      span.className = 'telegram-target-nowrap';
      span.textContent = part.text;
      fragment.append(span);
    }
  }
  return fragment;
}

function renderTelegramConfigStatus({ configured, chatId, botUsername, chatValid }) {
  const target = document.querySelector('#admin-backup-telegram-target');
  const button = document.querySelector('#admin-backup-telegram-send');
  if (!target) return;
  if (!configured) {
    target.textContent = 'Bot Telegram belum diatur. Isi token bot dan chat ID di bawah ini.';
  } else if (chatValid) {
    target.replaceChildren(telegramTargetParts(botUsername
      ? ['Bot Telegram siap — ', { text: `@${botUsername}` }, ' · ', { text: `chat ${chatId}` }, '. Backup dikirim ke chat itu.']
      : ['Bot Telegram siap — backup dikirim ke ', { text: `chat ${chatId}` }, '. Pastikan kamu sudah /start bot-nya.']));
  } else {
    target.replaceChildren(telegramTargetParts(botUsername
      ? ['Token tersimpan (', { text: `@${botUsername}` }, '), tapi chat belum valid — periksa chat ID dan pastikan bot sudah di-/start.']
      : ['Token tersimpan, tapi chat belum valid — periksa chat ID dan pastikan bot sudah di-/start.']));
  }
  if (button) button.disabled = !(configured && chatValid);
}

function setTelegramTokenHintVisible(visible) {
  const hint = document.querySelector('#admin-backup-telegram-token-hint');
  if (hint) hint.hidden = !visible;
}

async function loadAdminBackupTelegramStatus() {
  const target = document.querySelector('#admin-backup-telegram-target');
  const button = document.querySelector('#admin-backup-telegram-send');
  if (!target || currentUser?.role !== 'admin') return;
  try {
    const status = await api('/api/admin/backup/telegram-status');
    renderTelegramConfigStatus(status);
    const chatInput = document.querySelector('#admin-backup-telegram-chatid');
    if (chatInput && !chatInput.value && status.chatIdValue) chatInput.value = status.chatIdValue;
    // chatIdValue hanya dikembalikan bila token tersimpan sama dengan yang
    // efektif, jadi keberadaannya menandai token sudah tersimpan di server.
    telegramTokenStored = Boolean(status.configured && status.chatIdValue);
    setTelegramTokenHintVisible(telegramTokenStored);
    // Pil token mengikuti isi kolom, bukan token tersimpan: kolom token tidak
    // pernah diisi ulang dari server, jadi kolom kosong selalu Belum diperiksa
    // walau token tersimpan sudah valid — kevalidan token tersimpan sudah
    // ditunjukkan baris status dan petunjuk di bawah kolom.
    setTelegramConfigPill('token', 'idle');
    setTelegramConfigPill('chat', status.configured ? (status.chatValid ? 'valid' : 'invalid') : 'idle');
  } catch (error) {
    target.textContent = 'Tidak dapat memeriksa pengaturan bot Telegram.';
    if (button) button.disabled = true;
    if (error.status === 401) showAuth();
  }
}

let telegramConfigSaveTimer = null;
let telegramConfigWired = false;
let telegramTokenStored = false;

function scheduleTelegramConfigSave() {
  const tokenInput = document.querySelector('#admin-backup-telegram-token');
  const chatInput = document.querySelector('#admin-backup-telegram-chatid');
  if (!tokenInput || !chatInput) return;
  if (telegramConfigSaveTimer) clearTimeout(telegramConfigSaveTimer);
  const botToken = tokenInput.value.trim();
  const chatId = chatInput.value.trim();
  if (!chatId) return;
  if (!botToken && !telegramTokenStored) return;
  telegramConfigSaveTimer = setTimeout(() => void saveTelegramConfig(botToken, chatId), 800);
}

async function saveTelegramConfig(botToken, chatId) {
  const saveStatus = document.querySelector('#admin-backup-telegram-save-status');
  setTelegramConfigPill('token', 'checking');
  setTelegramConfigPill('chat', 'checking');
  if (saveStatus) saveStatus.textContent = 'Memeriksa token dan chat ID ke Telegram…';
  try {
    const result = await api('/api/admin/backup/telegram-config', { method: 'PUT', body: JSON.stringify({ botToken, chatId }) });
    renderTelegramConfigStatus(result);
    telegramTokenStored = true;
    setTelegramTokenHintVisible(true);
    // Pil token hanya Valid bila kolom token berisi token yang baru diperiksa;
    // simpan chat saja (kolom token kosong, memakai token tersimpan) membuat
    // pil token kembali Belum diperiksa, bukan Valid.
    setTelegramConfigPill('token', botToken ? 'valid' : 'idle');
    setTelegramConfigPill('chat', result.chatValid ? 'valid' : 'invalid');
    if (saveStatus) {
      saveStatus.textContent = result.chatValid
        ? `Tersimpan otomatis · ${new Date().toLocaleTimeString('id-ID')} — bot @${result.botUsername || 'Telegram'} siap, backup dikirim ke chat itu.`
        : `Tersimpan — ${result.chatError || 'chat belum valid.'}`;
    }
  } catch (error) {
    if (error.status === 400 && error.payload?.tokenValid === false) {
      setTelegramConfigPill('token', 'invalid');
      setTelegramConfigPill('chat', 'idle');
    } else {
      setTelegramConfigPill('token', 'idle');
      setTelegramConfigPill('chat', 'idle');
    }
    if (saveStatus) saveStatus.textContent = error.message || 'Tidak dapat menyimpan pengaturan Telegram.';
    if (error.status === 401) showAuth();
  }
}

function initAdminBackupTelegramConfig() {
  if (telegramConfigWired) return;
  const tokenInput = document.querySelector('#admin-backup-telegram-token');
  const chatInput = document.querySelector('#admin-backup-telegram-chatid');
  if (!tokenInput || !chatInput) return;
  telegramConfigWired = true;
  const fields = [
    { input: tokenInput, which: 'token' },
    { input: chatInput, which: 'chat' },
  ];
  for (const { input, which } of fields) {
    input.addEventListener('input', () => {
      // Hanya pil kolom yang sedang diketik yang kembali ke Belum diperiksa,
      // supaya pil kolom sebelahnya tetap menunjukkan hasil pemeriksaan terakhir.
      setTelegramConfigPill(which, 'idle');
      const saveStatus = document.querySelector('#admin-backup-telegram-save-status');
      if (saveStatus) saveStatus.textContent = 'Mengetik… pengaturan tersimpan otomatis setelah berhenti mengetik.';
      scheduleTelegramConfigSave();
    });
  }
}
document.querySelector('#admin-backup-direct-download')?.addEventListener('click', () => {
  if (currentUser?.role !== 'admin') return;
  setAdminBackupStatus('Mengunduh backup… Jika unduhan tidak mulai dalam beberapa detik, muat ulang halaman dan coba lagi.');
  window.location.href = '/api/admin/backup/download';
});
document.querySelector('#admin-backup-telegram-send')?.addEventListener('click', async (event) => {
  if (currentUser?.role !== 'admin') return;
  const button = event.currentTarget;
  button.disabled = true;
  setAdminBackupStatus('Menyiapkan dan mengirim backup ke Telegram…');
  try {
    const result = await api('/api/admin/backup/telegram', { method: 'POST' });
    setAdminBackupStatus(`Backup terkirim ke Telegram (${backupBytesLabel(result.bytes)}). Cek chat Telegram kamu.`);
  } catch (error) {
    setAdminBackupStatus(error.message, true);
    if (error.status === 401) showAuth();
  } finally {
    button.disabled = false;
    await loadAdminBackupTelegramStatus();
  }
});
document.querySelector('#admin-backup-export-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (currentUser?.role !== 'admin') return;
  const form = event.currentTarget;
  const input = document.querySelector('#admin-backup-export-passphrase');
  const button = form.querySelector('button[type="submit"]');
  const passphrase = input?.value || '';
  if ([...passphrase].length < 12) return setAdminBackupStatus('Gunakan kata sandi backup minimal 12 karakter.', true);
  button.disabled = true;
  setAdminBackupStatus('Menyiapkan dan mengenkripsi data…');
  try {
    const response = await fetch('/api/admin/backup/export', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!response.ok) {
      let error = {};
      try { error = await response.json(); } catch { /* Use generic fallback. */ }
      if (response.status === 401) showAuth();
      throw new Error(error.error || 'Backup belum dapat dibuat.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'readsw-backup.zip';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    input.value = '';
    setAdminBackupStatus('Backup terenkripsi berhasil diunduh. Simpan passphrase terpisah dari file ZIP.');
  } catch (error) {
    setAdminBackupStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#admin-backup-restore-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (currentUser?.role !== 'admin') return;
  const form = event.currentTarget;
  const fileInput = document.querySelector('#admin-backup-file');
  const passInput = document.querySelector('#admin-backup-restore-passphrase');
  const confirmInput = document.querySelector('#admin-backup-confirm');
  const button = form.querySelector('button[type="submit"]');
  const file = fileInput?.files?.[0];
  const passphrase = passInput?.value || '';
  if (!file || !file.name.toLowerCase().endsWith('.zip')) return setAdminBackupStatus('Pilih file backup ZIP ReadSW.', true);
  if (file.size > 80 * 1024 * 1024) return setAdminBackupStatus('Ukuran ZIP melebihi batas 80 MiB.', true);
  if ([...passphrase].length < 12) return setAdminBackupStatus('Masukkan kata sandi backup yang benar.', true);
  if (!confirmInput?.checked) return setAdminBackupStatus('Centang konfirmasi sebelum menjalankan restore.', true);
  const approved = await showConfirm({ title: 'Restore backup?', message: 'Restore akan mengganti data akun/data sesi saat ini, menghentikan koneksi WhatsApp yang sedang aktif, lalu mencoba menyambungkan sesi dari backup. Worker auto-start dapat mulai berjalan. Lanjutkan hanya jika Anda memahami dampaknya dan memiliki izin.', confirmLabel: 'Restore', danger: true });
  if (!approved) return;
  button.disabled = true;
  setAdminBackupStatus('Memvalidasi ZIP dan membuat restore point sebelum perubahan…');
  try {
    const response = await fetch('/api/admin/backup/restore', {
      method: 'POST', credentials: 'same-origin', body: file,
      headers: {
        'Content-Type': 'application/zip',
        'X-Backup-Passphrase': encodeURIComponent(passphrase),
        'X-Confirm-Restore': 'yes',
      },
    });
    let result = {};
    try { result = await response.json(); } catch { /* Use a safe fallback. */ }
    if (!response.ok) {
      if (response.status === 401) showAuth();
      throw new Error(result.error || 'Restore belum berhasil.');
    }
    inputCleanup();
    setAdminBackupStatus(`Restore selesai untuk ${result.restoredAccounts} akun. Sesi WA tersambung ulang: ${result.resumedWhatsAppSessions}; peringatan: ${result.reconnectWarnings}. Restore point otomatis tersimpan.`);
    await loadAdminBackupSnapshots();
    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    setAdminBackupStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
  function inputCleanup() {
    if (fileInput) fileInput.value = '';
    if (passInput) passInput.value = '';
    if (confirmInput) confirmInput.checked = false;
  }
});
const adminBanReasons = new Map();
const adminDeleteReasons = new Map();
adminUsersList?.addEventListener('input', (event) => {
  const field = event.target.closest('[data-admin-ban-reason], [data-admin-delete-reason]');
  const userId = field?.closest('.member-account-item')?.querySelector('[data-member-toggle]')?.dataset.userId;
  if (!field || !userId) return;
  if (field.hasAttribute('data-admin-ban-reason')) adminBanReasons.set(userId, field.value);
  else adminDeleteReasons.set(userId, field.value);
});
adminUsersList?.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-admin-action]');
  if (actionButton && adminUsersList.contains(actionButton)) {
    const action = actionButton.dataset.adminAction;
    const userId = actionButton.dataset.userId;
    const article = actionButton.closest('.member-account-item');
    const username = article?.querySelector('[data-member-toggle]')?.dataset.username || 'member';
    const confirmations = {
      'bot-start': { title: `Start bot @${username}?`, message: 'Bot memakai pengaturan tersimpan dan dapat membaca status serta mengirim reaksi bila mode itu aktif. Lanjut hanya jika kamu berwenang.', confirmLabel: 'Start bot' },
      'bot-restart': { title: `Restart bot @${username}?`, message: 'Bot berjalan kembali dengan pengaturan tersimpan. Lanjut hanya jika kamu berwenang.', confirmLabel: 'Restart bot' },
      'bot-stop': { title: `Matikan worker bot @${username}?`, message: 'Koneksi WhatsApp tetap tertaut. Lanjut hanya jika kamu berwenang.', confirmLabel: 'Matikan worker', danger: true },
      ban: { title: `Blokir @${username}?`, message: 'Sesi panel dicabut, worker/Online 24 Jam dihentikan, pairing yang belum selesai dibatalkan, dan tautan WA aktif tidak dihapus.', confirmLabel: 'Blokir', danger: true },
      unban: { title: `Buka blokir @${username}?`, message: 'Agar pemilik dapat login kembali.', confirmLabel: 'Buka blokir' },
    };
    if (action === 'member-delete') {
      if (actionButton.dataset.armed !== 'true') {
        actionButton.dataset.armed = 'true';
        actionButton.textContent = 'Klik lagi untuk menghapus permanen';
        return;
      }
      delete actionButton.dataset.armed;
      actionButton.textContent = 'Hapus akun permanen';
      if (!(await showConfirm({ title: `Hapus akun @${username} permanen?`, message: 'Semua data akun di DATA_AKUN, sesi panel, dan riwayat login ikut terhapus dan tidak dapat dikembalikan.', confirmLabel: 'Hapus permanen', danger: true }))) return;
      const actionButtons = [...(article?.querySelectorAll('[data-admin-action]') || [])];
      actionButtons.forEach((button) => { button.disabled = true; });
      try {
        const result = await api('/api/admin/users/delete', {
          method: 'POST',
          body: JSON.stringify({ userId, confirm: true, reason: article?.querySelector('[data-admin-delete-reason]')?.value || '' }),
        });
        adminDeleteReasons.delete(userId);
        if (expandedAdminUserId === userId) expandedAdminUserId = null;
        showToast(result.warning || `Akun @${username} dihapus permanen.`);
        await loadAdminUsers();
      } catch (error) {
        if (error.status === 401) showAuth();
        else showToast(error.message);
        actionButtons.forEach((button) => { button.disabled = false; });
      }
      return;
    }
    if (!(await showConfirm(confirmations[action] || { title: 'Lanjutkan tindakan admin ini?', message: 'Tindakan ini akan langsung dijalankan.', confirmLabel: 'Lanjutkan' }))) return;
    const actionButtons = [...(article?.querySelectorAll('[data-admin-action]') || [])];
    actionButtons.forEach((button) => { button.disabled = true; });
    try {
      if (action.startsWith('bot-')) {
        const botAction = action.slice('bot-'.length);
        const result = await api('/api/admin/users/bot', {
          method: 'POST',
          body: JSON.stringify({ userId, action: botAction, confirmActivity: botAction !== 'stop' }),
        });
        showToast(`Kontrol bot ${botAction} berhasil. Worker: ${result.workerStatus === 'running' ? 'berjalan' : 'berhenti'}.`);
      } else {
        const result = await api('/api/admin/users/ban', {
          method: 'POST',
          body: JSON.stringify({
            userId,
            action,
            confirm: action === 'ban',
            reason: article?.querySelector('[data-admin-ban-reason]')?.value || '',
          }),
        });
        adminBanReasons.delete(userId);
        showToast(result.warning || (result.banned ? 'Akun member diblokir dan sesi panel dicabut.' : 'Blokir akun member dibuka.'));
      }
      await loadAdminUsers();
    } catch (error) {
      if (error.status === 401) showAuth();
      else showToast(error.message);
      actionButtons.forEach((button) => { button.disabled = false; });
    }
    return;
  }
  const trigger = event.target.closest('[data-member-toggle]');
  if (!trigger || !adminUsersList.contains(trigger)) return;
  const shouldOpen = trigger.getAttribute('aria-expanded') !== 'true';
  expandedAdminUserId = shouldOpen ? trigger.dataset.userId : null;
  adminUsersList.querySelectorAll('.member-account-item').forEach((item) => {
    const button = item.querySelector('[data-member-toggle]');
    const panel = item.querySelector('.member-account-details');
    const isOpen = Boolean(shouldOpen && button === trigger);
    button?.setAttribute('aria-expanded', String(isOpen));
    button?.setAttribute('aria-label', `${isOpen ? 'Tutup' : 'Lihat'} detail akun @${button?.dataset.username || ''}`);
    const label = button?.querySelector('.member-account-toggle-label');
    if (label) label.textContent = isOpen ? 'Tutup detail' : 'Lihat detail';
    if (panel) panel.hidden = !isOpen;
    item.classList.toggle('is-open', isOpen);
  });
});

const MEMBER_ICON_PATHS = {
  crown: ['M3 8.5 6.5 12 12 6.5 17.5 12 21 8.5 19.4 18H4.6L3 8.5Z', 'M5 20.5h14'],
  user: ['M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M5 20.5c.8-3.2 3.6-5 7-5s6.2 1.8 7 5'],
  mail: ['M3.5 6h17v12h-17z', 'm4 7 8 6 8-6'],
  shield: ['M12 3.5 19 6v5.2c0 4.2-2.7 7.1-7 9.3-4.3-2.2-7-5.1-7-9.3V6z', 'm8.7 12.1 2.1 2.1 4.5-4.6'],
  activity: ['M3 12h4l2-5 4 10 2-5h6'],
  whatsapp: ['M5 19.2 6.1 16A7.6 7.6 0 1 1 9 18.6z', 'M9.1 9.1c.4 2 1.8 3.4 3.8 3.8l1.3-1 2 .9c-.2 1.2-1.2 2-2.4 1.9-3.5-.5-6.2-3.2-6.7-6.7-.1-1.2.7-2.2 1.9-2.4l.9 2z'],
  phone: ['M7 3.5h10v17H7z', 'M10 17.5h4'],
  bot: ['M8 8h8a4 4 0 0 1 4 4v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a4 4 0 0 1 4-4Z', 'M12 4v4', 'M10 13h.01', 'M14 13h.01', 'M9 16h6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3.5 2'],
  calendar: ['M4 5.5h16v15H4z', 'M8 3.5v4', 'M16 3.5v4', 'M4 9.5h16', 'M8 13h2', 'M14 13h2', 'M8 16.5h2'],
  eye: ['M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
  heart: ['M20.2 8.8c0 4.1-8.2 9.1-8.2 9.1s-8.2-5-8.2-9.1a4.1 4.1 0 0 1 8.2-1.1 4.1 4.1 0 0 1 8.2 1.1Z'],
  spark: ['m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z', 'm19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
};

function createMemberIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'member-detail-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of MEMBER_ICON_PATHS[name] || MEMBER_ICON_PATHS.activity) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.7');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

// Urutan daftar akun mengikuti runtime bot: yang baru jalan atau baru restart (runtime tersingkat) di atas, runtime terlama di bawah, dan akun yang botnya tidak berjalan di paling bawah.
function sortAdminUsersByRuntime(users) {
  const startedAtOf = (user) => {
    const timestamp = Number(user?.workerStartedAt);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  };
  return [...users].sort((a, b) => {
    const aRunning = a?.workerStatus === 'running' && startedAtOf(a) !== null;
    const bRunning = b?.workerStatus === 'running' && startedAtOf(b) !== null;
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    if (aRunning && bRunning) return startedAtOf(b) - startedAtOf(a);
    return 0;
  });
}

// Label status WhatsApp dipakai kartu akun di halaman Member dan di halaman Kontrol Bot.
const pairingLabels = {
  linked: 'Tersambung', disconnected: 'Terputus', reconnecting: 'Menyambung', stopped: 'Dihentikan',
  awaiting_code: 'Menunggu pairing', connecting: 'Menyiapkan pairing', linking: 'Menyelesaikan tautan', failed: 'Gagal',
};

async function loadAdminUsers() {
  const section = document.querySelector('#admin');
  try {
    const isAdmin = currentUser?.role === 'admin';
    const result = await api(isAdmin ? '/api/admin/users' : '/api/members');
    const users = Array.isArray(result.users) ? result.users : [];
    // Badge Member ikut diperbarui realtime dari daftar yang sama (tiap
    // 15 detik), tanpa memajukan penanda: penanda hanya maju saat halaman
    // Member dibuka dengan sengaja, jadi angka badge tetap akurat selama
    // daftar ini dilihat.
    if (memberListSeenLoaded) renderMemberBadge(countNewMembers(users, memberListSeen));
    adminUsersList.replaceChildren();
    if (!users.some((user) => String(user.id || user.username) === expandedAdminUserId)) expandedAdminUserId = null;
    if (!users.length) {
      const empty = document.createElement('p');
      empty.className = 'member-list-empty';
      empty.textContent = 'Belum ada akun member.';
      adminUsersList.append(empty);
    }

    const groups = [
      { key: 'admin', title: 'Admin', users: sortAdminUsersByRuntime(users.filter((user) => user.role === 'admin')) },
      { key: 'member', title: 'Member', users: sortAdminUsersByRuntime(users.filter((user) => user.role !== 'admin')) },
    ];
    for (const group of groups) {
      if (!group.users.length) continue;
      const groupSection = document.createElement('section');
      groupSection.className = 'member-account-group';
      groupSection.setAttribute('aria-label', `${group.title}, ${group.users.length} akun`);
      const groupHeading = document.createElement('div');
      groupHeading.className = 'member-account-group-heading';
      const groupTitle = document.createElement('h3');
      groupTitle.textContent = group.title;
      const groupCount = document.createElement('span');
      groupCount.textContent = `${group.users.length} akun`;
      groupHeading.append(groupTitle, groupCount);
      groupSection.append(groupHeading);

      for (const [index, user] of group.users.entries()) {
        const userId = String(user.id || user.username || `${group.key}-${index}`);
        const username = String(user.username || 'akun');
        const displayName = String(user.displayName || username);
        const detailId = `member-account-detail-${encodeURIComponent(userId)}`;
        const isOpen = userId === expandedAdminUserId;
        const pairingStatus = pairingLabels[user.whatsappStatus] || 'Belum tertaut';
        const roleLabel = user.isMainAdmin ? 'Admin Utama' : user.role === 'admin' ? 'Admin' : 'Member';
        const article = document.createElement('article');
        article.className = `member-account-item${isOpen ? ' is-open' : ''}${user.isMainAdmin ? ' is-main-admin' : ''}`;
        // Data filter Member: peran, status bot, dan status WhatsApp dibaca dari field yang sama dengan chip status di atas, supaya hitungan pil selalu sama dengan yang terlihat di kartu.
        article.dataset.memberRole = user.role === 'admin' ? 'admin' : 'member';
        article.dataset.memberBot = user.workerStatus === 'running' ? 'running' : 'stopped';
        article.dataset.memberWa = user.whatsappStatus === 'linked' ? 'linked' : 'unlinked';
        article.dataset.memberSearch = [username, displayName, user.email || ''].join(' ').toLowerCase();

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'member-account-toggle';
        toggle.dataset.memberToggle = 'true';
        toggle.dataset.userId = userId;
        toggle.dataset.username = username;
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-controls', detailId);
        toggle.setAttribute('aria-label', `${isOpen ? 'Tutup' : 'Lihat'} detail akun @${username}`);

        const topRow = document.createElement('span');
        topRow.className = 'member-account-top-row';
        const identity = document.createElement('span');
        identity.className = 'member-account-identity';
        const avatarImage = document.createElement('img');
        avatarImage.className = 'member-account-avatar';
        avatarImage.width = 44;
        avatarImage.height = 44;
        avatarImage.loading = 'lazy';
        avatarImage.decoding = 'async';
        avatarImage.alt = `Avatar ${roleLabel} ${displayName}`;
        const selectedAvatar = String(user.avatar || 'avatar-01');
        if (selectedAvatar === 'uploaded' && currentUser?.role === 'admin') {
          const version = encodeURIComponent(user.avatarUpdatedAt || '');
          avatarImage.src = `/api/admin/user-avatar?userId=${encodeURIComponent(userId)}&v=${version}`;
        } else {
          const preset = /^avatar-(0[1-9]|[123][0-9]|4[0-8])$/.test(selectedAvatar) ? selectedAvatar : 'avatar-01';
          avatarImage.src = `/avatars/${preset}.webp`;
        }
        avatarImage.addEventListener('error', () => { avatarImage.src = '/avatars/avatar-01.webp'; }, { once: true });
        const avatarWrap = document.createElement('span');
        avatarWrap.className = 'member-account-avatar-wrap';
        avatarWrap.append(avatarImage);
        // Titik online ala Facebook di sudut avatar: hijau bila pemilik akun
        // sedang membuka panel, tidak ada bila tidak aktif.
        if (user.panelActive) {
          const onlineDot = document.createElement('span');
          onlineDot.className = 'member-account-online-dot';
          onlineDot.title = 'Online';
          avatarWrap.append(onlineDot);
        }
        const identityText = document.createElement('span');
        identityText.className = 'member-account-identity-text';
        const name = document.createElement('strong');
        name.textContent = displayName;
        const handle = document.createElement('small');
        handle.textContent = `@${username}`;
        identityText.append(name, handle);
        identity.append(avatarWrap, identityText);
        const control = document.createElement('span');
        control.className = 'member-account-control';
        const controlLabel = document.createElement('span');
        controlLabel.className = 'member-account-toggle-label';
        controlLabel.textContent = isOpen ? 'Tutup detail' : 'Lihat detail';
        const chevron = document.createElement('span');
        chevron.className = 'member-account-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '⌄';
        control.append(controlLabel, chevron);
        topRow.append(identity, control);

        const statusRow = document.createElement('span');
        statusRow.className = 'member-account-statuses';
        const chips = [
          { text: roleLabel, icon: user.isMainAdmin ? 'crown' : null, className: `member-account-chip is-role${user.role === 'admin' ? ' is-admin' : ''}${user.isMainAdmin ? ' is-main-admin' : ''}`, title: user.isMainAdmin ? 'Admin Utama — akun admin dari config.json (WILYKUN), bukan admin biasa.' : null },
          ...(user.role !== 'admin' && user.banned ? [{ text: 'Diblokir', className: 'member-account-chip is-danger' }] : []),
          { text: user.panelActive ? 'Pemilik · Online' : 'Pemilik · Tidak aktif', className: `member-account-chip ${user.panelActive ? 'is-positive' : 'is-muted'}`, title: 'Status Online memakai heartbeat sesi panel dalam 75 detik terakhir; ini bukan status presence WhatsApp.' },
          { text: `WA · ${pairingStatus}`, className: `member-account-chip ${user.whatsappStatus === 'linked' ? 'is-positive' : user.whatsappStatus === 'failed' ? 'is-warning' : 'is-muted'}` },
          { text: `Bot WhatsApp · ${user.workerStatus === 'running' ? 'Berjalan' : user.workerStatus === 'waiting' ? 'Menunggu' : 'Berhenti'}`, className: `member-account-chip ${user.workerStatus === 'running' ? 'is-positive' : user.workerStatus === 'waiting' ? 'is-warning' : 'is-muted'}` },
          { text: `Mode · ${user.featureStats?.modeLabel || 'Mode belum dipilih'}`, className: `member-account-chip ${user.featureStats?.modeLabel && user.featureStats.modeLabel !== 'Mode belum dipilih' ? 'is-positive' : 'is-muted'}` },
          { runtime: true, className: `member-account-chip ${user.workerStatus === 'running' ? 'is-positive' : 'is-muted'}` },
        ];
        chips.forEach((chipInfo) => {
          const chip = document.createElement('span');
          chip.className = chipInfo.className;
          if (chipInfo.runtime) {
            if (user.workerStatus === 'running') {
              chip.dataset.workerRuntime = String(user.workerStartedAt || '');
              chip.dataset.runtimePrefix = 'Runtime bot';
              chip.textContent = `Runtime bot · ${formatWorkerRuntime(user.workerStartedAt)}`;
            } else {
              chip.textContent = `Runtime bot · ${user.workerStatus === 'waiting' ? 'menunggu' : 'tidak aktif'}`;
            }
          } else if (chipInfo.icon) {
            chip.append(createMemberIcon(chipInfo.icon), document.createTextNode(chipInfo.text));
          } else {
            chip.textContent = chipInfo.text;
          }
          if (chipInfo.title) chip.title = chipInfo.title;
          statusRow.append(chip);
        });
        toggle.append(topRow, statusRow);

        const details = document.createElement('div');
        details.id = detailId;
        details.className = 'member-account-details';
        details.hidden = !isOpen;
        const detailGrid = document.createElement('dl');
        detailGrid.className = 'member-detail-grid';
        const detailsData = [
          { label: 'Email', value: user.email || '—', icon: 'mail' },
          { label: 'Status akun', value: user.isMainAdmin ? 'Admin Utama' : user.role === 'admin' ? 'Administrator' : user.banned ? 'Diblokir oleh admin' : user.verified ? 'Terverifikasi' : 'Belum verifikasi', icon: 'shield' },
          { label: 'Aktivitas panel', value: user.panelActive ? 'Online' : 'Tidak aktif', icon: 'activity', note: formatPanelActivityNote(user) },
          { label: 'WhatsApp', value: pairingStatus, icon: 'whatsapp' },
          { label: 'Nomor tersamarkan', value: user.whatsappNumberMasked || 'Belum aktif', icon: 'phone' },
          { label: 'Bot WhatsApp', value: user.workerStatus === 'running' ? 'Berjalan' : user.workerStatus === 'waiting' ? 'Menunggu' : 'Berhenti', icon: 'bot' },
          { label: 'Runtime bot', value: user.workerStatus === 'running' ? formatWorkerRuntime(user.workerStartedAt) : 'Belum aktif', icon: 'clock' },
          { label: user.lastSeenSource === 'login' ? 'Login terakhir' : 'Terakhir terlihat', value: prettyDateTime(user.lastSeen), icon: 'clock' },
          { label: 'Bergabung', value: prettyDate(user.createdAt), icon: 'calendar' },
        ];
        const featureStats = user.featureStats || {};
        const storyReadCount = Math.max(0, Number(featureStats.storyReadCount) || 0);
        const reactionCount = Math.max(0, Number(featureStats.reactionCount) || 0);
        detailsData.forEach((detailInfo) => {
          const item = document.createElement('div');
          item.className = 'member-detail-item';
          const term = document.createElement('dt');
          term.append(createMemberIcon(detailInfo.icon), document.createTextNode(detailInfo.label));
          const description = document.createElement('dd');
          if (detailInfo.note) {
            const value = document.createElement('span');
            value.textContent = detailInfo.value;
            const note = document.createElement('small');
            note.className = 'member-detail-note';
            note.textContent = detailInfo.note;
            description.append(value, note);
          } else {
            description.textContent = detailInfo.value;
          }
          if (detailInfo.label === 'Runtime bot') {
            description.dataset.workerRuntime = user.workerStatus === 'running' ? String(user.workerStartedAt || '') : '';
            description.classList.add('member-worker-runtime');
          }
          item.append(term, description);
          detailGrid.append(item);
        });
        details.append(detailGrid);
        const featureFlags = featureStats.features || {};
        const featureSection = document.createElement('section');
        featureSection.className = 'member-feature-section';
        const featureHeading = document.createElement('h4');
        featureHeading.className = 'member-feature-heading';
        featureHeading.textContent = 'Fitur akun';
        const featureGrid = document.createElement('div');
        featureGrid.className = 'member-feature-grid';
        const workerRunning = user.workerStatus === 'running';
        const featureItems = [
          { name: 'ReadSW', icon: 'eye', enabled: featureFlags.readSW === true, detail: 'Menandai story sebagai dilihat.' },
          { name: 'ReactionSW', icon: 'heart', enabled: featureFlags.reactionSW === true, detail: 'Mengirim reaksi sesuai preferensi tersimpan.' },
          { name: 'Online 24 Jam', icon: 'spark', enabled: featureFlags.online24 === true, detail: 'Preferensi presence; bukan jaminan uptime 24/7.' },
        ];
        featureItems.forEach((feature) => {
          const card = document.createElement('article');
          card.className = `member-feature-card${feature.enabled ? ' is-enabled' : ''}`;
          const icon = document.createElement('span');
          icon.className = 'member-feature-icon';
          icon.append(createMemberIcon(feature.icon));
          const copy = document.createElement('span');
          copy.className = 'member-feature-copy';
          const name = document.createElement('strong');
          name.textContent = feature.name;
          const state = document.createElement('small');
          state.className = 'member-feature-state';
          state.textContent = feature.enabled
            ? feature.name === 'Online 24 Jam' ? 'Preferensi aktif' : workerRunning ? 'Berjalan' : 'Tersimpan'
            : 'Nonaktif';
          const note = document.createElement('small');
          note.className = 'member-feature-note';
          note.textContent = feature.detail;
          copy.append(name, state, note);
          card.append(icon, copy);
          featureGrid.append(card);
        });
        featureSection.append(featureHeading, featureGrid);
        const statsGrid = document.createElement('div');
        statsGrid.className = 'member-story-stats';
        [
          { label: 'Story dilihat', value: storyReadCount, icon: 'eye' },
          { label: 'Reaksi tercatat', value: reactionCount, icon: 'heart' },
        ].forEach((stat) => {
          const card = document.createElement('div');
          card.className = 'member-story-stat';
          const icon = document.createElement('span');
          icon.className = 'member-stat-icon';
          icon.append(createMemberIcon(stat.icon));
          const copy = document.createElement('span');
          copy.className = 'member-stat-copy';
          const label = document.createElement('small');
          label.textContent = stat.label;
          const value = document.createElement('strong');
          value.textContent = Math.max(0, Number(stat.value) || 0).toLocaleString('id-ID');
          copy.append(label, value);
          card.append(icon, copy);
          statsGrid.append(card);
        });
        details.append(featureSection, statsGrid);
        // Admin biasa hanya bisa mengelola member; Admin Utama juga bisa
        // mengelola admin biasa (blokir/hapus/kelola bot). Admin Utama sendiri
        // tidak bisa dikelola siapa pun (dijaga server).
        const canManageTarget = currentUser?.role === 'admin'
          && (user.role !== 'admin' || (currentUser.isMainAdmin === true && user.isMainAdmin !== true));
        if (canManageTarget) {
          const adminPanel = document.createElement('section');
          adminPanel.className = 'member-admin-panel';
          const heading = document.createElement('div');
          heading.className = 'member-admin-heading';
          const title = document.createElement('strong');
          title.textContent = 'Kontrol admin · pemantauan';
          const accountState = document.createElement('span');
          accountState.className = `member-admin-status${user.banned ? ' is-banned' : ''}`;
          accountState.textContent = user.banned ? 'Akun diblokir' : 'Akun aktif';
          heading.append(title, accountState);
          const note = document.createElement('p');
          note.className = 'member-admin-note';
          note.textContent = 'Admin dapat memantau dan mengelola worker bot, tetapi tidak masuk sebagai member. Pemilik akun menautkan WhatsApp sendiri.';
          const botActions = document.createElement('div');
          botActions.className = 'member-admin-actions';
          const addAdminButton = (label, action, disabled = false, variant = '') => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `button member-admin-button ${variant}`.trim();
            button.dataset.adminAction = action;
            button.dataset.userId = userId;
            button.textContent = label;
            button.disabled = disabled;
            botActions.append(button);
          };
          const linked = user.whatsappStatus === 'linked';
          addAdminButton('Start bot', 'bot-start', user.banned || !linked, 'button-primary');
          addAdminButton('Restart bot', 'bot-restart', user.banned || !linked, 'button-secondary');
          const hasWorker = user.workerStatus === 'running' || user.workerStatus === 'waiting' || user.botAutoStart === true || user.hasBotProfile === true;
          addAdminButton('Matikan bot', 'bot-stop', !hasWorker, 'button-secondary');
          const controlsNote = document.createElement('small');
          controlsNote.className = 'member-admin-hint';
          controlsNote.textContent = linked ? 'Start/restart memakai konfigurasi member. Tidak ada pairing atau akses isi pesan dari halaman ini.' : 'Start/restart tersedia setelah member menautkan WhatsApp dari akunnya sendiri.';
          const stateNote = document.createElement('p');
          stateNote.className = `member-admin-account-state${user.banned ? ' is-banned' : ''}`;
          stateNote.textContent = user.banned
            ? `Diblokir${user.bannedAt ? ` sejak ${prettyDateTime(user.bannedAt)}` : ''}${user.banReason ? ` · alasan: ${user.banReason}` : ''}. Worker/Online 24 Jam dimatikan; tautan WhatsApp tidak dihapus.`
            : 'Akun aktif. Admin tidak melihat kata sandi, kode pairing, atau isi percakapan.';
          adminPanel.append(heading, note, botActions, controlsNote, stateNote);
          if (user.banned) {
            const accountActions = document.createElement('div');
            accountActions.className = 'member-admin-actions member-admin-account-actions';
            const unbanButton = document.createElement('button');
            unbanButton.type = 'button';
            unbanButton.className = 'button member-admin-button button-primary';
            unbanButton.dataset.adminAction = 'unban';
            unbanButton.dataset.userId = userId;
            unbanButton.textContent = 'Buka blokir akun';
            accountActions.append(unbanButton);
            adminPanel.append(accountActions);
          } else {
            const reasonLabel = document.createElement('label');
            reasonLabel.className = 'member-admin-reason-label';
            const reasonCaption = document.createElement('span');
            reasonCaption.textContent = 'Alasan blokir (opsional, maksimal 240 karakter)';
            const reasonInput = document.createElement('textarea');
            reasonInput.dataset.adminBanReason = 'true';
            reasonInput.maxLength = 240;
            reasonInput.rows = 2;
            reasonInput.placeholder = 'Contoh: pelanggaran aturan penggunaan';
            reasonInput.value = adminBanReasons.get(userId) || '';
            reasonLabel.append(reasonCaption, reasonInput);
            const accountActions = document.createElement('div');
            accountActions.className = 'member-admin-actions member-admin-account-actions';
            const banButton = document.createElement('button');
            banButton.type = 'button';
            banButton.className = 'button member-admin-button button-danger';
            banButton.dataset.adminAction = 'ban';
            banButton.dataset.userId = userId;
            banButton.textContent = 'Blokir akun';
            accountActions.append(banButton);
            adminPanel.append(reasonLabel, accountActions);
          }
          const deleteSection = document.createElement('div');
          deleteSection.className = 'member-admin-delete';
          const deleteReasonLabel = document.createElement('label');
          deleteReasonLabel.className = 'member-admin-reason-label';
          const deleteReasonCaption = document.createElement('span');
          deleteReasonCaption.textContent = 'Alasan hapus akun (opsional, maksimal 240 karakter)';
          const deleteReasonInput = document.createElement('textarea');
          deleteReasonInput.dataset.adminDeleteReason = 'true';
          deleteReasonInput.maxLength = 240;
          deleteReasonInput.rows = 2;
          deleteReasonInput.placeholder = 'Contoh: akun tidak aktif';
          deleteReasonInput.value = adminDeleteReasons.get(userId) || '';
          deleteReasonLabel.append(deleteReasonCaption, deleteReasonInput);
          const deleteActions = document.createElement('div');
          deleteActions.className = 'member-admin-actions';
          const deleteButton = document.createElement('button');
          deleteButton.type = 'button';
          deleteButton.className = 'button member-admin-button button-danger';
          deleteButton.dataset.adminAction = 'member-delete';
          deleteButton.dataset.userId = userId;
          deleteButton.textContent = 'Hapus akun permanen';
          deleteActions.append(deleteButton);
          deleteSection.append(deleteReasonLabel, deleteActions);
          adminPanel.append(deleteSection);
          details.append(adminPanel);
        }
        article.append(toggle, details);
        groupSection.append(article);
      }
      adminUsersList.append(groupSection);
    }
    updateMemberFilterCounts();
    applyMemberFilter();
    const visible = Boolean(currentUser);
    section.classList.toggle('hidden', !visible);
    document.querySelector('#admin-nav').classList.toggle('hidden', !visible);
    document.querySelector('#admin-title').textContent = isAdmin ? 'Pemantauan akun member' : 'Daftar member';
    document.querySelector('#admin-description').textContent = isAdmin
      ? 'Status akun diperbarui tiap 15 detik dan runtime worker tiap detik. “Panel aktif” berarti akun masih membuka web dalam 75 detik terakhir; status panel ini berbeda dari status WhatsApp dan worker bot.'
      : 'Daftar ini hanya untuk melihat identitas dasar akun. Member tidak dapat mengontrol, mengedit, memasangkan WhatsApp, atau membuka data akun member lain.';
    // Halaman Backup (menu + seksi) hanya untuk admin; menunya tetap terlihat tapi terkunci untuk member, isi halamannya disembunyikan total.
    const backupNav = document.querySelector('#backup-nav');
    backupNav?.classList.remove('hidden');
    backupNav?.classList.toggle('nav-item-locked', !isAdmin);
    backupNav?.setAttribute('aria-disabled', String(!isAdmin));
    document.querySelector('#backup')?.classList.toggle('hidden', !isAdmin);
    // Halaman Kontrol Bot diperlakukan sama seperti Backup: menunya tetap terlihat tapi terkunci untuk member, isi halamannya disembunyikan total.
    const botControlNav = document.querySelector('#botcontrol-nav');
    botControlNav?.classList.remove('hidden');
    botControlNav?.classList.toggle('nav-item-locked', !isAdmin);
    botControlNav?.setAttribute('aria-disabled', String(!isAdmin));
    document.querySelector('#botcontrol')?.classList.toggle('hidden', !isAdmin);
    document.querySelector('#admin-updated').textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date())} WIB`;
    ensureWorkerRuntimeTicker();
  } catch (error) {
    if (error.status === 403) {
      section.classList.add('hidden');
      document.querySelector('#admin-nav').classList.add('hidden');
    }
  }
}

// Filter + pencarian Member ala Log privat: pil kategori berangka dan kotak pencarian di atas daftar, dengan hitungan yang dihitung ulang dari akun yang sedang tampil setiap kali daftar me-refresh (15 detik) dan filter yang sedang aktif tetap dipertahankan.
let memberFilter = 'all';
let memberQuery = '';
function memberFilterCounts() {
  const counts = { all: 0, admin: 0, member: 0, running: 0, linked: 0, inactive: 0 };
  document.querySelectorAll('#admin-users .member-account-item').forEach((article) => {
    counts.all += 1;
    if (article.dataset.memberRole === 'admin') counts.admin += 1;
    if (article.dataset.memberRole === 'member') counts.member += 1;
    if (article.dataset.memberBot === 'running') counts.running += 1;
    if (article.dataset.memberWa === 'linked') counts.linked += 1;
    if (article.dataset.memberBot !== 'running' && article.dataset.memberWa !== 'linked') counts.inactive += 1;
  });
  return counts;
}
function updateMemberFilterCounts() {
  const counts = memberFilterCounts();
  document.querySelectorAll('[data-member-filters] [data-filter-count]').forEach((countEl) => {
    const key = countEl.dataset.filterCount;
    if (Object.hasOwn(counts, key)) countEl.textContent = String(counts[key]);
  });
}
function memberArticleMatches(article) {
  if (memberFilter === 'admin' && article.dataset.memberRole !== 'admin') return false;
  if (memberFilter === 'member' && article.dataset.memberRole !== 'member') return false;
  if (memberFilter === 'running' && article.dataset.memberBot !== 'running') return false;
  if (memberFilter === 'linked' && article.dataset.memberWa !== 'linked') return false;
  if (memberFilter === 'inactive' && (article.dataset.memberBot === 'running' || article.dataset.memberWa === 'linked')) return false;
  if (!memberQuery) return true;
  return (article.dataset.memberSearch || '').includes(memberQuery);
}
function applyMemberFilter() {
  const articles = [...document.querySelectorAll('#admin-users .member-account-item')];
  let visible = 0;
  articles.forEach((article) => {
    const match = memberArticleMatches(article);
    article.classList.toggle('is-filtered-out', !match);
    if (match) visible += 1;
  });
  document.querySelectorAll('#admin-users .member-account-group').forEach((group) => {
    const hasVisible = [...group.querySelectorAll('.member-account-item')].some((article) => !article.classList.contains('is-filtered-out'));
    group.toggleAttribute('hidden', !hasVisible);
  });
  document.querySelector('#member-filter-empty')?.toggleAttribute('hidden', !(articles.length > 0 && visible === 0));
}
document.querySelector('#member-search')?.addEventListener('input', (event) => {
  memberQuery = String(event.target.value || '').trim().toLowerCase();
  applyMemberFilter();
});
document.querySelector('[data-member-filters]')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-member-filter]');
  if (!button) return;
  memberFilter = button.dataset.memberFilter;
  document.querySelectorAll('[data-member-filters] .filter-pill').forEach((pill) => {
    const active = pill === button;
    pill.classList.toggle('is-active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
  applyMemberFilter();
});

// Rank Bot: peringkat bot teraktif berdasarkan data tiap akun (DATA_AKUN) —
// story dibaca dan reaksi terkirim dari swstats.json masing-masing akun,
// dibaca server lewat readAccountFeatureStats dan dikirim lewat /api/members
// yang bisa dibuka semua akun yang login (member, Admin Utama, admin biasa).
// Tiga kategori terpisah: Semua (total aktivitas), Read Only (story dibaca),
// ReadSW + ReactionSW (reaksi terkirim). Urutan selalu terbanyak di atas.
let rankBotUsers = [];
let rankBotFilter = 'all';
let rankBotQuery = '';
let rankBotTimer = null;
const rankBotList = document.querySelector('#rankbot-users');
function rankCategoryOf(user) {
  const modeLabel = String(user?.featureStats?.modeLabel || '');
  if (modeLabel.startsWith('ReadSW + ReactionSW')) return 'readsw';
  if (modeLabel.startsWith('ReadSW')) return 'readonly';
  return 'none';
}
function rankScoreOf(user, category) {
  const stats = user?.featureStats || {};
  const reads = Math.max(0, Number(stats.storyReadCount) || 0);
  const reactions = Math.max(0, Number(stats.reactionCount) || 0);
  if (category === 'readonly') return reads;
  if (category === 'readsw') return reactions;
  return reads + reactions;
}
function rankLevelFor(count) {
  const value = Math.max(0, Number(count) || 0);
  if (value >= 500) return { label: 'Legenda', className: 'rank-level-legend' };
  if (value >= 200) return { label: 'Master', className: 'rank-level-master' };
  if (value >= 50) return { label: 'Rajin', className: 'rank-level-rajin' };
  if (value >= 1) return { label: 'Aktif', className: 'rank-level-aktif' };
  return { label: 'Pemula', className: 'rank-level-pemula' };
}
function rankModeShortLabel(modeLabel) {
  return String(modeLabel).replace('ReadSW + ReactionSW', 'ReadSW + Reaksi');
}
function sortRankBotUsers(users, category) {
  const inCategory = category === 'all' ? users : users.filter((user) => rankCategoryOf(user) === category);
  return [...inCategory].sort((a, b) => {
    const diff = rankScoreOf(b, category) - rankScoreOf(a, category);
    if (diff !== 0) return diff;
    return String(a.displayName || a.username || '').localeCompare(String(b.displayName || b.username || ''), 'id');
  });
}

// Notifikasi salip Rank Bot: tiap kali peringkat "Semua" dimuat ulang
// (dibuka atau polling 15 detik), urutan baru dibandingkan dengan urutan
// terakhir yang dilihat. Akun A menyalip B bila A dulu di bawah B dan kini
// di atas B — akun yang baru muncul atau hilang tidak dihitung sebagai salip,
// jadi hapus akun tidak memicu kartu palsu. Urutan terakhir disimpan juga di
// localStorage per akun yang login, supaya salip yang terjadi selagi halaman
// ditinggal tetap muncul sebagai kartu begitu Rank Bot dibuka lagi.
let rankOvertakeSnapshot = null;
let rankOvertakeSeen = false;
const rankOvertakeNotified = new Map();
function rankBotOrderUsernames(users) {
  return sortRankBotUsers(users, 'all').map((user) => String(user.username || ''));
}
function findRankBotOvertakes(previousOrder, currentOrder) {
  const previousPosition = new Map(previousOrder.map((username, index) => [username, index + 1]));
  const currentPosition = new Map(currentOrder.map((username, index) => [username, index + 1]));
  const events = [];
  for (const overtaker of currentOrder) {
    const before = previousPosition.get(overtaker);
    const now = currentPosition.get(overtaker);
    if (before === undefined || now === undefined || now >= before) continue;
    for (const overtaken of currentOrder) {
      if (overtaken === overtaker) continue;
      const overtakenBefore = previousPosition.get(overtaken);
      const overtakenNow = currentPosition.get(overtaken);
      if (overtakenBefore === undefined || overtakenNow === undefined) continue;
      if (overtakenBefore < before && overtakenNow > now) {
        events.push({ overtaker, overtaken, newPosition: now, oldPosition: before, overtakenNewPosition: overtakenNow });
      }
    }
  }
  // Yang paling dekat ke puncak dulu, lalu lompatan terbesar.
  events.sort((a, b) => (a.newPosition - b.newPosition) || ((b.oldPosition - b.newPosition) - (a.oldPosition - a.newPosition)));
  return events;
}
function rankBotLastSeenKey() {
  return `rankbot-last-seen:${String(currentUser?.username || 'anon')}`;
}
function readRankBotLastSeenOrder() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(rankBotLastSeenKey()) || 'null');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : null;
  } catch { return null; }
}
function writeRankBotLastSeenOrder(order) {
  try { window.localStorage.setItem(rankBotLastSeenKey(), JSON.stringify(order)); } catch { /* Urutan terakhir hanya pengingat lokal. */ }
}
function rankOvertakeDisplayName(username) {
  const user = rankBotUsers.find((item) => String(item.username || '') === username);
  return String(user?.displayName || username);
}
function notifyRankBotOvertake(event, live) {
  const overtakerName = rankOvertakeDisplayName(event.overtaker);
  const overtakenName = rankOvertakeDisplayName(event.overtaken);
  const openers = ['Wush!', 'Ngebut!', 'Salip menyalip!'];
  const opener = openers[(event.overtaker.length + event.newPosition) % openers.length];
  const when = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
  const text = live
    ? `${opener} ${overtakerName} menyalip ${overtakenName} dan kini #${event.newPosition} — ${overtakenName} turun ke #${event.overtakenNewPosition}. ${when} WIB.`
    : `Sejak terakhir kamu lihat, ${overtakerName} menyalip ${overtakenName} dan kini #${event.newPosition} — ${overtakenName} turun ke #${event.overtakenNewPosition}. ${when} WIB.`;
  const overtaker = rankBotUsers.find((item) => String(item.username || '') === event.overtaker);
  const overtaken = rankBotUsers.find((item) => String(item.username || '') === event.overtaken);
  showNoticeOverlay({
    title: 'Ada yang menyalip di Rank Bot!',
    text,
    context: { kind: 'rankovertake', userId: overtaker?.id || event.overtaker, feature: overtaken?.id || event.overtaken },
    addLabel: null,
    icon: '🏆',
  });
  rankOvertakeNotified.set(`${event.overtaker}>${event.overtaken}`, Date.now());
}
function notifyRankBotClimb(event, live) {
  const overtakenName = rankOvertakeDisplayName(event.overtaken);
  const when = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
  const isTop = event.newPosition === 1;
  const openers = isTop ? ['Puncak!', 'Juara!', 'Nomor satu!'] : ['Gas!', 'Naik terus!', 'Makin dekat ke puncak!'];
  const opener = openers[(event.overtaker.length + event.newPosition) % openers.length];
  const text = live
    ? `${opener} Kamu menyalip ${overtakenName} dan kini #${event.newPosition} (dari #${event.oldPosition}). ${when} WIB.`
    : `Sejak terakhir kamu lihat, kamu menyalip ${overtakenName} dan kini #${event.newPosition} (dari #${event.oldPosition}). ${when} WIB.`;
  const overtaken = rankBotUsers.find((item) => String(item.username || '') === event.overtaken);
  const viewer = rankBotUsers.find((item) => String(item.username || '') === event.overtaker);
  showNoticeOverlay({
    title: isTop ? 'Kamu nomor 1 di Rank Bot!' : 'Kamu naik peringkat!',
    text,
    context: { kind: 'rankclimb', userId: viewer?.id || event.overtaker, feature: overtaken?.id || event.overtaken },
    addLabel: null,
    icon: isTop ? '👑' : '🚀',
  });
  rankOvertakeNotified.set(`${event.overtaker}>${event.overtaken}`, Date.now());
}
function checkRankBotOvertakes() {
  const current = rankBotOrderUsernames(rankBotUsers);
  if (!current.length) return;
  const previous = rankOvertakeSeen ? rankOvertakeSnapshot : readRankBotLastSeenOrder();
  if (previous && previous.length) {
    const events = findRankBotOvertakes(previous, current);
    // Satu kartu per muat ulang (yang paling dekat ke puncak), dan pasangan
    // yang sama tidak diberitakan lagi dalam 10 menit supaya salip bolak-balik
    // tidak membanjiri layar.
    const fresh = events.filter((item) => (Date.now() - (rankOvertakeNotified.get(`${item.overtaker}>${item.overtaken}`) || 0)) > 10 * 60 * 1000);
    // Naik peringkat sendiri didahulukan dan kartunya beda dari kartu salip
    // biasa: judul, ikon, dan kata pembukanya khusus untuk yang login.
    const viewer = String(currentUser?.username || '');
    const climb = viewer ? fresh.find((item) => item.overtaker === viewer) : null;
    if (climb) notifyRankBotClimb(climb, rankOvertakeSeen);
    else if (fresh[0]) notifyRankBotOvertake(fresh[0], rankOvertakeSeen);
  }
  rankOvertakeSnapshot = current;
  rankOvertakeSeen = true;
  writeRankBotLastSeenOrder(current);
}
function renderRankBot() {
  if (!rankBotList) return;
  const sorted = sortRankBotUsers(rankBotUsers, rankBotFilter);
  rankBotList.replaceChildren();
  if (!sorted.length) {
    const empty = document.createElement('p');
    empty.className = 'member-list-empty';
    empty.textContent = 'Belum ada bot di kategori ini.';
    rankBotList.append(empty);
    document.querySelector('#rankbot-filter-empty')?.setAttribute('hidden', '');
    return;
  }
  let visible = 0;
  for (const [index, user] of sorted.entries()) {
    const username = String(user.username || 'akun');
    const displayName = String(user.displayName || username);
    const searchText = [username, displayName].join(' ').toLowerCase();
    if (rankBotQuery && !searchText.includes(rankBotQuery)) continue;
    visible += 1;
    const position = index + 1;
    const score = rankScoreOf(user, rankBotFilter);
    const level = rankLevelFor(score);
    const reads = Math.max(0, Number(user?.featureStats?.storyReadCount) || 0);
    const reactions = Math.max(0, Number(user?.featureStats?.reactionCount) || 0);
    const scoreLabel = rankBotFilter === 'readonly' ? 'story dibaca' : rankBotFilter === 'readsw' ? 'reaksi terkirim' : 'total aktivitas';
    const roleLabel = user.isMainAdmin ? 'Admin Utama' : user.role === 'admin' ? 'Admin' : 'Member';
    // Baris akun sendiri (yang sedang login) dibedakan dengan cincin avatar
    // emas dan lencana "Kamu" supaya langsung ketemu saat mencari di daftar.
    const isSelf = Boolean(currentUser && String(currentUser.username || '') === username);
    const article = document.createElement('article');
    article.className = `rankbot-item${position <= 3 ? ` rank-top-${position}` : ''}${user.isMainAdmin ? ' is-main-admin' : ''}${isSelf ? ' is-self' : ''}`;
    article.dataset.rankbotSearch = searchText;
    const positionBadge = document.createElement('span');
    positionBadge.className = `rankbot-position rank-${position <= 3 ? position : 'rest'}`;
    positionBadge.textContent = `#${position}`;
    const avatarImage = document.createElement('img');
    avatarImage.className = 'rankbot-avatar';
    avatarImage.width = 44;
    avatarImage.height = 44;
    avatarImage.loading = 'lazy';
    avatarImage.decoding = 'async';
    avatarImage.alt = `Avatar ${roleLabel} ${displayName}`;
    const selectedAvatar = String(user.avatar || 'avatar-01');
    const preset = /^avatar-(0[1-9]|[123][0-9]|4[0-8])$/.test(selectedAvatar) ? selectedAvatar : 'avatar-01';
    avatarImage.src = `/avatars/${preset}.webp`;
    avatarImage.addEventListener('error', () => { avatarImage.src = '/avatars/avatar-01.webp'; }, { once: true });
    const identity = document.createElement('div');
    identity.className = 'rankbot-identity';
    const nameRow = document.createElement('div');
    nameRow.className = 'rankbot-name-row';
    const name = document.createElement('strong');
    name.className = 'rankbot-name';
    name.textContent = displayName;
    const roleChip = document.createElement('span');
    roleChip.className = 'rankbot-role';
    roleChip.textContent = roleLabel;
    nameRow.append(name, roleChip);
    if (isSelf) {
      const selfBadge = document.createElement('span');
      selfBadge.className = 'rankbot-self-badge';
      selfBadge.textContent = 'Kamu';
      nameRow.append(selfBadge);
    }
    const handle = document.createElement('small');
    handle.className = 'rankbot-handle';
    handle.textContent = `@${username}`;
    const modeChip = document.createElement('span');
    modeChip.className = 'rankbot-mode';
    modeChip.textContent = rankModeShortLabel(String(user?.featureStats?.modeLabel || 'Mode belum dipilih'));
    const statsLine = document.createElement('p');
    statsLine.className = 'rankbot-stats';
    statsLine.textContent = `${reads} story dibaca · ${reactions} reaksi terkirim`;
    // Status realtime tiap baris: pemilik sedang aktif di web atau tidak, dan
    // bot WhatsApp akun itu sedang berjalan atau berhenti — dibaca dari
    // /api/members yang sama dengan peringkatnya.
    const statusLine = document.createElement('div');
    statusLine.className = 'rankbot-status';
    const ownerItem = document.createElement('span');
    const ownerActive = Boolean(user.panelActive);
    ownerItem.className = `rankbot-status-item${ownerActive ? ' is-active' : ' is-muted'}`;
    ownerItem.append(createMemberIcon('user'));
    ownerItem.append(document.createTextNode(`Pemilik · ${ownerActive ? 'Aktif' : 'Tidak Aktif'}`));
    const botItem = document.createElement('span');
    const botState = user.workerStatus === 'running' ? 'running' : user.workerStatus === 'waiting' ? 'waiting' : 'stopped';
    botItem.className = `rankbot-status-item${botState === 'running' ? ' is-active' : botState === 'waiting' ? ' is-waiting' : ' is-muted'}`;
    botItem.append(createMemberIcon('whatsapp'));
    botItem.append(document.createTextNode(`Bot WhatsApp · ${botState === 'running' ? 'Berjalan' : botState === 'waiting' ? 'Menunggu' : 'Berhenti'}`));
    statusLine.append(ownerItem, botItem);
    identity.append(nameRow, handle, modeChip, statsLine, statusLine);
    const side = document.createElement('div');
    side.className = 'rankbot-side';
    const scoreBlock = document.createElement('div');
    scoreBlock.className = 'rankbot-score';
    const scoreValue = document.createElement('strong');
    scoreValue.textContent = String(score);
    const scoreLabelEl = document.createElement('span');
    scoreLabelEl.textContent = scoreLabel;
    scoreBlock.append(scoreValue, scoreLabelEl);
    const levelBadge = document.createElement('span');
    levelBadge.className = `rankbot-level ${level.className}`;
    levelBadge.textContent = level.label;
    side.append(scoreBlock, levelBadge);
    article.append(positionBadge, avatarImage, identity, side);
    rankBotList.append(article);
  }
  document.querySelector('#rankbot-filter-empty')?.toggleAttribute('hidden', !(sorted.length > 0 && visible === 0));
  const counts = {
    all: rankBotUsers.length,
    readonly: rankBotUsers.filter((user) => rankCategoryOf(user) === 'readonly').length,
    readsw: rankBotUsers.filter((user) => rankCategoryOf(user) === 'readsw').length,
  };
  document.querySelectorAll('[data-rankbot-filters] [data-filter-count]').forEach((countEl) => {
    const key = countEl.dataset.filterCount;
    if (Object.hasOwn(counts, key)) countEl.textContent = String(counts[key]);
  });
}
async function loadRankBot() {
  try {
    const result = await api('/api/members');
    rankBotUsers = Array.isArray(result.users) ? result.users : [];
    renderRankBot();
    checkRankBotOvertakes();
    document.querySelector('#rankbot-updated').textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date())} WIB`;
  } catch (error) {
    if (error.status === 401) showAuth();
  }
}
function startRankBotPolling() {
  if (rankBotTimer) return;
  rankBotTimer = window.setInterval(() => {
    if (activeWorkspacePage === 'rankbot' && document.visibilityState === 'visible') void loadRankBot();
  }, 15000);
}
document.querySelector('#rankbot-search')?.addEventListener('input', (event) => {
  rankBotQuery = String(event.target.value || '').trim().toLowerCase();
  renderRankBot();
});
document.querySelector('[data-rankbot-filters]')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-rankbot-filter]');
  if (!button) return;
  rankBotFilter = button.dataset.rankbotFilter;
  document.querySelectorAll('[data-rankbot-filters] .filter-pill').forEach((pill) => {
    const active = pill === button;
    pill.classList.toggle('is-active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
  renderRankBot();
});

// Halaman Aktivitas Akun: kapan tiap pemilik terakhir login ke web panel,
// diurutkan dari yang paling baru login; diperbarui realtime tiap 15 detik.
// Waktu login diambil dari riwayat login akun (lastLoginAt di /api/members),
// dan hanya bila akun belum pernah tercatat login, dipakai aktivitas panel
// terakhir (lastSeen) sebagai pengganti.
const accountActivityList = document.querySelector('#accountactivity-users');
let accountActivityUsers = [];
let accountActivityTimer = null;

// Jam yang tampil adalah aktivitas web terbaru akun itu: login terakhir,
// atau terakhir terlihat di panel selagi halamannya terbuka (heartbeat
// tiap 25 detik) — jadi akun yang sedang membuka panel selalu menunjukkan
// jam saat ini, bukan jam login autentikasinya yang sudah lama.
function accountActivityLoginValue(user) {
  const loginMs = user?.lastLoginAt ? Date.parse(String(user.lastLoginAt)) : NaN;
  const seenMs = user?.lastSeen ? Number(user.lastSeen) : NaN;
  const latestMs = Math.max(Number.isNaN(loginMs) ? -Infinity : loginMs, Number.isNaN(seenMs) ? -Infinity : seenMs);
  if (latestMs === -Infinity) return null;
  return new Date(latestMs).toISOString();
}

function accountActivityTimeLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date);
}

// Pagi 04.00–10.59, Siang 11.00–14.59, Sore 15.00–17.59, Malam 18.00–03.59 WIB.
function accountActivityDaypart(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hour = Number(new Intl.DateTimeFormat('id-ID', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(date));
  if (hour >= 4 && hour < 11) return 'Pagi';
  if (hour >= 11 && hour < 15) return 'Siang';
  if (hour >= 15 && hour < 18) return 'Sore';
  return 'Malam';
}

function renderAccountActivity() {
  if (!accountActivityList) return;
  // Urutan baris: akun sendiri paling atas, lalu pemilik yang sedang aktif di panel, baru yang paling baru login.
  const viewer = String(currentUser?.username || '');
  const sorted = [...accountActivityUsers].sort((a, b) => {
    const aSelf = viewer && String(a.username || '') === viewer ? 0 : 1;
    const bSelf = viewer && String(b.username || '') === viewer ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    const aActive = a.panelActive ? 0 : 1;
    const bActive = b.panelActive ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aMs = Date.parse(accountActivityLoginValue(a) || '') || 0;
    const bMs = Date.parse(accountActivityLoginValue(b) || '') || 0;
    return bMs - aMs;
  });
  accountActivityList.replaceChildren();
  if (!sorted.length) {
    const empty = document.createElement('p');
    empty.className = 'member-list-empty';
    empty.textContent = 'Belum ada akun.';
    accountActivityList.append(empty);
    return;
  }
  for (const user of sorted) {
    const username = String(user.username || 'akun');
    const displayName = String(user.displayName || username);
    const timeLabel = accountActivityTimeLabel(accountActivityLoginValue(user));
    const isSelf = Boolean(viewer && username === viewer);
    const article = document.createElement('article');
    article.className = `accountactivity-item${isSelf ? ' is-self' : ''}`;
    const avatarWrap = document.createElement('span');
    avatarWrap.className = 'accountactivity-avatar-wrap';
    const avatarImage = document.createElement('img');
    avatarImage.className = 'accountactivity-avatar';
    avatarImage.width = 40;
    avatarImage.height = 40;
    avatarImage.loading = 'lazy';
    avatarImage.decoding = 'async';
    avatarImage.alt = `Avatar ${displayName}`;
    const selectedAvatar = String(user.avatar || 'avatar-01');
    const preset = /^avatar-(0[1-9]|[123][0-9]|4[0-8])$/.test(selectedAvatar) ? selectedAvatar : 'avatar-01';
    avatarImage.src = `/avatars/${preset}.webp`;
    avatarImage.addEventListener('error', () => { avatarImage.src = '/avatars/avatar-01.webp'; }, { once: true });
    avatarWrap.append(avatarImage);
    // Titik online ala Facebook di sudut avatar: hijau bila pemilik akun
    // sedang membuka panel, tidak ada bila tidak aktif.
    if (user.panelActive) {
      const onlineDot = document.createElement('span');
      onlineDot.className = 'accountactivity-online-dot';
      onlineDot.title = 'Online';
      avatarWrap.append(onlineDot);
    }
    const body = document.createElement('div');
    body.className = 'accountactivity-body';
    const nameRow = document.createElement('div');
    nameRow.className = 'accountactivity-namerow';
    const name = document.createElement('strong');
    name.className = 'accountactivity-name';
    name.textContent = displayName;
    const roleLabel = user.isMainAdmin ? 'Admin Utama' : user.role === 'admin' ? 'Admin' : 'Member';
    const roleChip = document.createElement('span');
    roleChip.className = `accountactivity-role${user.isMainAdmin ? ' is-main-admin' : user.role === 'admin' ? ' is-admin' : ''}`;
    roleChip.textContent = roleLabel;
    nameRow.append(name, roleChip);
    if (isSelf) {
      const selfBadge = document.createElement('span');
      selfBadge.className = 'rankbot-self-badge';
      selfBadge.textContent = 'Kamu';
      nameRow.append(selfBadge);
    }
    const loginLine = document.createElement('p');
    loginLine.className = 'accountactivity-login';
    loginLine.append(createMemberIcon('clock'));
    const daypart = accountActivityDaypart(accountActivityLoginValue(user));
    loginLine.append(document.createTextNode(timeLabel ? `Pemilik Login Ke Web · ${timeLabel} WIB · ${daypart}` : 'Pemilik Login Ke Web · Belum pernah login'));
    body.append(nameRow, loginLine);
    article.append(avatarWrap, body);
    accountActivityList.append(article);
  }
}

async function loadAccountActivity() {
  try {
    const result = await api('/api/members');
    accountActivityUsers = Array.isArray(result.users) ? result.users : [];
    renderAccountActivity();
    checkAccountActivityLogins(accountActivityUsers);
    // Membuka halaman berarti semua login sudah dilihat: tandai agar titik
    // merah di menu hilang sampai ada login baru lagi.
    const maxLogin = accountActivityUsers.reduce((max, item) => (!max || String(item.lastLoginAt || '') > max ? String(item.lastLoginAt) : max), null);
    if (maxLogin) window.localStorage.setItem(accountActivityLastSeenKey(), maxLogin);
    syncAccountActivityLoginBadge(maxLogin);
    const activityUpdated = document.querySelector('#accountactivity-updated');
    if (activityUpdated) activityUpdated.textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date())} WIB`;
  } catch (error) {
    if (error.status === 401) showAuth();
  }
}

// Login yang sudah terlihat di halaman Aktivitas Akun pada sesi ini —
// muatan pertama hanya menandai, tanpa notifikasi, supaya login lama tidak
// dianggap baru tiap halaman dibuka.
let accountActivitySeenLogins = null;
function checkAccountActivityLogins(users) {
  const now = Date.now();
  if (!accountActivitySeenLogins) {
    accountActivitySeenLogins = new Map(users.map((item) => [item.id, item.lastLoginAt || null]));
    return;
  }
  const fresh = users
    .filter((item) => String(item.username || '') !== String(currentUser?.username || ''))
    .filter((item) => item.lastLoginAt && item.lastLoginAt !== accountActivitySeenLogins.get(item.id))
    .filter((item) => Date.parse(item.lastLoginAt) > now - 5 * 60 * 1000)
    .sort((a, b) => Date.parse(b.lastLoginAt) - Date.parse(a.lastLoginAt));
  for (const item of users) accountActivitySeenLogins.set(item.id, item.lastLoginAt || null);
  const newest = fresh[0];
  if (!newest) return;
  const label = accountActivityTimeLabel(newest.lastLoginAt);
  showNoticeOverlay({
    title: 'Ada yang baru login ke web panel!',
    text: `${newest.displayName || newest.username} baru saja login ke web panel${label ? ` · ${label} WIB` : ''}.`,
    context: { kind: 'accountactivitylogin', userId: newest.id, feature: newest.lastLoginAt },
    addLabel: null,
    icon: '👤',
  });
}

function accountActivityLastSeenKey() {
  return `accountactivity-last-seen:${String(currentUser?.username || 'anon')}`;
}

// Titik merah di menu Aktivitas Akun bila ada login akun lain yang belum
// dilihat — heartbeat mengabarkan login terbaru tiap 25 detik, jadi titik
// ini muncul realtime dari halaman mana pun.
function syncAccountActivityLoginBadge(latestLoginAt) {
  const nav = document.querySelector('#accountactivity-nav');
  if (!nav) return;
  const seen = window.localStorage.getItem(accountActivityLastSeenKey());
  const hasUnseen = Boolean(latestLoginAt && (!seen || String(latestLoginAt) > seen));
  let dot = nav.querySelector('.accountactivity-dot');
  if (!hasUnseen) {
    dot?.remove();
    return;
  }
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'accountactivity-dot';
    dot.setAttribute('aria-label', 'Ada login baru ke web panel');
    nav.append(dot);
  }
}

function startAccountActivityPolling() {
  if (accountActivityTimer) return;
  accountActivityTimer = window.setInterval(() => {
    if (activeWorkspacePage === 'accountactivity' && document.visibilityState === 'visible') void loadAccountActivity();
  }, 15000);
}

// Kontrol Bot: daftar bot akun lain untuk admin. Admin biasa hanya bisa
// mengelola member, Admin Utama juga bisa mengelola admin biasa, dan Admin
// Utama sendiri tidak bisa dikelola siapa pun — aturan yang sama dipakai
// server, jadi kartu yang tidak bisa dikontrol sudah terlihat terkunci
// sebelum tombolnya ditekan.
let botControlFilter = 'all';
let botControlQuery = '';
let expandedBotControlUserId = null;
let botControlUsersTimer = null;
// Draf pengaturan fitur per akun, supaya editan admin yang belum disimpan tidak hilang saat daftar diperbarui berkala.
const botControlSettingsDrafts = new Map();

function normalizeBotControlSettings(botSettings) {
  const raw = botSettings?.storySettings || {};
  const values = { ...DEFAULT_STORY_SETTINGS, ...raw };
  const min = Math.min(20, Math.max(1, Number(values.delayMinSeconds) || 1));
  const max = Math.min(20, Math.max(min, Number(values.delayMaxSeconds) || 20));
  const mode = botSettings?.mode === 'readonly_readsw' ? 'readonly_readsw' : botSettings?.mode === 'readonly' ? 'readonly' : null;
  const options = [...new Set(Array.isArray(values.emojiOptions) ? values.emojiOptions : values.emojiPool)];
  const pool = [...new Set(Array.isArray(values.emojiPool) ? values.emojiPool : [])].filter((emoji) => options.includes(emoji));
  return { label: botSettings?.label || null, mode, online24: botSettings?.online24 === true, delayMinSeconds: min, delayMaxSeconds: max, autoReaction: mode === 'readonly_readsw' && values.autoReaction !== false, emojiOptions: options, emojiPool: pool };
}

function renderBotControlEmojiGrid(grid, draft) {
  grid.replaceChildren();
  if (!draft.emojiOptions.length) {
    const empty = document.createElement('small');
    empty.className = 'emoji-empty';
    empty.textContent = 'Belum ada emoji. Tambahkan satu di bawah.';
    grid.append(empty);
    return;
  }
  const selected = new Set(draft.emojiPool);
  for (const emoji of draft.emojiOptions) {
    const item = document.createElement('div');
    item.className = 'botcontrol-emoji-item';
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'botcontrol-emoji-choice';
    choice.dataset.emoji = emoji;
    choice.textContent = emoji;
    choice.classList.toggle('selected', selected.has(emoji));
    choice.setAttribute('aria-pressed', String(selected.has(emoji)));
    choice.setAttribute('aria-label', `${emoji} ${selected.has(emoji) ? 'aktif' : 'nonaktif'}`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'botcontrol-emoji-remove';
    remove.dataset.removeEmoji = emoji;
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Hapus emoji ${emoji} dari akun ini`);
    item.append(choice, remove);
    grid.append(item);
  }
}

function syncBotControlSettingsCard(article, draft) {
  article.querySelectorAll('[data-botcontrol-mode]').forEach((button) => {
    const active = button.dataset.botcontrolMode === draft.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const onlineButton = article.querySelector('[data-botcontrol-online24]');
  if (onlineButton) {
    onlineButton.classList.toggle('is-active', draft.online24);
    onlineButton.setAttribute('aria-pressed', String(draft.online24));
    onlineButton.querySelector('.botcontrol-online-state')?.replaceChildren(document.createTextNode(draft.online24 ? 'Aktif ✓' : 'Nonaktif'));
  }
  const reaction = article.querySelector('.botcontrol-auto-reaction');
  if (reaction) {
    reaction.checked = draft.mode === 'readonly_readsw' && draft.autoReaction;
    reaction.disabled = draft.mode !== 'readonly_readsw';
  }
  const grid = article.querySelector('.botcontrol-emoji-grid');
  if (grid) renderBotControlEmojiGrid(grid, draft);
  // Notifikasi reaksi di layar yang sama dengan halaman Fitur Bot, dengan nama
  // member-nya supaya admin tahu akun siapa yang dimaksud.
  const userId = article.querySelector('.botcontrol-settings')?.dataset.userId || '';
  const username = article.querySelector('[data-botcontrol-toggle]')?.dataset.username || 'member';
  const noticeActive = draft.mode === 'readonly_readsw' && !draft.autoReaction && draft.emojiPool.length === 0;
  if (!noticeActive) {
    botControlEmojiNoticeDismissed.delete(userId);
    if (noticeContext?.kind === 'botcontrol' && noticeContext.userId === userId) hideNoticeOverlay();
    return;
  }
  if (botControlEmojiNoticeDismissed.has(userId)) return;
  showNoticeOverlay({
    title: `Reaksi emoji @${username} tidak aktif`,
    text: `Akun @${username} tidak punya emoji dan reaksi otomatis mati — bot hanya menandai story sebagai dibaca, tanpa mengirim reaksi. Tambahkan emoji dan nyalakan reaksi otomatis bila mau ada reaksi.`,
    context: { kind: 'botcontrol', userId },
    addTarget: article.querySelector('.botcontrol-emoji-new'),
  });
}
const botControlUsersList = document.querySelector('#botcontrol-users');

function botControlFilterCounts() {
  const counts = { all: 0, running: 0, stopped: 0, linked: 0, inactive: 0 };
  document.querySelectorAll('#botcontrol-users .member-account-item').forEach((article) => {
    counts.all += 1;
    if (article.dataset.memberBot === 'running') counts.running += 1;
    else counts.stopped += 1;
    if (article.dataset.memberWa === 'linked') counts.linked += 1;
    if (article.dataset.memberBot !== 'running' && article.dataset.memberWa !== 'linked') counts.inactive += 1;
  });
  return counts;
}
function updateBotControlFilterCounts() {
  const counts = botControlFilterCounts();
  document.querySelectorAll('[data-botcontrol-filters] [data-filter-count]').forEach((countEl) => {
    const key = countEl.dataset.filterCount;
    if (Object.hasOwn(counts, key)) countEl.textContent = String(counts[key]);
  });
}
function botControlArticleMatches(article) {
  if (botControlFilter === 'running' && article.dataset.memberBot !== 'running') return false;
  if (botControlFilter === 'stopped' && article.dataset.memberBot === 'running') return false;
  if (botControlFilter === 'linked' && article.dataset.memberWa !== 'linked') return false;
  if (botControlFilter === 'inactive' && (article.dataset.memberBot === 'running' || article.dataset.memberWa === 'linked')) return false;
  if (!botControlQuery) return true;
  return (article.dataset.memberSearch || '').includes(botControlQuery);
}
function applyBotControlFilter() {
  const articles = [...document.querySelectorAll('#botcontrol-users .member-account-item')];
  let visible = 0;
  articles.forEach((article) => {
    const match = botControlArticleMatches(article);
    article.classList.toggle('is-filtered-out', !match);
    if (match) visible += 1;
  });
  // Pemisah kelompok ikut hilang bila semua kartunya terfilter.
  for (const groupSection of document.querySelectorAll('#botcontrol-users .member-account-group')) {
    const groupVisible = [...groupSection.querySelectorAll('.member-account-item')].some((article) => !article.classList.contains('is-filtered-out'));
    groupSection.toggleAttribute('hidden', !groupVisible);
  }
  document.querySelector('#botcontrol-filter-empty')?.toggleAttribute('hidden', !(articles.length > 0 && visible === 0));
}
document.querySelector('#botcontrol-search')?.addEventListener('input', (event) => {
  botControlQuery = String(event.target.value || '').trim().toLowerCase();
  applyBotControlFilter();
});
document.querySelector('[data-botcontrol-filters]')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-botcontrol-filter]');
  if (!button) return;
  botControlFilter = button.dataset.botcontrolFilter;
  document.querySelectorAll('[data-botcontrol-filters] .filter-pill').forEach((pill) => {
    const active = pill === button;
    pill.classList.toggle('is-active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
  applyBotControlFilter();
});

function buildBotControlSettings(user, draft) {
  const userId = String(user.id || user.username || '');
  const section = document.createElement('section');
  section.className = 'botcontrol-settings';
  section.dataset.userId = userId;
  const heading = document.createElement('strong');
  heading.className = 'botcontrol-settings-title';
  heading.textContent = 'Pengaturan fitur';
  const note = document.createElement('p');
  note.className = 'botcontrol-settings-note';
  note.textContent = user.botSettings
    ? 'Mode dan preferensi story akun ini. Perubahan hanya tersimpan setelah tombol Simpan pengaturan ditekan.'
    : 'Akun ini belum punya profil bot — simpan pengaturan untuk membuatnya.';
  section.append(heading, note);

  const modeLabel = document.createElement('span');
  modeLabel.className = 'botcontrol-field-label';
  modeLabel.textContent = 'Mode bot';
  const modeRow = document.createElement('div');
  modeRow.className = 'botcontrol-mode-row';
  for (const [value, label] of [['readonly', 'Read Only'], ['readonly_readsw', 'ReadSW + ReactionSW']]) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'filter-pill botcontrol-mode-pill';
    pill.dataset.botcontrolMode = value;
    pill.dataset.userId = userId;
    pill.textContent = label;
    modeRow.append(pill);
  }
  const onlineButton = document.createElement('button');
  onlineButton.type = 'button';
  onlineButton.className = 'filter-pill botcontrol-mode-pill';
  onlineButton.dataset.botcontrolOnline24 = 'true';
  onlineButton.dataset.userId = userId;
  onlineButton.setAttribute('aria-label', 'Online 24 Jam');
  const onlineIcon = document.createElement('span');
  onlineIcon.textContent = '⏱';
  const onlineText = document.createElement('span');
  onlineText.textContent = 'Online 24 Jam';
  const onlineState = document.createElement('span');
  onlineState.className = 'botcontrol-online-state';
  onlineButton.append(onlineIcon, onlineText, onlineState);
  modeRow.append(onlineButton);
  section.append(modeLabel, modeRow);

  const storyTitle = document.createElement('strong');
  storyTitle.className = 'botcontrol-settings-title';
  storyTitle.textContent = 'Preferensi story';
  const storyNote = document.createElement('p');
  storyNote.className = 'botcontrol-settings-note';
  storyNote.textContent = 'Delay & emoji ReadSW. Pengaturan ini tersimpan terpisah untuk akun ini. Tidak mengirim apa pun sampai bot dijalankan.';
  section.append(storyTitle, storyNote);

  const delayRow = document.createElement('div');
  delayRow.className = 'botcontrol-delay-row';
  for (const [field, label] of [['delayMinSeconds', 'Delay minimum'], ['delayMaxSeconds', 'Delay maksimum']]) {
    const wrap = document.createElement('label');
    wrap.className = 'botcontrol-field';
    const caption = document.createElement('span');
    caption.className = 'botcontrol-field-label';
    caption.textContent = `${label} (detik · 1–20)`;
    const select = document.createElement('select');
    select.className = `botcontrol-delay-${field === 'delayMinSeconds' ? 'min' : 'max'}`;
    select.dataset.userId = userId;
    for (let second = 1; second <= 20; second += 1) {
      const option = document.createElement('option');
      option.value = String(second);
      option.textContent = `${second} detik`;
      select.append(option);
    }
    select.value = String(field === 'delayMinSeconds' ? draft.delayMinSeconds : draft.delayMaxSeconds);
    wrap.append(caption, select);
    delayRow.append(wrap);
  }
  section.append(delayRow);

  const reactionLabel = document.createElement('label');
  reactionLabel.className = 'botcontrol-reaction-label';
  const reaction = document.createElement('input');
  reaction.type = 'checkbox';
  reaction.className = 'botcontrol-auto-reaction';
  reaction.dataset.userId = userId;
  const reactionText = document.createElement('span');
  reactionText.textContent = 'Reaksi emoji otomatis — hanya berjalan pada mode Read Only + ReadSW. Reaksi akan terlihat oleh pemilik story.';
  reactionLabel.append(reaction, reactionText);
  section.append(reactionLabel);

  const emojiLabel = document.createElement('span');
  emojiLabel.className = 'botcontrol-field-label';
  emojiLabel.textContent = 'Emoji reaksi — klik emoji untuk mengaktifkan atau menonaktifkan';
  const grid = document.createElement('div');
  grid.className = 'botcontrol-emoji-grid';
  section.append(emojiLabel, grid);

  const addRow = document.createElement('div');
  addRow.className = 'botcontrol-emoji-add-row';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'botcontrol-emoji-new';
  addInput.placeholder = 'Tempel emoji baru, pisahkan dengan koma';
  addInput.setAttribute('aria-label', 'Emoji baru');
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'button button-secondary botcontrol-emoji-add';
  addButton.dataset.userId = userId;
  addButton.textContent = '＋ Tambah emoji';
  addRow.append(addInput, addButton);
  const addHint = document.createElement('small');
  addHint.className = 'member-admin-hint';
  addHint.textContent = 'Bisa tempel banyak emoji sekaligus: satu per baris atau pisahkan dengan koma. Emoji baru langsung dipilih dan disimpan ke akun ini.';
  section.append(addRow, addHint);

  const saveRow = document.createElement('div');
  saveRow.className = 'botcontrol-save-row';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'button button-primary botcontrol-settings-save';
  saveButton.dataset.botcontrolSettingsSave = 'true';
  saveButton.dataset.userId = userId;
  saveButton.textContent = 'Simpan pengaturan';
  const feedback = document.createElement('p');
  feedback.className = 'botcontrol-settings-feedback';
  feedback.setAttribute('role', 'status');
  saveRow.append(saveButton, feedback);
  section.append(saveRow);
  const saveHint = document.createElement('small');
  saveHint.className = 'member-admin-hint';
  saveHint.textContent = 'Read Only menandai story sebagai dilihat tanpa emoji. Read Only + ReadSW bisa mengirim emoji pilihan setelah delay. Bot tidak menyimpan foto/video story.';
  section.append(saveHint);
  return section;
}

function buildBotControlCard(user) {
  const userId = String(user.id || user.username || '');
  const username = String(user.username || 'akun');
  const displayName = String(user.displayName || username);
  const detailId = `botcontrol-detail-${encodeURIComponent(userId)}`;
  const isOpen = userId === expandedBotControlUserId;
  const canManageTarget = currentUser?.role === 'admin'
    && (user.isMainAdmin !== true || currentUser.isMainAdmin === true);
  const pairingStatus = pairingLabels[user.whatsappStatus] || 'Belum tertaut';
  const roleLabel = user.isMainAdmin ? 'Admin Utama' : user.role === 'admin' ? 'Admin' : 'Member';
  const article = document.createElement('article');
  article.className = `member-account-item${isOpen ? ' is-open' : ''}${user.isMainAdmin ? ' is-main-admin' : ''}`;
  // Data filter Kontrol Bot memakai field yang sama dengan chip status di
  // atas, supaya hitungan pil selalu sama dengan yang terlihat di kartu.
  article.dataset.memberRole = user.role === 'admin' ? 'admin' : 'member';
  article.dataset.memberBot = user.workerStatus === 'running' ? 'running' : 'stopped';
  article.dataset.memberWa = user.whatsappStatus === 'linked' ? 'linked' : 'unlinked';
  article.dataset.memberSearch = [username, displayName, user.email || ''].join(' ').toLowerCase();

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'member-account-toggle';
  toggle.dataset.botcontrolToggle = 'true';
  toggle.dataset.userId = userId;
  toggle.dataset.username = username;
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-controls', detailId);
  toggle.setAttribute('aria-label', `${isOpen ? 'Tutup' : 'Buka'} kontrol bot @${username}`);

  const topRow = document.createElement('span');
  topRow.className = 'member-account-top-row';
  const identity = document.createElement('span');
  identity.className = 'member-account-identity';
  const avatarImage = document.createElement('img');
  avatarImage.className = 'member-account-avatar';
  avatarImage.width = 44;
  avatarImage.height = 44;
  avatarImage.loading = 'lazy';
  avatarImage.decoding = 'async';
  avatarImage.alt = `Avatar ${roleLabel} ${displayName}`;
  const selectedAvatar = String(user.avatar || 'avatar-01');
  if (selectedAvatar === 'uploaded' && currentUser?.role === 'admin') {
    const version = encodeURIComponent(user.avatarUpdatedAt || '');
    avatarImage.src = `/api/admin/user-avatar?userId=${encodeURIComponent(userId)}&v=${version}`;
  } else {
    const preset = /^avatar-(0[1-9]|[123][0-9]|4[0-8])$/.test(selectedAvatar) ? selectedAvatar : 'avatar-01';
    avatarImage.src = `/avatars/${preset}.webp`;
  }
  avatarImage.addEventListener('error', () => { avatarImage.src = '/avatars/avatar-01.webp'; }, { once: true });
  const identityText = document.createElement('span');
  identityText.className = 'member-account-identity-text';
  const name = document.createElement('strong');
  name.textContent = displayName;
  const handle = document.createElement('small');
  handle.textContent = `@${username}`;
  identityText.append(name, handle);
  identity.append(avatarImage, identityText);
  const control = document.createElement('span');
  control.className = 'member-account-control';
  const controlLabel = document.createElement('span');
  controlLabel.className = 'member-account-toggle-label';
  controlLabel.textContent = isOpen ? 'Tutup kontrol' : 'Kontrol bot';
  const chevron = document.createElement('span');
  chevron.className = 'member-account-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌄';
  control.append(controlLabel, chevron);
  topRow.append(identity, control);

  const statusRow = document.createElement('span');
  statusRow.className = 'member-account-statuses';
  const chips = [
    { text: roleLabel, icon: user.isMainAdmin ? 'crown' : null, className: `member-account-chip is-role${user.role === 'admin' ? ' is-admin' : ''}${user.isMainAdmin ? ' is-main-admin' : ''}`, title: user.isMainAdmin ? 'Admin Utama — akun admin dari config.json (WILYKUN), bukan admin biasa.' : null },
    ...(user.role !== 'admin' && user.banned ? [{ text: 'Diblokir', className: 'member-account-chip is-danger' }] : []),
    { text: user.panelActive ? 'Pemilik · Online' : 'Pemilik · Tidak aktif', className: `member-account-chip ${user.panelActive ? 'is-positive' : 'is-muted'}`, title: 'Status Online memakai heartbeat sesi panel dalam 75 detik terakhir; ini bukan status presence WhatsApp.' },
    { text: `WA · ${pairingStatus}`, className: `member-account-chip ${user.whatsappStatus === 'linked' ? 'is-positive' : user.whatsappStatus === 'failed' ? 'is-warning' : 'is-muted'}` },
    { text: `Bot WhatsApp · ${user.workerStatus === 'running' ? 'Berjalan' : user.workerStatus === 'waiting' ? 'Menunggu' : 'Berhenti'}`, className: `member-account-chip ${user.workerStatus === 'running' ? 'is-positive' : user.workerStatus === 'waiting' ? 'is-warning' : 'is-muted'}` },
    { text: `Mode · ${user.featureStats?.modeLabel || 'Mode belum dipilih'}`, className: `member-account-chip ${user.featureStats?.modeLabel && user.featureStats.modeLabel !== 'Mode belum dipilih' ? 'is-positive' : 'is-muted'}` },
    { runtime: true, className: `member-account-chip ${user.workerStatus === 'running' ? 'is-positive' : 'is-muted'}` },
  ];
  chips.forEach((chipInfo) => {
    const chip = document.createElement('span');
    chip.className = chipInfo.className;
    if (chipInfo.runtime) {
      if (user.workerStatus === 'running') {
        chip.dataset.workerRuntime = String(user.workerStartedAt || '');
        chip.dataset.runtimePrefix = 'Runtime bot';
        chip.textContent = `Runtime bot · ${formatWorkerRuntime(user.workerStartedAt)}`;
      } else {
        chip.textContent = `Runtime bot · ${user.workerStatus === 'waiting' ? 'menunggu' : 'tidak aktif'}`;
      }
    } else if (chipInfo.icon) {
      chip.append(createMemberIcon(chipInfo.icon), document.createTextNode(chipInfo.text));
    } else {
      chip.textContent = chipInfo.text;
    }
    if (chipInfo.title) chip.title = chipInfo.title;
    statusRow.append(chip);
  });
  toggle.append(topRow, statusRow);

  const details = document.createElement('div');
  details.id = detailId;
  details.className = 'member-account-details';
  details.hidden = !isOpen;
  if (canManageTarget) {
    const adminPanel = document.createElement('section');
    adminPanel.className = 'member-admin-panel';
    const heading = document.createElement('div');
    heading.className = 'member-admin-heading';
    const title = document.createElement('strong');
    title.textContent = `Kontrol bot · @${username}`;
    const accountState = document.createElement('span');
    accountState.className = `member-admin-status${user.banned ? ' is-banned' : ''}`;
    accountState.textContent = user.banned ? 'Akun diblokir' : 'Akun aktif';
    heading.append(title, accountState);
    const note = document.createElement('p');
    note.className = 'member-admin-note';
    note.textContent = 'Admin dapat memantau dan mengelola worker bot, tetapi tidak masuk sebagai member. Pemilik akun menautkan WhatsApp sendiri.';
    const botActions = document.createElement('div');
    botActions.className = 'member-admin-actions';
    const addControlButton = (label, action, disabled = false, variant = '') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `button member-admin-button ${variant}`.trim();
      button.dataset.botcontrolAction = action;
      button.dataset.userId = userId;
      button.textContent = label;
      button.disabled = disabled;
      botActions.append(button);
    };
    const linked = user.whatsappStatus === 'linked';
    const hasWorker = user.workerStatus === 'running' || user.workerStatus === 'waiting' || user.botAutoStart === true || user.hasBotProfile === true;
    addControlButton('Nyalakan bot', 'bot-start', user.banned || !linked || user.workerStatus === 'running', 'button-primary');
    addControlButton('Restart bot', 'bot-restart', user.banned || !linked || user.workerStatus !== 'running', 'button-secondary');
    addControlButton('Matikan bot', 'bot-stop', !hasWorker, 'button-secondary');
    addControlButton('Hapus sesi WhatsApp', 'bot-session-delete', !linked && !hasWorker, 'button-danger');
    const controlsNote = document.createElement('small');
    controlsNote.className = 'member-admin-hint';
    controlsNote.textContent = linked ? 'Nyalakan/restart memakai konfigurasi member. Hapus sesi memutus WhatsApp — pemilik akun harus menautkan ulang dari akunnya sendiri.' : 'Nyalakan/restart tersedia setelah member menautkan WhatsApp dari akunnya sendiri.';
    const stateNote = document.createElement('p');
    stateNote.className = `member-admin-account-state${user.banned ? ' is-banned' : ''}`;
    stateNote.textContent = user.banned
      ? `Diblokir${user.bannedAt ? ` sejak ${prettyDateTime(user.bannedAt)}` : ''}${user.banReason ? ` · alasan: ${user.banReason}` : ''}. Worker/Online 24 Jam dimatikan; tautan WhatsApp tidak dihapus.`
      : 'Akun aktif. Admin tidak melihat kata sandi, kode pairing, atau isi percakapan.';
    const draft = botControlSettingsDrafts.get(userId) || normalizeBotControlSettings(user.botSettings);
    botControlSettingsDrafts.set(userId, draft);
    const settingsSection = buildBotControlSettings(user, draft);
    adminPanel.append(heading, note, botActions, controlsNote, stateNote, settingsSection);
    details.append(adminPanel);
    syncBotControlSettingsCard(adminPanel, draft);
  } else {
    const note = document.createElement('p');
    note.className = 'member-admin-note';
    note.textContent = user.isMainAdmin
      ? 'Akun Admin Utama hanya bisa dikontrol oleh Admin Utama.'
      : 'Akun ini tidak dapat dikontrol oleh admin biasa.';
    details.append(note);
  }
  article.append(toggle, details);
  return article;
}

async function loadBotControlUsers() {
  const list = document.querySelector('#botcontrol-users');
  if (!list || currentUser?.role !== 'admin') return;
  try {
    const data = await api('/api/admin/users');
    const users = Array.isArray(data.users) ? data.users : [];
    // Pemisah Admin dan Member seperti halaman Member, dan di tiap kelompok
    // bot yang jalan dengan runtime terbaru paling atas (realtime, ikut
    // diperbarui tiap poll 15 detik) — urutan yang sama dipakai halaman
    // Member lewat sortAdminUsersByRuntime.
    const groups = [
      { key: 'admin', title: 'Admin', users: sortAdminUsersByRuntime(users.filter((user) => user.role === 'admin')) },
      { key: 'member', title: 'Member', users: sortAdminUsersByRuntime(users.filter((user) => user.role !== 'admin')) },
    ];
    list.replaceChildren();
    for (const group of groups) {
      if (!group.users.length) continue;
      const groupSection = document.createElement('section');
      groupSection.className = 'member-account-group';
      groupSection.setAttribute('aria-label', `${group.title}, ${group.users.length} akun`);
      const groupHeading = document.createElement('div');
      groupHeading.className = 'member-account-group-heading';
      const groupTitle = document.createElement('h3');
      groupTitle.textContent = group.title;
      const groupCount = document.createElement('span');
      groupCount.textContent = `${group.users.length} akun`;
      groupHeading.append(groupTitle, groupCount);
      groupSection.append(groupHeading);
      for (const user of group.users) groupSection.append(buildBotControlCard(user));
      list.append(groupSection);
    }
    if (users.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'member-list-empty';
      empty.textContent = 'Belum ada akun terdaftar.';
      list.append(empty);
    }
    updateBotControlFilterCounts();
    applyBotControlFilter();
    document.querySelector('#botcontrol-updated').textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date())} WIB`;
  } catch (error) {
    if (error.status === 401) showAuth();
  }
}

function startBotControlUsersPolling() {
  if (botControlUsersTimer) return;
  botControlUsersTimer = window.setInterval(() => {
    if (activeWorkspacePage === 'botcontrol' && document.visibilityState === 'visible') void loadBotControlUsers();
  }, 15000);
}

botControlUsersList?.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-botcontrol-action]');
  if (actionButton && botControlUsersList.contains(actionButton)) {
    const action = actionButton.dataset.botcontrolAction;
    const userId = actionButton.dataset.userId;
    const article = actionButton.closest('.member-account-item');
    const username = article?.querySelector('[data-botcontrol-toggle]')?.dataset.username || 'member';
    const confirmations = {
      'bot-start': { title: `Start bot @${username}?`, message: 'Bot memakai pengaturan tersimpan dan dapat membaca status serta mengirim reaksi bila mode itu aktif. Lanjut hanya jika kamu berwenang.', confirmLabel: 'Start bot' },
      'bot-restart': { title: `Restart bot @${username}?`, message: 'Bot berjalan kembali dengan pengaturan tersimpan. Lanjut hanya jika kamu berwenang.', confirmLabel: 'Restart bot' },
      'bot-stop': { title: `Matikan worker bot @${username}?`, message: 'Koneksi WhatsApp tetap tertaut. Lanjut hanya jika kamu berwenang.', confirmLabel: 'Matikan worker', danger: true },
      'bot-session-delete': { title: `Hapus sesi WhatsApp @${username}?`, message: 'Koneksi WhatsApp terputus dan sesi di server dihapus. Pemilik akun harus menautkan WhatsApp lagi dari akunnya sendiri. Lanjut hanya jika kamu berwenang.', confirmLabel: 'Hapus sesi', danger: true },
    };
    if (!(await showConfirm(confirmations[action] || { title: 'Lanjutkan tindakan admin ini?', message: 'Tindakan ini akan langsung dijalankan.', confirmLabel: 'Lanjutkan' }))) return;
    const actionButtons = [...(article?.querySelectorAll('[data-botcontrol-action]') || [])];
    actionButtons.forEach((button) => { button.disabled = true; });
    try {
      if (action === 'bot-session-delete') {
        await api('/api/admin/users/session/delete', {
          method: 'POST',
          body: JSON.stringify({ userId, confirm: true }),
        });
        showToast(`Sesi WhatsApp @${username} dihapus. Pemilik akun harus menautkan ulang.`);
      } else {
        const botAction = action.slice('bot-'.length);
        const result = await api('/api/admin/users/bot', {
          method: 'POST',
          body: JSON.stringify({ userId, action: botAction, confirmActivity: botAction !== 'stop' }),
        });
        showToast(`Kontrol bot ${botAction} berhasil. Worker: ${result.workerStatus === 'running' ? 'berjalan' : 'berhenti'}.`);
      }
      await loadBotControlUsers();
    } catch (error) {
      if (error.status === 401) showAuth();
      else showToast(error.message);
      actionButtons.forEach((button) => { button.disabled = false; });
    }
    return;
  }
  // Editor pengaturan fitur: mode, Online 24 Jam, delay, emoji — draf per akun dijaga supaya tidak hilang saat daftar diperbarui.
  const settingsSection = event.target.closest('.botcontrol-settings');
  if (settingsSection && botControlUsersList.contains(settingsSection)) {
    const article = settingsSection.closest('.member-account-item');
    const userId = settingsSection.dataset.userId || '';
    const draft = botControlSettingsDrafts.get(userId);
    const feedback = settingsSection.querySelector('.botcontrol-settings-feedback');
    const setFeedback = (type, text) => { if (feedback) { feedback.textContent = text; feedback.className = `botcontrol-settings-feedback${type ? ` is-${type}` : ''}`; } };
    if (article && draft) {
      const modeButton = event.target.closest('[data-botcontrol-mode]');
      if (modeButton) {
        draft.mode = modeButton.dataset.botcontrolMode;
        if (draft.mode !== 'readonly_readsw') draft.autoReaction = false;
        syncBotControlSettingsCard(article, draft);
        return;
      }
      const onlineButton = event.target.closest('[data-botcontrol-online24]');
      if (onlineButton) {
        draft.online24 = !draft.online24;
        syncBotControlSettingsCard(article, draft);
        return;
      }
      const emojiChoice = event.target.closest('.botcontrol-emoji-choice');
      if (emojiChoice) {
        const emoji = emojiChoice.dataset.emoji;
        if (draft.emojiPool.includes(emoji)) draft.emojiPool = draft.emojiPool.filter((item) => item !== emoji);
        else draft.emojiPool.push(emoji);
        syncBotControlSettingsCard(article, draft);
        return;
      }
      const emojiRemove = event.target.closest('.botcontrol-emoji-remove');
      if (emojiRemove) {
        const emoji = emojiRemove.dataset.removeEmoji;
        draft.emojiOptions = draft.emojiOptions.filter((item) => item !== emoji);
        draft.emojiPool = draft.emojiPool.filter((item) => item !== emoji);
        // Hapus emoji bisa memicu peringatan (emoji habis), jadi sinkronkan
        // seluruh kartu — bukan hanya grid-nya.
        syncBotControlSettingsCard(article, draft);
        return;
      }
      const emojiAdd = event.target.closest('.botcontrol-emoji-add');
      if (emojiAdd) {
        const input = article.querySelector('.botcontrol-emoji-new');
        if (!input) return;
        const { emojis, invalid } = parseEmojiBatch(input.value);
        if (invalid.length) { setFeedback('error', `Emoji tidak valid: ${invalid.join(' ')}`); return; }
        if (!emojis.length) { setFeedback('error', 'Tempel minimal satu emoji dulu.'); return; }
        if (draft.emojiOptions.length + emojis.filter((emoji) => !draft.emojiOptions.includes(emoji)).length > 30) { setFeedback('error', 'Maksimal 30 emoji per akun.'); return; }
        for (const emoji of emojis) {
          if (!draft.emojiOptions.includes(emoji)) draft.emojiOptions.push(emoji);
          if (!draft.emojiPool.includes(emoji)) draft.emojiPool.push(emoji);
        }
        input.value = '';
        // Tambah emoji bisa mematikan peringatan, jadi sinkronkan seluruh kartu.
        syncBotControlSettingsCard(article, draft);
        setFeedback('success', `${emojis.length} emoji ditambahkan — tekan Simpan pengaturan.`);
        return;
      }
      const saveButton = event.target.closest('[data-botcontrol-settings-save]');
      if (saveButton) {
        const username = article.querySelector('[data-botcontrol-toggle]')?.dataset.username || 'member';
        const displayName = article.querySelector('.member-account-identity-text strong')?.textContent || username;
        draft.delayMinSeconds = Number(article.querySelector('.botcontrol-delay-min')?.value || draft.delayMinSeconds);
        draft.delayMaxSeconds = Number(article.querySelector('.botcontrol-delay-max')?.value || draft.delayMaxSeconds);
        if (!draft.mode) { setFeedback('error', 'Pilih mode dulu: Read Only atau Read Only + ReadSW.'); return; }
        if (draft.delayMinSeconds > draft.delayMaxSeconds) { setFeedback('error', 'Delay minimum harus kurang dari atau sama dengan delay maksimum.'); return; }
        const autoReaction = draft.mode === 'readonly_readsw' && draft.autoReaction;
        if (autoReaction && draft.emojiPool.length === 0) { setFeedback('error', 'Aktifkan minimal satu emoji atau matikan reaksi otomatis.'); return; }
        saveButton.disabled = true;
        setFeedback('info', 'Menyimpan pengaturan…');
        void (async () => {
          try {
            await api('/api/admin/users/bot-settings', {
              method: 'PUT',
              body: JSON.stringify({ userId, label: draft.label || `${displayName} bot`, mode: draft.mode, online24: draft.online24, storySettings: { autoReaction, delayMinSeconds: draft.delayMinSeconds, delayMaxSeconds: draft.delayMaxSeconds, randomDelay: true, emojiPoolVersion: 2, emojiOptions: draft.emojiOptions, emojiPool: draft.emojiPool } }),
            });
            botControlSettingsDrafts.delete(userId);
            showToast(`Pengaturan bot @${username} tersimpan.`);
            await loadBotControlUsers();
          } catch (error) {
            if (error.status === 401) showAuth();
            else setFeedback('error', error.message);
            saveButton.disabled = false;
          }
        })();
        return;
      }
    }
  }
  // Spoiler kontrol bot: membuka satu kartu menutup kartu lain secara otomatis.
  const trigger = event.target.closest('[data-botcontrol-toggle]');
  if (!trigger || !botControlUsersList.contains(trigger)) return;
  const shouldOpen = trigger.getAttribute('aria-expanded') !== 'true';
  expandedBotControlUserId = shouldOpen ? trigger.dataset.userId : null;
  botControlUsersList.querySelectorAll('.member-account-item').forEach((item) => {
    const button = item.querySelector('[data-botcontrol-toggle]');
    const panel = item.querySelector('.member-account-details');
    const isOpen = Boolean(shouldOpen && button === trigger);
    button?.setAttribute('aria-expanded', String(isOpen));
    button?.setAttribute('aria-label', `${isOpen ? 'Tutup' : 'Buka'} kontrol bot @${button?.dataset.username || ''}`);
    const label = button?.querySelector('.member-account-toggle-label');
    if (label) label.textContent = isOpen ? 'Tutup kontrol' : 'Kontrol bot';
    if (panel) panel.hidden = !isOpen;
    item.classList.toggle('is-open', isOpen);
  });
});

botControlUsersList?.addEventListener('change', (event) => {
  const select = event.target.closest('.botcontrol-delay-min, .botcontrol-delay-max');
  if (select && botControlUsersList.contains(select)) {
    const draft = botControlSettingsDrafts.get(select.dataset.userId || '');
    if (!draft) return;
    if (select.classList.contains('botcontrol-delay-min')) draft.delayMinSeconds = Number(select.value);
    else draft.delayMaxSeconds = Number(select.value);
    return;
  }
  const reaction = event.target.closest('.botcontrol-auto-reaction');
  if (reaction && botControlUsersList.contains(reaction)) {
    const draft = botControlSettingsDrafts.get(reaction.dataset.userId || '');
    if (draft) {
      draft.autoReaction = reaction.checked;
      // Ceklis reaksi ikut menentukan peringatan emoji, jadi kartu harus
      // disinkronkan lagi — tanpa ini peringatan tidak muncul saat ceklis dimatikan.
      const article = reaction.closest('.member-account-item');
      if (article) syncBotControlSettingsCard(article, draft);
    }
  }
});

let loginHistoryTimer = null;
let adminUsersTimer = null;
let presenceHeartbeatTimer = null;

// Versi kode yang dimuat tab ini (dari ?v= di tag script app.js): dipakai
// untuk mendeteksi deploy baru supaya tab yang sudah terbuka ikut diperbarui
// tanpa muat ulang manual.
const loadedClientVersion = (() => {
  const src = document.querySelector('script[src*="/app.js"]')?.src || '';
  try { return new URL(src, location.href).searchParams.get('v'); } catch { return null; }
})();

// Muat ulang otomatis hanya bila pengguna sedang tidak diganggu: tidak ada
// overlay terbuka dan tidak sedang mengetik di kolom apa pun.
function isClientIdleForReload() {
  if (!document.querySelector('#emoji-notice-overlay')?.classList.contains('hidden')) return false;
  if (document.querySelector('.confirm-overlay')) return false;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) return false;
  return true;
}

// Versi baru dari server: muat ulang sendiri bila sedang tidak dipakai; bila
// sedang dipakai, tawarkan sekali lewat notifikasi di tengah layar.
function checkClientVersion(serverVersion) {
  if (!serverVersion || !loadedClientVersion || serverVersion === loadedClientVersion) {
    newVersionPrompted = null;
    if (noticeContext?.kind === 'version') hideNoticeOverlay();
    return;
  }
  if (serverVersion === newVersionPrompted) return;
  if (isClientIdleForReload()) { location.reload(); return; }
  showNoticeOverlay({
    title: 'Versi baru tersedia',
    text: 'Panel baru saja diperbarui. Muat ulang halaman untuk memakai versi terbaru.',
    context: { kind: 'version', version: serverVersion },
    addLabel: 'Muat ulang',
    onAdd: () => location.reload(),
  });
}

async function sendPresenceHeartbeat() {
  if (!currentUser || document.visibilityState !== 'visible' || appView.classList.contains('hidden')) return;
  try {
    const result = await api('/api/me/heartbeat', { method: 'POST', body: '{}' });
    checkClientVersion(result?.version);
    syncAccountActivityLoginBadge(result?.latestLoginAt);
    // Daftar member langsung dimuat ulang begitu heartbeat berhasil, jadi
    // status Pemilik milik sendiri mengikuti heartbeat tanpa menunggu
    // giliran polling 15 detik berikutnya.
    void loadAdminUsers();
  } catch (error) {
    if (error.status === 401) showAuth();
  }
}

function startPresenceHeartbeat() {
  if (presenceHeartbeatTimer) return;
  void sendPresenceHeartbeat();
  presenceHeartbeatTimer = setInterval(() => { void sendPresenceHeartbeat(); }, 25000);
}

// Saat tab kembali dibuka atau jendela kembali fokus, status kehadiran
// langsung disinkronkan ulang tanpa menunggu giliran interval berikutnya —
// tanpa ini, pengguna yang kembali dari tab lain bisa terlihat "Tidak aktif"
// sampai 40 detik walau tab panelnya tidak pernah ditutup.
function resyncPresenceOnReturn() {
  if (!currentUser || appView.classList.contains('hidden')) return;
  void sendPresenceHeartbeat();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resyncPresenceOnReturn();
});
window.addEventListener('focus', resyncPresenceOnReturn);

const LOGIN_HISTORY_PAGE_SIZE = 5;
const LOGIN_HISTORY_PAGE_WINDOW = 3;
let loginHistoryPage = 1;
let loginHistoryEntries = [];

function renderLoginHistory() {
  const list = document.querySelector('#login-history-list');
  const pagination = document.querySelector('#login-history-pagination');
  if (!list || !pagination) return;

  const totalPages = Math.max(1, Math.ceil(loginHistoryEntries.length / LOGIN_HISTORY_PAGE_SIZE));
  loginHistoryPage = Math.min(Math.max(1, loginHistoryPage), totalPages);
  list.replaceChildren();
  pagination.replaceChildren();

  if (!loginHistoryEntries.length) {
    const item = document.createElement('li');
    item.textContent = 'Belum ada riwayat login.';
    list.append(item);
    pagination.classList.add('hidden');
    return;
  }

  const start = (loginHistoryPage - 1) * LOGIN_HISTORY_PAGE_SIZE;
  for (const entry of loginHistoryEntries.slice(start, start + LOGIN_HISTORY_PAGE_SIZE)) {
    const item = document.createElement('li');
    item.className = 'login-history-item';
    const time = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }).format(new Date(entry.createdAt));
    const main = document.createElement('div');
    main.className = 'login-history-main';
    const title = document.createElement('strong');
    title.textContent = entry.deviceLabel;
    const meta = document.createElement('small');
    meta.textContent = `${time} WIB · ${entry.ip}`;
    main.append(title, meta);
    item.append(main);
    if (entry.current) {
      const badge = document.createElement('span');
      badge.className = 'login-current-badge';
      badge.textContent = 'sesi ini';
      item.append(badge);
    }
    list.append(item);
  }

  if (totalPages <= 1) {
    pagination.classList.add('hidden');
    return;
  }
  pagination.classList.remove('hidden');

  const addControl = (label, page, { disabled = false, current = false, ariaLabel = '' } = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'login-history-page-button';
    button.textContent = label;
    button.disabled = disabled;
    if (current) button.setAttribute('aria-current', 'page');
    if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', () => {
      loginHistoryPage = page;
      renderLoginHistory();
    });
    pagination.append(button);
  };
  const addEllipsis = () => {
    const ellipsis = document.createElement('span');
    ellipsis.className = 'login-history-page-ellipsis';
    ellipsis.textContent = '…';
    ellipsis.setAttribute('aria-hidden', 'true');
    pagination.append(ellipsis);
  };

  addControl('‹', Math.max(1, loginHistoryPage - 1), {
    disabled: loginHistoryPage === 1,
    ariaLabel: 'Halaman sebelumnya',
  });
  const firstPage = Math.max(1, Math.min(loginHistoryPage - 1, totalPages - LOGIN_HISTORY_PAGE_WINDOW + 1));
  const lastPage = Math.min(totalPages, firstPage + LOGIN_HISTORY_PAGE_WINDOW - 1);
  if (firstPage > 1) addEllipsis();
  for (let page = firstPage; page <= lastPage; page += 1) {
    addControl(String(page), page, { current: page === loginHistoryPage, ariaLabel: `Halaman ${page}` });
  }
  if (lastPage < totalPages) addEllipsis();
  addControl('›', Math.min(totalPages, loginHistoryPage + 1), {
    disabled: loginHistoryPage === totalPages,
    ariaLabel: 'Halaman berikutnya',
  });
}

async function loadLoginHistory() {
  if (!document.querySelector('#login-history-list') || !currentUser) return;
  try {
    const result = await api('/api/me/logins');
    loginHistoryEntries = Array.isArray(result.logins) ? result.logins : [];
    const totalPages = Math.max(1, Math.ceil(loginHistoryEntries.length / LOGIN_HISTORY_PAGE_SIZE));
    if (loginHistoryPage > totalPages) loginHistoryPage = totalPages;
    renderLoginHistory();
  } catch {
    // Riwayat login tidak tersedia; dashboard tetap jalan.
  }
}
function startLoginHistoryPolling() {
  if (loginHistoryTimer) return;
  loginHistoryTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && currentUser && !appView.classList.contains('hidden')) void loadLoginHistory();
  }, 15000);
}

function startAdminUsersPolling() {
  if (adminUsersTimer) return;
  adminUsersTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && currentUser && !appView.classList.contains('hidden')) void loadAdminUsers();
  }, 15000);
}

function setPairingNotice(text, success = false, info = false) {
  const notice = document.querySelector('#pairing-notice');
  if (!notice) return;
  notice.textContent = text;
  notice.classList.toggle('hidden', !text);
  notice.classList.toggle('success', success);
  notice.classList.toggle('info', info);
}

function stopPairingCooldown() {
  clearInterval(pairingCooldownTimer);
  pairingCooldownTimer = null;
  pairingCooldownUntil = 0;
  const submit = document.querySelector('#pairing-submit');
  const retry = document.querySelector('#pairing-retry');
  if (submit && !submit.classList.contains('is-loading')) submit.disabled = false;
  if (retry) retry.disabled = false;
  document.querySelector('#pairing-notice')?.classList.remove('cooldown');
}

function startPairingCooldown(seconds) {
  const duration = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (!duration) return stopPairingCooldown();
  clearInterval(pairingCooldownTimer);
  pairingCooldownUntil = Date.now() + duration * 1000;
  const submit = document.querySelector('#pairing-submit');
  const retry = document.querySelector('#pairing-retry');
  const notice = document.querySelector('#pairing-notice');
  if (submit) submit.disabled = true;
  if (retry) {
    retry.disabled = true;
    retry.classList.remove('hidden');
  }
  notice?.classList.add('cooldown');
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((pairingCooldownUntil - Date.now()) / 1000));
    if (!remaining) {
      stopPairingCooldown();
      if (retry) retry.classList.add('hidden');
      setPairingNotice('Jeda keamanan selesai. Kamu bisa meminta pairing code lagi.', false, true);
      return;
    }
    const minutes = Math.floor(remaining / 60);
    const secondsPart = String(remaining % 60).padStart(2, '0');
    setPairingNotice(`Tunggu ${minutes}:${secondsPart} sebelum meminta pairing code lagi.`, false, true);
  };
  tick();
  pairingCooldownTimer = setInterval(tick, 250);
}

function setControlFeedback(id, kind, title, message) {
  const target = document.querySelector(`#${id}`);
  target.replaceChildren();
  if (!title && !message) {
    target.className = 'control-feedback hidden';
    return;
  }
  target.className = `control-feedback ${kind || 'info'}`;
  if (title) {
    const heading = document.createElement('strong');
    heading.textContent = title;
    target.append(heading);
  }
  if (message) {
    const detail = document.createElement('p');
    detail.textContent = message;
    target.append(detail);
  }
}

function renderBotWorkerUi(workerStatus, connectionStatus, workerStartedAt = null) {
  const row = document.querySelector('#bot-worker-state');
  const label = document.querySelector('#bot-worker-status');
  const detail = document.querySelector('#bot-worker-detail');
  const dot = document.querySelector('#bot-worker-dot');
  const start = document.querySelector('#bot-start');
  const restart = document.querySelector('#bot-restart');
  const stop = document.querySelector('#bot-stop');
  const summary = document.querySelector('.activity-summary');
  const summaryTitle = document.querySelector('#activity-summary-title');
  const summaryDescription = document.querySelector('#activity-summary-description');
  const summaryDot = document.querySelector('#activity-summary-dot');
  const online = connectionStatus === 'linked';
  const running = workerStatus === 'running';
  const runtime = document.querySelector('#bot-worker-runtime');
  if (runtime) runtime.dataset.workerRuntime = running ? String(workerStartedAt || '') : '';
  ensureWorkerRuntimeTicker();
  const supportedMode = selectedMode === 'readonly' || selectedMode === 'readonly_readsw';
  if (!row || !label || !detail || !dot || !start || !restart || !stop) return;
  row.classList.toggle('is-running', running);
  label.textContent = running ? 'BOT BERJALAN' : workerStatus === 'waiting' ? 'MENUNGGU WHATSAPP' : online && !supportedMode ? 'MODE BELUM SIAP' : 'BOT BERHENTI';
  detail.textContent = running
    ? workerAutoStart ? 'Mendengarkan story/status real-time; auto-start aktif saat sesi pulih.' : 'Mendengarkan event story/status real-time.'
    : workerStatus === 'waiting' ? 'Akan aktif lagi setelah WhatsApp tersambung.'
      : online && !supportedMode ? 'Pilih mode Read Only atau Read Only + ReadSW untuk mengaktifkan worker.'
        : online ? workerAutoStart ? 'Auto-start aktif; worker akan dijalankan otomatis.' : 'WhatsApp online; tekan Start bot untuk mulai.' : 'Tautkan WhatsApp terlebih dahulu.';
  dot.className = running ? 'green-dot' : 'muted-dot';
  start.disabled = !online || running || !supportedMode;
  restart.disabled = !online || !supportedMode;
  stop.disabled = !running;
  if (!summary || !summaryTitle || !summaryDescription || !summaryDot) {
    clearInterval(logPollTimer);
    if (running) logPollTimer = setInterval(() => { void loadPairingLogs(); }, 4000);
    return;
  }
  summary.classList.toggle('is-running', running);
  summaryDot.className = running || online ? 'green-dot' : 'muted-dot';
  if (running) {
    summaryTitle.textContent = 'BOT AKTIF · WHATSAPP ONLINE';
    summaryDescription.textContent = 'Listener event story/status sedang berjalan; menunggu event baru.';
  } else if (online) {
    summaryTitle.textContent = supportedMode ? 'WHATSAPP ONLINE · BOT BERHENTI' : 'WHATSAPP ONLINE · MODE BELUM SIAP';
    summaryDescription.textContent = supportedMode
      ? workerAutoStart ? 'Sesi tersambung; worker otomatis siap berjalan.' : 'Sesi tersambung. Tekan Start bot untuk memantau event story/status.'
      : 'Sesi tersambung, tetapi pilih mode Read Only atau Read Only + ReadSW terlebih dahulu.';
  } else if (connectionStatus === 'disconnected' || connectionStatus === 'stopped') {
    summaryTitle.textContent = connectionStatus === 'stopped' ? 'WHATSAPP DIHENTIKAN' : 'WHATSAPP TERPUTUS';
    summaryDescription.textContent = 'Sesi tersimpan. Gunakan Sambungkan ulang untuk kembali online.';
  } else if (connectionStatus === 'reconnecting') {
    summaryTitle.textContent = 'WHATSAPP MENYAMBUNG ULANG';
    summaryDescription.textContent = 'Status dan tombol akan diperbarui saat koneksi siap.';
  } else if (workerStatus === 'waiting') {
    summaryTitle.textContent = 'BOT MENUNGGU KONEKSI WHATSAPP';
    summaryDescription.textContent = 'Worker akan menyambung lagi setelah sesi WhatsApp pulih.';
  } else {
    summaryTitle.textContent = 'BELUM TERTAUT';
    summaryDescription.textContent = 'Tautkan perangkat WhatsApp untuk mengaktifkan kontrol bot.';
  }
  clearInterval(logPollTimer);
  if (running) logPollTimer = setInterval(() => { void loadPairingLogs(); }, 4000);
}

const workspacePageTitles = { dashboard: 'Panel', mode: 'Fitur Bot', activity: 'Log privat', profile: 'Profil akun', pairing: 'Pairing WhatsApp', developer: 'Developer', infoupdate: 'Info Update', server: 'Server', bots: 'List Bot', admin: 'Member', backup: 'Backup & pemulihan', botcontrol: 'Kontrol Bot', rankbot: 'Rank Bot', accountactivity: 'Aktivitas Akun' };
let activeWorkspacePage = null;
let privateLogAutoRefreshTimer = null;
let privateLogScrollOnNextRender = false;
let privateLogLoading = false;
let privateLogSnapshotReady = false;
let lastPrivateLogIdentity = null;
let lastPrivateLogCount = 0;

function stopPrivateLogAutoRefresh() {
  if (privateLogAutoRefreshTimer) window.clearInterval(privateLogAutoRefreshTimer);
  privateLogAutoRefreshTimer = null;
}

function startPrivateLogAutoRefresh() {
  if (privateLogAutoRefreshTimer) return;
  privateLogAutoRefreshTimer = window.setInterval(() => {
    if (activeWorkspacePage === 'activity' && document.visibilityState === 'visible') void loadPairingLogs();
  }, 15000);
}

function scrollPrivateLogToNewest(list, behavior = 'smooth') {
  if (!list) return;
  requestAnimationFrame(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior;
    if (list.id === 'pairing-log-list') {
      list.scrollTo({ top: 0, behavior: motion });
      return;
    }
    const newest = list.querySelector('.activity-log-entry:not([hidden])');
    const fallback = newest || list.firstElementChild;
    if (fallback && !fallback.hidden) fallback.scrollIntoView({ behavior: motion, block: 'start' });
    else document.querySelector('.private-log-stream-heading')?.scrollIntoView({ behavior: motion, block: 'start' });
  });
}

function setWorkspacePage(page, smoothScroll = true) {
  // Member biasa yang WhatsApp-nya belum tertaut TIDAK BISA masuk Fitur Bot:
  // harus tertaut dulu baru bisa masuk. Upaya masuk menampilkan notifikasi di
  // layar dan member diarahkan ke halaman Pairing. Admin (Admin Utama dan
  // admin biasa) tidak kena aturan ini dan tetap bisa masuk walau belum tertaut.
  if (page === 'mode' && isBotLockedForMember()) {
    showBotLinkNotice();
    page = 'pairing';
  }
  const navItem = document.querySelector(`.side-nav .nav-item[href="#${page}"]`);
  // Halaman Backup dijaga juga lewat peran (bukan hanya lewat menu yang tersembunyi), karena menunya kini terlihat tapi terkunci untuk member. Halaman Kontrol Bot dijaga dengan cara yang sama.
  if (!workspacePageTitles[page] || (page === 'admin' && !currentUser) || (page === 'backup' && currentUser?.role !== 'admin') || (page === 'botcontrol' && currentUser?.role !== 'admin') || navItem?.classList.contains('hidden')) {
    // Upaya masuk langsung (misalnya lewat tautan #backup) juga menampilkan notifikasi yang sama.
    if ((page === 'backup' || page === 'botcontrol') && currentUser?.role !== 'admin') {
      showLockedNotice(page === 'backup' ? 'Backup' : 'Kontrol Bot');
    }
    page = document.body.dataset.whatsappLinked === 'true' ? 'dashboard' : 'pairing';
  }
  // Penanda Member hanya maju saat halaman Member dibuka dengan sengaja
  // (klik menu), bukan saat aplikasi mendarat di sana otomatis setelah
  // login — kalau tidak, badge akun baru tidak pernah sempat terlihat.
  const previousPage = activeWorkspacePage;
  activeWorkspacePage = page;
  try { window.sessionStorage.setItem(LAST_PAGE_STORAGE_KEY, page); } catch { /* Halaman terakhir tetap berjalan tanpa storage. */ }
  document.querySelectorAll('[data-page-view]').forEach((view) => {
    view.classList.toggle('view-hidden', view.dataset.pageView !== page);
  });
  document.querySelectorAll('.side-nav .nav-item[href^="#"]').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('href') === `#${page}`);
  });
  document.querySelector('#page-breadcrumb').textContent = workspacePageTitles[page];
  // URL panel selalu tampil bersih tanpa #halaman. Tautan dalam dengan #halaman tetap dibaca sekali saat halaman dimuat (renderLinkGate / showDashboard), lalu dibersihkan di sini.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo({ top: 0, behavior: smoothScroll ? 'smooth' : 'auto' });
  if (page === 'activity') {
    privateLogScrollOnNextRender = true;
    startPrivateLogAutoRefresh();
    void loadPairingLogs();
  } else {
    privateLogScrollOnNextRender = false;
    stopPrivateLogAutoRefresh();
  }
  if (page === 'infoupdate') {
    void loadInfoUpdates();
    stopInfoUpdateAutoRefresh();
    infoUpdateRefreshTimer = window.setInterval(() => { void loadInfoUpdates(); }, 60000);
  } else {
    stopInfoUpdateAutoRefresh();
    void refreshInfoUpdateBadge();
  }
  if (page === 'admin') {
    if (previousPage !== null) void markMemberListSeen();
  } else {
    void refreshMemberBadge();
  }
  if (page === 'server') {
    void refreshWorkspaceServerStatus();
    stopWorkspaceServerAutoRefresh();
    workspaceServerRefreshTimer = window.setInterval(() => { void refreshWorkspaceServerStatus(); }, 5000);
  } else {
    stopWorkspaceServerAutoRefresh();
  }
  // Halaman Backup memuat ulang status Telegram dan restore point setiap kali dibuka agar angkanya selalu dari data live, bukan sisa login.
  if (page === 'backup') {
    initAdminBackupTelegramConfig();
    void loadAdminBackupTelegramStatus();
    void loadAdminBackupSnapshots();
  }
  // Halaman Kontrol Bot memuat ulang daftar bot setiap kali dibuka agar statusnya selalu dari data live, bukan sisa login.
  if (page === 'botcontrol') {
    void loadBotControlUsers();
    startBotControlUsersPolling();
  }
  // Halaman Rank Bot memuat ulang peringkat setiap kali dibuka agar angkanya selalu dari data live, bukan sisa login.
  if (page === 'rankbot') {
    void loadRankBot();
    startRankBotPolling();
  }
  // Halaman Aktivitas Akun memuat ulang waktu login tiap pemilik setiap kali dibuka agar angkanya selalu dari data live, bukan sisa login.
  if (page === 'accountactivity') {
    void loadAccountActivity();
    startAccountActivityPolling();
  }
  // Halaman Pairing memuat pustaka nomor telepon hanya saat dibuka, supaya
  // halaman login tidak ikut mengunduh file 252 KB itu di awal.
  if (page === 'pairing') {
    void ensureLibphonenumber();
  }
  // Halaman Fitur Bot dibuka: posisikan carousel HP ke kartu yang terbuka dan segarkan titik indikatornya.
  if (page === 'mode') {
    syncPlanCarouselPosition();
    syncBotLinkNotice();
  }
  setMenu(false);
}

function renderLinkGate(pairing) {
  const linkedSessionStates = new Set(['linked', 'disconnected', 'reconnecting', 'stopped']);
  const hasLinkedSession = linkedSessionStates.has(pairing?.status);
  document.body.dataset.whatsappLinked = String(hasLinkedSession);
  // Menu Fitur Bot selalu tampil walau WhatsApp belum tertaut: member yang
  // mengetuknya mendapat notifikasi di layar dan diarahkan ke Pairing — masuk
  // ke halamannya sendiri diblokir sampai WhatsApp tertaut (lihat
  // setWorkspacePage). Admin tidak kena aturan ini.
  document.querySelectorAll('[data-linked-only]:not([data-page-view="mode"])').forEach((element) => {
    element.classList.toggle('hidden', !hasLinkedSession);
  });
  document.querySelector('.side-nav .nav-item[href="#mode"]')?.classList.remove('hidden');
  document.querySelectorAll('[data-page-view="mode"]').forEach((element) => {
    element.classList.remove('hidden');
  });
  document.querySelectorAll('[data-setup-only]').forEach((element) => {
    element.classList.toggle('hidden', hasLinkedSession);
  });
  const adminVisible = Boolean(currentUser);
  document.querySelector('#admin')?.classList.toggle('hidden', !adminVisible);
  document.querySelector('#rankbot')?.classList.remove('hidden');
  document.querySelector('#accountactivity')?.classList.remove('hidden');
  document.querySelector('#admin-nav')?.classList.toggle('hidden', !adminVisible);
  document.querySelector('.side-nav .nav-item[href="#dashboard"]')?.classList.toggle('hidden', !hasLinkedSession);
  document.querySelector('.side-nav .nav-item[href="#activity"]')?.classList.toggle('hidden', !hasLinkedSession);
  document.querySelector('#pairing-nav')?.classList.toggle('hidden', hasLinkedSession);
  // Lencana koneksi punya dua label: label panjang untuk layar lebar dan label
  // ringkas untuk HP sempit, keduanya selalu diisi dari status yang sama agar
  // tampilannya akurat di semua ukuran layar.
  // Lencana harus jujur soal status realtime: sesi yang sedang
  // menyambung ulang bukan "TERTAUT" — sebelumnya badge itu yang membuat
  // sesi mati terlihat masih konek di HP member.
  const badgeByStatus = {
    linked: ['WHATSAPP ONLINE', 'WA ONLINE'],
    reconnecting: ['MENYAMBUNG…', 'MENYAMBUNG'],
    disconnected: ['WA TERPUTUS', 'TERPUTUS'],
    stopped: ['WA DIHENTIKAN', 'BERHENTI'],
    invalid: ['SESI DITOLAK', 'DITOLAK'],
    awaiting_code: ['MENUNGGU KODE', 'KODE'],
    awaiting_qr: ['MENUNGGU QR', 'QR'],
    connecting: ['MENGHUBUNGKAN', 'HUBUNGKAN'],
    checking_number: ['MENGHUBUNGKAN', 'HUBUNGKAN'],
    linking: ['MENAUTKAN', 'TAUTKAN'],
  };
  const badgePair = badgeByStatus[pairing?.status]
    || (hasLinkedSession ? ['SESI TERSIMPAN', 'TERSIMPAN'] : ['TAUTKAN WHATSAPP', 'TAUTKAN']);
  const badgeText = badgePair[0];
  const badgeShortText = badgePair[1];
  document.querySelector('#connection-badge').textContent = badgeText;
  document.querySelector('#connection-badge-short').textContent = badgeShortText;
  syncBotLinkNotice();
  if (!activeWorkspacePage) {
    const requestedPage = location.hash.slice(1);
    const requestedNav = document.querySelector(`.side-nav .nav-item[href="#${requestedPage}"]`);
    let rememberedPage = null;
    try { rememberedPage = window.sessionStorage.getItem(LAST_PAGE_STORAGE_KEY); } catch { /* Halaman awal tetap berjalan tanpa storage. */ }
    const rememberedNav = rememberedPage ? document.querySelector(`.side-nav .nav-item[href="#${rememberedPage}"]`) : null;
    const initialPage = requestedNav && !requestedNav.classList.contains('hidden')
      ? requestedPage
      : rememberedNav && !rememberedNav.classList.contains('hidden')
        ? rememberedPage
        : adminVisible
          ? 'admin'
          : hasLinkedSession ? 'dashboard' : 'pairing';
    setWorkspacePage(initialPage, false);
  } else if (hasLinkedSession && activeWorkspacePage === 'pairing') {
    setWorkspacePage('dashboard');
  } else if (!hasLinkedSession && ['dashboard', 'mode'].includes(activeWorkspacePage)) {
    setWorkspacePage('pairing');
  }
  return hasLinkedSession;
}

function renderPairingState(pairing) {
  const previousPairingStatus = lastPairingStatus;
  lastPairingStatus = pairing?.status || null;
  renderLinkGate(pairing);
  const codeCard = document.querySelector('#pairing-code-card');
  const codeElement = document.querySelector('#pairing-code');
  const expiryElement = document.querySelector('#pairing-expiry');
  const qrCard = document.querySelector('#pairing-qr-card');
  const qrElement = document.querySelector('#pairing-qr');
  const qrExpiryElement = document.querySelector('#pairing-qr-expiry');
  const retryButton = document.querySelector('#pairing-retry');
  const controls = document.querySelector('#pairing-controls');
  const recoveryCard = document.querySelector('#pairing-recovery-card');
  const recoveryCopy = document.querySelector('#pairing-recovery-copy');
  const recoverButton = document.querySelector('#pairing-recover');
  const linkedCard = document.querySelector('#pairing-linked-card');
  const sessionActions = document.querySelector('#session-actions');
  const resumeButton = document.querySelector('#session-resume');
  const stopButton = document.querySelector('#session-stop');
  const statusValue = document.querySelector('#whatsapp-status-value');
  const statusDescription = document.querySelector('#whatsapp-status-description');
  const statusFoot = document.querySelector('#whatsapp-status-foot');
  const statusDot = document.querySelector('#whatsapp-status-dot');
  const runnerTitle = document.querySelector('#runner-title');
  const runnerDescription = document.querySelector('#runner-description');
  const runnerStatus = document.querySelector('#runner-status');
  const pairingInstructions = document.querySelector('#pairing-instructions');
  const requiredElements = [
    codeCard, codeElement, expiryElement, retryButton, controls, recoveryCard,
    recoverButton, linkedCard,
    sessionActions, resumeButton, stopButton, statusValue, statusDescription,
    statusFoot, statusDot, runnerTitle, runnerDescription, runnerStatus,
  ];
  if (requiredElements.some((element) => !element)) return;
  const instructionsWereOpen = pairingInstructions?.open === true;
  clearInterval(pairingPollTimer);
  clearInterval(pairingCountdownTimer);
  stopPairingCooldown();
  codeCard.classList.add('hidden');
  qrCard?.classList.add('hidden');
  retryButton.classList.add('hidden');
  controls.classList.remove('hidden');
  recoveryCard.classList.add('hidden');
  recoverButton.disabled = false;
  recoverButton.textContent = 'Coba pulihkan sesi';
  linkedCard.classList.add('hidden');
  sessionActions.classList.add('hidden');
  resumeButton.classList.add('hidden');
  stopButton.classList.add('hidden');
  codeElement.textContent = '';
  if (qrElement) qrElement.removeAttribute('src');

	  if (!pairing) {
	    // Jangan mewarisi centang dari pemulihan form browser saat membuka pairing baru.
	    document.querySelector('#pairing-confirm').checked = false;
	    document.querySelector('#pairing-auto-confirm').checked = false;
	    document.querySelectorAll('.pairing-consent').forEach((label) => label.classList.remove('is-required-error'));
	    statusValue.textContent = 'Belum tertaut';
    statusDescription.textContent = 'Belum ada sesi WhatsApp aktif.';
    statusFoot.textContent = 'Menunggu pairing';
    statusDot.className = 'muted-dot';
    runnerTitle.textContent = 'Belum ada perangkat WhatsApp tertaut';
    runnerDescription.textContent = 'Minta pairing code untuk menautkan perangkat. Worker bot dan pembacaan story belum aktif.';
    runnerStatus.textContent = 'BELUM TERTAUT';
    renderBotWorkerUi('stopped', null, null);
    setPairingNotice('');
    return;
  }
	  renderBotWorkerUi(pairing.workerStatus || 'stopped', pairing.status, pairing.workerStartedAt);
	  if (pairing.status === 'awaiting_qr' && pairing.qrDataUrl && pairing.expiresAt) {
	    // Setelah QR siap, tampilkan kartu QR sebagai hasil utama tanpa mengulang
	    // blok consent/peringatan pairing di bawahnya.
	    controls.classList.add('hidden');
	    qrCard?.classList.remove('hidden');
    if (qrElement) qrElement.src = pairing.qrDataUrl;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
      if (qrExpiryElement) qrExpiryElement.textContent = seconds
        ? `Buka WhatsApp → Perangkat Tertaut → Tautkan Perangkat → scan QR ini · tersisa ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
        : 'QR Code kedaluwarsa. Minta QR baru setelah jeda keamanan.';
      if (!seconds) {
        qrCard?.classList.add('hidden');
        setPairingNotice('QR Code kedaluwarsa. Tunggu jeda keamanan sebelum meminta QR baru.', false, true);
      }
    };
    tick();
    pairingCountdownTimer = setInterval(tick, 1000);
    setPairingNotice('QR Code siap. Scan hanya dari aplikasi WhatsApp milikmu.', true);
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 5000);
    return;
	  }
	  if (pairing.status === 'awaiting_code' && pairing.code && pairing.expiresAt) {
	    // Kartu pairing code menjadi satu-satunya hasil utama saat kode siap.
	    controls.classList.add('hidden');
	    codeCard.classList.remove('hidden');
    codeElement.textContent = pairing.code;
    if (pairingInstructions) pairingInstructions.open = instructionsWereOpen;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
      const displayPhone = pairing.phoneNumber ? `+${pairing.phoneNumber}` : pairing.maskedPhone;
      expiryElement.textContent = seconds
        ? `Masukkan di WhatsApp · ${displayPhone} · tersisa ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
        : 'Kode kedaluwarsa. Minta kode baru setelah jeda keamanan.';
      if (!seconds) {
        codeElement.textContent = '';
        codeCard.classList.add('hidden');
        setPairingNotice('Pairing code kedaluwarsa. Tunggu jeda keamanan sebelum meminta kode lain.', false, true);
      }
    };
    tick();
    pairingCountdownTimer = setInterval(tick, 1000);
    setPairingNotice('Pairing code siap. Masukkan sendiri di WhatsApp pada Perangkat Tertaut.', true);
    if (previousPairingStatus !== 'awaiting_code') {
      // Kode baru muncul realtime: gulir jendela kode ke tengah layar HP
      // supaya member langsung melihatnya tanpa mencari ke bawah.
      codeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('Pairing code baru tersedia — masukkan di WhatsApp.');
    }
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 5000);
    return;
  }
  if (pairing.status === 'connecting') {
    statusValue.textContent = 'Menghubungkan';
    statusDescription.textContent = 'Menyiapkan sesi pairing WhatsApp.';
    statusFoot.textContent = 'Membuat pairing code';
    statusDot.className = 'muted-dot';
    setPairingNotice('Menghubungkan ke WhatsApp untuk meminta kode…', false, true);
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 5000);
    return;
  }
  if (pairing.status === 'checking_number') {
    statusValue.textContent = 'Memproses nomor';
    statusDescription.textContent = 'Mengirim permintaan pairing ke WhatsApp.';
    statusFoot.textContent = 'Respons WhatsApp realtime';
    statusDot.className = 'muted-dot';
    setPairingNotice('WhatsApp sedang memproses nomor dan menyiapkan pairing code…', false, true);
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 3000);
    return;
  }
  if (pairing.status === 'linking') {
    statusValue.textContent = 'Menyelesaikan tautan';
    statusDescription.textContent = 'WhatsApp menerima kode; koneksi sedang dimulai ulang.';
    statusFoot.textContent = 'Menunggu konfirmasi WhatsApp';
    statusDot.className = 'muted-dot';
    setPairingNotice('Kode diterima. WhatsApp sedang menyelesaikan tautan perangkat…', false, true);
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 5000);
    return;
  }
  if (pairing.status === 'linked') {
    controls.classList.add('hidden');
    linkedCard.classList.remove('hidden');
    linkedCard.classList.remove('is-warning');
    linkedCard.querySelector('.linked-mark').textContent = '✓';
    sessionActions.classList.remove('hidden');
    stopButton.classList.remove('hidden');
    statusValue.textContent = 'WhatsApp Online';
    statusDescription.textContent = 'Koneksi WhatsApp terbuka dan aktif real-time.';
    statusFoot.textContent = 'Terhubung sekarang';
    statusDot.className = 'green-dot';
    const workerRunning = pairing.workerStatus === 'running';
    runnerTitle.textContent = workerRunning ? 'Bot memantau event story/status' : 'WhatsApp terhubung real-time';
    runnerDescription.textContent = workerRunning
      ? 'Bot worker aktif dan mencatat event status yang diterima Baileys; tanda baca otomatis tidak dikirim.'
      : 'Koneksi WhatsApp aktif. Tekan Start bot untuk memantau event status/story.';
    runnerStatus.textContent = workerRunning ? 'BOT ONLINE' : 'WHATSAPP ONLINE';
    linkedCard.querySelector('strong').textContent = workerRunning
      ? 'WhatsApp Online · Bot berjalan'
      : 'WhatsApp Online · terhubung real-time';
    linkedCard.querySelector('p').textContent = workerRunning
      ? 'Koneksi aktif; worker mencatat event story/status yang diterima tanpa read receipt otomatis.'
      : 'Koneksi aktif. Worker bot bisa dinyalakan dari panel Kontrol Bot.';
    document.querySelector('#pairing-phone').value = '';
    document.querySelector('#pairing-confirm').checked = false;
    setPairingNotice('');
    void loadPairingLogs();
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 5000);
    return;
  }
  if (pairing.status === 'expired') {
    statusValue.textContent = 'Kode kedaluwarsa';
    statusDescription.textContent = 'Sesi tidak tertaut. Minta kode baru setelah jeda.';
    statusFoot.textContent = 'Pairing belum selesai';
    statusDot.className = 'muted-dot';
    retryButton.classList.remove('hidden');
    setPairingNotice('Pairing code sudah kedaluwarsa. Untuk keamanan, tunggu jeda sebelum meminta kode lain.', false, true);
    void loadPairingLogs();
    return;
  }
  if (pairing.status === 'disconnected') {
    controls.classList.add('hidden');
    linkedCard.classList.remove('hidden');
    linkedCard.classList.add('is-warning');
    linkedCard.querySelector('.linked-mark').textContent = '!';
    linkedCard.querySelector('strong').textContent = 'WhatsApp mencoba tersambung ulang';
    linkedCard.querySelector('p').textContent = 'Sesi masih tersimpan dan sambung ulang otomatis dijadwalkan. Kamu juga bisa mencoba Sambungkan ulang.';
    sessionActions.classList.remove('hidden');
    resumeButton.classList.remove('hidden');
    statusValue.textContent = 'Mencoba ulang';
    statusDescription.textContent = 'Sesi tersimpan; koneksi akan dicoba ulang otomatis.';
    statusFoot.textContent = 'Retry otomatis aktif';
    statusDot.className = 'muted-dot';
    setPairingNotice('');
    void loadPairingLogs();
    return;
  }
  if (pairing.status === 'invalid') {
    if (pairing.maskedPhone) {
      controls.classList.add('hidden');
      recoveryCard.classList.remove('hidden');
      // Sesi mati tapi kredensial masih tersimpan: member harus bisa
      // menghapus tautan dari sini, bukan cuma "Coba pulihkan sesi".
      sessionActions.classList.remove('hidden');
      if (recoveryCopy) recoveryCopy.textContent = `Sesi ${pairing.maskedPhone} ditolak WhatsApp. Coba pulihkan dulu — kalau sesinya masih bagus, panel akan sambung lagi tanpa perlu nomor baru. Kalau pulihkan gagal terus, berarti sesi ini sudah dicabut WhatsApp: hapus perangkat lama di WhatsApp > Perangkat tertaut, lalu pairing ulang dengan nomor baru.`;
      statusValue.textContent = 'Sesi ditolak WhatsApp';
      statusDescription.textContent = 'Coba pulihkan dulu. Kalau gagal terus, hapus perangkat lama di WhatsApp > Perangkat tertaut lalu pairing ulang.';
      statusFoot.textContent = 'Coba pulihkan dulu';
      statusDot.className = 'muted-dot';
      setPairingNotice('Sesi ditolak WhatsApp. Coba pulihkan dulu; kalau gagal terus, hapus perangkat lama di WhatsApp lalu pairing ulang.', false, true);
      void loadPairingLogs();
      pairingPollTimer = setInterval(() => { void refreshPairing(); }, 5000);
      return;
    }
    statusValue.textContent = 'Sesi tidak valid';
    statusDescription.textContent = 'WhatsApp menolak kredensial sesi tersimpan. Pairing ulang diperlukan.';
    statusFoot.textContent = 'Perlu tautkan ulang';
    statusDot.className = 'muted-dot';
    setPairingNotice('Sesi lama tidak diterima oleh WhatsApp. Masukkan nomor yang ingin ditautkan lalu minta pairing code baru.', false, true);
    void loadPairingLogs();
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 5000);
    return;
  }
  if (pairing.status === 'recovering') {
    controls.classList.add('hidden');
    linkedCard.classList.remove('hidden');
    linkedCard.classList.add('is-warning');
    linkedCard.querySelector('.linked-mark').textContent = '…';
    sessionActions.classList.remove('hidden');
    linkedCard.querySelector('strong').textContent = 'Memulihkan sesi…';
    linkedCard.querySelector('p').textContent = 'Sesi ditolak WhatsApp; panel mencoba sambung ulang dari sesi tersimpan dan cadangan terakhir yang sehat.';
    statusValue.textContent = 'Memulihkan sesi';
    statusDescription.textContent = 'Mencoba sambung ulang dari sesi tersimpan dan cadangan terakhir yang sehat.';
    statusFoot.textContent = 'Pemulihan otomatis';
    statusDot.className = 'muted-dot';
    setPairingNotice('Mencoba memulihkan sesi…', false, true);
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 3000);
    return;
  }
  if (pairing.status === 'reconnecting') {
    controls.classList.add('hidden');
    linkedCard.classList.remove('hidden');
    linkedCard.classList.add('is-warning');
    linkedCard.querySelector('.linked-mark').textContent = '…';
    // Sebelumnya tombol aksi sesi disembunyikan di state ini, jadi member
    // yang sesinya macet tidak bisa Sambungkan ulang maupun Hapus sesi.
    sessionActions.classList.remove('hidden');
    resumeButton.classList.remove('hidden');
    linkedCard.querySelector('strong').textContent = 'Menyambungkan WhatsApp…';
    linkedCard.querySelector('p').textContent = 'Sedang membuka kembali sesi yang tersimpan.';
    statusValue.textContent = 'Menyambungkan';
    statusDescription.textContent = pairing.reconnectFailures
      ? `Mencoba menyambungkan ulang sesi WhatsApp. Gagal ${pairing.reconnectFailures} dari 5 kali percobaan — kalau gagal terus, sesi ditandai tidak valid dan kamu bisa minta pairing code baru.`
      : 'Mencoba menyambungkan ulang sesi WhatsApp.';
    statusFoot.textContent = 'Menghubungkan';
    statusDot.className = 'muted-dot';
    setPairingNotice('');
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 3000);
    return;
  }
  if (pairing.status === 'stopped') {
    controls.classList.add('hidden');
    linkedCard.classList.remove('hidden');
    linkedCard.classList.add('is-warning');
    linkedCard.querySelector('.linked-mark').textContent = '!';
    linkedCard.querySelector('strong').textContent = 'Sesi WhatsApp dihentikan';
    linkedCard.querySelector('p').textContent = 'Kredensial tetap tersimpan. Sambungkan ulang untuk kembali online.';
    sessionActions.classList.remove('hidden');
    resumeButton.classList.remove('hidden');
    statusValue.textContent = 'Dihentikan';
    statusDescription.textContent = 'Koneksi dihentikan; sesi lokal masih tersimpan.';
    statusFoot.textContent = 'Bisa disambungkan ulang';
    statusDot.className = 'muted-dot';
    setPairingNotice('');
    return;
  }
  if (pairing.status === 'failed') {
    statusValue.textContent = 'Belum tertaut';
    statusDescription.textContent = 'Belum ada sesi WhatsApp aktif. Masukkan nomor untuk memulai pairing.';
    statusFoot.textContent = 'Siap untuk dicoba lagi';
    statusDot.className = 'muted-dot';
    retryButton.classList.add('hidden');
    setPairingNotice('');
  }
}

async function refreshPairing() {
  try {
    const result = await api('/api/pairing/status');
    renderPairingState(result.pairing);
    // Pairing sukses membuat profil default di backend. Muat ulang profil bot
    // agar kartu mode langsung menampilkan mode terbaru, bukan state sebelum tertaut.
    if (result.pairing?.status === 'linked') {
      const botResult = await api('/api/bot');
      applyBot(botResult.bot);
    }
  } catch (error) {
    if (error.status === 401) showAuth();
  }
}

const PRIVATE_LOG_ICON_PATHS = {
  story: ['M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
  alert: ['M12 3.2 22 20.5H2z', 'M12 9v4', 'M12 16.5h.01'],
  bot: ['M8 8h8a4 4 0 0 1 4 4v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a4 4 0 0 1 4-4Z', 'M12 4v4', 'M10 13h.01', 'M14 13h.01', 'M9 16h6'],
  whatsapp: ['M5 19.2 6.1 16A7.6 7.6 0 1 1 9 18.6z', 'M9 9c.4 2 1.8 3.4 3.8 3.8l1.4-1 2 .9c-.2 1.2-1.2 2-2.4 1.9-3.5-.5-6.2-3.2-6.7-6.7-.1-1.2.7-2.2 1.9-2.4l.9 2z'],
  system: ['M3 12h4l2-5 4 10 2-5h6'],
};

function createPrivateLogIcon(category) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'private-log-event-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PRIVATE_LOG_ICON_PATHS[category] || PRIVATE_LOG_ICON_PATHS.system) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

function buildPrivateLogEntry(entry) {
  const item = document.createElement('li');
  item.className = 'activity-log-entry';
  const meta = document.createElement('div');
  meta.className = 'activity-log-meta';
  const time = document.createElement('time');
  time.dateTime = entry.createdAt;
  time.textContent = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt));
  const text = String(entry.event || 'Aktivitas akun.');
  const lower = text.toLowerCase();
  const kind = document.createElement('span');
  let category = 'SISTEM';
  let className = '';
  if (entry.details?.kind === 'story') { category = 'STORY'; className = 'story'; }
  else if (/gagal|terputus|kedaluwarsa|dihapus/.test(lower)) { category = 'PERHATIAN'; className = 'alert'; }
  else if (/menerima.*(story|status)|pembaruan story|pembaruan status/.test(lower)) { category = 'STORY'; className = 'story'; }
  else if (/bot|worker/.test(lower)) { category = 'BOT'; className = 'bot'; }
  else if (/story|status/.test(lower)) { category = 'STORY'; className = 'story'; }
  else if (/whatsapp|pairing|perangkat|koneksi|tautan|sesi/.test(lower)) { category = 'WHATSAPP'; className = 'whatsapp'; }
  const categoryKey = className || 'system';
  item.dataset.logCategory = categoryKey;
  kind.className = `activity-kind ${className}`;
  kind.append(createPrivateLogIcon(categoryKey), document.createTextNode(category));
  meta.append(kind, time);
  if (entry.details?.kind === 'story') {
    item.classList.add('activity-log-story');
    const details = entry.details;
    const card = document.createElement('article');
    card.className = 'story-log-card';
    const heading = document.createElement('div');
    heading.className = 'story-log-heading';
    const title = document.createElement('strong');
    title.textContent = 'Auto Read Story';
    const outcome = document.createElement('span');
    const outcomeText = String(details.success || 'Status tidak diketahui');
    outcome.className = `story-log-outcome ${/gagal|❌/i.test(outcomeText) ? 'is-error' : 'is-success'}`;
    outcome.textContent = outcomeText;
    heading.append(title, outcome);
    const grid = document.createElement('dl');
    grid.className = 'story-log-grid';
    const fields = [
      ['Mode', details.mode], ['TipeStory', details.mediaType], ['IdStory', details.storyId],
      ['Selamat', details.greeting], ['Hari', details.dayName], ['Tanggal', details.date],
      ['Waktu', details.time], ['Nama', details.name], ['Nomor', details.number],
      ['TotalStory', details.storyCount], ['EmojiMode', details.emojiMode],
      ['Berhasil', details.success], ['Reaksi', details.reaction], ['Resolve', details.resolve],
      ['Delay', `${Number(details.delaySeconds || 0).toFixed(1)} detik`],
    ];
    for (const [label, value] of fields) {
      const cell = document.createElement('div');
      cell.className = 'story-log-field';
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = String(value ?? '—');
      cell.append(term, description);
      grid.append(cell);
    }
    card.append(heading, grid);
    item.append(meta, card);
  } else {
    const message = document.createElement('span');
    message.className = 'activity-log-message';
    message.textContent = text;
    item.append(meta, message);
  }
  return item;
}

let activePrivateLogFilter = 'all';

function applyPrivateLogFilters() {
  const list = document.querySelector('#private-log-list');
  const filterSummary = document.querySelector('#private-log-filter-summary');
  const emptyState = document.querySelector('#private-log-empty');
  if (!list) return;
  const items = [...list.querySelectorAll('.activity-log-entry')];
  const categoryCounts = { all: items.length, story: 0, bot: 0, whatsapp: 0, alert: 0, system: 0 };
  items.forEach((item) => {
    const category = categoryCounts[item.dataset.logCategory] === undefined ? 'system' : item.dataset.logCategory;
    categoryCounts[category] += 1;
  });
  if (activePrivateLogFilter !== 'all' && !categoryCounts[activePrivateLogFilter]) activePrivateLogFilter = 'all';
  const query = String(document.querySelector('#private-log-search')?.value || '').trim().toLocaleLowerCase('id-ID');
  let visibleCount = 0;
  items.forEach((item) => {
    const categoryMatches = activePrivateLogFilter === 'all' || item.dataset.logCategory === activePrivateLogFilter;
    const searchMatches = !query || item.textContent.toLocaleLowerCase('id-ID').includes(query);
    const visible = categoryMatches && searchMatches;
    item.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  document.querySelectorAll('[data-log-filter]').forEach((button) => {
    const filter = button.dataset.logFilter;
    const active = filter === activePrivateLogFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    const count = button.querySelector('[data-filter-count]');
    if (count) count.textContent = String(categoryCounts[filter] ?? 0);
  });
  if (filterSummary) {
    filterSummary.textContent = items.length
      ? `${visibleCount.toLocaleString('id-ID')} dari ${items.length.toLocaleString('id-ID')} event ditampilkan`
      : 'Belum ada event untuk ditampilkan';
  }
  if (emptyState) emptyState.hidden = !items.length || visibleCount > 0;
}

async function loadPairingLogs() {
  if (privateLogLoading) return;
  privateLogLoading = true;
  const summaryList = document.querySelector('#pairing-log-list');
  const detailList = document.querySelector('#private-log-list');
  try {
    const result = await api('/api/pairing/logs');
    const logs = Array.isArray(result.logs) ? result.logs : [];
    const latest = logs.at(-1);
    const latestIdentity = latest ? String(latest.id || `${latest.createdAt}:${latest.event}`) : null;
    const hasNewActivity = privateLogSnapshotReady && latestIdentity !== null && latestIdentity !== lastPrivateLogIdentity;
    const contentChanged = !privateLogSnapshotReady || latestIdentity !== lastPrivateLogIdentity || logs.length !== lastPrivateLogCount;
    privateLogSnapshotReady = true;
    lastPrivateLogIdentity = latestIdentity;
    lastPrivateLogCount = logs.length;
    const countText = logs.length === 100 ? '100 aktivitas terbaru dimuat' : `${logs.length.toLocaleString('id-ID')} aktivitas dimuat`;
    const latestTime = latest ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(latest.createdAt)) : '';
    const latestText = latest ? `Terakhir: ${latestTime} WIB` : 'Belum ada aktivitas tercatat.';
    document.querySelector('#private-log-count')?.replaceChildren(document.createTextNode(countText));
    document.querySelector('#private-log-latest')?.replaceChildren(document.createTextNode(latestText));
    document.querySelector('#private-log-page-count')?.replaceChildren(document.createTextNode(countText));
    document.querySelector('#private-log-page-updated')?.replaceChildren(document.createTextNode(`Diperbarui ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date())} WIB`));
    if (!contentChanged) {
      if (activeWorkspacePage === 'activity' && privateLogScrollOnNextRender) {
        scrollPrivateLogToNewest(detailList, 'auto');
        privateLogScrollOnNextRender = false;
      }
      return;
    }
    const emptyText = 'Belum ada aktivitas bot. Event story/status akan dicatat saat diterima Baileys.';
    const summaryEntries = logs.slice(-8).reverse();
    const detailEntries = logs.slice(-100).reverse();
    for (const [list, entries] of [[summaryList, summaryEntries], [detailList, detailEntries]]) {
      if (!list) continue;
      list.replaceChildren();
      if (!logs.length) {
        const empty = document.createElement('li');
        empty.textContent = emptyText;
        list.append(empty);
        continue;
      }
      for (const entry of entries) list.append(buildPrivateLogEntry(entry));
    }
    applyPrivateLogFilters();
    if (activeWorkspacePage === 'activity' && (privateLogScrollOnNextRender || hasNewActivity)) {
      scrollPrivateLogToNewest(detailList, privateLogScrollOnNextRender ? 'auto' : 'smooth');
      privateLogScrollOnNextRender = false;
    } else if (activeWorkspacePage === 'dashboard' && hasNewActivity) {
      scrollPrivateLogToNewest(summaryList);
    }
  } catch (error) {
    for (const list of [summaryList, detailList]) {
      if (!list) continue;
      list.replaceChildren();
      const item = document.createElement('li');
      item.textContent = error.status === 401 ? 'Silakan masuk kembali.' : 'Log belum dapat dimuat.';
      list.append(item);
    }
    const filterSummary = document.querySelector('#private-log-filter-summary');
    if (filterSummary) filterSummary.textContent = error.status === 401 ? 'Sesi login perlu diperbarui' : 'Log belum dapat dimuat';
  } finally {
    privateLogLoading = false;
  }
}

document.querySelector('.avatar-tabs')?.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-avatar-filter]');
  if (!tab) return;
  const filter = tab.dataset.avatarFilter;
  document.querySelectorAll('[data-avatar-filter]').forEach((item) => {
    const active = item === tab;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-avatar-preset]').forEach((card) => {
    card.hidden = filter !== 'all' && card.dataset.avatarGender !== filter;
  });
});

function applyAvatar(user) {
  const preset = /^avatar-(0[1-9]|[123][0-9]|4[0-8])$/.test(user.avatar || '') ? user.avatar : 'avatar-01';
  const src = user.avatar === 'uploaded'
    ? `/api/me/avatar?u=${encodeURIComponent(user.id)}&v=${encodeURIComponent(user.avatarUpdatedAt || Date.now())}`
    : `/avatars/${preset}.webp`;
  for (const image of [document.querySelector('#avatar-initials'), document.querySelector('#profile-avatar-image')]) {
    if (!image) continue;
    image.src = src;
    image.alt = `${user.displayName || user.username} avatar`;
    image.onerror = () => { image.onerror = null; image.src = '/avatars/avatar-01.webp'; };
  }
  document.querySelectorAll('[data-avatar-preset]').forEach((button) => {
    button.setAttribute('aria-pressed', String(user.avatar === button.dataset.avatarPreset || (!user.avatar && button.dataset.avatarPreset === 'avatar-01')));
  });
  const selectedCard = user.avatar === 'uploaded' ? null : [...document.querySelectorAll('[data-avatar-preset]')].find((button) => button.dataset.avatarPreset === preset);
  const selectedName = selectedCard?.querySelector('.avatar-choice-name')?.textContent || (user.avatar === 'uploaded' ? 'Unggahan pribadi' : 'Avatar pilihan');
  const selectionNote = document.querySelector('#avatar-selection-note');
  if (selectionNote) selectionNote.textContent = `Avatar aktif: ${selectedName}. Pilihan ini tersimpan khusus untuk akunmu.`;
}

async function showDashboard(user) {
  currentUser = user;
  const isAdmin = user.role === 'admin';
  document.querySelector('#admin-nav')?.classList.remove('hidden');
  document.querySelector('#admin')?.classList.remove('hidden');
  // Halaman Backup hanya untuk admin (Admin Utama dan admin biasa): menunya terlihat untuk semua akun yang login, tapi terkunci untuk member (lencana Terkunci, tidak bisa diklik); isi halamannya tetap disembunyikan total untuk member.
  const backupNav = document.querySelector('#backup-nav');
  backupNav?.classList.remove('hidden');
  backupNav?.classList.toggle('nav-item-locked', !isAdmin);
  backupNav?.setAttribute('aria-disabled', String(!isAdmin));
  document.querySelector('#backup')?.classList.toggle('hidden', !isAdmin);
  // Halaman Kontrol Bot hanya untuk admin (Admin Utama dan admin biasa): menunya terlihat untuk semua akun yang login, tapi terkunci untuk member (lencana Terkunci, tidak bisa diklik); isi halamannya tetap disembunyikan total untuk member.
  const botControlNav = document.querySelector('#botcontrol-nav');
  botControlNav?.classList.remove('hidden');
  botControlNav?.classList.toggle('nav-item-locked', !isAdmin);
  botControlNav?.setAttribute('aria-disabled', String(!isAdmin));
  document.querySelector('#botcontrol')?.classList.toggle('hidden', !isAdmin);
  const requestedPage = location.hash.slice(1);
  if (requestedPage === 'profile' || requestedPage === 'admin') {
    setWorkspacePage(requestedPage, false);
  }
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  bootScreen?.classList.add('hidden');
  const displayName = user.displayName || user.username;
  document.querySelector('#welcome-name').textContent = displayName;
  document.querySelector('#top-user-name').textContent = displayName;
  document.querySelector('#profile-display-title').textContent = displayName;
  document.querySelector('#profile-username-label').textContent = user.username;
  document.querySelector('#sidebar-account-role').textContent = user.role === 'admin' ? 'ADMIN' : 'MEMBER';
  document.querySelector('#sidebar-account-username').textContent = `@${user.username}`;
  applyAvatar(user);
  document.querySelector('#account-role').textContent = user.role === 'admin' ? 'Administrator' : 'Pengguna';
  document.querySelector('#account-email').textContent = user.email;
  document.querySelector('#profile-name').value = displayName;
  document.querySelector('#profile-username').value = user.username;
  document.querySelector('#profile-email').value = user.email;
  document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());
  try {
    const result = await api('/api/bot');
    applyBot(result.bot);
  } catch (error) {
    if (error.status === 401) return showAuth();
    showToast(error.message);
  }
  await Promise.all([loadAdminUsers(), loadAdminBackupSnapshots(), loadAdminBackupTelegramStatus(), refreshPairing(), loadPairingLogs()]);
  void refreshInfoUpdateBadge();
  void refreshMemberBadge();
  await loadLoginHistory();
  startLoginHistoryPolling();
  startAdminUsersPolling();
  startBotControlUsersPolling();
  startPresenceHeartbeat();
}

async function persistStorySettings(snapshot, mode, userId, revision, showSavedToast = false) {
  if (revision !== storySaveRevision || !currentUser || currentUser.id !== userId) return;
  if (!mode) {
    setControlFeedback('story-settings-feedback', 'info', 'Pilih mode dulu', 'Daftar emoji siap dipakai. Pilih Read Only atau Read Only + ReadSW agar daftar ini tersimpan ke data akun.');
    return;
  }
  const storySettings = { ...snapshot };
  if (mode !== 'readonly_readsw') storySettings.autoReaction = false;
  if (storySettings.delayMinSeconds > storySettings.delayMaxSeconds) {
    setControlFeedback('story-settings-feedback', 'error', 'Rentang delay tidak valid', 'Delay minimum harus kurang dari atau sama dengan delay maksimum.');
    return;
  }
  if (storySettings.autoReaction && storySettings.emojiPool.length === 0) {
    setControlFeedback('story-settings-feedback', 'error', 'Pilih emoji aktif', 'Aktifkan minimal satu emoji atau matikan reaksi otomatis.');
    return;
  }
  const button = document.querySelector('#save-story-settings');
  button.disabled = true;
  setControlFeedback('story-settings-feedback', 'info', 'Menyimpan otomatis…', 'Menyimpan perubahan ke pengaturan akun ini.');
  try {
    const result = await api('/api/bot', {
      method: 'PUT',
      body: JSON.stringify({ mode, label: `${currentUser.displayName || currentUser.username} bot`, storySettings }),
    });
    if (revision !== storySaveRevision || currentUser?.id !== userId) return;
    applyBot(result.bot);
    if (result.pairing) renderPairingState(result.pairing);
    setControlFeedback('story-settings-feedback', 'success', 'Tersimpan otomatis', 'Emoji dan pengaturan ini tersimpan di data akunmu; akun lain memiliki daftar terpisah.');
    if (showSavedToast) showToast('Pengaturan story tersimpan pada akun ini.');
  } catch (error) {
    if (revision !== storySaveRevision || currentUser?.id !== userId) return;
    if (error.status === 401) showAuth();
    else setControlFeedback('story-settings-feedback', 'error', 'Belum tersimpan', error.message);
  } finally {
    if (revision === storySaveRevision) button.disabled = false;
  }
}

function scheduleStorySettingsSave(showSavedToast = false) {
  clearTimeout(storySaveTimer);
  const revision = ++storySaveRevision;
  const snapshot = readStorySettings();
  const mode = selectedMode;
  const userId = currentUser?.id;
  if (!currentUser) return showAuth();
  if (!mode) {
    setControlFeedback('story-settings-feedback', 'info', 'Pilih mode dulu', 'Daftar emoji siap dipakai. Pilih Read Only atau Read Only + ReadSW agar perubahan tersimpan ke akunmu.');
    return;
  }
  setControlFeedback('story-settings-feedback', 'info', 'Perubahan akan disimpan…', 'Menyimpan ke pengaturan khusus akun ini.');
  storySaveTimer = setTimeout(() => {
    storySaveQueue = storySaveQueue.catch(() => {}).then(() => persistStorySettings(snapshot, mode, userId, revision, showSavedToast));
  }, 250);
}

function saveStoryPreferences() {
  clearTimeout(storySaveTimer);
  const revision = ++storySaveRevision;
  const snapshot = readStorySettings();
  const mode = selectedMode;
  const userId = currentUser?.id;
  storySaveQueue = storySaveQueue.catch(() => {}).then(() => persistStorySettings(snapshot, mode, userId, revision, true));
  return storySaveQueue;
}

function showAuth(mode = 'login') {
  infoUpdateUnreadCount = 0;
  memberNewCount = 0;
  updateMenuToggleAlert();
  setMenu(false);
  setMobileInfo(false);
  stopPrivateLogAutoRefresh();
  privateLogScrollOnNextRender = false;
  privateLogSnapshotReady = false;
  lastPrivateLogIdentity = null;
  lastPrivateLogCount = 0;
  clearTimeout(storySaveTimer);
  storySaveRevision += 1;
  document.querySelector('#save-story-settings').disabled = false;
  clearInterval(pairingPollTimer);
  clearInterval(pairingCountdownTimer);
  stopPairingCooldown();
  clearInterval(logPollTimer);
  clearInterval(adminUsersTimer);
  clearInterval(presenceHeartbeatTimer);
  adminUsersTimer = null;
  presenceHeartbeatTimer = null;
  setControlFeedback('session-feedback', '', '', '');
  setControlFeedback('bot-feedback', '', '', '');
  document.querySelector('#pairing-code')?.replaceChildren();
  document.querySelector('#pairing-code-card')?.classList.add('hidden');
  currentUser = null;
  activeWorkspacePage = null;
  try { window.sessionStorage.removeItem(LAST_PAGE_STORAGE_KEY); } catch { /* Halaman terakhir tetap terhapus dari memori halaman. */ }
  document.querySelectorAll('[data-page-view]').forEach((view) => view.classList.remove('view-hidden'));
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
  bootScreen?.classList.add('hidden');
  setAuthMode(mode === 'register' ? 'register' : 'login');
  startMotivationQuote();
}

const mobileInfoToggle = document.querySelector('#mobile-info-toggle');
const mobileInfoPage = document.querySelector('#mobile-info-page');
const mobileInfoMenu = document.querySelector('[data-mobile-info-menu-view]');
const mobileInfoTabs = document.querySelector('.mobile-info-tabs');
let mobileServerStatusTimer = null;

// Halaman Developer sebelum login memakai isi yang sama dengan halaman Developer di dalam panel agar tidak ada dua versi yang berbeda.
function syncMobileInfoDeveloperPanel() {
  const source = document.querySelector('#developer');
  const target = document.querySelector('[data-mobile-info-panel="developer"]');
  if (!source || !target || target.dataset.synced === 'true') return;
  const clone = document.createElement('div');
  clone.className = 'developer-section';
  for (const child of source.children) clone.append(child.cloneNode(true));
  clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  clone.querySelectorAll('[aria-labelledby]').forEach((element) => element.removeAttribute('aria-labelledby'));
  target.replaceChildren(clone);
  target.dataset.synced = 'true';
}
syncMobileInfoDeveloperPanel();

function formatServerBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatServerUptime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}h ${hours}j`;
  if (hours) return `${hours}j ${minutes}m`;
  return `${minutes}m ${seconds % 60}d`;
}

function formatServerSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return formatServerBytes(bytes);
}

function formatServerDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(date);
}

async function refreshMobileServerStatus() {
  try {
    const status = await api('/api/public/server-status');
    document.querySelector('#server-status-value').textContent = status.status === 'online' ? 'Online' : 'Gangguan';
    document.querySelector('#server-uptime-value').textContent = formatServerUptime(status.uptimeSeconds);
    document.querySelector('#server-process-memory-value').textContent = formatServerBytes(status.processMemoryBytes);
    document.querySelector('#server-system-memory-value').textContent = `${formatServerBytes(status.systemTotalMemoryBytes)} · ${status.systemUsedPercent}% terpakai`;
    document.querySelector('#server-node-value').textContent = status.nodeVersion || '—';
    document.querySelector('#server-cpu-value').textContent = `${status.cpuCount || '—'} core · ${status.loadAverage1m ?? '—'}`;
    document.querySelector('#server-status-detail').textContent = `Platform ${status.platform || 'server'} · RAM proses diukur dari runtime Node.js.`;
    document.querySelector('#server-status-updated').textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(status.updatedAt))} WIB`;
  } catch {
    document.querySelector('#server-status-value').textContent = 'Tidak tersedia';
    document.querySelector('#server-status-detail').textContent = 'Status server belum dapat diambil. Coba buka halaman ini lagi.';
    document.querySelector('#server-status-updated').textContent = 'Gagal memperbarui';
  }
}

async function refreshWorkspaceServerStatus() {
  try {
    const status = await api('/api/public/server-status');
    document.querySelector('#workspace-server-status-value').textContent = status.status === 'online' ? 'Online' : 'Gangguan';
    document.querySelector('#workspace-server-uptime-value').textContent = formatServerUptime(status.uptimeSeconds);
    document.querySelector('#workspace-server-process-memory-value').textContent = formatServerBytes(status.processMemoryBytes);
    document.querySelector('#workspace-server-system-memory-value').textContent = `${formatServerBytes(status.systemTotalMemoryBytes)} · ${status.systemUsedPercent}% terpakai`;
    document.querySelector('#workspace-server-node-value').textContent = status.nodeVersion || '—';
    document.querySelector('#workspace-server-cpu-value').textContent = `${status.cpuCount || '—'} core · ${status.loadAverage1m ?? '—'}`;
    document.querySelector('#workspace-server-cpu-model-value').textContent = status.cpuModel || '—';
    document.querySelector('#workspace-server-cpu-cores-value').textContent = status.cpuCount ? `${status.cpuCount} core` : '—';
    document.querySelector('#workspace-server-cpu-load-value').textContent = [status.loadAverage1m, status.loadAverage5m, status.loadAverage15m].map((value) => (typeof value === 'number' ? value.toFixed(2) : '—')).join(' / ');
    document.querySelector('#workspace-server-ram-free-value').textContent = formatServerBytes(status.systemFreeMemoryBytes);
    document.querySelector('#workspace-server-ram-used-value').textContent = formatServerBytes((status.systemTotalMemoryBytes || 0) - (status.systemFreeMemoryBytes || 0));
    document.querySelector('#workspace-server-heap-value').textContent = `${formatServerBytes(status.processHeapUsedBytes)} / ${formatServerBytes(status.processHeapTotalBytes)}`;
    document.querySelector('#workspace-server-disk-total-value').textContent = formatServerSize(status.diskTotalBytes);
    document.querySelector('#workspace-server-disk-used-value').textContent = status.diskTotalBytes ? `${formatServerSize(status.diskTotalBytes - status.diskFreeBytes)} · ${status.diskUsedPercent}%` : '—';
    document.querySelector('#workspace-server-disk-free-value').textContent = formatServerSize(status.diskFreeBytes);
    document.querySelector('#workspace-server-started-value').textContent = formatServerDateTime(status.serverStartedAt);
    document.querySelector('#workspace-server-system-uptime-value').textContent = formatServerUptime(status.systemUptimeSeconds);
    document.querySelector('#workspace-server-clock-value').textContent = formatServerDateTime(status.updatedAt);
    document.querySelector('#workspace-server-status-detail').textContent = `Platform ${status.platform || 'server'} · RAM proses diukur dari runtime Node.js.`;
    document.querySelector('#workspace-server-status-updated').textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(status.updatedAt))} WIB`;
  } catch {
    document.querySelector('#workspace-server-status-value').textContent = 'Tidak tersedia';
    document.querySelector('#workspace-server-status-detail').textContent = 'Status server belum dapat diambil. Coba buka halaman ini lagi.';
    document.querySelector('#workspace-server-status-updated').textContent = 'Gagal memperbarui';
  }
}

function setMobileInfoView(view = 'menu') {
  const selected = ['menu', 'overview', 'developer', 'server', 'bots', 'infoupdate'].includes(view) ? view : 'menu';
  const isMenu = selected === 'menu';
  mobileInfoPage?.setAttribute('data-mobile-info-view', selected);
  if (mobileInfoMenu) mobileInfoMenu.hidden = !isMenu;
  if (mobileInfoTabs) mobileInfoTabs.hidden = isMenu;
  document.querySelectorAll('[data-mobile-info-tab]').forEach((tab) => {
    const active = tab.dataset.mobileInfoTab === selected;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-mobile-info-panel]').forEach((panel) => {
    panel.hidden = isMenu || panel.dataset.mobileInfoPanel !== selected;
  });
  if (selected === 'server') void refreshMobileServerStatus();
  if (selected === 'infoupdate') void loadMobileInfoUpdates();
}

function setMobileInfo(open) {
  const isDesktop = window.innerWidth > 820;
  if (isDesktop) {
    authView.classList.toggle('hide-art', open === true);
    authView.classList.remove('show-mobile-info');
  } else {
    authView.classList.toggle('show-mobile-info', open === true);
    authView.classList.remove('hide-art');
  }
  mobileInfoToggle?.setAttribute('aria-expanded', String(open === true));
  if (mobileInfoToggle) {
    mobileInfoToggle.textContent = open === true ? '×' : '☰';
    mobileInfoToggle.setAttribute('aria-label', open === true ? 'Tutup informasi ReadSW' : 'Buka informasi ReadSW');
  }
  if (open === true) {
    setMobileInfoView('menu');
    if (!mobileServerStatusTimer) mobileServerStatusTimer = setInterval(() => { void refreshMobileServerStatus(); }, 5000);
  } else {
    clearInterval(mobileServerStatusTimer);
    mobileServerStatusTimer = null;
  }
}

mobileInfoToggle?.addEventListener('click', () => {
  const isDesktop = window.innerWidth > 820;
  const isOpen = isDesktop ? authView.classList.contains('hide-art') : authView.classList.contains('show-mobile-info');
  setMobileInfo(!isOpen);
});

document.querySelectorAll('[data-mobile-info-tab]').forEach((tab) => {
  tab.addEventListener('click', () => setMobileInfoView(tab.dataset.mobileInfoTab));
});

document.querySelectorAll('[data-mobile-info-menu]').forEach((button) => {
  button.addEventListener('click', () => setMobileInfoView(button.dataset.mobileInfoMenu));
});
document.querySelector('[data-mobile-info-menu-back]')?.addEventListener('click', () => setMobileInfoView('menu'));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthMessage('');
  const button = loginForm.querySelector('button[type="submit"]');
  setAuthSubmitLoading(button, 'login', true);
  try {
    const data = Object.fromEntries(new FormData(loginForm));
    const result = await waitForAuthAnimation(api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }));
    await showDashboard(result.user);
  } catch (error) {
    if (error.payload?.banned === true) showAccountNotice('banned', error.payload.banReason);
    else if (error.payload?.deleted === true) showAccountNotice('deleted', error.payload.reason);
    else setAuthMessage(error.message);
  } finally {
    setAuthSubmitLoading(button, 'login', false);
  }
});

// Pilihan peran di formulir daftar: Member (default) atau Admin (butuh kode
// akses setelah verifikasi). Nilai peran ikut terkirim lewat input hidden.
const registerRoleInput = document.querySelector('#register-role');
document.querySelectorAll('[data-register-role]').forEach((option) => {
  option.addEventListener('click', () => {
    const role = option.dataset.registerRole === 'admin' ? 'admin' : 'user';
    if (registerRoleInput) registerRoleInput.value = role;
    document.querySelectorAll('[data-register-role]').forEach((item) => {
      const selected = item === option;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
  });
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthMessage('');
  const data = Object.fromEntries(new FormData(registerForm));
  if (data.password !== data.confirmPassword) {
    registerConfirmPasswordInput.setCustomValidity('Kata sandi belum cocok.');
    registerConfirmPasswordInput.focus();
    registerConfirmPasswordInput.reportValidity();
    setAuthMessage('Pastikan konfirmasi kata sandi sama persis.');
    return;
  }
  delete data.confirmPassword;
  const button = registerForm.querySelector('button[type="submit"]');
  setAuthSubmitLoading(button, 'register', true);
  try {
    const result = await waitForAuthAnimation(api('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }));
    verificationIdentifier = result.verification.identifier;
    showVerificationForm(result.verification);
    if (result.verification.cooldownUntil) startVerificationCooldown(result.verification.cooldownUntil);
  } catch (error) {
    setAuthMessage(error.message);
  } finally {
    setAuthSubmitLoading(button, 'register', false);
  }
});

verificationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthMessage('');
  const button = verificationForm.querySelector('button[type="submit"]');
  let nextCooldownUntil = 0;
  let refreshedPrompt = false;
  setAuthSubmitLoading(button, 'verification', true);
  try {
    const data = Object.fromEntries(new FormData(verificationForm));
    const result = await waitForAuthAnimation(api('/api/auth/verify-registration', {
      method: 'POST',
      body: JSON.stringify({ identifier: verificationIdentifier, code: data.code }),
    }));
    if (result.needsAccessCode === true) {
      showAdminAccessForm(result.identifier || verificationIdentifier);
      return;
    }
    await showDashboard(result.user);
    showToast('Akun berhasil diverifikasi.');
  } catch (error) {
    refreshedPrompt = setVerificationPrompt(error.payload?.verification);
    nextCooldownUntil = Number(error.payload?.cooldownUntil || 0);
    setAuthMessage(error.message);
  } finally {
    setAuthSubmitLoading(button, 'verification', false);
    if (nextCooldownUntil > Date.now()) startVerificationCooldown(nextCooldownUntil);
    else if (refreshedPrompt) document.querySelector('#verification-code').focus();
  }
});

adminAccessForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthMessage('');
  const button = adminAccessForm.querySelector('button[type="submit"]');
  setAuthSubmitLoading(button, 'admin-access', true);
  try {
    const data = Object.fromEntries(new FormData(adminAccessForm));
    const result = await waitForAuthAnimation(api('/api/auth/admin-access', {
      method: 'POST',
      body: JSON.stringify({ identifier: verificationIdentifier, accessCode: data.accessCode }),
    }));
    await showDashboard(result.user);
    showToast('Akun admin berhasil dibuat.');
  } catch (error) {
    setAuthMessage(error.message);
    document.querySelector('#admin-access-code')?.focus();
  } finally {
    setAuthSubmitLoading(button, 'admin-access', false);
  }
});

const pairingForm = document.querySelector('#pairing-form');
const pairingPhoneInput = pairingForm.querySelector('#pairing-phone');
const pairingPhoneField = document.querySelector('#pairing-phone-field');
const pairingMethodHint = document.querySelector('#pairing-method-hint');
const pairingMethodPicker = document.querySelector('.pairing-method-picker');
let pairingMethod = null;
let pairingMethodPickerUnlocked = false;
const regionDisplayNames = new Intl.DisplayNames(['id'], { type: 'region' });

function setPairingMethod(method) {
  pairingMethod = method === 'qr' ? 'qr' : 'pairing';
  document.querySelectorAll('[data-pairing-method]').forEach((option) => {
    const selected = option.dataset.pairingMethod === pairingMethod;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-pressed', String(selected));
	  });
	  const isQr = pairingMethod === 'qr';
	  // Nomor sudah dimasukkan sebelum Gasss pertama. Setelah metode dipilih,
	  // sembunyikan field agar tidak muncul ulang/bertabrakan di mobile; nilainya
	  // tetap tersimpan di input untuk request Pairing Code.
	  pairingPhoneField?.classList.add('hidden');
	  pairingPhoneInput.required = false;
  pairingMethodPicker?.classList.toggle('hidden', !pairingMethodPickerUnlocked);
  pairingMethodHint?.classList.toggle('hidden', !pairingMethodPickerUnlocked);
  if (pairingMethodHint) pairingMethodHint.textContent = isQr
    ? 'QR Code dipilih. Tekan Gasss Slurrr :V di bawah untuk meminta QR.'
    : 'Pairing Code dipilih. Tekan Gasss Slurrr :V di bawah untuk meminta kode.';
  const submit = document.querySelector('#pairing-submit');
  if (submit) {
    submit.innerHTML = 'Gasss Slurrr :V <span>→</span>';
    submit.disabled = false;
  }
}

document.querySelectorAll('[data-pairing-method]').forEach((option) => {
  option.addEventListener('click', () => {
    if (!pairingMethodPickerUnlocked) return;
    setPairingMethod(option.dataset.pairingMethod);
  });
});
document.querySelector('#pairing-qr-change-method')?.addEventListener('click', () => {
  document.querySelector('#pairing-qr-card')?.classList.add('hidden');
	  pairingMethod = null;
	  pairingMethodPickerUnlocked = true;
	  pairingPhoneField?.classList.add('hidden');
	  pairingPhoneInput.required = false;
  document.querySelectorAll('[data-pairing-method]').forEach((option) => {
    option.classList.remove('is-selected');
    option.setAttribute('aria-pressed', 'false');
  });
  pairingMethodPicker?.classList.remove('hidden');
  pairingMethodHint?.classList.remove('hidden');
  const submit = document.querySelector('#pairing-submit');
  if (submit) { submit.disabled = true; submit.innerHTML = 'Pilih QR atau Pairing Code <span>↑</span>'; }
  setPairingNotice('Pilih QR Code atau Pairing Code di atas, lalu tekan Gasss Slurrr :V.');
});

let libphonenumberLoadPromise = null;
function ensureLibphonenumber() {
  if (window.libphonenumber) return Promise.resolve();
  if (!libphonenumberLoadPromise) {
    libphonenumberLoadPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = '/vendor/libphonenumber-max.js?v=libphone-20261117';
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.append(script);
    });
  }
  return libphonenumberLoadPromise;
}

function parseInternationalNumber(digits) {
  const parser = window.libphonenumber?.parsePhoneNumberFromString;
  if (!parser || !digits) return null;
  try { return parser(`+${digits}`); } catch { return null; }
}

function flagForRegion(region) {
  if (!/^[A-Z]{2}$/.test(String(region || ''))) return '🌐';
  return String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)));
}

function updatePhoneNumberPreview(value) {
  const feedback = document.querySelector('#pairing-number-feedback');
  const flag = document.querySelector('#pairing-number-flag');
  const countryLabel = document.querySelector('#pairing-number-country');
  const formatLabel = document.querySelector('#pairing-number-format');
	  const validity = document.querySelector('#pairing-number-validity');
	  const showMethodPicker = (show) => {
	    // Metode baru ditampilkan setelah tombol Gasss pertama agar alurnya jelas:
	    // nomor -> Gasss -> pilih QR/Pairing -> Gasss lagi.
	    const visible = Boolean(show && pairingMethodPickerUnlocked);
	    pairingMethodPicker?.classList.toggle('hidden', !visible);
	    pairingMethodHint?.classList.toggle('hidden', !visible);
	  };
  const digits = String(value || '').replace(/\D/g, '').slice(0, 15);
  feedback.classList.remove('is-valid', 'is-invalid');

  if (!digits) {
    showMethodPicker(pairingMethodPickerUnlocked);
    flag.textContent = '🌐';
    countryLabel.textContent = 'Negara belum terdeteksi';
    formatLabel.textContent = 'Negara dan format internasional akan muncul saat nomor diketik.';
    validity.textContent = 'Belum diperiksa';
    return null;
  }

  const phone = parseInternationalNumber(digits);
  if (!phone) {
    showMethodPicker(pairingMethodPickerUnlocked);
    flag.textContent = '🌐';
    countryLabel.textContent = 'Kode negara belum dikenali';
    formatLabel.textContent = `Nomor saat ini: +${digits} · cek kode negara dan digitnya.`;
    validity.textContent = 'Periksa nomor';
    feedback.classList.add('is-invalid');
    return null;
  }

  const country = phone.country;
  flag.textContent = flagForRegion(country);
  const countryName = country ? regionDisplayNames.of(country) : `Wilayah kode +${phone.countryCallingCode}`;
  countryLabel.textContent = `${countryName} · +${phone.countryCallingCode}`;
  const formatted = phone.formatInternational();
  const valid = phone.isValid();
  const possible = phone.isPossible();
  // Pemilih metode tampil begitu langkahnya dibuka, apa pun validitas nomornya:
  // QR tidak butuh nomor, dan Pairing Code memvalidasi nomor di Gasss kedua.
  // Memakai `valid` di sini dulu menyembunyikan pemilih untuk nomor yang terurai
  // tapi tidak valid — kolom nomor ikut tersembunyi dan tombol terkunci, jadi
  // pengguna mentok tanpa jalan keluar.
  showMethodPicker(pairingMethodPickerUnlocked);
  if (valid) {
    formatLabel.textContent = `Format internasional: ${formatted}`;
    validity.textContent = 'Format valid · cek WA saat lanjut';
    feedback.classList.add('is-valid');
  } else if (possible) {
    formatLabel.textContent = `${formatted} · prefix/nomor tidak sesuai metadata wilayah ini.`;
    validity.textContent = 'Nomor tidak valid';
    feedback.classList.add('is-invalid');
  } else {
    formatLabel.textContent = `${formatted} · belum lengkap atau panjangnya tidak sesuai.`;
    validity.textContent = 'Belum lengkap';
  }
  return phone;
}

pairingPhoneInput.addEventListener('input', (event) => {
  pairingMethodPickerUnlocked = false;
  pairingMethod = null;
  const firstButton = document.querySelector('#pairing-submit');
  if (firstButton) { firstButton.disabled = false; firstButton.innerHTML = 'Gasss Slurrr :V <span>→</span>'; }
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 15);
  event.target.setCustomValidity('');
  updatePhoneNumberPreview(event.target.value);
});
updatePhoneNumberPreview(pairingPhoneInput.value);
function updatePairingConsentGuidance() {
  const ownershipConsent = document.querySelector('#pairing-confirm');
  const autoConsent = document.querySelector('#pairing-auto-confirm');
  const ownershipLabel = ownershipConsent.closest('.pairing-consent');
  const autoLabel = autoConsent.closest('.pairing-consent');
  const checkedCount = Number(ownershipConsent.checked) + Number(autoConsent.checked);
  [ownershipLabel, autoLabel].forEach((label) => {
    label.classList.toggle('is-required-ok', label.querySelector('input').checked);
    label.classList.toggle('is-required-error', !label.querySelector('input').checked && checkedCount > 0);
    label.classList.remove('consent-nudge');
  });
  const missing = [];
  if (!ownershipConsent.checked) missing.push('Konfirmasi kepemilikan');
  if (!autoConsent.checked) missing.push('Setuju dengan mode otomatis');
  if (!missing.length) {
    setPairingNotice('✓ 2/2 persetujuan sudah dicentang. Sekarang tekan Gasss Slurrr :V.', true);
    return;
  }
  if (!checkedCount) {
    setPairingNotice('0/2 persetujuan dicentang. Centang dua kotak wajib sebelum menekan Gasss.');
  } else {
    setPairingNotice(`✓ ${checkedCount}/2 sudah dicentang. Masih wajib: ${missing.join(' dan ')}.` , false, true);
  }
  missing.forEach((name) => {
    const label = name === 'Konfirmasi kepemilikan' ? ownershipLabel : autoLabel;
    label.classList.remove('consent-nudge');
    void label.offsetWidth;
    label.classList.add('consent-nudge');
    window.setTimeout(() => label.classList.remove('consent-nudge'), 800);
  });
}
document.querySelectorAll('#pairing-confirm, #pairing-auto-confirm').forEach((input) => {
  input.addEventListener('change', () => {
    input.setCustomValidity('');
    updatePairingConsentGuidance();
  });
});
pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#pairing-submit');
  const enteredNumber = pairingPhoneInput.value.trim();
  const ownershipConsent = document.querySelector('#pairing-confirm');
  const autoConsent = document.querySelector('#pairing-auto-confirm');
  const consentLabels = document.querySelectorAll('.pairing-consent');
  consentLabels.forEach((label) => label.classList.remove('is-required-error'));
  if (!ownershipConsent.checked || !autoConsent.checked) {
    if (!ownershipConsent.checked) ownershipConsent.closest('.pairing-consent')?.classList.add('is-required-error');
    if (!autoConsent.checked) autoConsent.closest('.pairing-consent')?.classList.add('is-required-error');
    // Pesan kesalahan tampil sebagai gelembung bawaan browser yang menempel di
    // kotak persetujuan yang belum dicentang — sama seperti gelembung validasi
    // email di halaman daftar — bukan lagi kotak notif generik di bawah tombol.
    const firstMissing = ownershipConsent.checked ? autoConsent : ownershipConsent;
    firstMissing.setCustomValidity(firstMissing === ownershipConsent
      ? 'Centang Konfirmasi kepemilikan dulu — wajib sebelum pairing.'
      : 'Centang Setuju dengan mode otomatis dulu — wajib sebelum pairing.');
    firstMissing.reportValidity();
    return;
  }
	  if (!pairingMethodPickerUnlocked) {
	    pairingMethodPickerUnlocked = true;
	    pairingMethod = null;
	    // Nomor sudah diterima dan disimpan di state form. Sembunyikan field saat
	    // masuk ke layar pilihan metode agar mobile tidak menampilkan nomor ulang.
	    pairingPhoneField?.classList.add('hidden');
	    pairingPhoneInput.required = false;
	    document.querySelectorAll('[data-pairing-method]').forEach((option) => {
      option.classList.remove('is-selected');
      option.setAttribute('aria-pressed', 'false');
    });
    updatePhoneNumberPreview(enteredNumber);
    button.disabled = true;
    button.innerHTML = 'Pilih QR atau Pairing Code <span>↑</span>';
    if (pairingMethodHint) pairingMethodHint.textContent = 'QR tidak memerlukan nomor. Pairing Code memerlukan nomor internasional. Pilih metode di atas.';
    setPairingNotice('Pilih QR Code atau Pairing Code di atas, lalu tekan Gasss Slurrr :V.', true);
    pairingMethodPicker?.querySelector('[data-pairing-method="qr"]')?.focus();
    return;
  }
  if (!pairingMethod) {
    setPairingNotice('Pilih QR Code atau Pairing Code di atas terlebih dahulu.');
    return;
  }
  let phoneNumber = null;
  if (pairingMethod === 'pairing') {
    if (!/^[1-9]\d{6,14}$/.test(enteredNumber)) {
      pairingPhoneField?.classList.remove('hidden');
      pairingPhoneInput.setCustomValidity('Masukkan 7–15 digit dengan kode negara, tanpa tanda + atau pemisah.');
      pairingPhoneInput.reportValidity();
      return;
    }
    const parsedPhone = updatePhoneNumberPreview(enteredNumber);
    if (!parsedPhone?.isValid()) {
      pairingPhoneField?.classList.remove('hidden');
      pairingPhoneInput.setCustomValidity('Nomor belum valid menurut format penomoran internasional. Periksa kode negara dan digitnya.');
      pairingPhoneInput.reportValidity();
      return;
    }
    phoneNumber = enteredNumber;
  }
  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `<span class="pairing-submit-spinner" aria-hidden="true"></span><span>${pairingMethod === 'qr' ? 'Menyiapkan QR Code…' : 'Menyiapkan pairing code…'}</span>`;
  setPairingNotice(`Mengirim permintaan ${pairingMethod === 'qr' ? 'QR Code' : 'pairing code'} ke WhatsApp… Hanya tampil di sesi akun ini.`, false, true);
  const minimumLoadingTime = new Promise((resolve) => window.setTimeout(resolve, 3000));
  const progressPollTimer = window.setInterval(() => { void refreshPairing(); }, 1200);
  try {
    const result = await api('/api/pairing/start', {
      method: 'POST',
      body: JSON.stringify({ method: pairingMethod, phoneNumber, confirmOwnership: true, confirmAutoReaction: true }),
    });
    window.clearInterval(progressPollTimer);
    const pairingLogsRequest = loadPairingLogs();
    await minimumLoadingTime;
    renderPairingState(result.pairing);
    await pairingLogsRequest;
    showToast(`${pairingMethod === 'qr' ? 'QR Code' : 'Pairing code'} tersedia di panel akunmu.`);
  } catch (error) {
    window.clearInterval(progressPollTimer);
    await minimumLoadingTime;
    document.querySelector('#pairing-retry')?.classList.remove('hidden');
    const cooldownMatch = String(error.message || '').match(/Tunggu\s+(\d+)\s+detik/i);
    if (cooldownMatch) startPairingCooldown(Number(cooldownMatch[1]));
    else setPairingNotice(error.message);
    await loadPairingLogs();
  } finally {
    button.disabled = false;
    if (pairingCooldownUntil > Date.now()) button.disabled = true;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.innerHTML = pairingMethodPickerUnlocked && !pairingMethod ? 'Pilih QR atau Pairing Code <span>↑</span>' : 'Gasss Slurrr :V <span>→</span>';
  }
});

document.querySelector('#pairing-retry').addEventListener('click', () => {
  if (pairingMethod) pairingForm.requestSubmit();
  else setPairingNotice('Pilih QR Code atau Pairing Code di atas.');
});

document.querySelector('#pairing-change-number').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  const approved = await showConfirm({ title: 'Batalkan pairing code?', message: 'Kode lama tidak akan bisa digunakan dan kamu dapat mengganti nomor.', confirmLabel: 'Batalkan' });
  if (!approved) return;
  clearInterval(pairingPollTimer);
  button.disabled = true;
  button.textContent = 'Membatalkan…';
  try {
    const result = await api('/api/pairing/cancel', { method: 'POST', body: '{}' });
    renderPairingState(result.pairing);
    const cooldown = Number(result.cooldownSeconds || 0);
    setPairingNotice(
      cooldown > 0
        ? `Kode lama dibatalkan. Kamu bisa mengganti nomor sekarang; permintaan kode baru tersedia dalam ${cooldown} detik.`
        : 'Kode lama dibatalkan. Masukkan nomor baru untuk meminta pairing code.',
      false,
      true,
    );
    pairingPhoneInput.focus();
  } catch (error) {
    await refreshPairing();
    setPairingNotice(error.message, false, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Ganti nomor';
  }
});

async function callSessionAction(url, method, successMessage) {
  const buttons = [...document.querySelectorAll('#session-actions button')];
  buttons.forEach((button) => { button.disabled = true; });
  setControlFeedback('session-feedback', 'info', 'Sedang memproses', successMessage);
  try {
    const result = await api(url, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
    renderPairingState(result.pairing);
    if (method === 'DELETE') {
      setControlFeedback('session-feedback', 'success', 'Sesi dihapus', 'Sesi lokal dihapus dari server. Untuk menautkan kembali, minta pairing code baru.');
    } else if (url.endsWith('/stop')) {
      setControlFeedback('session-feedback', 'success', 'Koneksi dihentikan', 'Kredensial tetap tersimpan. Sambungkan ulang kapan saja dari tombol di atas.');
    } else {
      setControlFeedback('session-feedback', 'success', 'Sambung ulang dimulai', 'Status koneksi akan diperbarui otomatis saat WhatsApp kembali online.');
    }
    showToast(successMessage);
  } catch (error) {
    setControlFeedback('session-feedback', 'error', 'Aksi tidak berhasil', error.message);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.querySelector('#session-resume').addEventListener('click', () => {
  void callSessionAction('/api/pairing/resume', 'POST', 'Permintaan sambung ulang dikirim.');
});
document.querySelector('#pairing-recover').addEventListener('click', async () => {
  const button = document.querySelector('#pairing-recover');
  button.disabled = true;
  button.textContent = 'Memulihkan…';
  try {
    await callSessionAction('/api/pairing/resume', 'POST', 'Permintaan pemulihan sesi dikirim.');
  } finally {
    button.disabled = false;
    button.textContent = 'Coba pulihkan sesi';
  }
});
document.querySelector('#pairing-recover-dismiss').addEventListener('click', () => {
  document.querySelector('#pairing-recovery-card')?.classList.add('hidden');
  document.querySelector('#pairing-controls')?.classList.remove('hidden');
  setPairingNotice('Pairing ulang dengan nomor baru. Sesi lama akan dibersihkan saat pairing baru dimulai.', false, true);
  pairingPhoneInput.focus();
});
document.querySelector('#session-stop').addEventListener('click', () => {
  void callSessionAction('/api/pairing/stop', 'POST', 'Koneksi dihentikan; sesi lokal dipertahankan.');
});
document.querySelector('#session-delete').addEventListener('click', async () => {
  const approved = await showConfirm({ title: 'Hapus sesi WhatsApp?', message: 'Jika masih tersambung, aplikasi akan mencoba logout. Untuk menautkan lagi, kamu perlu meminta pairing code baru.', confirmLabel: 'Hapus sesi', danger: true });
  if (approved) void callSessionAction('/api/pairing/session', 'DELETE', 'Sesi WhatsApp dihapus.');
});

async function callBotAction(action) {
  const buttons = [...document.querySelectorAll('#bot-start, #bot-restart, #bot-stop')];
  buttons.forEach((button) => { button.disabled = true; });
  setControlFeedback('bot-feedback', 'info', 'Sedang memproses', action === 'stop' ? 'Menghentikan listener bot…' : 'Mengatur listener bot…');
  let pairing = null;
  try {
    const result = await api(`/api/bot/${action}`, { method: 'POST', body: '{}' });
    pairing = result.pairing;
    workerAutoStart = result.autoStart === true;
    renderPairingState(pairing);
    await loadPairingLogs();
    const messages = {
      start: ['Bot aktif', 'Story akan ditandai dilihat sesuai mode. ReadSW mengirim emoji pilihan jika reaksi otomatis aktif.'],
      restart: ['Bot dimulai ulang', 'Listener terpasang kembali; mode, delay, dan emoji tersimpan tetap digunakan.'],
      stop: ['Bot dimatikan', 'Listener berhenti; koneksi WhatsApp tetap online.'],
    };
    setControlFeedback('bot-feedback', 'success', messages[action][0], messages[action][1]);
    showToast(action === 'start' ? 'Bot worker dimulai.' : action === 'restart' ? 'Bot worker dimulai ulang.' : 'Bot worker dihentikan.');
  } catch (error) {
    setControlFeedback('bot-feedback', 'error', 'Aksi tidak berhasil', error.message);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    if (pairing) renderBotWorkerUi(pairing.workerStatus, pairing.status);
  }
}

document.querySelector('#bot-start').addEventListener('click', () => { void callBotAction('start'); });
document.querySelector('#bot-restart').addEventListener('click', () => { void callBotAction('restart'); });
document.querySelector('#bot-stop').addEventListener('click', async () => {
  const approved = await showConfirm({ title: 'Matikan bot dan nonaktifkan auto-start?', message: 'Bot tidak akan hidup lagi otomatis sampai kamu menekan Start bot.', confirmLabel: 'Matikan bot' });
  if (approved) void callBotAction('stop');
});

document.querySelector('#story-emoji-grid').addEventListener('click', (event) => {
  const remove = event.target.closest('.emoji-remove');
  if (remove) {
    const emoji = remove.dataset.removeEmoji;
    const settings = readStorySettings();
    settings.emojiOptions = settings.emojiOptions.filter((item) => item !== emoji);
    settings.emojiPool = settings.emojiPool.filter((item) => item !== emoji);
    if (!settings.emojiPool.length) document.querySelector('#story-reaction-enabled').checked = false;
    renderEmojiPool(settings.emojiOptions, settings.emojiPool);
    syncStoryEmojiNotice();
    scheduleStorySettingsSave();
    return;
  }
  const button = event.target.closest('.emoji-choice');
  if (!button) return;
  const selected = button.classList.toggle('selected');
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-label', `${button.dataset.emoji} ${selected ? 'aktif' : 'nonaktif'}`);
  if (!selected && !document.querySelector('.emoji-choice.selected')) {
    document.querySelector('#story-reaction-enabled').checked = false;
  }
  syncStoryEmojiNotice();
  scheduleStorySettingsSave();
});

async function addStoryEmoji() {
  const input = document.querySelector('#story-emoji-input');
  const { emojis, invalid } = parseEmojiBatch(input.value);
  if (!emojis.length) {
    setControlFeedback('story-settings-feedback', 'error', 'Emoji tidak ditemukan', 'Tempel emoji dipisahkan baris atau koma; teks biasa tidak ditambahkan.');
    input.focus();
    return;
  }
  const settings = readStorySettings();
  const newEmojis = emojis.filter((emoji) => !settings.emojiOptions.includes(emoji));
  const duplicates = emojis.length - newEmojis.length;
  if (!newEmojis.length) {
    setControlFeedback('story-settings-feedback', 'info', 'Emoji sudah ada', 'Semua emoji tersebut sudah tersimpan di daftar akunmu.');
    input.select();
    return;
  }
  if (settings.emojiOptions.length + newEmojis.length > 30) {
    setControlFeedback('story-settings-feedback', 'error', 'Batas emoji tercapai', 'Satu akun dapat menyimpan maksimal 30 emoji.');
    return;
  }
  settings.emojiOptions.push(...newEmojis);
  settings.emojiPool.push(...newEmojis);
  renderEmojiPool(settings.emojiOptions, settings.emojiPool);
  syncStoryEmojiNotice();
  input.value = '';
  scheduleStorySettingsSave();
  const skipped = duplicates + invalid.length;
  if (skipped) showToast(`${newEmojis.length} emoji ditambahkan; duplikat/teks non-emoji dilewati.`);
}

document.querySelector('#story-emoji-add').addEventListener('click', () => { void addStoryEmoji(); });
document.querySelector('#story-emoji-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void addStoryEmoji(); }
});
document.querySelector('#story-delay-min').addEventListener('change', scheduleStorySettingsSave);
document.querySelector('#story-delay-max').addEventListener('change', scheduleStorySettingsSave);
document.querySelector('#story-reaction-enabled').addEventListener('change', () => {
  if (document.querySelector('#story-reaction-enabled').checked && selectedMode !== 'readonly_readsw') {
    setControlFeedback('story-settings-feedback', 'info', 'Mengaktifkan mode ReadSW', 'Reaksi hanya tersedia di Read Only + ReadSW; mode akan dipilih dan disimpan otomatis.');
    document.querySelector('.select-plan[data-plan="readonly_readsw"]')?.click();
    return;
  }
  syncStoryEmojiNotice();
  scheduleStorySettingsSave();
});
document.querySelector('#save-story-settings').addEventListener('click', () => { void saveStoryPreferences(); });

document.querySelector('#copy-pairing-code').addEventListener('click', async () => {
  const code = document.querySelector('#pairing-code').textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast('Kode disalin. Jangan bagikan kepada siapa pun.');
  } catch {
    showToast('Pilih kode di panel lalu salin secara manual.');
  }
});

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'show-register') return setAuthMode('register');
  if (action === 'show-login') return setAuthMode('login');
  if (action === 'logout') {
    const logoutButton = event.target.closest('[data-action="logout"]');
    if (logoutButton?.disabled) return;
    setLogoutLoading(logoutButton, true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      // Jangan menahan tampilan selama animasi 3 detik; mobile sering dianggap
      // macet karena tombol tetap menampilkan "Keluar…" selama menunggu itu.
      await api('/api/auth/logout', { method: 'POST', body: '{}', signal: controller.signal });
    } catch { /* cookie is cleared when possible */ }
    finally {
      clearTimeout(timeout);
      setLogoutLoading(logoutButton, false);
      setMenu(false);
      showAuth();
    }
    return;
  }
  if (action === 'profile') {
    setWorkspacePage('profile');
    return;
  }
  // Header kartu mode adalah tombol accordion: membuka satu kartu menutup kartu
  // lain yang sedang terbuka, dan mengetuk kartu yang terbuka akan menutupnya.
  const planToggle = event.target.closest('.plan-card-toggle');
  if (planToggle) {
    planAccordionUserTouched = true;
    const card = planToggle.closest('.plan-card');
    const wasOpen = card && !card.classList.contains('is-collapsed');
    document.querySelectorAll('.plan-card').forEach((other) => setPlanCardOpen(other, false));
    if (card && !wasOpen) {
      setPlanCardOpen(card, true);
      // Di HP, kartu yang dibuka ikut digeser ke posisi terlihat di carousel.
      scrollToPlanCard(card, 'smooth');
    }
    return;
  }
  const mode = event.target.closest('[data-plan]')?.dataset.plan;
  if (mode) {
    if (!currentUser) return showAuth();
    if (isBotLockedForMember()) { showBotLinkNotice(); return; }
    clearTimeout(storySaveTimer);
    storySaveRevision += 1;
    const userId = currentUser.id;
    const previousMode = selectedMode;
    const previousStorySettings = readStorySettings();
    const storySettings = { ...previousStorySettings, autoReaction: mode === 'readonly_readsw' };
    applyStorySettings(storySettings, mode);
    const buttons = [...document.querySelectorAll('.select-plan')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const result = await api('/api/bot', {
        method: 'PUT',
        body: JSON.stringify({ mode, online24: document.querySelector('[data-online-addon]')?.classList.contains('selected') === true, label: `${currentUser.displayName || currentUser.username} bot`, storySettings }),
      });
      if (currentUser?.id !== userId) return;
      applyBot(result.bot);
      if (result.pairing) renderPairingState(result.pairing);
      let workerStarted = false;
      if (mode !== 'online24' && result.pairing?.status === 'linked') {
        try {
          const started = await api('/api/bot/start', { method: 'POST', body: '{}' });
          workerStarted = started.pairing?.workerStatus === 'running';
          renderPairingState(started.pairing);
        } catch (startError) {
          setControlFeedback('bot-feedback', 'info', 'Mode aktif', `Mode ${modeNames[mode]} sudah aktif, tetapi worker belum menyala: ${startError.message}`);
        }
      }
      showToast(workerStarted ? `${modeNames[mode]} aktif; bot langsung berjalan.` : mode === 'online24' ? 'Online 24 Jam aktif; runner 24/7 membutuhkan host persisten.' : `${modeNames[mode]} aktif.`);
    } catch (error) {
      applyStorySettings(previousStorySettings, previousMode);
      if (error.status === 401) showAuth();
      else showToast(error.message);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }
  const onlineToggle = event.target.closest('[data-online24-toggle]');
  if (onlineToggle) {
    if (!currentUser) return showAuth();
    if (isBotLockedForMember()) { showBotLinkNotice(); return; }
    const userId = currentUser.id;
    const enabled = !document.querySelector('[data-online-addon]')?.classList.contains('selected');
    onlineToggle.disabled = true;
    try {
      const result = await api('/api/bot', {
        method: 'PUT',
        body: JSON.stringify({
          mode: selectedMode || 'readonly',
          online24: enabled,
          label: `${currentUser.displayName || currentUser.username} bot`,
          storySettings: readStorySettings(),
        }),
      });
      if (currentUser?.id !== userId) return;
      applyBot(result.bot);
      if (result.pairing) renderPairingState(result.pairing);
      showToast(enabled ? 'Online 24 Jam aktif bersama mode story.' : 'Online 24 Jam dimatikan; mode story tetap aktif.');
    } catch (error) {
      if (error.status === 401) showAuth();
      else showToast(error.message);
    } finally {
      onlineToggle.disabled = false;
    }
  }
});

function setAvatarFeedback(message, kind = '') {
  const feedback = document.querySelector('#avatar-feedback');
  feedback.textContent = message;
  feedback.dataset.kind = kind;
}

document.querySelectorAll('[data-avatar-preset]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!currentUser) return showAuth();
    document.querySelectorAll('[data-avatar-preset]').forEach((item) => { item.disabled = true; });
    setAvatarFeedback('Menyimpan pilihan avatar…');
    try {
      const result = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ avatar: button.dataset.avatarPreset }) });
      currentUser = result.user;
      applyAvatar(currentUser);
      setAvatarFeedback('Avatar tersimpan khusus untuk akun ini.', 'success');
    } catch (error) {
      if (error.status === 401) showAuth();
      else setAvatarFeedback(error.message, 'error');
    } finally {
      document.querySelectorAll('[data-avatar-preset]').forEach((item) => { item.disabled = false; });
    }
  });
});
document.querySelector('#avatar-random')?.addEventListener('click', () => {
  const visible = [...document.querySelectorAll('[data-avatar-preset]')].filter((button) => !button.hidden && !button.disabled);
  if (!visible.length) return;
  visible[Math.floor(Math.random() * visible.length)].click();
});

const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_AVATAR_UPLOAD_BYTES = 100 * 1024;
const AVATAR_INPUT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

async function encodeAvatarCanvas(image) {
  const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
  for (const outputSize of [512, 384, 256]) {
    for (const mime of ['image/webp', 'image/jpeg']) {
      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Browser tidak dapat memproses gambar. Coba browser lain atau avatar bawaan.');
      if (mime === 'image/jpeg') {
        context.fillStyle = '#eaf2ed';
        context.fillRect(0, 0, outputSize, outputSize);
      }
      context.drawImage(image,
        (image.naturalWidth - cropSize) / 2,
        (image.naturalHeight - cropSize) / 2,
        cropSize, cropSize, 0, 0, outputSize, outputSize);
      for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
        if (!blob || blob.type !== mime) continue;
        if (blob.size <= MAX_AVATAR_UPLOAD_BYTES) return blob;
      }
    }
  }
  throw new Error('Gambar masih terlalu besar setelah dikompres. Coba gambar yang lebih sederhana.');
}

document.querySelector('#avatar-upload').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const extension = file.name?.split('.').pop()?.toLowerCase();
  const extensionMime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' })[extension];
  const inputMime = ({ 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png' })[file.type.toLowerCase()] || file.type.toLowerCase();
  const sourceMime = AVATAR_INPUT_MIMES.has(inputMime) ? inputMime : extensionMime || null;
  if (!sourceMime) {
    setAvatarFeedback('Format belum didukung. Pilih gambar PNG, JPG, WebP, GIF, atau AVIF.', 'error');
    input.value = '';
    return;
  }
  if (file.size > MAX_AVATAR_SOURCE_BYTES) {
    setAvatarFeedback('Ukuran file sumber maksimal 8 MB. Gambar akan dipotong dan dikompres otomatis.', 'error');
    input.value = '';
    return;
  }
  let objectUrl;
  try {
    setAvatarFeedback('Memproses dan mengompres gambar…');
    objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectUrl;
    try {
      await image.decode();
    } catch {
      throw new Error('Gambar tidak bisa dibaca di browser ini. Simpan ulang sebagai PNG atau JPG lalu coba lagi.');
    }
    if (image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error('Dimensi gambar maksimal 8192 × 8192 piksel.');
    const encoded = await encodeAvatarCanvas(image);
    const result = await api('/api/me/avatar', { method: 'POST', body: encoded, headers: { 'Content-Type': encoded.type } });
    currentUser = result.user;
    applyAvatar(currentUser);
    setAvatarFeedback('Avatar berhasil diunggah dan disimpan privat di folder akunmu.', 'success');
  } catch (error) {
    if (error.status === 401) showAuth();
    else setAvatarFeedback(error.message || 'Avatar belum bisa diproses. Coba PNG, JPG, WebP, GIF, atau AVIF.', 'error');
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    input.value = '';
  }
});
document.querySelector('#save-profile').addEventListener('click', async () => {
  const button = document.querySelector('#save-profile');
  const displayName = document.querySelector('#profile-name').value.trim();
  button.disabled = true;
  try {
    const result = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName }) });
    await showDashboard(result.user);
    showToast('Profil berhasil disimpan.');
  } catch (error) {
    if (error.status === 401) showAuth();
    else showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('.nav-item[href^="#"]').forEach((item) => {
  item.addEventListener('click', (event) => {
    // Menu Backup yang terkunci (member) tidak bisa dibuka: tampilkan notifikasi di tengah layar.
    if (item.id === 'backup-nav' && item.classList.contains('nav-item-locked')) {
      event.preventDefault();
      showLockedNotice('Backup');
      return;
    }
    // Menu Kontrol Bot yang terkunci (member) tidak bisa dibuka: tampilkan notifikasi di tengah layar.
    if (item.id === 'botcontrol-nav' && item.classList.contains('nav-item-locked')) {
      event.preventDefault();
      showLockedNotice('Kontrol Bot');
      return;
    }
    const target = document.querySelector(item.getAttribute('href'));
    if (!target || target.classList.contains('hidden')) return;
    event.preventDefault();
    setWorkspacePage(target.id);
  });
});

// Info Update: daftar pembaruan dibaca dari info-updates.json agar entri baru langsung tampil tanpa ubah halaman.
let infoUpdateRefreshTimer = null;
function stopInfoUpdateAutoRefresh() {
  if (infoUpdateRefreshTimer) window.clearInterval(infoUpdateRefreshTimer);
  infoUpdateRefreshTimer = null;
}
let workspaceServerRefreshTimer = null;
function stopWorkspaceServerAutoRefresh() {
  if (workspaceServerRefreshTimer) window.clearInterval(workspaceServerRefreshTimer);
  workspaceServerRefreshTimer = null;
}
// Info Update ala MyAnimeList: tiap entri kartu poster + judul + meta + tag, teks deskripsi di kotak scroll manual (bukan auto-scroll).
// Kategori akurat: Fitur baru (hal baru yang belum ada), Perubahan (yang sudah ada berubah perilaku/tampilannya), Perbaikan (bug dibetulkan), Fitur dihapus (yang dicabut), Tampilan (hanya tampilan).
const INFO_UPDATE_TAG_LABELS = { 'fitur-baru': 'Fitur baru', perubahan: 'Perubahan', perbaikan: 'Perbaikan', 'fitur-dihapus': 'Fitur dihapus', tampilan: 'Tampilan' };
const INFO_UPDATE_TAG_ICONS = {
  'fitur-baru': '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.9 5.4 5.6 1.6-5.6 1.9L12 17.5l-1.9-5.6-5.6-1.9 5.6-1.6z"/></svg>',
  perubahan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/></svg>',
  perbaikan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
  'fitur-dihapus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  tampilan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
};
function createInfoUpdateItem(update) {
  const item = document.createElement('li');
  item.className = 'info-update-item';
  const rawTag = (update.tag || 'Pembaruan').trim() || 'Pembaruan';
  const tagSlug = rawTag.toLowerCase().replace(/\s+/g, '-');
  const tag = INFO_UPDATE_TAG_LABELS[tagSlug] || rawTag;
  item.dataset.tag = tagSlug;
  const poster = document.createElement('div');
  poster.className = 'info-update-poster';
  const mark = document.createElement('span');
  mark.className = 'info-update-poster-mark';
  mark.innerHTML = INFO_UPDATE_TAG_ICONS[tagSlug] || INFO_UPDATE_TAG_ICONS['fitur-baru'];
  mark.setAttribute('aria-hidden', 'true');
  poster.append(mark);
  const body = document.createElement('div');
  body.className = 'info-update-body';
  const title = document.createElement('h4');
  title.textContent = update.title || '';
  const meta = document.createElement('p');
  meta.className = 'info-update-meta';
  meta.textContent = [update.day, update.time].filter(Boolean).join(' · ');
  const tagEl = document.createElement('span');
  tagEl.className = 'info-update-tag';
  tagEl.textContent = tag;
  const desc = document.createElement('div');
  desc.className = 'info-update-desc';
  const description = document.createElement('p');
  description.textContent = update.description || '';
  desc.append(description);
  body.append(title, meta, tagEl, desc);
  item.append(poster, body);
  return item;
}

async function loadInfoUpdates() {
  const list = document.querySelector('#infoupdate .info-update-list');
  if (!list) return;
  try {
    const response = await fetch('/info-updates.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const updates = Array.isArray(data?.updates) ? data.updates : [];
    if (!updates.length) throw new Error('empty');
    list.innerHTML = '';
    updates.forEach((update) => list.append(createInfoUpdateItem(update)));
    void markInfoUpdatesSeen(updates);
  } catch { /* Biarkan daftar statis di halaman bila file belum bisa dibaca. */ }
  updateInfoUpdateFilterCounts();
  applyInfoUpdateFilter({ resetPage: false });
}

// Filter + pencarian Info Update ala Log privat: pil kategori berangka dan kotak pencarian di atas daftar, dengan hitungan yang dihitung ulang dari data yang sedang tampil setiap kali daftar me-refresh (60 detik) dan filter yang sedang aktif tetap dipertahankan.
let infoUpdateFilter = 'all';
let infoUpdateQuery = '';
function infoUpdateFilterCounts() {
  const counts = { all: 0, 'fitur-baru': 0, perubahan: 0, perbaikan: 0, 'fitur-dihapus': 0, tampilan: 0 };
  document.querySelectorAll('#infoupdate .info-update-item').forEach((item) => {
    const tag = item.dataset.tag || '';
    counts.all += 1;
    if (Object.hasOwn(counts, tag)) counts[tag] += 1;
  });
  return counts;
}
function updateInfoUpdateFilterCounts() {
  const counts = infoUpdateFilterCounts();
  document.querySelectorAll('[data-info-update-filters] [data-filter-count]').forEach((countEl) => {
    const key = countEl.dataset.filterCount;
    if (Object.hasOwn(counts, key)) countEl.textContent = String(counts[key]);
  });
}
function infoUpdateItemMatches(item) {
  if (infoUpdateFilter !== 'all' && (item.dataset.tag || '') !== infoUpdateFilter) return false;
  if (!infoUpdateQuery) return true;
  const haystack = `${item.querySelector('h4')?.textContent || ''} ${item.querySelector('.info-update-desc')?.textContent || ''} ${item.querySelector('.info-update-tag')?.textContent || ''}`.toLowerCase();
  return haystack.includes(infoUpdateQuery);
}
function applyInfoUpdateFilter({ resetPage = true } = {}) {
  const items = [...document.querySelectorAll('#infoupdate .info-update-item')];
  let visible = 0;
  items.forEach((item) => {
    const match = infoUpdateItemMatches(item);
    item.classList.toggle('is-filtered-out', !match);
    if (match) visible += 1;
  });
  document.querySelector('#info-update-empty')?.toggleAttribute('hidden', visible > 0);
  if (resetPage) infoUpdatePage = 1;
  renderInfoUpdatePagination();
}
document.querySelector('#info-update-search')?.addEventListener('input', (event) => {
  infoUpdateQuery = String(event.target.value || '').trim().toLowerCase();
  applyInfoUpdateFilter();
});
document.querySelector('[data-info-update-filters]')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-info-filter]');
  if (!button) return;
  infoUpdateFilter = button.dataset.infoFilter;
  document.querySelectorAll('[data-info-update-filters] .filter-pill').forEach((pill) => {
    const active = pill === button;
    pill.classList.toggle('is-active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
  applyInfoUpdateFilter();
});

// Badge Info Update: angka update belum dibaca di menu samping. Penanda terakhir dibaca disimpan per akun di server, dihitung dari entri terbaru yang sudah dilihat.
function countUnreadInfoUpdates(updates, seen) {
  if (!Array.isArray(updates) || !updates.length) return 0;
  if (!seen || !seen.day || !seen.time || !seen.title) return updates.length;
  let unread = 0;
  for (const update of updates) {
    if (update.day === seen.day && update.time === seen.time && update.title === seen.title) break;
    unread += 1;
    // Entri yang diamandemen (hari dan judul sama, jam berubah) adalah entri
    // yang sudah dibaca itu sendiri: hitung sekali sebagai belum dibaca, lalu
    // berhenti — entri di bawahnya sudah dibaca semua. Tanpa ini, penanda
    // lama jadi yatim dan seluruh daftar terhitung belum dibaca.
    if (update.day === seen.day && update.title === seen.title) break;
  }
  return unread;
}

let infoUpdateUnreadCount = 0;
let memberNewCount = 0;
// Tanda seru di tombol garis tiga: muncul selama masih ada notifikasi
// yang belum dilihat (Info Update belum dibaca atau akun baru di Member),
// hilang begitu semuanya sudah dilihat. Angkanya mengikuti badge yang
// sama, jadi tidak ada sumber hitungan baru.
function updateMenuToggleAlert() {
  const button = document.querySelector('#menu-toggle');
  if (!button) return;
  const hasAlert = infoUpdateUnreadCount + memberNewCount > 0;
  button.classList.toggle('has-alert', hasAlert);
  button.setAttribute('aria-label', hasAlert ? 'Buka menu (ada notifikasi)' : 'Buka menu');
}

function renderInfoUpdateBadge(count) {
  infoUpdateUnreadCount = count > 0 ? count : 0;
  updateMenuToggleAlert();
  const item = document.querySelector('.side-nav .nav-item[href="#infoupdate"]');
  if (!item) return;
  let badge = item.querySelector('.nav-badge');
  if (!count || count <= 0) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    item.append(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', `${count} pembaruan belum dibaca`);
}

async function refreshInfoUpdateBadge() {
  try {
    const [updatesResponse, seenResponse] = await Promise.all([
      fetch('/info-updates.json', { cache: 'no-store' }),
      fetch('/api/info-updates/seen', { credentials: 'same-origin' }),
    ]);
    if (!updatesResponse.ok) return;
    const data = await updatesResponse.json();
    const updates = Array.isArray(data?.updates) ? data.updates : [];
    let seen = null;
    if (seenResponse.ok) {
      const seenData = await seenResponse.json().catch(() => ({}));
      seen = seenData?.seen || null;
    }
    renderInfoUpdateBadge(countUnreadInfoUpdates(updates, seen));
  } catch { /* Badge gagal dimuat: biarkan menu tanpa angka. */ }
}

async function markInfoUpdatesSeen(updates) {
  const newest = Array.isArray(updates) ? updates[0] : null;
  if (!newest?.day || !newest?.time || !newest?.title) return;
  try {
    const response = await fetch('/api/info-updates/seen', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: newest.day, time: newest.time, title: newest.title }),
    });
    if (response.ok) renderInfoUpdateBadge(0);
  } catch { /* Penanda gagal disimpan: badge tetap tampil sampai berhasil. */ }
}

// Badge Member: angka akun baru (member maupun admin) yang belum dilihat.
// Penanda disimpan per akun di server, jadi admin dan member melihat angka
// yang berbeda — masing-masing dihitung dari terakhir kali akun itu membuka
// halaman Member.
let memberListSeen = null;
let memberListSeenLoaded = false;
function countNewMembers(users, seen) {
  if (!Array.isArray(users) || !users.length) return 0;
  if (!seen || !seen.createdAt || Number.isNaN(Date.parse(seen.createdAt))) return users.length;
  const seenAt = Date.parse(seen.createdAt);
  return users.filter((user) => {
    const createdAt = Date.parse(user?.createdAt || '');
    return Number.isFinite(createdAt) && createdAt > seenAt;
  }).length;
}
function renderMemberBadge(count) {
  memberNewCount = count > 0 ? count : 0;
  updateMenuToggleAlert();
  const item = document.querySelector('#admin-nav');
  if (!item) return;
  let badge = item.querySelector('.nav-badge');
  if (!count || count <= 0) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    item.append(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', `${count} akun baru belum dilihat`);
}
async function refreshMemberBadge() {
  try {
    const [membersResponse, seenResponse] = await Promise.all([
      fetch('/api/members', { credentials: 'same-origin' }),
      fetch('/api/member-list/seen', { credentials: 'same-origin' }),
    ]);
    if (!membersResponse.ok) return;
    const data = await membersResponse.json();
    const users = Array.isArray(data?.users) ? data.users : [];
    let seen = null;
    if (seenResponse.ok) {
      const seenData = await seenResponse.json().catch(() => ({}));
      seen = seenData?.seen || null;
    }
    memberListSeen = seen;
    memberListSeenLoaded = true;
    renderMemberBadge(countNewMembers(users, seen));
  } catch { /* Badge gagal dimuat: biarkan menu tanpa angka. */ }
}
async function markMemberListSeen(users) {
  try {
    let list = Array.isArray(users) ? users : null;
    if (!list) {
      const response = await fetch('/api/members', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      list = Array.isArray(data?.users) ? data.users : [];
    }
    const newest = [...list]
      .filter((user) => Number.isFinite(Date.parse(user?.createdAt || '')))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (!newest?.createdAt || !newest?.username) return;
    if (memberListSeen?.createdAt === newest.createdAt && memberListSeen?.username === newest.username) {
      renderMemberBadge(0);
      return;
    }
    const response = await fetch('/api/member-list/seen', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ createdAt: newest.createdAt, username: newest.username }),
    });
    if (response.ok) {
      memberListSeen = { createdAt: newest.createdAt, username: newest.username };
      memberListSeenLoaded = true;
      renderMemberBadge(0);
    }
  } catch { /* Penanda gagal disimpan: badge tetap tampil sampai berhasil. */ }
}

// Info Update: daftar pembaruan dipaginasi 3 entri per halaman agar tetap ringkas di layar kecil.
const INFO_UPDATE_PAGE_SIZE = 3;
// Tombol nomor halaman hanya menampilkan jendela 5 halaman di sekitar halaman aktif (plus "…") agar baris paginasi tidak meluber di HP — pola yang sama dengan paginasi riwayat login.
const INFO_UPDATE_PAGE_WINDOW = 5;
let infoUpdatePage = 1;
function renderInfoUpdatePagination() {
  // Paginasi hanya menghitung entri yang lolos filter aktif, supaya halaman dan jumlahnya selalu sesuai dengan yang terlihat.
  const items = [...document.querySelectorAll('#infoupdate .info-update-item')].filter((item) => !item.classList.contains('is-filtered-out'));
  const pager = document.querySelector('#info-update-pagination');
  if (!pager) return;
  const pages = Math.max(1, Math.ceil(items.length / INFO_UPDATE_PAGE_SIZE));
  infoUpdatePage = Math.min(Math.max(1, infoUpdatePage), pages);
  items.forEach((item, index) => {
    item.classList.toggle('hidden', Math.floor(index / INFO_UPDATE_PAGE_SIZE) + 1 !== infoUpdatePage);
  });
  pager.innerHTML = '';
  const firstButton = document.createElement('button');
  firstButton.type = 'button';
  firstButton.className = 'info-page-button';
  firstButton.textContent = '«';
  firstButton.setAttribute('aria-label', 'Halaman pertama');
  firstButton.disabled = infoUpdatePage <= 1;
  firstButton.addEventListener('click', () => { infoUpdatePage = 1; renderInfoUpdatePagination(); });
  pager.append(firstButton);
  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'info-page-button';
  prevButton.textContent = '‹';
  prevButton.setAttribute('aria-label', 'Halaman sebelumnya');
  prevButton.disabled = infoUpdatePage <= 1;
  prevButton.addEventListener('click', () => { infoUpdatePage -= 1; renderInfoUpdatePagination(); });
  pager.append(prevButton);
  const addPageButton = (page) => {
    const pageButton = document.createElement('button');
    pageButton.type = 'button';
    pageButton.className = `info-page-button${page === infoUpdatePage ? ' is-active' : ''}`;
    pageButton.textContent = String(page);
    pageButton.setAttribute('aria-label', `Halaman ${page}`);
    pageButton.setAttribute('aria-current', page === infoUpdatePage ? 'page' : 'false');
    pageButton.disabled = page === infoUpdatePage;
    pageButton.addEventListener('click', () => { infoUpdatePage = page; renderInfoUpdatePagination(); });
    pager.append(pageButton);
  };
  const addEllipsis = () => {
    const ellipsis = document.createElement('span');
    ellipsis.className = 'info-page-ellipsis';
    ellipsis.textContent = '…';
    ellipsis.setAttribute('aria-hidden', 'true');
    pager.append(ellipsis);
  };
  const firstPage = Math.max(1, Math.min(infoUpdatePage - 2, pages - INFO_UPDATE_PAGE_WINDOW + 1));
  const lastPage = Math.min(pages, firstPage + INFO_UPDATE_PAGE_WINDOW - 1);
  if (firstPage > 1) addEllipsis();
  for (let page = firstPage; page <= lastPage; page += 1) addPageButton(page);
  if (lastPage < pages) addEllipsis();
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'info-page-button';
  nextButton.textContent = '›';
  nextButton.setAttribute('aria-label', 'Halaman berikutnya');
  nextButton.disabled = infoUpdatePage >= pages;
  nextButton.addEventListener('click', () => { infoUpdatePage += 1; renderInfoUpdatePagination(); });
  pager.append(nextButton);
  const lastButton = document.createElement('button');
  lastButton.type = 'button';
  lastButton.className = 'info-page-button';
  lastButton.textContent = '»';
  lastButton.setAttribute('aria-label', 'Halaman terakhir');
  lastButton.disabled = infoUpdatePage >= pages;
  lastButton.addEventListener('click', () => { infoUpdatePage = pages; renderInfoUpdatePagination(); });
  pager.append(lastButton);
}
renderInfoUpdatePagination();
// Hitungan pil + filter langsung diterapkan ke daftar statis fallback, supaya pencarian dan kategori sudah bekerja sebelum file JSON selesai dimuat.
updateInfoUpdateFilterCounts();
applyInfoUpdateFilter({ resetPage: false });

// Info Update sebelum login: daftar yang sama dengan di dalam panel, dibaca dari
// file publik yang sama, tapi tanpa penanda sudah dibaca (butuh akun) dan dengan
// paginasi sendiri agar tidak mengganggu paginasi di dalam panel.
let mobileInfoUpdatePage = 1;
async function loadMobileInfoUpdates() {
  const list = document.querySelector('#mobile-info-update-list');
  if (!list) return;
  try {
    const response = await fetch('/info-updates.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const updates = Array.isArray(data?.updates) ? data.updates : [];
    if (!updates.length) throw new Error('empty');
    list.innerHTML = '';
    updates.forEach((update) => list.append(createInfoUpdateItem(update)));
  } catch {
    list.innerHTML = '<li class="info-update-item"><div class="info-update-body"><h4>Info Update belum bisa dimuat</h4><p class="info-update-meta">Coba buka lagi halaman ini.</p><p>Login untuk melihat Info Update di dalam panel.</p></div></li>';
  }
  mobileInfoUpdatePage = 1;
  renderMobileInfoUpdatePagination();
}
function renderMobileInfoUpdatePagination() {
  const items = [...document.querySelectorAll('#mobile-info-update-list .info-update-item')];
  const pager = document.querySelector('#mobile-info-update-pagination');
  if (!pager) return;
  const pages = Math.max(1, Math.ceil(items.length / INFO_UPDATE_PAGE_SIZE));
  mobileInfoUpdatePage = Math.min(Math.max(1, mobileInfoUpdatePage), pages);
  items.forEach((item, index) => {
    item.classList.toggle('hidden', Math.floor(index / INFO_UPDATE_PAGE_SIZE) + 1 !== mobileInfoUpdatePage);
  });
  pager.innerHTML = '';
  const makeButton = (label, ariaLabel, disabled, onClick, isActive = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `info-page-button${isActive ? ' is-active' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    if (isActive) button.setAttribute('aria-current', 'page');
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    pager.append(button);
    return button;
  };
  makeButton('«', 'Halaman pertama', mobileInfoUpdatePage <= 1, () => { mobileInfoUpdatePage = 1; renderMobileInfoUpdatePagination(); });
  makeButton('‹', 'Halaman sebelumnya', mobileInfoUpdatePage <= 1, () => { mobileInfoUpdatePage -= 1; renderMobileInfoUpdatePagination(); });
  const firstPage = Math.max(1, Math.min(mobileInfoUpdatePage - 2, pages - INFO_UPDATE_PAGE_WINDOW + 1));
  const lastPage = Math.min(pages, firstPage + INFO_UPDATE_PAGE_WINDOW - 1);
  if (firstPage > 1) {
    const ellipsis = document.createElement('span');
    ellipsis.className = 'info-page-ellipsis';
    ellipsis.textContent = '…';
    ellipsis.setAttribute('aria-hidden', 'true');
    pager.append(ellipsis);
  }
  for (let page = firstPage; page <= lastPage; page += 1) {
    makeButton(String(page), `Halaman ${page}`, page === mobileInfoUpdatePage, () => { mobileInfoUpdatePage = page; renderMobileInfoUpdatePagination(); }, page === mobileInfoUpdatePage);
  }
  if (lastPage < pages) {
    const ellipsis = document.createElement('span');
    ellipsis.className = 'info-page-ellipsis';
    ellipsis.textContent = '…';
    ellipsis.setAttribute('aria-hidden', 'true');
    pager.append(ellipsis);
  }
  makeButton('›', 'Halaman berikutnya', mobileInfoUpdatePage >= pages, () => { mobileInfoUpdatePage += 1; renderMobileInfoUpdatePagination(); });
  makeButton('»', 'Halaman terakhir', mobileInfoUpdatePage >= pages, () => { mobileInfoUpdatePage = pages; renderMobileInfoUpdatePagination(); });
}

// Tombol kembali ke atas di pojok kanan bawah, muncul setelah halaman di-scroll ke bawah.
const backToTopButton = document.querySelector('#back-to-top');
function updateBackToTop() {
  backToTopButton?.classList.toggle('is-visible', window.scrollY > 300);
}
window.addEventListener('scroll', updateBackToTop, { passive: true });
updateBackToTop();
backToTopButton?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
document.querySelectorAll('[data-open-private-log]').forEach((button) => {
  button.addEventListener('click', () => setWorkspacePage('activity'));
});
document.querySelector('#private-log-search')?.addEventListener('input', applyPrivateLogFilters);
document.querySelector('[data-private-log-filters]')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-log-filter]');
  if (!button) return;
  activePrivateLogFilter = button.dataset.logFilter || 'all';
  applyPrivateLogFilters();
});
document.querySelector('[data-refresh-private-log]')?.addEventListener('click', () => { void loadPairingLogs(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && activeWorkspacePage === 'activity') void loadPairingLogs();
});

(async function boot() {
  try {
    const result = await api('/api/me');
    await showDashboard(result.user);
  } catch {
    showAuth(savedAuthMode());
  }
})();

// Statistik publik hanya menampilkan agregat dan diperbarui berkala tanpa data pribadi.
const publicStatsTimer = setInterval(refreshPublicAccountStats, 15000);

async function refreshPublicAccountStats() {
  try {
    const stats = await api('/api/public/account-stats');
    const total = document.querySelector('#public-stat-total');
    const active = document.querySelector('#public-stat-active');
    const inactive = document.querySelector('#public-stat-inactive');
    const admin = document.querySelector('#public-stat-admin');
    const member = document.querySelector('#public-stat-member');
    const bot = document.querySelector('#public-stat-bot');
    const whatsapp = document.querySelector('#public-stat-whatsapp');
    const worker = document.querySelector('#public-stat-worker');
    const updated = document.querySelector('#public-stats-updated');
    if (total) total.textContent = Number(stats.total || 0).toLocaleString('id-ID');
    if (active) active.textContent = Number(stats.active || 0).toLocaleString('id-ID');
    if (inactive) inactive.textContent = Number(stats.inactive || 0).toLocaleString('id-ID');
    if (admin) admin.textContent = Number(stats.admin || 0).toLocaleString('id-ID');
    if (member) member.textContent = Number(stats.member || 0).toLocaleString('id-ID');
    if (bot) bot.textContent = Number(stats.botOnline || 0).toLocaleString('id-ID');
    if (whatsapp) whatsapp.textContent = Number(stats.whatsappConnected || 0).toLocaleString('id-ID');
    if (worker) worker.textContent = Number(stats.workersRunning || 0).toLocaleString('id-ID');
    const botOnlineCount = document.querySelector('#public-bot-online-count');
    const workerCount = document.querySelector('#public-worker-count');
    const botUpdated = document.querySelector('#mobile-bot-list-updated');
    if (botOnlineCount) botOnlineCount.textContent = Number(stats.botOnline || 0).toLocaleString('id-ID');
    if (workerCount) workerCount.textContent = Number(stats.workersRunning || 0).toLocaleString('id-ID');
    if (botUpdated) botUpdated.textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(stats.updatedAt))} WIB`;
    if (updated) updated.textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(stats.updatedAt))} WIB`;
    const workspaceTotal = document.querySelector('#workspace-public-stat-total');
    const workspaceActive = document.querySelector('#workspace-public-stat-active');
    const workspaceInactive = document.querySelector('#workspace-public-stat-inactive');
    const workspaceAdmin = document.querySelector('#workspace-public-stat-admin');
    const workspaceMember = document.querySelector('#workspace-public-stat-member');
    const workspaceBot = document.querySelector('#workspace-public-stat-bot');
    const workspaceWhatsapp = document.querySelector('#workspace-public-stat-whatsapp');
    const workspaceWorker = document.querySelector('#workspace-public-stat-worker');
    const workspaceUpdated = document.querySelector('#workspace-public-stats-updated');
    if (workspaceTotal) workspaceTotal.textContent = Number(stats.total || 0).toLocaleString('id-ID');
    if (workspaceActive) workspaceActive.textContent = Number(stats.active || 0).toLocaleString('id-ID');
    if (workspaceInactive) workspaceInactive.textContent = Number(stats.inactive || 0).toLocaleString('id-ID');
    if (workspaceAdmin) workspaceAdmin.textContent = Number(stats.admin || 0).toLocaleString('id-ID');
    if (workspaceMember) workspaceMember.textContent = Number(stats.member || 0).toLocaleString('id-ID');
    if (workspaceBot) workspaceBot.textContent = Number(stats.botOnline || 0).toLocaleString('id-ID');
    if (workspaceWhatsapp) workspaceWhatsapp.textContent = Number(stats.whatsappConnected || 0).toLocaleString('id-ID');
    if (workspaceWorker) workspaceWorker.textContent = Number(stats.workersRunning || 0).toLocaleString('id-ID');
    const workspaceBotOnlineCount = document.querySelector('#workspace-bot-online-count');
    const workspaceWorkerCount = document.querySelector('#workspace-worker-count');
    const workspaceBotUpdated = document.querySelector('#workspace-bot-list-updated');
    if (workspaceBotOnlineCount) workspaceBotOnlineCount.textContent = Number(stats.botOnline || 0).toLocaleString('id-ID');
    if (workspaceWorkerCount) workspaceWorkerCount.textContent = Number(stats.workersRunning || 0).toLocaleString('id-ID');
    if (workspaceBotUpdated) workspaceBotUpdated.textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(stats.updatedAt))} WIB`;
    if (workspaceUpdated) workspaceUpdated.textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(stats.updatedAt))} WIB`;
  } catch {
    const updated = document.querySelector('#public-stats-updated');
    if (updated) updated.textContent = 'Data realtime belum tersedia';
  }
}

void refreshPublicAccountStats();
