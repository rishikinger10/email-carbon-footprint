// Gmail Carbon Reducer — content script.
// Everything runs locally in the browser: no backend, no tracking, no AI.
//
// Gmail's DOM is obfuscated and changes without notice, so all the selectors
// below are best-effort. If a feature silently stops working, the selectors
// are the first place to look.

const SEND_BUTTON_SELECTOR = '[role="button"][aria-label*="Send"], [role="button"][data-tooltip*="Send"]';
const COMPOSE_BODY_SELECTOR = '.Am.Al.editable, [role="textbox"][contenteditable="true"]';
const EMAIL_ROW_SELECTOR = 'tr.zA';           // inbox list rows
const MESSAGE_BODY_SELECTOR = '.a3s';         // opened message body
const ATTACHMENT_SIZE_SELECTOR = '.dO .vJ, .vJ'; // compose attachment chips, text like "(2,341K)"

// ~20g CO2 per MB transferred is the commonly cited ballpark (see README).
const CARBON_PER_MB_GRAMS = 20;
const LARGE_ATTACHMENT_BYTES = 1024 * 1024;
const SHORT_EMAIL_WORDS = 4;
const MAX_ROWS_PER_SCAN = 50;

// Two or more hits = probably bulk mail. One hit is just suspicious —
// plenty of legit transactional email contains "unsubscribe".
const SPAM_KEYWORDS = [
  'unsubscribe', 'limited time', 'act now', 'winner', 'free gift',
  'click here', 'special offer', 'no obligation', '% off', 'flash sale',
  'newsletter', 'weekly digest', 'view in browser', 'deals'
];

const UNSUB_LINK = /unsubscribe|opt[ -]?out|manage (your )?preferences/i;

class CarbonReducer {
  constructor() {
    this.settings = {
      shortEmailPrompt: true,
      imageCompression: true,
      deleteSuggestions: true,
      unsubscribeAssistant: true,
      retentionDays: 30
    };
    this.sendApproved = false;
    this.scanTimer = null;
    this.toolbars = new Map(); // composeBody -> floating toolbar element
  }

  async init() {
    this.settings = await chrome.storage.sync.get(this.settings);

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SETTINGS_UPDATED') {
        chrome.storage.sync.get(this.settings).then((s) => { this.settings = s; });
      }
    });

    this.interceptSendClicks();

    // Gmail is a SPA, so watch for DOM changes rather than page loads.
    // The scan itself is debounced — mutations arrive in bursts.
    new MutationObserver(() => this.onGmailUpdate())
      .observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', () => this.repositionToolbars(), true);
    window.addEventListener('resize', () => this.repositionToolbars());
    this.onGmailUpdate();
  }

  onGmailUpdate() {
    document.querySelectorAll(COMPOSE_BODY_SELECTOR).forEach((el) => this.enhanceCompose(el));
    this.repositionToolbars();
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanInbox();
      this.scanOpenMessages();
    }, 1000);
  }

  /* ============ cleanup badges ============ */

  classify(text, isStarred) {
    const lower = text.toLowerCase();
    const hits = SPAM_KEYWORDS.filter((kw) => lower.includes(kw)).length;
    const bulkish = hits >= 1;
    return {
      isSpam: hits >= 2,
      isImportant: isStarred || (!bulkish && text.split(/\s+/).length > 50)
    };
  }

  scanInbox() {
    if (!this.settings.deleteSuggestions) return;

    const rows = Array.from(document.querySelectorAll(EMAIL_ROW_SELECTOR))
      .filter((row) => !row.dataset.carbonScanned)
      .slice(0, MAX_ROWS_PER_SCAN);

    for (const row of rows) {
      row.dataset.carbonScanned = 'true';
      const email = this.extractRowData(row);
      if (!email) continue;

      const { isSpam, isImportant } = this.classify(`${email.subject} ${email.snippet}`, email.isStarred);

      if (isSpam) {
        this.badgeRow(row, '🗑 Likely spam');
      } else if (email.daysOld > this.settings.retentionDays && !isImportant) {
        this.badgeRow(row, `🌱 Older than ${this.settings.retentionDays}d — consider deleting`);
      }
    }
  }

  extractRowData(row) {
    const id = row.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id')
      || row.querySelector('[data-thread-id]')?.getAttribute('data-thread-id');
    if (!id) return null;

    // The date cell's title attribute holds the full timestamp
    const dateTitle = row.querySelector('td.xW span[title]')?.getAttribute('title');
    const date = dateTitle ? new Date(dateTitle) : null;

    return {
      id,
      subject: row.querySelector('.bog')?.textContent.trim() || '',
      snippet: row.querySelector('.y2')?.textContent.replace(/^\s*-\s*/, '').trim() || '',
      isStarred: !!row.querySelector('.T-KT-Jp'),
      daysOld: date && !isNaN(date) ? (Date.now() - date.getTime()) / 86400000 : 0
    };
  }

  badgeRow(row, label) {
    if (row.querySelector('.carbon-row-badge')) return;
    const subjectCell = row.querySelector('.bog')?.parentElement;
    if (!subjectCell) return;
    const badge = document.createElement('span');
    badge.className = 'carbon-row-badge';
    badge.textContent = label;
    subjectCell.appendChild(badge);
  }

  /* ============ unsubscribe assistant ============ */

  scanOpenMessages() {
    if (!this.settings.unsubscribeAssistant) return;

    document.querySelectorAll(MESSAGE_BODY_SELECTOR).forEach((body) => {
      if (body.dataset.carbonUnsubChecked) return;
      body.dataset.carbonUnsubChecked = 'true';

      const link = Array.from(body.querySelectorAll('a[href^="http"]'))
        .find((a) => UNSUB_LINK.test(a.textContent) || UNSUB_LINK.test(a.href));
      if (link) this.showUnsubBanner(body, link.href);
    });
  }

  showUnsubBanner(messageBody, url) {
    const banner = document.createElement('div');
    banner.className = 'carbon-unsub-banner';

    const text = document.createElement('span');
    text.textContent = '🌱 This looks like a newsletter. Unsubscribing stops future emails — and their carbon cost — at the source.';

    const unsubBtn = document.createElement('button');
    unsubBtn.className = 'carbon-btn-primary';
    unsubBtn.textContent = 'Unsubscribe';
    unsubBtn.addEventListener('click', () => {
      window.open(url, '_blank', 'noopener');
      this.addStats({ emailsOptimized: 1 });
      banner.remove();
      this.notify('Unsubscribe page opened. Future emails from this sender will stop arriving.');
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'carbon-btn-secondary';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => banner.remove());

    banner.append(text, unsubBtn, dismissBtn);
    messageBody.parentElement.insertBefore(banner, messageBody);
  }

  /* ============ compose: word count, compression, send checks ============ */

  enhanceCompose(composeBody) {
    if (composeBody.dataset.carbonEnhanced) return;
    composeBody.dataset.carbonEnhanced = 'true';

    const toolbar = document.createElement('div');
    toolbar.className = 'carbon-compose-toolbar';

    const wordCount = document.createElement('span');
    wordCount.className = 'carbon-word-count';
    wordCount.textContent = 'Words: 0';
    toolbar.appendChild(wordCount);

    if (this.settings.imageCompression) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'carbon-compress-btn';
      btn.textContent = '🌱 Compress image';
      btn.title = 'Compress an image before attaching it';
      btn.addEventListener('click', () => this.pickImage());
      toolbar.appendChild(btn);
    }

    // Appended to document.body and positioned with `fixed` coordinates,
    // not into Gmail's own compose DOM: that container has a Gmail-computed
    // fixed height with clipped overflow, so an extra in-flow node there
    // pushes Gmail's own Send button row past the visible edge.
    document.body.appendChild(toolbar);
    this.toolbars.set(composeBody, toolbar);
    this.positionToolbar(composeBody, toolbar);

    composeBody.addEventListener('input', () => {
      const words = this.countWords(composeBody.innerText);
      wordCount.textContent = `Words: ${words}`;
      wordCount.classList.toggle('carbon-word-count-low', words > 0 && words < SHORT_EMAIL_WORDS);
    });
  }

  positionToolbar(composeBody, toolbar) {
    const rect = composeBody.getBoundingClientRect();
    toolbar.style.top = `${Math.max(0, rect.top - toolbar.offsetHeight - 4)}px`;
    toolbar.style.left = `${rect.left}px`;
  }

  repositionToolbars() {
    for (const [composeBody, toolbar] of this.toolbars) {
      if (!composeBody.isConnected) {
        toolbar.remove();
        this.toolbars.delete(composeBody);
        continue;
      }
      this.positionToolbar(composeBody, toolbar);
    }
  }

  countWords(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  interceptSendClicks() {
    // Capture phase, so we run before Gmail's own handler and can cancel it.
    document.addEventListener('click', (e) => {
      const sendButton = e.target.closest(SEND_BUTTON_SELECTOR);
      if (!sendButton || this.sendApproved) {
        this.sendApproved = false;
        return;
      }

      const dialog = sendButton.closest('[role="dialog"]') || document;
      const concerns = this.checkBeforeSend(dialog);
      if (!concerns.length) return;

      e.preventDefault();
      e.stopPropagation();
      this.confirmSend(concerns).then((sendAnyway) => {
        if (sendAnyway) {
          this.sendApproved = true; // let the re-click through
          sendButton.click();
        }
      });
    }, true);
  }

  checkBeforeSend(dialog) {
    const concerns = [];

    if (this.settings.shortEmailPrompt) {
      const body = dialog.querySelector(COMPOSE_BODY_SELECTOR);
      const words = body ? this.countWords(body.innerText) : SHORT_EMAIL_WORDS;
      if (words < SHORT_EMAIL_WORDS) {
        concerns.push(`This email is only ${words} word${words === 1 ? '' : 's'} long. Very short replies like "Thanks!" still cost energy to send and store — could it be unnecessary?`);
      }
    }

    if (this.settings.imageCompression) {
      const bytes = this.attachedBytes(dialog);
      if (bytes > LARGE_ATTACHMENT_BYTES) {
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        concerns.push(`Attachments total ~${mb} MB. A copy goes to every recipient's inbox — sharing a Google Drive link or compressing images first saves the most carbon.`);
      }
    }

    return concerns;
  }

  attachedBytes(dialog) {
    let total = 0;
    dialog.querySelectorAll(ATTACHMENT_SIZE_SELECTOR).forEach((el) => {
      const m = el.textContent.match(/([\d,.]+)\s*([KMG])/i);
      if (!m) return;
      const value = parseFloat(m[1].replace(/,/g, ''));
      const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2].toUpperCase()];
      if (value && unit) total += value * unit;
    });
    return total;
  }

  confirmSend(concerns) {
    return new Promise((resolve) => {
      const modal = this.modal(`
        <h3>🌍 Carbon-Friendly Reminder</h3>
        ${concerns.map((c) => `<p>${c}</p>`).join('')}
        <div class="carbon-modal-actions">
          <button class="carbon-btn-secondary" data-action="send">Send Anyway</button>
          <button class="carbon-btn-primary" data-action="edit">Keep Editing</button>
        </div>
      `);
      modal.querySelector('[data-action="send"]').onclick = () => { modal.remove(); resolve(true); };
      modal.querySelector('[data-action="edit"]').onclick = () => { modal.remove(); resolve(false); };
    });
  }

  /* ============ image compression (canvas, fully offline) ============ */

  pickImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      if (input.files[0]) this.offerCompression(input.files[0]);
    });
    input.click();
  }

  offerCompression(file) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const linkTip = file.size > LARGE_ATTACHMENT_BYTES
      ? `<p class="carbon-tip">💡 This file is ${sizeMB} MB. For large files, sharing a
         <a href="https://drive.google.com" target="_blank">Google Drive link</a>
         instead of attaching saves the most carbon — the file is stored once, not copied to every inbox.</p>`
      : '';

    const modal = this.modal(`
      <h3>Optimize "${file.name}" (${sizeMB} MB)</h3>
      ${linkTip}
      <p>Compress this image, then attach the downloaded copy:</p>
      <div class="carbon-modal-actions">
        <button class="carbon-btn-primary" data-quality="0.85">High Quality</button>
        <button class="carbon-btn-primary" data-quality="0.65">Balanced</button>
        <button class="carbon-btn-primary" data-quality="0.45">Max Savings</button>
        <button class="carbon-btn-secondary" data-action="cancel">Cancel</button>
      </div>
    `);

    modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
    modal.querySelectorAll('[data-quality]').forEach((btn) => {
      btn.onclick = () => {
        modal.remove();
        this.compress(file, parseFloat(btn.dataset.quality));
      };
    });
  }

  async compress(file, quality) {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw new Error('canvas.toBlob returned null');

      // Hand the result back as a download — extensions can't inject files
      // into Gmail's attachment picker directly.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name.replace(/\.[^.]+$/, '') + '-compressed.jpg';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      const saved = Math.max(0, file.size - blob.size);
      const carbonSaved = (saved / (1024 * 1024)) * CARBON_PER_MB_GRAMS;
      const percent = file.size ? Math.round((saved / file.size) * 100) : 0;

      this.addStats({ carbonSaved, storageSaved: saved, emailsOptimized: 1 });
      this.notify(`Image compressed: ${percent}% smaller, ~${carbonSaved.toFixed(1)}g CO₂ saved. Attach the downloaded copy.`);
    } catch (err) {
      console.error('carbon-reducer: compression failed', err);
      this.notify('Could not compress this image.');
    }
  }

  /* ============ misc ============ */

  async addStats(delta) {
    const stats = await chrome.storage.sync.get({ carbonSaved: 0, storageSaved: 0, emailsOptimized: 0 });
    await chrome.storage.sync.set({
      carbonSaved: stats.carbonSaved + (delta.carbonSaved || 0),
      storageSaved: stats.storageSaved + (delta.storageSaved || 0),
      emailsOptimized: stats.emailsOptimized + (delta.emailsOptimized || 0)
    });
  }

  modal(innerHTML) {
    const overlay = document.createElement('div');
    overlay.className = 'carbon-modal';
    const content = document.createElement('div');
    content.className = 'carbon-modal-content';
    content.innerHTML = innerHTML;
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    return overlay;
  }

  notify(message) {
    const el = document.createElement('div');
    el.className = 'carbon-notification';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
}

new CarbonReducer().init();
