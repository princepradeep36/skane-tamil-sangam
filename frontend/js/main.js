document.addEventListener('DOMContentLoaded', () => {
  // Year labels (footer and [data-year]) follow the server's clock, so they never need editing.
  // The phone's own year shows first; the server's year (from its Date header) replaces it a moment later.
  const showYear = y => {
    document.querySelectorAll('.copyright').forEach(el => { el.innerHTML = el.innerHTML.replace(/© \d{4}/, '© ' + y); });
    document.querySelectorAll('[data-year]').forEach(el => { el.textContent = y; });
  };
  showYear(new Date().getFullYear());
  fetch(location.pathname, { method: 'HEAD', cache: 'no-store' })
    .then(r => { const y = new Date(r.headers.get('Date')).getFullYear(); if (y > 2000) showYear(y); })
    .catch(() => {});
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    const navbar = document.querySelector('.navbar');

    // ─── Mobile Menu ─────────────────────────────────────────
    if (mobileBtn && navLinks) {
        mobileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navLinks.classList.toggle('active');
            mobileBtn.textContent = navLinks.classList.contains('active') ? '✕' : '☰';
        });

        document.addEventListener('click', (e) => {
            if (navLinks.classList.contains('active') &&
                !navLinks.contains(e.target) &&
                e.target !== mobileBtn) {
                navLinks.classList.remove('active');
                mobileBtn.textContent = '☰';
            }
        });

        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                mobileBtn.textContent = '☰';
            });
        });
    }

    // ─── Login State Aware Navigation ────────────────────────
    // Every page's menu ends with the account links: "Log in" + "Join" when logged out, "My Sangam" +
    // "Log out" for members, and "Admin" for admins, staff and vendors (Click2Eat login, this tab only).
    const updateNavbar = () => {
        if (!navLinks) return;
        let user = null;
        try { user = JSON.parse(localStorage.getItem('user')); } catch (e) { }
        const userRole = localStorage.getItem('userRole');
        const staffRole = sessionStorage.getItem('user_role');
        const staffToken = sessionStorage.getItem('auth_token');
        // Remove any account links already in the page's markup, then add the right ones.
        navLinks.querySelectorAll('a[href="login.html"], a[href="join.html"], a[href="settings.html"], a[href="admin-hub.html"]').forEach(a => {
            if (!a.closest('.nav-links > li')) return;
            if (a.classList.contains('active')) return; // keep the current page's own link
            a.closest('li').remove();
        });
        const here = location.pathname.split('/').pop();
        const add = html => { const li = document.createElement('li'); li.className = 'nav-account'; li.innerHTML = html; navLinks.appendChild(li); return li; };
        const btnStyle = 'padding: 0.6rem 1.25rem; font-size: 0.9rem;';
        if (staffToken && staffRole) {
            const href = staffRole === 'vendor' ? `food/vendor.html?vendor_id=${encodeURIComponent(sessionStorage.getItem('vendor_id') || '')}` : 'food/admin.html?admin=true';
            add(`<a href="${href}" class="nav-link">${staffRole === 'vendor' ? 'Vendor' : 'Admin'}</a>`);
        }
        if (user) {
            add(userRole === 'admin' ? `<a href="admin-hub.html" class="nav-link">Dashboard</a>` : `<a href="app.html" class="nav-link">My Sangam</a>`);
            const li = add(`<button class="btn btn-outline" style="${btnStyle}">Log out</button>`);
            li.querySelector('button').onclick = () => {
                ['authToken', 'userRole', 'user', 'sts_booking', 'sts_guest'].forEach(k => localStorage.removeItem(k));
                window.location.href = 'index.html';
            };
        } else if (!(staffToken && staffRole)) {
            if (here !== 'login.html') add(`<a href="login.html" class="nav-link">Log in</a>`);
            if (here !== 'join.html') add(`<a href="join.html" class="btn btn-secondary" style="${btnStyle}">Join</a>`);
        }
    };

    if (navLinks) updateNavbar();

    // ─── Navbar Scroll Effect ─────────────────────────────────
    if (navbar) {
        window.addEventListener('scroll', () => {
            navbar.classList.toggle('scrolled', window.scrollY > 50);
        });
    }

    // ─── Back to Top Button ───────────────────────────────────
    const backToTop = document.getElementById('back-to-top');
    if (backToTop) {
        window.addEventListener('scroll', () => {
            backToTop.classList.toggle('visible', window.scrollY > 300);
        });
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ─── Animated Stat Counters ───────────────────────────────
    const statNumbers = document.querySelectorAll('.stat-number[data-target]');
    if (statNumbers.length > 0) {
        const animateCounter = (el) => {
            const target = +el.dataset.target;
            const suffix = '+';
            const duration = 1800;
            const step = Math.ceil(target / (duration / 16));
            let current = 0;

            // Clear target attribute so we don't re-animate
            el.removeAttribute('data-target');

            const tick = () => {
                current = Math.min(current + step, target);
                el.textContent = current + suffix;
                if (current < target) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && entry.target.dataset.target) {
                    animateCounter(entry.target);
                }
            });
        }, { threshold: 0.5 });

        statNumbers.forEach(el => observer.observe(el));
    }
});
