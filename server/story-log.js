function maskLogPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 7) return 'Tidak tersedia';
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

function compactLogStoryId(value) {
  const id = String(value || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return 'Tidak tersedia';
  return id.length > 12 ? `${id.slice(0, 8)}···${id.slice(-4)}` : `${id.slice(0, 3)}···`;
}

export function sanitizeStoryLogDetails(details) {
  if (!details || typeof details !== 'object' || details.kind !== 'story') return null;
  const storyCount = Number.isInteger(details.storyCount) && details.storyCount >= 1
    ? Math.min(1_000_000, details.storyCount)
    : 1;
  return {
    kind: 'story',
    mode: String(details.mode || '').slice(0, 40),
    mediaType: String(details.mediaType || 'Story').slice(0, 32),
    storyId: compactLogStoryId(details.storyId),
    greeting: String(details.greeting || '').slice(0, 24),
    dayName: String(details.dayName || '').slice(0, 16),
    date: String(details.date || '').slice(0, 32),
    time: String(details.time || '').slice(0, 8),
    name: String(details.name || 'Tidak tersedia').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 72),
    number: maskLogPhone(details.number),
    storyCount,
    emojiMode: String(details.emojiMode || '—').slice(0, 24),
    success: String(details.success || 'Status tidak diketahui').slice(0, 48),
    reaction: String(details.reaction || 'Off').slice(0, 24),
    resolve: String(details.resolve || 'Tidak diketahui').slice(0, 32),
    delaySeconds: Number.isFinite(details.delaySeconds) ? Math.min(20, Math.max(0, details.delaySeconds)) : 0,
  };
}
