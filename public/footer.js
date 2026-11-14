(() => {
  const clocks = [...document.querySelectorAll('[data-live-clock]')];
  const years = [...document.querySelectorAll('[data-current-year]')];
  if (!clocks.length && !years.length) return;

  const formatter = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Jakarta',
  });

  function updateFooterClock() {
    const now = new Date();
    const parts = Object.fromEntries(
      formatter.formatToParts(now)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const date = `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
    const time = `${parts.hour}.${parts.minute}.${parts.second} WIB`;
    clocks.forEach((clock) => {
      clock.dateTime = now.toISOString();
      clock.textContent = `${date} · ${time}`;
      clock.setAttribute('aria-label', `Waktu Indonesia Barat: ${date}, pukul ${parts.hour}.${parts.minute}.${parts.second}`);
    });
    years.forEach((year) => { year.textContent = parts.year; });
  }

  function renderPresence(stats) {
    document.querySelectorAll('[data-live-online]').forEach((node) => {
      node.textContent = Number(stats.online || 0).toLocaleString('id-ID');
    });
    document.querySelectorAll('[data-live-stalker]').forEach((node) => {
      node.textContent = Number(stats.stalker || 0).toLocaleString('id-ID');
    });
    document.querySelectorAll('[data-live-visits]').forEach((node) => {
      node.textContent = Number(stats.visits || 0).toLocaleString('id-ID');
    });
  }

  async function refreshPresence() {
    try {
      const response = await fetch('/api/public/live-stats', { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok) renderPresence(await response.json());
    } catch { /* Footer counters boleh menunggu server pulih. */ }
  }

  async function sendVisitorHeartbeat() {
    try {
      const response = await fetch('/api/visitor/heartbeat', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (response.ok) renderPresence(await response.json());
    } catch { /* Koneksi offline tidak mengubah isi halaman. */ }
  }

  updateFooterClock();
  window.setInterval(updateFooterClock, 1000);
  void sendVisitorHeartbeat();
  window.setInterval(sendVisitorHeartbeat, 20000);
  window.setInterval(refreshPresence, 10000);
  void refreshPresence();
})();
