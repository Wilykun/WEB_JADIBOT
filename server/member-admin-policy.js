export const BANNED_LOGIN_NOTICE = 'Akun Anda diblokir oleh admin. Silakan hubungi administrator untuk bantuan.';

export function memberAdminPolicyError(actor, target) {
  if (!actor) return { status: 401, message: 'Silakan masuk kembali.' };
  if (actor.role !== 'admin') return { status: 403, message: 'Akses admin diperlukan.' };
  if (!target) return { status: 404, message: 'Akun member tidak ditemukan.' };
  if (target.role === 'admin') return { status: 400, message: 'Aksi ini hanya berlaku untuk akun member.' };
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
