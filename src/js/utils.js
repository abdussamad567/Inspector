export function truncate(str, n) {
    if (!str) return '';
    return (str.length > n) ? str.substr(0, n - 1) + '...' : str;
}

export function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard');
    }).catch(err => {
        console.error('Could not copy text: ', err);
    });
}

export function showToast(message, iconClass = 'ph-fill ph-check-circle') {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toast-msg');
    const icon = toast.querySelector('i');

    if (toast && msg && icon) {
        msg.textContent = message;
        icon.className = iconClass;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

/**
 * Generates a URL for the given state, preserving current routing style (path or query).
 */
export function getUrl(id, localId = null, turn = null, scrollTo = null) {
    try {
        const url = new URL(window.location);
        const path = url.pathname;
        let pathSegments = path.split('/').filter(seg => seg && seg !== 'index.html');

        const idParams = ['remote', 'view', 'id', 'chat', 'remoteId'];
        const localParams = ['local', 'localId', 'h'];
        const allIdParams = [...idParams, ...localParams];
        const posParams = ['turn', 'scrollTo'];

        // 1. Identify existing routing style
        const existingIdParam = idParams.find(p => url.searchParams.has(p));
        const existingLocalParam = localParams.find(p => url.searchParams.has(p));

        let pathIdIndex = -1;
        if (pathSegments.length > 0) {
            const last = pathSegments[pathSegments.length - 1];
            if (last.length > 20 || /^\d+$/.test(last)) {
                pathIdIndex = pathSegments.length - 1;
            }
        }

        // 2. Clear all ID and pos params from search to avoid duplicates
        allIdParams.forEach(p => url.searchParams.delete(p));
        posParams.forEach(p => url.searchParams.delete(p));

        // 3. Apply ID
        const targetId = id || localId;
        if (targetId) {
            const isIdInPath = path.includes(String(targetId));

            if (pathIdIndex !== -1) {
                // Path-based routing: Replace existing ID in path
                pathSegments[pathIdIndex] = targetId;
                url.pathname = '/' + pathSegments.join('/');
            } else if (!isIdInPath) {
                // Not in path, check if we should use a prefix or search param
                const prefixes = ['chat', 'view', 'id', 'local', 'remote'];
                const lastSeg = pathSegments[pathSegments.length - 1];
                if (pathSegments.length > 0 && prefixes.includes(lastSeg)) {
                     pathSegments.push(targetId);
                     url.pathname = '/' + pathSegments.join('/');
                } else {
                    // Query-based routing
                    if (id) {
                        url.searchParams.set(existingIdParam || 'remote', id);
                    } else {
                        let pName = existingLocalParam || 'local';
                        if (pName === 'h') pName = 'local';
                        url.searchParams.set(pName, localId);
                    }
                }
            }
        }

        // 4. Apply Position: Hide if 0
        const t = parseInt(turn);
        const s = parseInt(scrollTo);
        if (!isNaN(t) && t > 0) url.searchParams.set('turn', t);
        if (!isNaN(s) && s > 0) url.searchParams.set('scrollTo', s);

        return url.toString();
    } catch (e) {
        console.error("Failed to generate URL", e);
        return window.location.href;
    }
}

export function updateUrl(id, localId = null, turn = null, scrollTo = null, replace = false) {
    try {
        const newUrl = getUrl(id, localId, turn, scrollTo);
        if (replace) {
            window.history.replaceState({}, '', newUrl);
        } else {
            window.history.pushState({}, '', newUrl);
        }
    } catch (e) {
        console.error("Failed to update URL", e);
    }
}
