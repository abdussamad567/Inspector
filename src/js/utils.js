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
        const newUrl = new URL(window.location);
        // Clear all possible ID and positioning params to start fresh
        const paramsToRemove = ['id', 'chat', 'view', 'h', 'localId', 'local', 'remoteId', 'turn', 'scrollTo'];
        paramsToRemove.forEach(p => newUrl.searchParams.delete(p));

        if (localId) {
            newUrl.searchParams.set('local', localId);
        } else if (id) {
            // If the ID is purely numeric, it's likely a local IndexedDB ID
            if (/^\d+$/.test(id)) {
                newUrl.searchParams.set('local', id);
            } else {
                newUrl.searchParams.set('view', id);
            }
        }

        if (turn !== null) {
            newUrl.searchParams.set('turn', turn);
        } else if (scrollTo !== null) {
            newUrl.searchParams.set('scrollTo', scrollTo);
        }

        if (replace) {
            window.history.replaceState({}, '', newUrl);
        } else {
            window.history.pushState({}, '', newUrl);
        }
    } catch (e) {
        console.error("Failed to update URL", e);
    }
}