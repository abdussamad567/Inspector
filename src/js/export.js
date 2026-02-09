/* global htmlToImage */
import { showToast } from './utils.js';

/**
 * Exports a set of chunks as Markdown
 */
export function exportToMarkdown(chunks, filename) {
    const md = chunksToMarkdown(chunks);
    downloadString(md, `${filename}.md`, 'text/markdown');
}

/**
 * Exports a set of chunks as Plain Text
 */
export function exportToTxt(chunks, filename) {
    const txt = chunksToTxt(chunks);
    downloadString(txt, `${filename}.txt`, 'text/plain');
}

/**
 * Copy chunks to clipboard as Markdown
 */
export function copyToClipboardAsMarkdown(chunks) {
    const md = chunksToMarkdown(chunks);
    navigator.clipboard.writeText(md).then(() => showToast('Copied as Markdown'));
}

/**
 * Copy chunks to clipboard as Plain Text
 */
export function copyToClipboardAsText(chunks) {
    const txt = chunksToTxt(chunks);
    navigator.clipboard.writeText(txt).then(() => showToast('Copied as Plain Text'));
}

/**
 * Exports a set of chunks or an element as HTML
 */
export function exportToHtml(element, title, filename) {
    const styles = Array.from(document.styleSheets)
        .map(sheet => {
            try {
                return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
            } catch (e) {
                // Skip cross-origin stylesheets if they can't be read
                return '';
            }
        }).join('\n');

    // Add Highlight.js theme
    const themeLink = document.getElementById('highlight-stylesheet');
    const themeUrl = themeLink ? themeLink.href : '';

    const rootStyles = getComputedStyle(document.documentElement);
    const cssVars = [
        '--bg-app', '--bg-surface', '--bg-sidebar', '--bg-code', '--text-main', '--text-muted', '--text-faint',
        '--accent-primary', '--accent-surface', '--border-subtle', '--border-focus',
        '--radius-sm', '--radius-md', '--radius-lg'
    ].map(v => `${v}: ${rootStyles.getPropertyValue(v)};`).join('\n');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <link rel="stylesheet" href="${themeUrl}">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            ${cssVars}
        }
        body {
            font-family: 'Inter', sans-serif;
            padding: 40px;
            background: var(--bg-app);
            color: var(--text-main);
            line-height: 1.5;
        }
        ${styles}
        .message-tooltip, .code-header-actions, .collapse-code-btn, .sticky-sentinel { display: none !important; }
        .message { max-width: 900px; margin: 0 auto 30px auto !important; }
        .premium-header {
            max-width: 900px;
            margin: 0 auto 40px auto;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border-subtle);
        }
        .premium-header h1 { margin: 0; font-size: 24px; }
        .premium-header p { color: var(--text-muted); margin: 5px 0 0 0; font-size: 14px; }
    </style>
</head>
<body data-theme="${document.documentElement.getAttribute('data-theme') || 'light'}">
    <div class="premium-header">
        <h1>${title}</h1>
        <p>Exported from Gemini Inspector</p>
    </div>
    <div class="content-wrapper">
        ${element.innerHTML}
    </div>
</body>
</html>`;

    downloadString(html, `${filename}.html`, 'text/html');
}

/**
 * Trigger browser print for PDF
 */
export function exportToPdf(targetElements = null) {
    if (targetElements) {
        if (!Array.isArray(targetElements)) targetElements = [targetElements];
        targetElements.forEach(el => el.classList.add('print-target'));
        document.body.classList.add('print-isolated');

        window.print();

        // Use a small delay for restoration to ensure print dialog is finished
        setTimeout(() => {
            document.body.classList.remove('print-isolated');
            targetElements.forEach(el => el.classList.remove('print-target'));
        }, 500);
    } else {
        window.print();
    }
}

/**
 * Export element as Image (Carbon.sh Style)
 */
export async function exportToImage(element, filename) {
    try {
        showToast("Preparing snapshot...");

        // Create a temporary container for capture
        const captureContainer = document.createElement('div');
        captureContainer.style.position = 'fixed';
        captureContainer.style.top = '-9999px';
        captureContainer.style.left = '-9999px';
        captureContainer.style.width = '1000px';
        captureContainer.style.padding = '60px';
        captureContainer.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        captureContainer.style.display = 'flex';
        captureContainer.style.justifyContent = 'center';
        captureContainer.style.alignItems = 'center';

        const card = document.createElement('div');
        card.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface');
        card.style.borderRadius = '12px';
        card.style.boxShadow = '0 30px 60px rgba(0,0,0,0.4)';
        card.style.width = '100%';
        card.style.overflow = 'hidden';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';

        // Window Controls Header
        const header = document.createElement('div');
        header.style.padding = '16px';
        header.style.display = 'flex';
        header.style.gap = '8px';
        header.style.borderBottom = '1px solid ' + getComputedStyle(document.documentElement).getPropertyValue('--border-subtle');

        ['#ff5f56', '#ffbd2e', '#27c93f'].forEach(color => {
            const dot = document.createElement('div');
            dot.style.width = '12px';
            dot.style.height = '12px';
            dot.style.borderRadius = '50%';
            dot.style.backgroundColor = color;
            header.appendChild(dot);
        });

        const body = document.createElement('div');
        body.style.padding = '30px';

        // Clone the content
        const clone = element.cloneNode(true);
        // Hide tooltips/actions in clone
        clone.querySelectorAll('.message-tooltip, .code-header-actions, .collapse-code-btn, .sticky-sentinel').forEach(t => t.remove());

        // Apply some styles to clone for better rendering in isolation
        clone.style.width = '100%';
        clone.style.margin = '0';
        clone.style.opacity = '1';
        clone.style.visibility = 'visible';
        clone.style.position = 'relative';

        body.appendChild(clone);
        card.appendChild(header);
        card.appendChild(body);
        captureContainer.appendChild(card);
        document.body.appendChild(captureContainer);

        const dataUrl = await htmlToImage.toPng(captureContainer, {
            width: 1000,
            pixelRatio: 2,
        });

        document.body.removeChild(captureContainer);

        const link = document.createElement('a');
        link.download = `${filename}.png`;
        link.href = dataUrl;
        link.click();
        showToast("Snapshot saved");
    } catch (error) {
        console.error('Image export failed:', error);
        showToast('Image export failed', 'error');
    }
}

// --- Internal Helpers ---

function chunksToMarkdown(chunks) {
    let output = "";
    let currentRole = null;
    let currentIsThought = null;

    chunks.forEach(chunk => {
        const isThought = !!chunk.isThought;
        if (chunk.role !== currentRole || isThought !== currentIsThought) {
            currentRole = chunk.role;
            currentIsThought = isThought;
            const label = currentRole === 'user' ? 'User' : (isThought ? 'Thinking' : 'Gemini');
            output += `\n\n## ${label}\n\n`;
        }

        let content = '';
        if (chunk.text) {
            content = chunk.text;
        } else if (chunk.inlineData || chunk.inlineImage) {
            const type = (chunk.inlineData || chunk.inlineImage).mimeType || 'image';
            content = `\n![Attached ${type}](Embedded Data)\n`;
        } else if (chunk.driveDocument || chunk.driveImage || chunk.driveAudio || chunk.driveVideo || chunk.driveFile) {
            const data = chunk.driveDocument || chunk.driveImage || chunk.driveAudio || chunk.driveVideo || chunk.driveFile;
            content = `\n[Drive Attachment: ${data.id}]\n`;
        } else if (chunk.inlineFile) {
            content = `\n[Attached File: ${chunk.inlineFile.mimeType}]\n`;
        }
        output += content + "\n";
    });

    return output.trim();
}

function chunksToTxt(chunks) {
    return chunks.map(chunk => {
        let content = '';
        if (chunk.text) {
            // Advanced Markdown to Plain Text stripping
            content = chunk.text
                .replace(/^#+\s+/gm, '') // Remove headers
                .replace(/(\*\*|__)(.*?)\1/g, '$2') // Bold
                .replace(/(\*|_)(.*?)\1/g, '$2') // Italic
                .replace(/`{3}[\s\S]*?`{3}/g, (match) => { // Code blocks
                    return match.replace(/`{3}/g, '').trim();
                })
                .replace(/`(.+?)`/g, '$1') // Inline code
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // Links
                .replace(/^\s*[-*+]\s+/gm, '') // Unordered lists
                .replace(/^\s*\d+\.\s+/gm, '') // Ordered lists
                .replace(/^\s*>\s+/gm, ''); // Blockquotes
        } else if (chunk.inlineData || chunk.inlineImage) {
            content = `[Attached Image/Media]`;
        } else if (chunk.driveDocument || chunk.driveImage || chunk.driveAudio || chunk.driveVideo || chunk.driveFile) {
            const data = chunk.driveDocument || chunk.driveImage || chunk.driveAudio || chunk.driveVideo || chunk.driveFile;
            content = `[Drive Attachment: ${data.id}]`;
        } else if (chunk.inlineFile) {
            content = `[Attached File]`;
        }

        const prefix = chunk.role === 'user' ? 'USER: ' : (chunk.isThought ? 'THINKING: ' : 'GEMINI: ');
        return prefix + content;
    }).join('\n\n');
}

function downloadString(content, filename, contentType) {
    const a = document.createElement('a');
    const blob = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
