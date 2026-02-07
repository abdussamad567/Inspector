import { initPreferences, prefs, setTheme } from './settings.js';
import { initDB, saveFileToHistory, loadLastFileFromDB, clearRecentsInDB, togglePinInDB, fetchHistory } from './db.js';
import { fetchDriveFile, parseDriveLink, cancelFetch, fetchProxyBlob } from './drive.js';
import { parseConversation, generateMetadataHTML, getCleanJSON, extractMedia } from './parser.js';
import * as UI from './ui.js';
import { updateUrl, showToast, truncate } from './utils.js';

// Application State
const state = {
    parsedData: null,
    currentPrompts: [],
    currentFileName: "Untitled",
    currentFileId: null,
    rawContent: null,
    isScrollMode: false,
    focusIndex: 0,
    isDeepSearch: false,
    extractedMedia: []
};


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initPreferences();
    initDB(() => {
        loadHistory();
        handleInitialLoad();
    });
    setupEventListeners();
    setupThemeLogic();
    UI.setNavigationContext(state, renderChat);
});

function handleInitialLoad() {
    const urlParams = new URLSearchParams(window.location.search);
    let fileId = urlParams.get('view') || urlParams.get('id') || urlParams.get('chat');

    // Hash routing check
    if (!fileId && window.location.hash) {
        let hashVal = window.location.hash.substring(1);
        if (hashVal.startsWith('/')) hashVal = hashVal.substring(1);
        if (/^[a-zA-Z0-9_-]+$/.test(hashVal) && hashVal.length > 20) {
            fileId = hashVal;
        }
    }

    // Path routing check
    if (!fileId) {
        const pathSegments = window.location.pathname.split('/').filter(seg => seg && seg !== 'index.html');
        if (pathSegments.length > 0) {
            const lastSegment = pathSegments[pathSegments.length - 1];
            if (/^[a-zA-Z0-9_-]+$/.test(lastSegment) && lastSegment.length > 20) {
                fileId = lastSegment;
            }
        }
    }

    if (fileId) {
        if (prefs.autoRestoreContent) {
            loadFromDrive(fileId);
        } else {
            UI.showConfirmModal(
                `Do you want to load this file (${truncate(fileId, 15)})?`,
                () => loadFromDrive(fileId),
                () => updateUrl(null)
            );
        }
    } else if (prefs.openLastFileOnStartup) {
        loadLastFileFromDB((fileRecord) => {
            loadFileFromRecord(fileRecord);
        });
    }
}

// --- Data Loading & Processing ---

function handleFile(file) {
    UI.showLoading();
    const reader = new FileReader();
    reader.onload = (e) => handleText(e.target.result, file.name, null);
    reader.readAsText(file);
}

function handleText(text, name, driveId = null) {
    try {
        const result = parseConversation(text);
        state.parsedData = result.data;
        state.currentPrompts = result.prompts;
        state.currentFileName = name;
        state.currentFileId = driveId;
        state.rawContent = text;
        
        saveFileToHistory({
            name,
            data: result.data,
            raw: text,
            driveId: driveId
        }, () => loadHistory());
        
        processAndRender();
        UI.hideLoading();
    } catch (e) {
        console.error(e);
        UI.hideLoading();
        UI.showError("Invalid Content", "The content is not valid JSON.");
    }
}

function loadFileFromRecord(record) {
    UI.showLoading();
    state.currentFileName = record.name;
    state.currentFileId = record.driveId || null;
    state.parsedData = record.data;
    state.rawContent = record.raw || JSON.stringify(record.data, null, 2);
    
    // Re-parse to get prompts structure if not saved
    const result = parseConversation(state.rawContent);
    state.currentPrompts = result.prompts;
    
    processAndRender();
    UI.hideLoading();
}

function loadFromDrive(id) {
    UI.showLoading();
    updateUrl(id);
    state.currentFileId = id;
    fetchDriveFile(id, {
        onSuccess: (text) => handleText(text, `Drive File (${id})`, id),
        onError: (err) => {
            UI.hideLoading();
            if (err.message === "Private File / HTML content") {
                UI.showError("Access Denied", "This file appears to be private.", true, () => loadFromDrive(id), id);
            } else {
                UI.showError("Network Error", "Failed to fetch file. CodeTabs proxy might be down or blocked.", false, () => loadFromDrive(id), id);
            }
        }
    });
}

function processAndRender() {
    UI.updateFilename(state.currentFileName, state.currentFileId);
    document.title = `${state.currentFileName} | Inspector`;
    
    // Metadata
    const meta = generateMetadataHTML(state.parsedData);
    UI.renderMetadata(meta);
    
    // Extract Media
    state.extractedMedia = extractMedia(state.parsedData);
    UI.showMediaButton(state.extractedMedia.length > 0);
    
    // Sidebar
    UI.populateSidebar(state.currentPrompts, (index) => handlePromptClick(index));
    
    // Show main UI elements
    document.getElementById('downloadGroup').classList.remove('hidden');
    document.getElementById('exportGroup').classList.remove('hidden');
    document.getElementById('nav-widget').classList.remove('hidden');

    // Render first turn
    if (state.currentPrompts.length > 0) {
        renderChat(0);
    } else {
        UI.renderFullConversation(state.parsedData, []);
    }
}

function handlePromptClick(index) {
    if (prefs.isScrollMode) {
        // Scroll logic handled by UI helper or implementation details
        const target = document.getElementById(`msg-user-${index}`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            UI.setActiveSidebarItem(index);
        } else {
            // If in scroll mode but not rendered (e.g. switch just happened), render full
            renderCompleteDialog();
            setTimeout(() => handlePromptClick(index), 100);
        }
    } else {
        renderChat(index);
    }
    if (window.innerWidth <= 768) UI.toggleSidebar();
}

function renderChat(index) {
    state.focusIndex = index;
    UI.renderConversation(state.parsedData, index, state.currentPrompts);
}

function renderCompleteDialog() {
    UI.renderFullConversation(state.parsedData, state.currentPrompts);
}

// --- Sidebar & History ---

function loadHistory() {
    fetchHistory((recent, pinned) => {
        UI.renderHistoryLists(recent, pinned, {
            onLoad: (file) => {
                updateUrl(null);
                loadFileFromRecord(file);
            },
            onTogglePin: (file) => {
                togglePinInDB(file, () => loadHistory());
            }
        });
    });
}

function performSearch(term) {
    term = term.toLowerCase();
    if (!term) {
        document.querySelectorAll('.prompt-item').forEach(item => item.style.display = 'block');
        return;
    }

    let matchingIndices;
    if (state.isDeepSearch) {
        matchingIndices = new Set();
        if (!state.parsedData || !state.currentPrompts) return;
        state.currentPrompts.forEach((prompt, promptIndex) => {
            let found = false;
            if (prompt.text && prompt.text.toLowerCase().includes(term)) {
                matchingIndices.add(promptIndex);
                found = true;
            }
            if (!found) {
                for (let i = prompt.originalIndex + 1; i < state.parsedData.chunkedPrompt.chunks.length; i++) {
                    const chunk = state.parsedData.chunkedPrompt.chunks[i];
                    if (chunk.role === 'user') break;
                    if (chunk.role === 'model' && chunk.text && chunk.text.toLowerCase().includes(term)) {
                        matchingIndices.add(promptIndex);
                        break;
                    }
                }
            }
        });
    }

    document.querySelectorAll('.prompt-item').forEach(item => {
        const index = parseInt(item.dataset.index);
        const isVisible = state.isDeepSearch ? matchingIndices.has(index) : item.title.toLowerCase().includes(term);
        item.style.display = isVisible ? 'block' : 'none';
    });
}

// --- Event Listeners Setup ---

function setupEventListeners() {
    // File Inputs
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', (e) => {
        if(e.target.files[0]) {
            updateUrl(null);
            handleFile(e.target.files[0]);
        }
    });

    // Drag & Drop
    window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.style.opacity = '0.5'; });
    window.addEventListener('dragleave', () => document.body.style.opacity = '1');
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        document.body.style.opacity = '1';
        if (e.dataTransfer.files.length > 0) {
            updateUrl(null);
            handleFile(e.dataTransfer.files[0]);
        }
    });

    // Paste
    window.addEventListener('paste', async (e) => {
        if (!state.parsedData && e.clipboardData) {
            e.preventDefault();
            const text = e.clipboardData.getData('text');
            handlePaste(text);
        }
    });
    
    document.getElementById('pasteBtn').addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            handlePaste(text);
        } catch (err) {
            UI.showError("Clipboard Error", "Could not access clipboard content. Please try using Ctrl+V or check permissions.");
        }
    });

    function handlePaste(text) {
        const trimmed = text.trim();
        if (trimmed.includes('aistudio.google.com') || trimmed.includes('/prompts/') || trimmed.includes('/file/d/')) {
            const id = parseDriveLink(trimmed);
            if(id) loadFromDrive(id);
            else UI.showError("Link Error", "Could not parse ID from link.");
        } else {
            updateUrl(null);
            handleText(trimmed, "Pasted content", null);
        }
    }

    // Export / Download
    document.getElementById('downloadBtn').addEventListener('click', () => {
        if (!state.rawContent) return;
        downloadString(state.rawContent, state.currentFileName, 'application/json');
    });

    document.getElementById('mediaGalleryBtn').addEventListener('click', () => {
        if (!state.extractedMedia || state.extractedMedia.length === 0) return;
        UI.renderMediaGallery(state.extractedMedia, handleBulkDownload);
    });

    // Event listener for Tooltip Download Media button
    document.addEventListener('download-message-media', (e) => {
        const chunks = e.detail.chunks;
        // Mock a parsedData structure for the extractor
        const tempMedia = extractMedia({ chunkedPrompt: { chunks: chunks } });
        if(tempMedia.length > 0) {
            handleBulkDownload(tempMedia, (pct) => {
               if(pct === 0) UI.showToast("Zipping media...");
               if(pct === 100) UI.showToast("Download started");
            });
        }
    });

    document.getElementById('copyOriginalBtn').addEventListener('click', () => {
        if (state.rawContent) {
            navigator.clipboard.writeText(state.rawContent).then(() => showToast("Original JSON copied"));
        }
    });

    document.getElementById('exportBtn').addEventListener('click', () => {
        const clean = getCleanJSON(state.parsedData);
        if (clean) downloadString(JSON.stringify(clean, null, 2), `CLEAN_${state.currentFileName}`, 'application/json');
    });

    document.getElementById('copyCleanBtn').addEventListener('click', () => {
        const clean = getCleanJSON(state.parsedData);
        if (clean) {
            navigator.clipboard.writeText(JSON.stringify(clean, null, 2)).then(() => showToast("Copied JSON to clipboard"));
        }
    });

    // Drive Link Input
    const linkBtn = document.getElementById('linkBtn');
    const linkPopover = document.getElementById('link-popover');
    linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        linkPopover.classList.toggle('hidden');
        if (!linkPopover.classList.contains('hidden')) document.getElementById('driveLinkInput').focus();
    });
    
    document.getElementById('driveLoadBtn').addEventListener('click', () => {
        const val = document.getElementById('driveLinkInput').value;
        const id = parseDriveLink(val);
        if (id) {
            linkPopover.classList.add('hidden');
            loadFromDrive(id);
        } else {
            document.getElementById('drive-error-msg').classList.remove('hidden');
        }
    });

    // Sidebar & Settings
    document.getElementById('sidebar-toggle-btn').addEventListener('click', UI.toggleSidebar);
    document.getElementById('sidebar-close-btn').addEventListener('click', UI.toggleSidebar);
    document.getElementById('sidebar-overlay').addEventListener('click', UI.toggleSidebar);

    document.getElementById('deepSearchToggle').addEventListener('click', function() {
        state.isDeepSearch = !state.isDeepSearch;
        this.classList.toggle('active', state.isDeepSearch);
        document.getElementById('searchPrompts').placeholder = state.isDeepSearch ? 'Search all content...' : 'Search prompts...';
        performSearch(document.getElementById('searchPrompts').value);
    });

    document.getElementById('searchPrompts').addEventListener('input', (e) => performSearch(e.target.value));
    
    document.getElementById('clearRecentsBtn').addEventListener('click', () => {
        clearRecentsInDB(() => loadHistory());
    });
    
    // View Modes
    document.getElementById('sidebarModeToggle').addEventListener('change', (e) => {
        prefs.isScrollMode = e.target.checked;
        // Don't save strictly to localstorage here if it's per-session, but original did specific logic
        if (!state.parsedData) return;
        UI.showLoading();
        setTimeout(() => {
            if (prefs.isScrollMode) renderCompleteDialog();
            else renderChat(state.focusIndex);
            UI.hideLoading();
        }, 50);
    });

    document.getElementById('thinkingModeToggle').addEventListener('change', (e) => {
        prefs.collapseThoughts = !e.target.checked;
        localStorage.setItem('collapseThoughts', JSON.stringify(prefs.collapseThoughts));
        if (!state.parsedData) return;
        
        UI.showLoading();
        setTimeout(() => {
            try {
                if (prefs.isScrollMode) {
                    renderCompleteDialog();
                } else if (state.focusIndex > -1) {
                    renderChat(state.focusIndex);
                }
            } catch (err) {
                console.error("Error re-rendering for thinking mode:", err);
            } finally {
                UI.hideLoading();
            }
        }, 50);
    });

    document.getElementById('cancel-processing-btn').addEventListener('click', () => {
        cancelFetch();
        window.location.reload();
    });
}

function setupThemeLogic() {
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        setTheme(current === 'dark' ? 'light' : 'dark');
        // Icon update logic handled in settings or UI helper, but for now:
        const icon = document.querySelector('#theme-toggle i');
        const text = document.querySelector('#theme-toggle span');
        if (current !== 'dark') { // switching to dark
            icon.className = 'ph-fill ph-sun';
            text.textContent = 'Light Mode';
        } else {
            icon.className = 'ph-fill ph-moon';
            text.textContent = 'Dark Mode';
        }
    });
}

// --- Bulk Download Logic ---
async function handleBulkDownload(mediaItems, onProgress) {
    /* global JSZip */
    if (typeof JSZip === 'undefined') {
        UI.showError("Missing Library", "JSZip library not loaded. Please refresh.");
        return;
    }

    const zip = new JSZip();
    const folder = zip.folder("media");
    
    let processedCount = 0;
    const total = mediaItems.length;
    
    const updateProgress = () => {
        processedCount++;
        if(onProgress) onProgress((processedCount / total) * 50); // First 50% is fetching
    };

    const promises = mediaItems.map(async (item, i) => {
        const filename = `${item.role}_${item.index}_${i}.${item.ext}`;
        
        try {
            if (item.type === 'inline') {
                folder.file(filename, item.data, { base64: true });
            } else if (item.type === 'drive') {
                const url = `https://drive.google.com/uc?export=download&id=${item.id}`;
                const blob = await fetchProxyBlob(url);
                folder.file(filename, blob);
            }
        } catch (e) {
            console.error(`Failed to zip ${filename}`, e);
            folder.file(`${filename}.error.txt`, `Failed to fetch: ${e.message}`);
        } finally {
            updateProgress();
        }
    });

    await Promise.all(promises);

    const content = await zip.generateAsync({ type: "blob" }, (metadata) => {
        if(onProgress) onProgress(50 + (metadata.percent / 2));
    });
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `Media_${state.currentFileName}_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if(onProgress) onProgress(100);
}

function downloadString(content, filename, contentType) {
    const a = document.createElement('a');
    const blob = new Blob([content], {type: contentType});
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}