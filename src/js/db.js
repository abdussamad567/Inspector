const DB_NAME = 'GeminiInspectorDB';
const DB_VERSION = 2;
const STORE_NAME = 'files';
let db;

export function initDB(onLoadCallback) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains(STORE_NAME)) {
            e.target.result.createObjectStore(STORE_NAME, {
                keyPath: 'id'
            });
        }
    };
    request.onsuccess = (e) => {
        db = e.target.result;
        if (onLoadCallback) onLoadCallback();
    };
    request.onerror = (e) => console.error("DB Error", e);
}

export function saveFileToHistory(fileObj, callback) {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const record = {
        id: fileObj.id || Date.now(),
        name: fileObj.name,
        data: fileObj.data,
        raw: fileObj.raw,
        driveId: fileObj.driveId || null,
        timestamp: Date.now(),
        pinned: fileObj.pinned || false
    };
    store.put(record);
    transaction.oncomplete = () => {
        cleanupHistory();
        if (callback) callback();
    };
}

export function fetchHistory(callback) {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    store.getAll().onsuccess = (e) => {
        const files = e.target.result;
        const pinned = files.filter(f => f.pinned).sort((a, b) => b.timestamp - a.timestamp);
        let unpinned = files.filter(f => !f.pinned).sort((a, b) => b.timestamp - a.timestamp);
        // De-duplicate unpinned by name for display
        const uniqueRecent = unpinned.filter((f, index, self) => index === self.findIndex(t => t.name === f.name));
        callback(uniqueRecent.slice(0, 5), pinned);
    };
}

export function loadLastFileFromDB(callback) {
    if (!db) return;
    const req = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => {
        const files = e.target.result;
        if (files.length > 0) {
            files.sort((a, b) => b.timestamp - a.timestamp);
            callback(files[0]);
        }
    };
}

export function togglePinInDB(file, callback) {
    if (!db) return;
    const tx = db.transaction([STORE_NAME], 'readwrite');
    file.pinned = !file.pinned;
    tx.objectStore(STORE_NAME).put(file);
    tx.oncomplete = callback;
}

export function clearRecentsInDB(callback) {
    if (!db) return;
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.getAll().onsuccess = (e) => {
        e.target.result.forEach(f => {
            if (!f.pinned) store.delete(f.id);
        });
        if (callback) callback();
    };
}

function cleanupHistory() {
    if (!db) return;
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.getAll().onsuccess = (e) => {
        const files = e.target.result;
        let unpinned = files.filter(f => !f.pinned).sort((a, b) => b.timestamp - a.timestamp);

        const seenNames = new Set();
        for (const f of unpinned) {
            if (!seenNames.has(f.name)) seenNames.add(f.name);
            else store.delete(f.id);
        }
        if (unpinned.length > 20) unpinned.slice(20).forEach(f => store.delete(f.id));
    };
}