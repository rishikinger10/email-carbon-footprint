const DEFAULTS = {
    deleteSuggestions: true,
    imageCompression: true,
    shortEmailPrompt: true,
    unsubscribeAssistant: true,
    retentionDays: 30
};

const TOGGLE_IDS = ['deleteSuggestions', 'imageCompression', 'shortEmailPrompt', 'unsubscribeAssistant'];

document.addEventListener('DOMContentLoaded', async () => {
    const settings = await chrome.storage.sync.get(DEFAULTS);

    TOGGLE_IDS.forEach((id) => {
        const checkbox = document.getElementById(id);
        checkbox.checked = settings[id];
        checkbox.addEventListener('change', async (e) => {
            await chrome.storage.sync.set({ [id]: e.target.checked });
            broadcastSettingsChange();
        });
    });

    const retention = document.getElementById('retentionDays');
    retention.value = settings.retentionDays;
    retention.addEventListener('change', async (e) => {
        const days = Math.max(1, parseInt(e.target.value, 10) || 30);
        e.target.value = days;
        await chrome.storage.sync.set({ retentionDays: days });
        broadcastSettingsChange();
    });

    showStats(await chrome.storage.sync.get({ carbonSaved: 0, storageSaved: 0, emailsOptimized: 0 }));

    // Deep Clean: hand off to Gmail's own search — the server finds the
    // heavy mail, the user reviews and bulk-deletes.
    document.getElementById('cleanOldUnstarred').addEventListener('click', async () => {
        const { retentionDays } = await chrome.storage.sync.get({ retentionDays: 30 });
        openGmailSearch(`older_than:${retentionDays}d -is:starred -is:important`);
    });
    document.getElementById('cleanPromotions').addEventListener('click', async () => {
        const { retentionDays } = await chrome.storage.sync.get({ retentionDays: 30 });
        openGmailSearch(`category:promotions older_than:${retentionDays}d`);
    });
    document.getElementById('cleanLargeAttachments').addEventListener('click', () => {
        openGmailSearch('has:attachment larger:5M older_than:1y -is:starred');
    });
});

function showStats(stats) {
    const mb = (stats.storageSaved / (1024 * 1024)).toFixed(2);
    document.getElementById('carbonSaved').textContent = `${stats.carbonSaved.toFixed(2)}g CO₂`;
    document.getElementById('storageSaved').textContent = `${mb} MB`;
    document.getElementById('emailsOptimized').textContent = stats.emailsOptimized;
}

function openGmailSearch(query) {
    chrome.tabs.create({ url: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}` });
}

function broadcastSettingsChange() {
    chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
        tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
        });
    });
}
