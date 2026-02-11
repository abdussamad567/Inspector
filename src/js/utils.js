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

export function updateUrl(id, localId = null, turn = null, scrollTo = null, replace = false) {
    try {
        const url = new URL(window.location);
        const path = url.pathname;

        const idParams = ['remote', 'view', 'id', 'chat', 'remoteId'];
        const localParams = ['local', 'localId', 'h'];
        const allIdParams = [...idParams, ...localParams];
        const posParams = ['turn', 'scrollTo'];

        // Determine existing parameter names to preserve them
        const existingIdParam = idParams.find(p => url.searchParams.has(p));
        const existingLocalParam = localParams.find(p => url.searchParams.has(p));

        // DRY: Check if ID is already in path
        const isIdInPath = (val) => val && path.includes(String(val));

        // Clear all relevant params first to re-apply correctly
        allIdParams.forEach(p => url.searchParams.delete(p));
        posParams.forEach(p => url.searchParams.delete(p));

        if (id) {
            // Priority 1: Remote ID
            if (!isIdInPath(id)) {
                const paramName = existingIdParam || 'remote';
                url.searchParams.set(paramName, id);
            }
        } else if (localId) {
            // Priority 2: Local ID (only if no remote ID)
            if (!isIdInPath(localId)) {
                let paramName = existingLocalParam || 'local';
                if (paramName === 'h') paramName = 'local'; // Kill legacy 'h'
                url.searchParams.set(paramName, localId);
            }
        }

        // Positioning: Hide if 0
        const t = parseInt(turn);
        const s = parseInt(scrollTo);
        if (!isNaN(t) && t > 0) url.searchParams.set('turn', t);
        if (!isNaN(s) && s > 0) url.searchParams.set('scrollTo', s);

        if (replace) {
            window.history.replaceState({}, '', url);
        } else {
            window.history.pushState({}, '', url);
        }
    } catch (e) {
        console.error("Failed to update URL", e);
    }
}