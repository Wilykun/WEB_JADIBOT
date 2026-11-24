const UPSTREAM = "https://wise-moon-dffba322.tunnl.gg";
// Perf fix tanpa ubah tampilan: injeksi CSS/JS ringan ke halaman HTML saja.
// - scroll-behavior auto (bukan smooth global, biar scroll HP ringan)
// - matikan blur .ambient pas lagi scroll, nyalain lagi pas berhenti
// - jeda animasi berat pas tab tidak aktif
const PERF_SNIPPET = `<style>html{scroll-behavior:auto!important}.ambient{will-change:transform;contain:strict}body.scrolling .ambient{opacity:0!important}body.scrolling *{animation-play-state:paused!important}</style><script>let _st;addEventListener('scroll',()=>{document.body.classList.add('scrolling');clearTimeout(_st);_st=setTimeout(()=>document.body.classList.remove('scrolling'),120)},{passive:true});document.addEventListener('visibilitychange',()=>{document.body.style.setProperty('--perf-paused',document.hidden?'1':'0')});</script>`;
// Halaman pengganti saat tunnel/panel mati: pengunjung tidak lagi melihat
// "Not Found" polos dari tunnl.gg, tapi halaman ini yang refresh otomatis
// tiap 10 detik sampai situs hidup lagi. Status 503 + no-store supaya
// browser tidak menyimpan halaman ini. Tombol Muat Ulang dan Chat Owner
// berdampingan (horizontal, flex 1:1) supaya pas di layar HP; di bawahnya
// ada catatan sabar (maklum pengguna gratis), kalimat santai, dan tawaran
// paket premium Rp10.000 dengan ajakan chat owner di WA.
const MAINTENANCE_HTML = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>ReadSW — Sedang Dipulihkan</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0f14;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px}.wrap{max-width:420px}h1{font-size:22px;margin:0 0 8px}p{color:#8b98a5;margin:0 0 20px;line-height:1.6}.actions{display:flex;gap:10px}.actions button,.actions a{flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:8px;padding:11px 10px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;color:#fff}.actions button{background:#1f6feb}.actions a{background:#25d366}.actions a svg{width:18px;height:18px;flex:0 0 auto;fill:none;stroke:#fff;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.actions a svg path:last-child{fill:none}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f0a832;margin-right:6px;animation:blink 1s infinite}@keyframes blink{50%{opacity:.25}}.note{margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,.09)}.note p{margin:0 0 8px;font-size:14px}.note .free{color:#8b98a5}.note .play{color:#8b98a5}.note .premium{color:#c9d4de}.note .premium b{color:#fff}</style></head><body><div class="wrap"><h1><span class="dot"></span>ReadSW sedang dipulihkan</h1><p>Situs sempat tidak terjangkau dan sedang dihidupkan lagi otomatis.<br>Halaman ini akan refresh sendiri — tidak perlu menutup tab ini.</p><div class="actions"><button onclick="location.reload()">Muat Ulang Sekarang</button><a href="https://wa.me/6289688206739" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A10.7 10.7 0 0 0 3.4 16.4L2 21.8l5.5-1.4A10.7 10.7 0 1 0 20.5 3.5Z"/><path d="M8.6 7.3c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.8 1.8c.1.2.1.4 0 .6l-.5.7c-.1.2-.2.3 0 .6.5.8 1.2 1.5 2 2 .3.2.4.2.6 0l.8-.8c.2-.2.4-.2.6-.1l1.8.9c.2.1.3.3.2.6-.1.7-.5 1.2-1.1 1.5-.6.3-1.3.2-2.1 0-1.4-.5-2.7-1.3-3.8-2.4-1.1-1.1-1.9-2.4-2.4-3.8-.2-.8-.3-1.5 0-2.1.3-.6.8-1 1.4-1.2Z"/></svg>Chat Owner</a></div><div class="note"><p class="free">Sabar ya, maklum pengguna gratis — panel ini sedang dipulihkan otomatis, tunggu sebentar.</p><p class="play">Panelnya tetap bisa jalan gini terus kok, sabar ya 😂</p><p class="premium">Mau yang jalan terus 24 jam tanpa putus dan fitur penuh? Paket premium cuma <b>Rp10.000</b> — chat owner di WA.</p></div></div></body></html>`;
function maintenanceResponse() {
  return new Response(MAINTENANCE_HTML, {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__tunnel/health") {
      return new Response(JSON.stringify({ ok: true, service: "readsw-proxy", upstream: UPSTREAM }), { headers: { "content-type": "application/json" } });
    }
    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.set("User-Agent", "readsw-proxy/1.0");
    // Panel checkOrigin(): Origin harus cocok dengan X-Forwarded-Host/Host.
    // Teruskan host domain asli (readsw.my.id) supaya login tidak 403
    // "Asal permintaan tidak diizinkan."
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Original-Host", url.host);
    headers.set("X-Forwarded-Proto", "https");
    headers.delete("sec-fetch-site");
    headers.delete("sec-fetch-mode");
    headers.delete("sec-fetch-dest");
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    let resp;
    try {
      resp = await fetch(upstreamUrl, init);
    } catch {
      // Upstream tidak bisa dijangkau sama sekali (tunnel mati / DNS gagal).
      return maintenanceResponse();
    }
    // Gateway error dari tunnl.gg / proxy: tunnel atau panel sedang mati.
    if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
      return maintenanceResponse();
    }
    // "Not Found" polos (text/plain) = tunnl.gg tidak ada tunnel yang
    // melayani subdomain ini. Bedakan dari 404 panel sendiri (JSON/HTML).
    if (resp.status === 404) {
      const ct404 = (resp.headers.get("content-type") || "").toLowerCase();
      if (ct404.includes("text/plain")) {
        const body404 = (await resp.text()).trim();
        if (body404.toLowerCase() === "not found") return maintenanceResponse();
        return new Response(body404, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      }
    }
    const outHeaders = new Headers(resp.headers);
    outHeaders.delete("content-encoding");
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    // Cache static assets di edge, biar scroll/load berikutnya ringan
    if (/\.(js|css|png|svg|woff2|jpg|jpeg)$/.test(url.pathname)) {
      outHeaders.set("Cache-Control", "public, max-age=3600");
    }
    if (ct.includes("text/html")) {
      let html = await resp.text();
      if (html.includes("</head>")) html = html.replace("</head>", PERF_SNIPPET + "</head>");
      else html += PERF_SNIPPET;
      outHeaders.delete("content-length");
      return new Response(html, { status: resp.status, statusText: resp.statusText, headers: outHeaders });
    }
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: outHeaders });
  }
};
