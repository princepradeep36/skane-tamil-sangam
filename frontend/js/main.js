document.addEventListener('DOMContentLoaded', () => {
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
    const updateNavbar = () => {
        if (!navLinks) return;
        const user = JSON.parse(localStorage.getItem('user'));
        const userRole = localStorage.getItem('userRole');
        const loginLink = Array.from(navLinks.querySelectorAll('a'))
            .find(a => a.getAttribute('href') === 'login.html');
        const joinBtn = navLinks.querySelector('.btn-secondary');

        if (user && loginLink) {
            const loginLi = loginLink.parentElement;
            const joinLi = joinBtn ? joinBtn.parentElement : null;

            loginLi.innerHTML = userRole === 'admin'
                ? `<a href="admin-hub.html" class="nav-link">Dashboard</a>`
                : `<a href="settings.html" class="nav-link">My Profile</a>`;

            const logoutBtn = document.createElement('button');
            logoutBtn.className = 'btn btn-outline';
            logoutBtn.style.cssText = 'padding: 0.6rem 1.25rem; font-size: 0.9rem;';
            logoutBtn.textContent = 'Logout';
            logoutBtn.onclick = () => {
                localStorage.clear();
                window.location.href = 'index.html';
            };

            if (joinLi) {
                joinLi.innerHTML = '';
                joinLi.appendChild(logoutBtn);
            } else {
                const newLi = document.createElement('li');
                newLi.appendChild(logoutBtn);
                navLinks.appendChild(newLi);
            }
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
