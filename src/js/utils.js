export function truncate(str, n) {
    if (!str) return '';
    return (str.length > n) ? str.substr(0, n - 1) + '...' : str;
}

export function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    if (toast && toastMsg) {
        toastMsg.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }
}

export function updateUrl(id) {
    try {
        const newUrl = new URL(window.location);
        // Clear old params
        newUrl.searchParams.delete('id');
        newUrl.searchParams.delete('chat');
        
        if (id) {
            newUrl.searchParams.set('view', id);
        } else {
            newUrl.searchParams.delete('view');
        }
        window.history.pushState({}, '', newUrl);
    } catch (e) {
        console.error("Failed to update URL", e);
    }
}