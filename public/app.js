const authView = document.querySelector('#auth-view');
const appView = document.querySelector('#app-view');
const bootScreen = document.querySelector('#boot-screen');
const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const verificationForm = document.querySelector('#verification-form');
const authMessage = document.querySelector('#auth-message');
const toast = document.querySelector('#toast');
let currentUser = null;
let verificationIdentifier = '';
let selectedMode = null;
let workerAutoStart = false;
let toastTimer;
let pairingPollTimer;
let pairingCountdownTimer;
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
  setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenu(false);
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

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
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
  clearVerificationCooldown();
  try { window.sessionStorage.setItem(AUTH_MODE_STORAGE_KEY, registering ? 'register' : 'login'); } catch { /* Mode tetap berjalan tanpa storage. */ }
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.querySelector('.auth-panel')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  authView.classList.toggle('is-registering', registering);
  loginForm.classList.toggle('hidden', registering);
  registerForm.classList.toggle('hidden', !registering);
  verificationForm.classList.add('hidden');
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
  clearVerificationCooldown();
  loginForm.classList.add('hidden');
  registerForm.classList.add('hidden');
  verificationForm.classList.remove('hidden');
  document.querySelector('#auth-eyebrow').textContent = 'SATU LANGKAH LAGI';
  document.querySelector('#auth-title').textContent = 'Verifikasi akunmu';
  document.querySelector('#auth-subtitle').textContent = 'Masukkan kode CAPTCHA 5 karakter sebelum masuk ke dashboard.';
  setVerificationPrompt(payload);
  document.querySelector('#auth-switch').innerHTML = 'Perlu melanjutkan pendaftaran? <button type="button" data-action="show-register">Kembali ke formulir</button>';
  setAuthMessage('Pendaftaran tersimpan sementara. Akun permanen baru dibuat setelah kode verifikasi benar.');
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
      button.classList.toggle('button-primary', active || card.dataset.planCard === 'readonly_readsw');
      button.classList.toggle('button-secondary', !active && card.dataset.planCard !== 'readonly_readsw');
    }
  });
  const onlineCard = document.querySelector('[data-online-addon]');
  const onlineButton = onlineCard?.querySelector('[data-online24-toggle]');
  onlineCard?.classList.toggle('selected', online24);
  if (onlineButton) {
    onlineButton.innerHTML = online24 ? 'Aktif <span>✓</span>' : 'Aktifkan <span>→</span>';
    onlineButton.setAttribute('aria-pressed', String(online24));
    onlineButton.setAttribute('aria-label', online24 ? 'Online 24 Jam sedang aktif' : 'Aktifkan Online 24 Jam');
    onlineButton.classList.toggle('button-primary', online24);
    onlineButton.classList.toggle('button-secondary', !online24);
  }
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
  const approved = window.confirm('Restore akan mengganti data akun/data sesi saat ini, menghentikan koneksi WhatsApp yang sedang aktif, lalu mencoba menyambungkan sesi dari backup. Worker auto-start dapat mulai berjalan. Lanjutkan hanya jika Anda memahami dampaknya dan memiliki izin.');
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
adminUsersList?.addEventListener('input', (event) => {
  const field = event.target.closest('[data-admin-ban-reason]');
  const userId = field?.closest('.member-account-item')?.querySelector('[data-member-toggle]')?.dataset.userId;
  if (field && userId) adminBanReasons.set(userId, field.value);
});
adminUsersList?.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-admin-action]');
  if (actionButton && adminUsersList.contains(actionButton)) {
    const action = actionButton.dataset.adminAction;
    const userId = actionButton.dataset.userId;
    const article = actionButton.closest('.member-account-item');
    const username = article?.querySelector('[data-member-toggle]')?.dataset.username || 'member';
    const confirmations = {
      'bot-start': `Start bot untuk akun WhatsApp @${username}? Bot memakai pengaturan tersimpan dan dapat membaca status serta mengirim reaksi bila mode itu aktif. Lanjut hanya jika kamu berwenang.`,
      'bot-restart': `Restart bot untuk akun WhatsApp @${username}? Bot berjalan kembali dengan pengaturan tersimpan. Lanjut hanya jika kamu berwenang.`,
      'bot-stop': `Matikan worker bot @${username}? Koneksi WhatsApp tetap tertaut. Lanjut hanya jika kamu berwenang.`,
      ban: `Blokir @${username}? Sesi panel dicabut, worker/Online 24 Jam dihentikan, pairing yang belum selesai dibatalkan, dan tautan WA aktif tidak dihapus.`,
      unban: `Buka blokir @${username} agar pemilik dapat login kembali?`,
    };
    if (!window.confirm(confirmations[action] || 'Lanjutkan tindakan admin ini?')) return;
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

async function loadAdminUsers() {
  const section = document.querySelector('#admin');
  try {
    const isAdmin = currentUser?.role === 'admin';
    const result = await api(isAdmin ? '/api/admin/users' : '/api/members');
    const users = Array.isArray(result.users) ? result.users : [];
    adminUsersList.replaceChildren();
    if (!users.some((user) => String(user.id || user.username) === expandedAdminUserId)) expandedAdminUserId = null;
    if (!users.length) {
      const empty = document.createElement('p');
      empty.className = 'member-list-empty';
      empty.textContent = 'Belum ada akun member.';
      adminUsersList.append(empty);
    }

    const pairingLabels = {
      linked: 'Tersambung', disconnected: 'Terputus', reconnecting: 'Menyambung', stopped: 'Dihentikan',
      awaiting_code: 'Menunggu pairing', connecting: 'Menyiapkan pairing', linking: 'Menyelesaikan tautan', failed: 'Gagal',
    };
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
        const roleLabel = user.role === 'admin' ? 'Admin' : 'Member';
        const article = document.createElement('article');
        article.className = `member-account-item${isOpen ? ' is-open' : ''}`;

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
          const preset = /^avatar-(0[1-9]|[12][0-9]|3[0-4])$/.test(selectedAvatar) ? selectedAvatar : 'avatar-01';
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
          { text: roleLabel, className: `member-account-chip is-role${user.role === 'admin' ? ' is-admin' : ''}` },
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
          { label: 'Status akun', value: user.role === 'admin' ? 'Administrator' : user.banned ? 'Diblokir oleh admin' : user.verified ? 'Terverifikasi' : 'Belum verifikasi', icon: 'shield' },
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
        if (currentUser?.role === 'admin' && user.role !== 'admin') {
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
          details.append(adminPanel);
        }
        article.append(toggle, details);
        groupSection.append(article);
      }
      adminUsersList.append(groupSection);
    }
    const visible = Boolean(currentUser);
    section.classList.toggle('hidden', !visible);
    document.querySelector('#admin-nav').classList.toggle('hidden', !visible);
    document.querySelector('#admin-title').textContent = isAdmin ? 'Pemantauan akun member' : 'Daftar member';
    document.querySelector('#admin-description').textContent = isAdmin
      ? 'Status akun diperbarui tiap 15 detik dan runtime worker tiap detik. “Panel aktif” berarti akun masih membuka web dalam 75 detik terakhir; status panel ini berbeda dari status WhatsApp dan worker bot.'
      : 'Daftar ini hanya untuk melihat identitas dasar akun. Member tidak dapat mengontrol, mengedit, memasangkan WhatsApp, atau membuka data akun member lain.';
    document.querySelector('#admin-backup-area')?.classList.toggle('hidden', !isAdmin);
    document.querySelector('#admin-updated').textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date())} WIB`;
    ensureWorkerRuntimeTicker();
  } catch (error) {
    if (error.status === 403) {
      section.classList.add('hidden');
      document.querySelector('#admin-nav').classList.add('hidden');
    }
  }
}
let loginHistoryTimer = null;
let adminUsersTimer = null;
let presenceHeartbeatTimer = null;

async function sendPresenceHeartbeat() {
  if (!currentUser || document.visibilityState !== 'visible' || appView.classList.contains('hidden')) return;
  try {
    await api('/api/me/heartbeat', { method: 'POST', body: '{}' });
  } catch (error) {
    if (error.status === 401) showAuth();
  }
}

function startPresenceHeartbeat() {
  if (presenceHeartbeatTimer) return;
  void sendPresenceHeartbeat();
  presenceHeartbeatTimer = setInterval(() => { void sendPresenceHeartbeat(); }, 25000);
}

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

const workspacePageTitles = { dashboard: 'Panel', mode: 'Fitur Bot', activity: 'Log privat', profile: 'Profil akun', pairing: 'Pairing WhatsApp', developer: 'Developer', infoupdate: 'Info Update', admin: 'Member' };
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

function setWorkspacePage(page, updateHash = true) {
  const navItem = document.querySelector(`.side-nav .nav-item[href="#${page}"]`);
  if (!workspacePageTitles[page] || (page === 'admin' && !currentUser) || navItem?.classList.contains('hidden')) {
    page = document.body.dataset.whatsappLinked === 'true' ? 'dashboard' : 'pairing';
  }
  activeWorkspacePage = page;
  document.querySelectorAll('[data-page-view]').forEach((view) => {
    view.classList.toggle('view-hidden', view.dataset.pageView !== page);
  });
  document.querySelectorAll('.side-nav .nav-item[href^="#"]').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('href') === `#${page}`);
  });
  document.querySelector('#page-breadcrumb').textContent = workspacePageTitles[page];
  if (updateHash && location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  window.scrollTo({ top: 0, behavior: updateHash ? 'smooth' : 'auto' });
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
  }
  setMenu(false);
}

function renderLinkGate(pairing) {
  const linkedSessionStates = new Set(['linked', 'disconnected', 'reconnecting', 'stopped']);
  const hasLinkedSession = linkedSessionStates.has(pairing?.status);
  document.body.dataset.whatsappLinked = String(hasLinkedSession);
  // Menu dan halaman Fitur Bot selalu tampil walau WhatsApp belum tertaut agar mode dan pengaturan story bisa diatur dulu, worker bot baru jalan otomatis begitu akun tertaut.
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
  document.querySelector('#admin-nav')?.classList.toggle('hidden', !adminVisible);
  document.querySelector('.side-nav .nav-item[href="#dashboard"]')?.classList.toggle('hidden', !hasLinkedSession);
  document.querySelector('.side-nav .nav-item[href="#activity"]')?.classList.toggle('hidden', !hasLinkedSession);
  document.querySelector('#pairing-nav')?.classList.toggle('hidden', hasLinkedSession);
  document.querySelector('#connection-badge').textContent = pairing?.status === 'linked'
    ? 'WHATSAPP ONLINE'
    : hasLinkedSession ? 'SESI TERTAUT' : 'TAUTKAN WHATSAPP';
  if (!activeWorkspacePage) {
    const requestedPage = location.hash.slice(1);
    const requestedNav = document.querySelector(`.side-nav .nav-item[href="#${requestedPage}"]`);
    const initialPage = requestedNav && !requestedNav.classList.contains('hidden')
      ? requestedPage
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
      if (recoveryCopy) recoveryCopy.textContent = `Sesi ${pairing.maskedPhone} ditolak, tapi nomor ini masih terdaftar tertaut. Coba pulihkan dulu — nggak perlu masukkan nomor lagi.`;
      statusValue.textContent = 'Sesi ditolak WhatsApp';
      statusDescription.textContent = 'Perangkat masih tertaut di WhatsApp. Coba pulihkan dulu; pairing ulang hanya bila pemulihan gagal.';
      statusFoot.textContent = 'Bisa dipulihkan';
      statusDot.className = 'muted-dot';
      setPairingNotice('Sesi ditolak WhatsApp. Coba pulihkan dulu — perangkatmu masih tertaut.', false, true);
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
    linkedCard.querySelector('strong').textContent = 'Menyambungkan WhatsApp…';
    linkedCard.querySelector('p').textContent = 'Sedang membuka kembali sesi yang tersimpan.';
    statusValue.textContent = 'Menyambungkan';
    statusDescription.textContent = 'Mencoba menyambungkan ulang sesi WhatsApp.';
    statusFoot.textContent = 'Menghubungkan';
    statusDot.className = 'muted-dot';
    setPairingNotice('');
    pairingPollTimer = setInterval(() => { void refreshPairing(); }, 3000);
    return;
  }
  if (pairing.status === 'stopped') {
    controls.classList.add('hidden');
    linkedCard.classList.remove('hidden');
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
  const preset = /^avatar-(0[1-9]|[12][0-9]|3[0-4])$/.test(user.avatar || '') ? user.avatar : 'avatar-01';
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
  await Promise.all([loadAdminUsers(), loadAdminBackupSnapshots(), refreshPairing(), loadPairingLogs()]);
  await loadLoginHistory();
  startLoginHistoryPolling();
  startAdminUsersPolling();
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

function setMobileInfoView(view = 'menu') {
  const selected = ['menu', 'overview', 'developer', 'server', 'bots'].includes(view) ? view : 'menu';
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
  if (open === true && !isDesktop) {
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
    setAuthMessage(error.message);
  } finally {
    setAuthSubmitLoading(button, 'login', false);
  }
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
  showMethodPicker(valid);
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
  input.addEventListener('change', updatePairingConsentGuidance);
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
    setPairingNotice('Wajib centang 2 persetujuan terlebih dahulu: Konfirmasi kepemilikan dan Setuju dengan mode otomatis.');
    (ownershipConsent.checked ? autoConsent : ownershipConsent).focus();
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
      setPairingNotice('Untuk Pairing Code, masukkan 7–15 digit dengan kode negara, tanpa tanda + atau pemisah.');
      pairingPhoneField?.classList.remove('hidden');
      pairingPhoneInput.focus();
      return;
    }
    const parsedPhone = updatePhoneNumberPreview(enteredNumber);
    if (!parsedPhone?.isValid()) {
      setPairingNotice('Nomor belum valid menurut format penomoran internasional. Periksa kode negara dan digitnya. Valid menurut format belum memastikan nomor memiliki akun WhatsApp.');
      pairingPhoneField?.classList.remove('hidden');
      pairingPhoneInput.focus();
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
  const approved = window.confirm('Batalkan pairing code yang sedang tampil? Kode lama tidak akan bisa digunakan dan kamu dapat mengganti nomor.');
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
document.querySelector('#session-delete').addEventListener('click', () => {
  const approved = window.confirm('Hapus sesi WhatsApp dari server ini? Jika masih tersambung, aplikasi akan mencoba logout. Untuk menautkan lagi, kamu perlu meminta pairing code baru.');
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
document.querySelector('#bot-stop').addEventListener('click', () => {
  const approved = window.confirm('Matikan bot dan nonaktifkan auto-start? Bot tidak akan hidup lagi otomatis sampai kamu menekan Start bot.');
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
  const mode = event.target.closest('[data-plan]')?.dataset.plan;
  if (mode) {
    if (!currentUser) return showAuth();
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
async function loadInfoUpdates() {
  const list = document.querySelector('.info-update-list');
  if (!list) return;
  try {
    const response = await fetch('/info-updates.json', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const updates = Array.isArray(data?.updates) ? data.updates : [];
    if (!updates.length) return;
    list.innerHTML = '';
    updates.forEach((update) => {
      const item = document.createElement('li');
      item.className = 'info-update-item';
      const date = document.createElement('span');
      date.className = 'info-update-date';
      const day = document.createElement('span');
      day.textContent = update.day || '';
      const time = document.createElement('span');
      time.className = 'info-update-time';
      time.textContent = update.time || '';
      date.append(day, time);
      const body = document.createElement('div');
      const title = document.createElement('h4');
      title.textContent = update.title || '';
      const description = document.createElement('p');
      description.textContent = update.description || '';
      body.append(title, description);
      item.append(date, body);
      list.append(item);
    });
    infoUpdatePage = 1;
    renderInfoUpdatePagination();
  } catch { /* Biarkan daftar statis di halaman bila file belum bisa dibaca. */ }
}

// Info Update: daftar pembaruan dipaginasi 3 entri per halaman agar tetap ringkas di layar kecil.
const INFO_UPDATE_PAGE_SIZE = 3;
let infoUpdatePage = 1;
function renderInfoUpdatePagination() {
  const items = [...document.querySelectorAll('#infoupdate .info-update-item')];
  const pager = document.querySelector('#info-update-pagination');
  if (!pager) return;
  const pages = Math.max(1, Math.ceil(items.length / INFO_UPDATE_PAGE_SIZE));
  infoUpdatePage = Math.min(Math.max(1, infoUpdatePage), pages);
  items.forEach((item, index) => {
    item.classList.toggle('hidden', Math.floor(index / INFO_UPDATE_PAGE_SIZE) + 1 !== infoUpdatePage);
  });
  pager.innerHTML = '';
  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'info-page-button';
  prevButton.textContent = '‹';
  prevButton.setAttribute('aria-label', 'Halaman sebelumnya');
  prevButton.disabled = infoUpdatePage <= 1;
  prevButton.addEventListener('click', () => { infoUpdatePage -= 1; renderInfoUpdatePagination(); });
  pager.append(prevButton);
  for (let page = 1; page <= pages; page += 1) {
    const pageButton = document.createElement('button');
    pageButton.type = 'button';
    pageButton.className = `info-page-button${page === infoUpdatePage ? ' is-active' : ''}`;
    pageButton.textContent = String(page);
    pageButton.setAttribute('aria-label', `Halaman ${page}`);
    pageButton.setAttribute('aria-current', page === infoUpdatePage ? 'page' : 'false');
    pageButton.disabled = page === infoUpdatePage;
    pageButton.addEventListener('click', () => { infoUpdatePage = page; renderInfoUpdatePagination(); });
    pager.append(pageButton);
  }
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'info-page-button';
  nextButton.textContent = '›';
  nextButton.setAttribute('aria-label', 'Halaman berikutnya');
  nextButton.disabled = infoUpdatePage >= pages;
  nextButton.addEventListener('click', () => { infoUpdatePage += 1; renderInfoUpdatePagination(); });
  pager.append(nextButton);
}
renderInfoUpdatePagination();

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
  } catch {
    const updated = document.querySelector('#public-stats-updated');
    if (updated) updated.textContent = 'Data realtime belum tersedia';
  }
}

void refreshPublicAccountStats();
