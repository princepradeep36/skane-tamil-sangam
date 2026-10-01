const API_BASE_URL = '/api';

/**
 * Loads content for the current page from the CMS API.
 * Identifies elements with 'data-cms-key' and updates them.
 */
async function loadPageContent() {
    const pageKey = window.location.pathname.split('/').pop().replace('.html', '') || 'index';

    try {
        const response = await fetch(`${API_BASE_URL}/content/${pageKey}`);
        if (!response.ok) throw new Error('Failed to fetch content');

        const contentMap = await response.json();

        // Find all elements with data-cms-key
        const cmsElements = document.querySelectorAll('[data-cms-key]');

        cmsElements.forEach(el => {
            const key = el.getAttribute('data-cms-key');
            if (contentMap[key]) {
                const { content, type } = contentMap[key];

                if (type === 'image' && el.tagName === 'IMG') {
                    el.src = content;
                } else if (type === 'html') {
                    el.innerHTML = content;
                } else {
                    el.textContent = content;
                }
            }
        });
    } catch (err) {
        console.error('CMS Error:', err);
    }
}

// Auto-load content on DOMContentLoaded
document.addEventListener('DOMContentLoaded', loadPageContent);
