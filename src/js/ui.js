/* global marked, DOMPurify, hljs */
import { prefs, CODE_THEMES } from './settings.js';
import { truncate, showToast } from './utils.js';
import { fetchProxyContent } from './drive.js';

let themePreviewTimeout = null;
let lastPreviewedTheme = null;
let previewShadowRoot = null;
let previewLang = "javascript";

const PREVIEW_CODE_SAMPLES = {
    javascript: `function greet(name) {\n  const message = \`Hello, \${name}!\`;\n  // A simple comment\n  return message;\n}\n\nconsole.log(greet("Inspector"));`,
    python: `import math\n\ndef calculate_area(radius):\n    """Calculates the area of a circle."""\n    return math.pi * radius ** 2\n\n# Calculate and print\nprint(f"Area: {calculate_area(5):.2f}")`,
    json: `{\n  "model": "gemini-1.5-pro",\n  "temperature": 0.7,\n  "safe": true\n}`
};

// --- DOM Elements ---
const els = {
    chatStream: document.getElementById('chat-stream'),
    scrollContainer: document.getElementById('scroll-container'),
    loading: document.getElementById('loading-overlay'),
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    filenameDisplay: document.getElementById('filename-display'),
    
    // History
    recentList: document.getElementById('recent-files-list'),
    pinnedList: document.getElementById('pinned-files-list'),
    historySection: document.getElementById('history-section'),
    
    // Metadata
    metaPanel: document.getElementById('metadata-panel'),
    metaBody: document.getElementById('metadata-body'),
    collapseBtn: document.querySelector('.collapse-btn'),
    
    // Modals
    imageModal: document.getElementById('image-modal'),
    modalImg: document.getElementById('modal-img'),
    textViewerModal: document.getElementById('text-viewer-modal'),
    textViewerCode: document.getElementById('text-viewer-code'),
    errorModal: document.getElementById('error-modal'),
    confirmModal: document.getElementById('confirm-modal')
};

// --- Initialization & Settings Controls ---
document.addEventListener('DOMContentLoaded', () => {
    try {
        initSettingsUI();
        initHistoryUI();
        initNavUI();
        initCodeThemeUI();
        initModals();
    } catch (e) {
        console.error("Critical Initialization Error:", e);
    }
});

function initSettingsUI() {
    // Width Slider
    const widthSlider = document.getElementById('widthSlider');
    if (widthSlider) {
        widthSlider.value = prefs.contentWidth;
        widthSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            document.documentElement.style.setProperty('--content-width', `${val}px`);
            localStorage.setItem('contentWidth', val);
        });
    }

    // --- Toggles ---
    
    // Helper for simple boolean toggles
    const setupSimpleToggle = (id, prefKey, onChange) => {
        const el = document.getElementById(id);
        if (!el) return; // Prevent crash if element is missing
        
        el.checked = prefs[prefKey];
        el.addEventListener('change', (e) => {
            prefs[prefKey] = e.target.checked;
            localStorage.setItem(prefKey, JSON.stringify(e.target.checked));
            if(onChange) onChange(e.target.checked);
        });
    };

    // Auto Restore
    setupSimpleToggle('autoRestoreToggle', 'openLastFileOnStartup');
    // Note: The HTML only has 'autoRestoreToggle', but original code bound 'autoRestoreContent' to the same or a missing one.
    // If 'autoRestoreContent' ID doesn't exist, we skip binding to prevent crash.
    setupSimpleToggle('autoRestoreContent', 'autoRestoreContent');

    // Thinking Mode (Inverted Logic)
    const thinkingToggle = document.getElementById('thinkingModeToggle');
    if (thinkingToggle) {
        thinkingToggle.checked = !prefs.collapseThoughts; 
        thinkingToggle.addEventListener('change', (e) => {
            prefs.collapseThoughts = !e.target.checked;
            localStorage.setItem('collapseThoughts', JSON.stringify(prefs.collapseThoughts));
        });
    }

    // Metadata Toggle (Inverted Logic)
    const metaToggle = document.getElementById('metadataCollapseToggle');
    if (metaToggle) {
        metaToggle.checked = !prefs.collapseMetadataByDefault;
        metaToggle.addEventListener('change', (e) => {
            prefs.collapseMetadataByDefault = !e.target.checked;
            localStorage.setItem('collapseMetadata', JSON.stringify(prefs.collapseMetadataByDefault));
            
            // Apply immediately
            els.metaBody.classList.toggle('collapsed', prefs.collapseMetadataByDefault);
            const icon = els.collapseBtn.querySelector('i');
            if (icon) icon.className = prefs.collapseMetadataByDefault ? 'ph ph-caret-down' : 'ph ph-caret-up';
        });
    }

    // Code State Persistence
    setupSimpleToggle('codePersistenceToggle', 'preserveCodeState', (checked) => {
        if (!checked) {
            const currentFile = els.filenameDisplay.textContent;
            if (currentFile && currentFile !== 'No file loaded') {
                localStorage.removeItem(`code_states_${currentFile}`);
            }
        }
    });

    setupSimpleToggle('scrollableCodeToggle', 'isScrollableCode', (checked) => {
        document.body.classList.toggle('scrollable-codeblocks', checked);
    });

    setupSimpleToggle('wrapCodeToggle', 'isWrapCode', (checked) => {
        document.body.classList.toggle('wrap-codeblocks', checked);
    });

    // Toggle All Code Action
    const toggleCodeBtn = document.getElementById('toggleAllCodeAction');
    if (toggleCodeBtn) {
        toggleCodeBtn.addEventListener('click', () => {
            const wrappers = document.querySelectorAll('.code-block-wrapper');
            if (wrappers.length === 0) return;
            const anyExpanded = Array.from(wrappers).some(w => !w.classList.contains('collapsed'));
            
            wrappers.forEach(w => {
                const shouldCollapse = anyExpanded;
                w.classList.toggle('collapsed', shouldCollapse);
                const icon = w.querySelector('.collapse-code-btn i');
                if (icon) icon.className = shouldCollapse ? 'ph ph-caret-right' : 'ph ph-caret-down';
                
                if (prefs.preserveCodeState && w.dataset.blockId) {
                    const filename = els.filenameDisplay.textContent;
                    const key = `code_states_${filename}`;
                    let states = JSON.parse(localStorage.getItem(key) || '{}');
                    states[w.dataset.blockId] = shouldCollapse;
                    localStorage.setItem(key, JSON.stringify(states));
                }
            });
        });
    }
}

function initHistoryUI() {
    const miniTabs = document.querySelectorAll('.mini-tab');
    const historyViews = document.querySelectorAll('.history-view');
    
    miniTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            miniTabs.forEach(t => t.classList.remove('active'));
            historyViews.forEach(v => v.classList.remove('active'));
            
            tab.classList.add('active');
            const targetId = `view-${tab.dataset.target}`;
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.classList.add('active');
        });
    });
}

function initNavUI() {
    // Scroll Widget
    const btnTop = document.getElementById('scroll-top');
    const btnBottom = document.getElementById('scroll-bottom');
    const btnNext = document.getElementById('scroll-next');
    const btnPrev = document.getElementById('scroll-prev');
    
    if(btnTop) btnTop.addEventListener('click', () => els.scrollContainer.scrollTo({ top: 0, behavior: 'smooth' }));
    if(btnBottom) btnBottom.addEventListener('click', () => els.scrollContainer.scrollTo({ top: els.scrollContainer.scrollHeight, behavior: 'smooth' }));
    
    if(btnNext) btnNext.addEventListener('click', () => navigateMessages(1));
    if(btnPrev) btnPrev.addEventListener('click', () => navigateMessages(-1));
}

let _appState;
let _renderConversation;

export function setNavigationContext(state, renderConversation) {
    _appState = state;
    _renderConversation = renderConversation;
}

function navigateMessages(direction) {
    if (!_appState.parsedData) return;
    const messages = Array.from(document.querySelectorAll('.message'));
    if (messages.length === 0) return;

    const containerTop = els.scrollContainer.scrollTop;
    let currentIndex = -1;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].offsetTop >= containerTop - 20) {
            currentIndex = i;
            break;
        }
    }
    if (currentIndex === -1) currentIndex = messages.length - 1;

    let nextIndex = currentIndex + direction;

    if (nextIndex >= 0 && nextIndex < messages.length) {
        const targetMsg = messages[nextIndex];
        const isModel = targetMsg.classList.contains('role-model') && !targetMsg.classList.contains('thought-message');
        if (isModel && nextIndex > 0) {
            const prevMsg = messages[nextIndex - 1];
            if (prevMsg?.classList.contains('thought-message') && prevMsg.classList.contains('collapsed')) {
                nextIndex += direction;
            }
        }
    }

    if (prefs.isScrollMode) {
        if (nextIndex < 0) nextIndex = 0;
        if (nextIndex >= messages.length) nextIndex = messages.length - 1;
        messages[nextIndex].scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    } else {
        if (nextIndex < 0) {
            if (_appState.focusIndex > 0) {
                _renderConversation(_appState.focusIndex - 1);
                setTimeout(() => els.scrollContainer.scrollTo({
                    top: els.scrollContainer.scrollHeight,
                    behavior: 'auto'
                }), 20);
            }
        } else if (nextIndex >= messages.length) {
            if (_appState.focusIndex < _appState.currentPrompts.length - 1) {
                _renderConversation(_appState.focusIndex + 1);
            }
        } else {
            messages[nextIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }
}

function initCodeThemeUI() {
    const wrapper = document.getElementById('codeThemeWrapper');
    const options = document.getElementById('codeThemeOptions');
    const currentNameEl = document.getElementById('currentThemeName');
    const trigger = document.getElementById('codeThemeTrigger');
    const previewContainer = document.getElementById('theme-preview-container');
    const mainStylesheet = document.getElementById('highlight-stylesheet');

    if (!wrapper || !options || !currentNameEl || !previewContainer) return;

    function applyCodeTheme(themeValue) {
        prefs.codeTheme = themeValue;
        const themeObj = CODE_THEMES.find(t => t.value === themeValue);
        if (themeObj) currentNameEl.textContent = themeObj.name;

        mainStylesheet.href = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${themeValue}.min.css`;
        localStorage.setItem('codeTheme', themeValue);

        Array.from(options.children).forEach(child => {
            child.classList.toggle('selected', child.dataset.value === themeValue);
        });
    }

    function hideThemePreview() {
        previewContainer.classList.remove('visible');
        setTimeout(() => {
            if (!previewContainer.classList.contains('visible')) {
                previewContainer.classList.add('hidden');
                lastPreviewedTheme = null; // Reset for next time
            }
        }, 200);
    }

    function showThemePreview(themeValue) {
        clearTimeout(themePreviewTimeout);

        if (lastPreviewedTheme === themeValue && previewContainer.classList.contains('visible')) return;
        lastPreviewedTheme = themeValue;

        const rect = wrapper.getBoundingClientRect();
        previewContainer.style.top = `${rect.top}px`;
        previewContainer.style.left = `${rect.right + 12}px`;

        const styleUrl = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${themeValue}.min.css`;

        const dropdownCss = `
            .lang-select-wrapper { position: relative; margin-top: 8px; user-select: none; }
            .lang-select-trigger { background: var(--bg-surface, #fff); color: var(--text-main, #000); border: 1px solid var(--border-subtle, #ccc); border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
            .lang-options { display: none; position: absolute; top: 100%; left: 0; width: 100%; background: var(--bg-surface, #fff); border: 1px solid var(--border-subtle, #ccc); border-radius: 4px; z-index: 10; margin-top: 2px; }
            .lang-options.open { display: block; }
            .lang-option { padding: 4px 8px; cursor: pointer; }
            .lang-option:hover { background: rgba(0,0,0,0.05); }
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #888; border-radius: 4px; }
            pre.wrapped { white-space: pre-wrap; word-wrap: break-word; }
        `;

        previewShadowRoot.innerHTML = `
            <link rel="stylesheet" href="${styleUrl}">
            <style>
                :host { display: block; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
                .preview-box { border-radius: 6px; overflow: hidden; background: var(--bg-code, #1e293b); }
                pre { margin: 0; padding: 10px; }
                code.hljs { padding: 0; background: transparent; }
                ${dropdownCss}
            </style>
            <div class="preview-box">
                <pre class="${prefs.isWrapCode ? 'wrapped' : ''}"><code class="hljs language-${previewLang}"></code></pre>
            </div>
            <div class="lang-select-wrapper">
                <div class="lang-select-trigger">
                    <span>${previewLang.charAt(0).toUpperCase() + previewLang.slice(1)}</span>
                    <span>▼</span>
                </div>
                <div class="lang-options">
                    <div class="lang-option" data-val="javascript">JavaScript</div>
                    <div class="lang-option" data-val="python">Python</div>
                    <div class="lang-option" data-val="json">JSON</div>
                </div>
            </div>
        `;

        const codeBlock = previewShadowRoot.querySelector('code');
        codeBlock.textContent = PREVIEW_CODE_SAMPLES[previewLang];
        hljs.highlightElement(codeBlock);

        const langTrigger = previewShadowRoot.querySelector('.lang-select-trigger');
        const langOptions = previewShadowRoot.querySelector('.lang-options');
        langTrigger.addEventListener('click', () => langOptions.classList.toggle('open'));

        previewShadowRoot.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                previewLang = e.target.dataset.val;
                lastPreviewedTheme = null; // Force refresh
                showThemePreview(themeValue);
            });
        });

        previewContainer.classList.remove('hidden');
        requestAnimationFrame(() => previewContainer.classList.add('visible'));
    }
    
    // --- Setup ---
    options.innerHTML = '';
    const initial = CODE_THEMES.find(t => t.value === prefs.codeTheme);
    if(initial) currentNameEl.textContent = initial.name;

    CODE_THEMES.forEach(t => {
        const div = document.createElement('div');
        div.className = 'custom-option';
        div.textContent = t.name;
        div.dataset.value = t.value;
        if (t.value === prefs.codeTheme) div.classList.add('selected');

        div.addEventListener('click', () => applyCodeTheme(t.value));
        div.addEventListener('mouseenter', () => showThemePreview(t.value));
        
        options.appendChild(div);
    });

    if (!previewShadowRoot) {
        previewShadowRoot = previewContainer.attachShadow({ mode: 'open' });
    }

    wrapper.addEventListener('mouseenter', () => clearTimeout(themePreviewTimeout));
    previewContainer.addEventListener('mouseenter', () => clearTimeout(themePreviewTimeout));
    wrapper.addEventListener('mouseleave', () => themePreviewTimeout = setTimeout(hideThemePreview, 300));
    previewContainer.addEventListener('mouseleave', () => themePreviewTimeout = setTimeout(hideThemePreview, 300));

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.toggle('open');
        if (isOpen) {
            const selected = options.querySelector('.selected');
            if (selected) showThemePreview(selected.dataset.value);
        } else {
            hideThemePreview();
        }
    });

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target) && !previewContainer.contains(e.target) && !previewContainer.contains(e.target)) {
            wrapper.classList.remove('open');
            hideThemePreview();
        }
    });
}

function initModals() {
    // Image Modal
    const closeImgBtn = document.getElementById('close-image-modal-btn');
    if (closeImgBtn) closeImgBtn.addEventListener('click', () => els.imageModal.classList.add('hidden'));
    
    if(els.imageModal) {
        els.imageModal.addEventListener('click', (e) => {
            if(e.target === els.imageModal) els.imageModal.classList.add('hidden');
        });
    }

    const downloadImgBtn = document.getElementById('download-image-btn');
    if (downloadImgBtn) {
        downloadImgBtn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = els.modalImg.src;
            a.download = `image_${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }

    // Text Viewer Modal
    const closeTextBtn = document.getElementById('close-text-viewer-btn');
    if (closeTextBtn) closeTextBtn.addEventListener('click', () => els.textViewerModal.classList.add('hidden'));
    
    if (els.textViewerModal) {
        els.textViewerModal.addEventListener('click', (e) => {
            if(e.target === els.textViewerModal) els.textViewerModal.classList.add('hidden');
        });
    }

    const copyTextBtn = document.getElementById('copy-viewer-btn');
    if (copyTextBtn) {
        copyTextBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(els.textViewerCode.textContent).then(() => showToast("Copied to clipboard"));
        });
    }

    // Error Modal
    const closeErrorBtn = document.getElementById('close-error-btn');
    if(closeErrorBtn) closeErrorBtn.addEventListener('click', () => els.errorModal.classList.add('hidden'));
    
    if(els.errorModal) {
        els.errorModal.addEventListener('click', (e) => {
            if(e.target === els.errorModal) els.errorModal.classList.add('hidden');
        });
    }

    // Confirm Modal
    const cancelConfirmBtn = document.getElementById('confirm-cancel-btn');
    if(cancelConfirmBtn) cancelConfirmBtn.addEventListener('click', () => els.confirmModal.classList.add('hidden'));
    
    if(els.confirmModal) {
        els.confirmModal.addEventListener('click', (e) => {
            if(e.target === els.confirmModal) els.confirmModal.classList.add('hidden');
        });
    }
    
    // Metadata Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            
            const target = document.getElementById(btn.dataset.tab);
            if(target) target.classList.add('active');
            
            if(els.metaBody.classList.contains('collapsed')) {
                els.metaBody.classList.remove('collapsed');
                els.collapseBtn.querySelector('i').className = 'ph ph-caret-up';
            }
        });
    });
    
    if (els.collapseBtn) {
        els.collapseBtn.addEventListener('click', () => {
            els.metaBody.classList.toggle('collapsed');
            const icon = els.collapseBtn.querySelector('i');
            icon.className = els.metaBody.classList.contains('collapsed') ? 'ph ph-caret-down' : 'ph ph-caret-up';
        });
    }
    
    // Metadata Header Click to Toggle
    const metaHeader = document.getElementById('metadata-header');
    if (metaHeader) {
        metaHeader.addEventListener('click', (e) => {
            if (e.target.closest('.tab-btn')) return;
            els.metaBody.classList.toggle('collapsed');
            const icon = els.collapseBtn.querySelector('i');
            icon.className = els.metaBody.classList.contains('collapsed') ? 'ph ph-caret-down' : 'ph ph-caret-up';
        });
    }
}

// --- Main UI Exported Functions ---

export function showLoading() { els.loading.classList.remove('hidden'); }
export function hideLoading() { els.loading.classList.add('hidden'); }

export function toggleSidebar() {
    els.sidebar.classList.toggle('open');
    els.sidebarOverlay.classList.toggle('open');
}

export function updateFilename(name) {
    els.filenameDisplay.textContent = truncate(name, 64);
    els.filenameDisplay.title = name;
}

export function renderMetadata(metaHtml) {
    document.getElementById('tab-run-settings').innerHTML = metaHtml.settingsHtml;
    document.getElementById('tab-system').innerHTML = metaHtml.sysHtml;
    document.getElementById('tab-citations').innerHTML = metaHtml.citesHtml;
    
    els.metaPanel.classList.remove('hidden');
    els.metaBody.classList.toggle('collapsed', !prefs.collapseMetadataByDefault);
    els.collapseBtn.querySelector('i').className = prefs.collapseMetadataByDefault ? 'ph ph-caret-up' : 'ph ph-caret-down';
}

export function populateSidebar(prompts, onPromptClick) {
    const list = document.getElementById('prompt-list');
    list.innerHTML = '';
    
    if (prompts.length === 0) {
        list.innerHTML = '<div class="empty-state-sidebar">No user prompts found</div>';
        return;
    }

    prompts.forEach((p, index) => {
        const btn = document.createElement('button');
        btn.className = 'prompt-item';
        const promptText = p.text || "[Uploaded File]";
        btn.innerHTML = `<i class="ph ph-chat-circle"></i> ${truncate(promptText, 35)}`;
        btn.title = promptText;
        btn.dataset.index = index;
        btn.onclick = () => onPromptClick(index);
        list.appendChild(btn);
    });
}

export function setActiveSidebarItem(index) {
    document.querySelectorAll('.prompt-item').forEach(e => e.classList.remove('active'));
    const target = document.querySelector(`.prompt-item[data-index="${index}"]`);
    if(target) target.classList.add('active');
}

export function renderHistoryLists(recentFiles, pinnedFiles, handlers) {
    const { onLoad, onTogglePin } = handlers;
    
    els.historySection.classList.toggle('hidden', recentFiles.length === 0 && pinnedFiles.length === 0);
    
    const createItem = (file) => {
        const div = document.createElement('div');
        div.className = 'recent-file-item';
        if(file.name === els.filenameDisplay.title) div.classList.add('active');
        
        div.onclick = () => onLoad(file);

        const nameGroup = document.createElement('div');
        nameGroup.className = 'file-name-group';
        nameGroup.innerHTML = `<i class="ph ph-file-text"></i> <span class="file-text" title="${file.name}">${truncate(file.name, 22)}</span>`;

        const pinBtn = document.createElement('button');
        pinBtn.className = `pin-btn ${file.pinned ? 'is-pinned' : ''}`;
        const iconClass = file.pinned ? 'ph-fill' : 'ph-bold';
        pinBtn.innerHTML = `<i class="${iconClass} ph-push-pin"></i>`;
        
        pinBtn.onclick = (e) => {
            e.stopPropagation();
            onTogglePin(file);
        };
        
        if (!file.pinned) {
            pinBtn.onmouseenter = () => pinBtn.querySelector('i').className = 'ph-fill ph-push-pin';
            pinBtn.onmouseleave = () => pinBtn.querySelector('i').className = 'ph-bold ph-push-pin';
        } else {
            pinBtn.onmouseenter = () => pinBtn.querySelector('i').className = 'ph-bold ph-push-pin';
            pinBtn.onmouseleave = () => pinBtn.querySelector('i').className = 'ph-fill ph-push-pin';
        }

        div.appendChild(nameGroup);
        div.appendChild(pinBtn);
        return div;
    };

    els.recentList.innerHTML = '';
    recentFiles.forEach(f => els.recentList.appendChild(createItem(f)));
    
    els.pinnedList.innerHTML = '';
    pinnedFiles.forEach(f => els.pinnedList.appendChild(createItem(f)));
}

// --- Conversation Rendering ---

export function renderConversation(parsedData, promptIndex, promptsList) {
    els.chatStream.innerHTML = '';
    els.chatStream.removeAttribute('data-view');
    setActiveSidebarItem(promptIndex);

    const userPrompt = promptsList[promptIndex];
    const allChunks = parsedData.chunkedPrompt.chunks;

    let userChunks = [];
    let i = userPrompt.originalIndex;
    while (i < allChunks.length && allChunks[i].role === 'user') {
        userChunks.push(allChunks[i]);
        i++;
    }
    els.chatStream.appendChild(createMessageElement(userChunks, 'user'));

    for (; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        if (chunk.role === 'model') {
            els.chatStream.appendChild(createMessageElement([chunk], 'model'));
        } else if (chunk.role === 'user') break;
    }

    postProcessCodeBlocks();
    els.scrollContainer.scrollTop = 0;
}

export function renderFullConversation(parsedData, promptsList) {
    els.chatStream.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-faint); text-transform:uppercase; font-size:11px; font-weight:600; letter-spacing:0.05em;">Full Conversation History</div>';
    els.chatStream.setAttribute('data-view', 'full');

    let currentTurn = [];
    let currentRole = null;
    let userPromptCount = 0;

    parsedData.chunkedPrompt.chunks.forEach((chunk) => {
        let shouldFlush = false;

        if (currentTurn.length > 0) {
            if (chunk.role !== currentRole) {
                shouldFlush = true;
            } else if (currentRole === 'model') {
                const currentIsThought = currentTurn[0].isThought;
                const newIsThought = chunk.isThought;
                if (currentIsThought !== newIsThought) shouldFlush = true;
            }
        }

        if (shouldFlush) {
            let id = null;
            if (currentRole === 'user') {
                id = `msg-user-${userPromptCount}`;
                userPromptCount++;
            }
            els.chatStream.appendChild(createMessageElement(currentTurn, currentRole, id));
            currentTurn = [];
        }
        currentRole = chunk.role;
        currentTurn.push(chunk);
    });

    if (currentTurn.length > 0) {
        let id = null;
        if (currentRole === 'user') id = `msg-user-${userPromptCount}`;
        els.chatStream.appendChild(createMessageElement(currentTurn, currentRole, id));
    }

    postProcessCodeBlocks();
    
    const observer = new IntersectionObserver((entries) => {
        let visible = entries.filter(e => e.isIntersecting);
        if(visible.length > 0) {
            visible.sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top);
            const id = visible[0].target.id;
            const idx = id.split('-').pop();
            setActiveSidebarItem(idx);
        }
    }, { root: els.scrollContainer, threshold: 0.1 });
    
    document.querySelectorAll('.message.role-user[id]').forEach(el => observer.observe(el));
}

function createMessageElement(chunks, role, id = null) {
    const wrapper = document.createElement('div');
    wrapper.className = `message role-${role}`;
    if (id) wrapper.id = id;

    const mainChunk = chunks[0] || {};
    const isThought = mainChunk.isThought || false;
    if (isThought) {
        wrapper.classList.add('thought-message');
        if (prefs.collapseThoughts) wrapper.classList.add('collapsed');
    }

    const isUser = role === 'user';
    const iconHtml = isUser ? 'You' : (isThought ? '<i class="ph-fill ph-brain"></i> Thinking' : '<i class="ph-fill ph-sparkle"></i> Gemini');
    const totalTokens = chunks.reduce((acc, c) => acc + (c.tokenCount || 0), 0);
    const tokens = totalTokens > 0 ? `<span style="opacity:0.5; font-weight:400; margin-left:8px;">${totalTokens} tokens</span>` : '';
    const expandIcon = isThought ? `<span class="thought-icon-rotate" style="margin-left:auto;"><i class="ph ph-caret-${prefs.collapseThoughts ? 'down' : 'up'}"></i></span>` : '';

    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerHTML = isUser ? `${tokens} ${iconHtml}` : `${iconHtml} ${tokens} ${expandIcon}`;

    if (isThought) {
        header.onclick = () => {
            wrapper.classList.toggle('collapsed');
            const icon = header.querySelector('.thought-icon-rotate i');
            icon.className = wrapper.classList.contains('collapsed') ? 'ph ph-caret-down' : 'ph ph-caret-up';
        };
    }
    
    const tooltipTemplate = document.getElementById('message-tooltip-template');
    if(tooltipTemplate) {
        wrapper.appendChild(tooltipTemplate.content.cloneNode(true));
    }
    
    wrapper.appendChild(header);

    const contentWrapper = (isUser) ? document.createElement('div') : wrapper;
    if (isUser) {
        contentWrapper.className = 'user-content-wrapper';
        wrapper.appendChild(contentWrapper);
    }

    chunks.forEach(chunk => {
        let contentContainer;

        if (chunk.text || chunk.inlineData || chunk.inlineImage) {
            contentContainer = document.createElement('div');
            contentContainer.className = 'message-bubble';
            let contentHtml = '';
            
            if (chunk.inlineData || chunk.inlineImage) {
                const imgData = chunk.inlineData || chunk.inlineImage;
                const imgSrc = `data:${imgData.mimeType};base64,${imgData.data}`;
                contentHtml = `<img src="${imgSrc}" class="inline-img" alt="Generated Image"/>`;
            } else {
                contentHtml = window.marked.parse(chunk.text || '');
            }
            contentContainer.innerHTML = window.DOMPurify.sanitize(contentHtml, { ADD_TAGS: ['img'] });
            
            const img = contentContainer.querySelector('.inline-img');
            if (img) {
                img.onclick = () => {
                    els.modalImg.src = img.src;
                    els.imageModal.classList.remove('hidden');
                };
            }
            contentContainer.querySelectorAll('a').forEach(a => a.setAttribute('target', '_blank'));
        } 
        else if (chunk.driveDocument || chunk.driveImage) {
            const templateId = chunk.driveDocument ? 'drive-doc-template' : 'drive-image-template';
            const template = document.getElementById(templateId);
            if(template) {
                contentContainer = template.content.cloneNode(true).firstElementChild;
                const driveId = chunk.driveDocument?.id || chunk.driveImage?.id;
                
                contentContainer.querySelector('.drive-id-display').textContent = truncate(driveId, 15);
                contentContainer.querySelector('.drive-id-display').title = driveId;
                contentContainer.querySelector('.open-drive-link-btn').href = `https://drive.google.com/file/d/${driveId}`;
                contentContainer.querySelector('.view-drive-file-btn').onclick = () => viewDriveFile(driveId);
            }
        }

        if (contentContainer) contentWrapper.appendChild(contentContainer);
    });

    return wrapper;
}

function viewDriveFile(driveId) {
    showLoading();
    const originalUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
    
    fetchProxyContent(originalUrl)
        .then(async response => {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.startsWith('image/')) {
                const blob = await response.blob();
                els.modalImg.src = URL.createObjectURL(blob);
                els.imageModal.classList.remove('hidden');
            } else {
                const text = await response.text();
                if (text.trim().startsWith('<')) throw new Error("Private File / HTML response");
                
                const highlightResult = window.hljs.highlightAuto(text);
                const detectedLanguage = highlightResult.language || 'Plain Text';
                
                document.getElementById('text-viewer-filename').textContent = `Drive File: ${truncate(driveId, 15)}`;
                document.getElementById('text-viewer-lang-tag').textContent = detectedLanguage;
                els.textViewerCode.textContent = text;
                els.textViewerCode.className = `hljs language-${detectedLanguage}`;
                window.hljs.highlightElement(els.textViewerCode);
                
                const pre = els.textViewerModal.querySelector('pre');
                pre.classList.toggle('wrapped', prefs.isWrapCode);
                els.textViewerModal.classList.remove('hidden');
            }
            hideLoading();
        })
        .catch(err => {
            hideLoading();
            if (err.message === "Private File / HTML response") {
                 showError("Access Denied", "This file is private.", true, () => viewDriveFile(driveId), driveId);
            } else {
                 showError("Fetch Error", "Failed to fetch file content.", false, () => viewDriveFile(driveId), driveId);
            }
        });
}

function postProcessCodeBlocks() {
    const filename = els.filenameDisplay.textContent;
    const persistedStates = prefs.preserveCodeState ? JSON.parse(localStorage.getItem(`code_states_${filename}`) || '{}') : {};

    document.querySelectorAll('pre code').forEach((block, idx) => {
        if (block.id === 'text-viewer-code') return;
        window.hljs.highlightElement(block);

        let lang = 'Plain Text';
        const langClass = Array.from(block.classList).find(c => c.startsWith('language-'));
        if (langClass) lang = langClass.replace('language-', '');
        if (lang === 'undefined') lang = 'Unknown';

        const pre = block.parentElement;
        if (pre.parentElement.classList.contains('code-block-wrapper')) return;

        const blockId = `b-${idx}`;
        const isCollapsed = persistedStates[blockId] === true;

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        wrapper.dataset.blockId = blockId;
        if (isCollapsed) wrapper.classList.add('collapsed');

        const sentinel = document.createElement('div');
        sentinel.className = 'sticky-sentinel';

        const iconClass = isCollapsed ? 'ph ph-caret-right' : 'ph ph-caret-down';
        const header = document.createElement('div');
        header.className = 'code-header';
        header.innerHTML = `
            <div class="code-title-group">
                <button class="collapse-code-btn" title="Toggle Code">
                    <i class="${iconClass}"></i>
                </button>
                <span class="lang-tag">${lang}</span>
            </div>
            <button class="copy-btn"><i class="ph ph-copy"></i> Copy</button>
        `;

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(sentinel);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);

        if (prefs.isWrapCode) pre.classList.add('wrapped');

        const observer = new IntersectionObserver(([e]) => {
            header.classList.toggle('is-sticky', !e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top || 0));
        }, { root: els.scrollContainer, threshold: 0 });
        observer.observe(sentinel);

        header.querySelector('.copy-btn').addEventListener('click', () => {
            navigator.clipboard.writeText(block.textContent).then(() => showToast("Copied code"));
        });
        
        const collapseBtn = header.querySelector('.collapse-code-btn');
        collapseBtn.addEventListener('click', () => {
            const nowCollapsed = wrapper.classList.toggle('collapsed');
            collapseBtn.querySelector('i').className = nowCollapsed ? 'ph ph-caret-right' : 'ph ph-caret-down';
            
            if (prefs.preserveCodeState) {
                const key = `code_states_${filename}`;
                let states = JSON.parse(localStorage.getItem(key) || '{}');
                states[blockId] = nowCollapsed;
                localStorage.setItem(key, JSON.stringify(states));
            }
        });
    });
}

// --- Helpers ---

export function showError(title, message, showGif, retryCallback, fileId) {
    els.errorModal.querySelector('.error-header span').textContent = title;
    document.getElementById('error-message-text').textContent = message;
    document.getElementById('error-gif-container').classList.toggle('hidden', !showGif);
    
    const retryBtn = document.getElementById('retry-error-btn');
    const driveBtn = document.getElementById('open-drive-error-btn');
    
    const newRetry = retryBtn.cloneNode(true);
    retryBtn.parentNode.replaceChild(newRetry, retryBtn);
    
    if (retryCallback) {
        newRetry.classList.remove('hidden');
        newRetry.addEventListener('click', () => {
            els.errorModal.classList.add('hidden');
            retryCallback();
        });
    } else {
        newRetry.classList.add('hidden');
    }

    if (fileId) {
        driveBtn.href = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
        driveBtn.classList.remove('hidden');
    } else {
        driveBtn.classList.add('hidden');
    }

    els.errorModal.classList.remove('hidden');
}

export function showConfirmModal(htmlMessage, onOk, onCancel) {
    document.getElementById('confirm-message-text').innerHTML = htmlMessage;
    
    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const newOk = okBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    
    newOk.addEventListener('click', () => {
        els.confirmModal.classList.add('hidden');
        if(onOk) onOk();
    });
    
    newCancel.addEventListener('click', () => {
        els.confirmModal.classList.add('hidden');
        if(onCancel) onCancel();
    });

    els.confirmModal.classList.remove('hidden');
}