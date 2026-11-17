export const BANNED_LOGIN_NOTICE = 'Akun Anda diblokir oleh admin. Silakan hubungi administrator untuk bantuan.';
export const DELETED_LOGIN_NOTICE = 'Akun Anda telah dihapus oleh admin. Silakan hubungi administrator untuk bantuan.';

// Admin Utama = akun admin yang namanya tercantum di config.json
// (BOOTSTRAP_ADMIN_USERNAME, yaitu WILYKUN). Ia bukan admin biasa: tidak
// bisa diubah siapa pun, dan hanya ia yang boleh mengelola admin biasa.
export function isMainAdminUser(user, bootstrapUsername) {
  const bootstrap = String(bootstrapUsername || '').trim().toLowerCase();
  return Boolean(bootstrap) && user?.role === 'admin'
    && String(user.username || '').toLowerCase() === bootstrap;
}

export function memberAdminPolicyError(actor, target, bootstrapUsername) {
  if (!actor) return { status: 401, message: 'Silakan masuk kembali.' };
  if (actor.role !== 'admin') return { status: 403, message: 'Akses admin diperlukan.' };
  if (!target) return { status: 404, message: 'Akun member tidak ditemukan.' };
  if (target.role === 'admin') {
    if (isMainAdminUser(target, bootstrapUsername)) return { status: 400, message: 'Akun Admin Utama tidak dapat diubah.' };
    if (!isMainAdminUser(actor, bootstrapUsername)) return { status: 400, message: 'Aksi ini hanya berlaku untuk akun member.' };
  }
  return null;
}

// Aturan KHUSUS kontrol bot (start/stop/restart/hapus sesi/atur
// pengaturan): Admin Utama boleh mengelola siapa pun termasuk dirinya
// sendiri; admin biasa boleh mengelola member dan sesama admin biasa,
// tetapi tidak Admin Utama. Aturan ini lebih longgar dari
// memberAdminPolicyError yang dipakai ban/hapus akun — jangan dipakai di
// sana, supaya admin biasa tetap tidak bisa memblokir atau menghapus
// sesama admin.
export function botControlPolicyError(actor, target, bootstrapUsername) {
  if (!actor) return { status: 401, message: 'Silakan masuk kembali.' };
  if (actor.role !== 'admin') return { status: 403, message: 'Akses admin diperlukan.' };
  if (!target) return { status: 404, message: 'Akun member tidak ditemukan.' };
  if (isMainAdminUser(target, bootstrapUsername) && !isMainAdminUser(actor, bootstrapUsername)) {
    return { status: 400, message: 'Akun Admin Utama tidak dapat diubah.' };
  }
  return null;
}

export function isBannedAccount(user) {
  return user?.banned === true;
}

export function normalizeBanReason(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

const memberLifecycleLocks = new Map();

export async function withMemberLifecycleLock(memberId, operation) {
  const key = String(memberId || '');
  const previous = memberLifecycleLocks.get(key) || Promise.resolve();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => held);
  memberLifecycleLocks.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (memberLifecycleLocks.get(key) === tail) memberLifecycleLocks.delete(key);
  }
}
