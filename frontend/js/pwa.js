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

    function ensureStyle() {
        if (document.getElementById('pwa-style')) return;
        {
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
    }

    function showSteps() {
        const s = steps();
        ensureStyle();
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

    /* ---------- App feel: bottom tab bar ---------- */
    // In the installed app (and always on the app home) public pages get a bottom tab bar like a phone app:
    // Home, Event, Food, Game, Me. Admin, vendor, stage-screen and game pages keep their own layout.
    const path = location.pathname.replace(/\/index\.html$/, '/');
    const NO_TABS = /^\/(admin\/|admin-|food\/(admin|vendor|login)|quiz|connection|offline\.html)|-screen\.html$/;
    const GAMES = [
        { kind: 'quiz', url: '/quiz.html', live: ['LOBBY', 'QUESTION', 'RESULT', 'BOARD'] },
        { kind: 'clue', url: '/connection.html?game=clue', live: ['LOBBY', 'PLAYING'] },
        { kind: 'connection', url: '/connection.html', live: ['LOBBY', 'PLAYING'] }
    ];

    function toast(text) {
        let t = document.getElementById('sts-toast');
        if (!t) { t = document.createElement('div'); t.id = 'sts-toast'; t.className = 'sts-toast'; document.documentElement.appendChild(t); }
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
    }

    async function openGame() {
        const found = await Promise.all(GAMES.map(g => fetch(`/food-api/${g.kind}/me`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null).then(s => s && g.live.includes(s.status) ? g : null).catch(() => null)));
        const live = found.find(Boolean);
        if (live) location.href = live.url;
        else toast('No game is running right now. When a game starts on stage, tap Game to join.');
    }

    function tabBar() {
        if (NO_TABS.test(path) || document.getElementById('sts-tabs')) return;
        if (!(isStandalone() || path === '/app.html')) return;
        const st = document.createElement('style');
        st.textContent = `
body{padding-bottom:calc(70px + env(safe-area-inset-bottom)) !important}
.bottom-bar{bottom:calc(64px + env(safe-area-inset-bottom)) !important}
.floating-basket{bottom:calc(150px + env(safe-area-inset-bottom)) !important}
.back-to-top{bottom:calc(84px + env(safe-area-inset-bottom)) !important}
.sts-tabs{position:fixed;left:0;right:0;bottom:0;z-index:1000;display:flex;background:rgba(255,255,255,.96);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid rgba(0,0,0,.08);padding:6px 4px calc(6px + env(safe-area-inset-bottom));font-family:"League Spartan",system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 -4px 18px rgba(0,0,0,.06)}
.sts-tabs a{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;text-decoration:none;color:#7a7a7a;font-size:.72rem;font-weight:600;padding:4px 0;border-radius:12px;-webkit-tap-highlight-color:transparent}
.sts-tabs a .i{font-size:1.35rem;line-height:1.2;filter:grayscale(1);opacity:.75;transition:transform .15s}
.sts-tabs a.on{color:#0056b3}
.sts-tabs a.on .i{filter:none;opacity:1;transform:translateY(-1px) scale(1.08)}
.sts-tabs a:active .i{transform:scale(.9)}
.sts-toast{position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:10000;background:#1f2937;color:#fff;border-radius:14px;padding:12px 16px;font:500 .95rem/1.35 "League Spartan",system-ui,sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transform:translateY(10px);transition:all .2s;pointer-events:none;max-width:480px;margin:0 auto}
.sts-toast.show{opacity:1;transform:none}
@media (min-width:700px){.sts-tabs{left:50%;right:auto;transform:translateX(-50%);width:520px;bottom:12px;border-radius:20px;border:1px solid rgba(0,0,0,.08);padding-bottom:6px}}`;
        document.head.appendChild(st);
        const onMe = path === '/app.html' && location.hash === '#me';
        const tabs = [
            { i: '🏠', t: 'Home', href: '/app.html', on: path === '/app.html' && !onMe },
            { i: '🎟️', t: 'Event', href: (() => { try { return localStorage.getItem('sts_booking') || '/event-registration.html'; } catch (e) { return '/event-registration.html'; } })(), on: /^\/(event-registration|events|sweets)\.html$/.test(path) },
            { i: '🍛', t: 'Food', href: '/food/menu.html', on: /^\/food\/(menu|payment|receipts|index)\.html$/.test(path) || path === '/food/' },
            { i: '🎮', t: 'Game', href: '#', game: true, on: false },
            { i: '👤', t: 'Me', href: '/app.html#me', on: onMe || /^\/(settings|login|join|forgot-password|reset-password)\.html$/.test(path) }
        ];
        const nav = document.createElement('nav');
        nav.id = 'sts-tabs';
        nav.className = 'sts-tabs';
        nav.setAttribute('aria-label', 'App');
        nav.innerHTML = tabs.map(t => `<a href="${t.href}"${t.on ? ' class="on" aria-current="page"' : ''}${t.game ? ' data-game' : ''}><span class="i">${t.i}</span>${t.t}</a>`).join('');
        nav.querySelector('[data-game]').addEventListener('click', e => { e.preventDefault(); openGame(); });
        nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
            nav.querySelectorAll('a').forEach(x => x.classList.toggle('on', x === a && !a.hasAttribute('data-game')));
        }));
        document.body.appendChild(nav);
    }

    /* ---------- Games: Back doesn't throw players out ---------- */
    // Players kept tapping Back (or swiping) by mistake and landed outside the game. On the game pages Back
    // now asks first: "Stay in game" or "Leave". The score is kept either way (the player token is saved).
    function guardGame() {
        if (!/^\/(quiz|connection)\.html$/.test(path)) return;
        const arm = () => { if (!history.state || !history.state.stsGame) history.pushState({ stsGame: 1 }, '', location.href); };
        // Chrome skips history entries made without a tap, so the guard is (re)armed on the player's taps.
        document.addEventListener('pointerdown', arm, true);
        document.addEventListener('keydown', arm, true);
        arm();
        let sheet = null;
        window.addEventListener('popstate', () => {
            if (sheet) return;
            ensureStyle();
            sheet = document.createElement('div');
            sheet.className = 'pwa-overlay';
            sheet.innerHTML = `<div class="pwa-sheet" role="dialog" aria-modal="true" aria-label="Leave the game?">
  <div class="pwa-head"><div style="font-size:2.4rem;line-height:1">🎮</div><div><h3>Leave the game?</h3><small>Your score is kept. You can come back any time.</small></div></div>
  <button type="button" class="pwa-close" data-stay>Stay in game</button>
  <button type="button" class="pwa-close" data-leave style="margin-top:10px;background:#f1f1f1;color:#1a1a1a">Leave game</button></div>`;
            sheet.querySelector('[data-stay]').onclick = () => { arm(); sheet.remove(); sheet = null; };
            sheet.querySelector('[data-leave]').onclick = () => { location.href = '/app.html'; };
            document.documentElement.appendChild(sheet);
        });
    }

    function startShell() { tabBar(); guardGame(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startShell); else startShell();
})();
