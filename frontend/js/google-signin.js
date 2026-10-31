// "Sign in with Google" for Login and Create Account. Shows Google's button in #google-signin
// once the server has a GOOGLE_CLIENT_ID; until then the box stays hidden.
(async function () {
    const box = document.getElementById('google-signin');
    if (!box) return;
    let clientId = null;
    try {
        const res = await fetch('/api/auth/google/config', { cache: 'no-store' });
        if (res.ok) clientId = (await res.json()).clientId;
    } catch (e) { /* no Google sign-in */ }
    if (!clientId) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
        google.accounts.id.initialize({ client_id: clientId, callback: onCredential });
        google.accounts.id.renderButton(document.getElementById('google-signin-button'), {
            theme: 'outline', size: 'large', shape: 'pill', text: box.dataset.text || 'continue_with', width: 320
        });
        box.hidden = false;
    };
    document.head.appendChild(script);

    async function onCredential(response) {
        const msg = document.getElementById('google-signin-msg');
        msg.textContent = 'Signing you in…';
        try {
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Google sign-in failed.');
            // Same session as the email and password login.
            localStorage.setItem('userRole', data.role);
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            msg.textContent = '✓ Signed in. Redirecting…';
            window.location.href = data.role === 'admin' ? 'admin-hub.html' : 'index.html';
        } catch (err) {
            msg.textContent = err.message;
        }
    }
})();
