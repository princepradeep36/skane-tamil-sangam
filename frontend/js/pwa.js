// Makes the site installable as a phone app (Android "Install", iPhone "Add to Home Screen").
// Loaded on every page. Registers the service worker (sw.js) and wires up any element with
// data-install-app as an "Install app" button: on Android/Chrome it opens the browser's own
// install prompt; on iPhone, and anywhere the browser can't prompt, it shows short steps.
// Buttons hide themselves when the site is already running as the installed app.
(function () {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
    }

    const ua = navigator.userAgent;
    const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isInAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|MicroMessenger|; wv\)/.test(ua);
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; hideButtons(); });

    function hideButtons() { document.querySelectorAll('[data-install-app]').forEach(b => { b.hidden = true; }); }

    function steps() {
        if (isInAppBrowser) return {
            title: 'Open in your browser first',
            items: [
                `Tap the menu <b>⋯</b> or <b>⋮</b> at the top of this screen.`,
                `Choose <b>Open in ${isIOS ? 'Safari' : 'Chrome'}</b> (or "Open in browser").`,
                `Then tap <b>📱 Install App</b> again.`
            ]
        };
        if (isIOS) return {
            title: 'Add to your iPhone',
            items: [
                `Tap the <b>Share</b> button <span class="pwa-ico">⬆︎</span> (in Safari it is at the bottom; on newer iPhones it may be inside the <b>⋯</b> menu).`,
                `Scroll down and tap <b>Add to Home Screen</b> <span class="pwa-ico">＋</span>.`,
                `Tap <b>Add</b>. The Tamil Sangam icon appears on your home screen.`
            ]
        };
        return {
            title: 'Install the app',
            items: [
                `Tap the browser menu <b>⋮</b> (top right in Chrome).`,
                `Choose <b>Install app</b> or <b>Add to Home screen</b>.`,
                `Tap <b>Install</b>. The Tamil Sangam icon appears with your apps.`
            ]
        };
    }

    function showSteps() {
        const s = steps();
        if (!document.getElementById('pwa-style')) {
            const st = document.createElement('style');
            st.id = 'pwa-style';
            st.textContent = `
.pwa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100000;display:flex;align-items:flex-end;justify-content:center;font-family:"League Spartan",system-ui,-apple-system,"Segoe UI",sans-serif}
.pwa-sheet{background:#fff;color:#1a1a1a;width:100%;max-width:460px;border-radius:20px 20px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:pwaUp .25s ease-out;text-align:left}
@media(min-width:600px){.pwa-overlay{align-items:center}.pwa-sheet{border-radius:20px}}
@keyframes pwaUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
.pwa-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.pwa-head img{width:52px;height:52px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.pwa-head h3{margin:0;font-size:1.2rem;line-height:1.2}
.pwa-head small{color:#666;font-size:.85rem}
.pwa-sheet ol{margin:0 0 18px;padding-left:1.3rem;line-height:1.55;font-size:1rem}
.pwa-sheet li{margin-bottom:.55rem}
.pwa-ico{display:inline-block;background:#e6f0ff;color:#0056b3;border-radius:6px;padding:0 6px;font-weight:700}
.pwa-close{display:block;width:100%;background:#0056b3;color:#fff;border:0;border-radius:999px;padding:12px;font-size:1rem;font-weight:700;cursor:pointer}`;
            document.head.appendChild(st);
        }
        const ov = document.createElement('div');
        ov.className = 'pwa-overlay';
        ov.innerHTML = `<div class="pwa-sheet" role="dialog" aria-modal="true" aria-label="${s.title}">
  <div class="pwa-head"><img src="/icons/icon-192.png" alt=""><div><h3>${s.title}</h3><small>Free · no app store needed</small></div></div>
  <ol>${s.items.map(i => `<li>${i}</li>`).join('')}</ol>
  <button type="button" class="pwa-close">Got it</button></div>`;
        ov.addEventListener('click', e => { if (e.target === ov || e.target.classList.contains('pwa-close')) ov.remove(); });
        // Attached to <html>, not <body>: some pages animate <body>, which would stop position:fixed
        // from covering the screen.
        document.documentElement.appendChild(ov);
    }

    async function install() {
        if (deferredPrompt) {
            const p = deferredPrompt;
            deferredPrompt = null;
            p.prompt();
            try { await p.userChoice; } catch (e) { }
            return;
        }
        showSteps();
    }

    function wire() {
        if (isStandalone()) { hideButtons(); return; }
        document.querySelectorAll('[data-install-app]').forEach(b => {
            b.hidden = false;
            b.addEventListener('click', e => { e.preventDefault(); install(); });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
    window.installSangamApp = install;
})();
