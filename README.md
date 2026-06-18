# Email Carbon Footprint Reducer

A Chrome extension that reduces the carbon footprint of your email, that runs entirely in the browser: no backend, no AI model, no build step, and no data ever leaves your machine.

## Background

Email feels free, but it isn't. Every message gets transmitted through network infrastructure, processed by mail servers, and then stored, usually forever, and usually replicated across multiple data centers. Some commonly cited estimates:

| Action | Estimated CO₂ |
|---|---|
| A short text-only email | ~0.3 g |
| An email with a large attachment | 5 to 50 g |
| Storing an email for a year | ~0.3 g |
| Transferring 1 MB of data | ~20 g |

These numbers are tiny on their own, but the world sends over 300 billion emails a day, and the average inbox holds years of newsletters and multi-megabyte attachments that get backed up indefinitely. There are really only two levers that matter:

1. Stop emails before they are sent or received. Unsubscribing from newsletters and skipping pointless one-word replies both do this.
2. Shrink what does get sent, by compressing images or sharing links instead of attachments.

This extension is built around those two levers.

## Features

**Unsubscribe assistant.** When you open a newsletter, the extension finds its unsubscribe link and shows a small banner offering a one-click way out. This is the highest-impact feature in the project: unsubscribing stops future emails at the source, and the savings recur forever.

**Deep clean.** The popup has three one-click Gmail searches that surface the heaviest mail for bulk deletion: old unstarred mail past your retention period, old promotions and newsletters, and attachments over 5 MB that are more than a year old. These are plain Gmail search operators (`older_than:`, `larger:`, `-is:starred`), so Google's servers do the finding and you just review the results and delete.

**Inbox cleanup badges.** Rule-based flagging of spam and stale mail, shown directly on inbox rows. Messages with several bulk-mail markers get a "Likely spam" badge, and unimportant mail older than your retention window gets a "consider deleting" badge. Starred mail is never flagged. The retention window is configurable from 1 to 3650 days and also drives the deep clean searches.

**Image compression.** Every compose window gets a "Compress image" button with three quality presets. Compression happens in the browser using the canvas API, and the compressed copy downloads immediately so you can attach it.

**Large attachment warnings.** If the attachments on an outgoing email total more than 1 MB, you get a reminder at send time that a copy lands in every recipient's inbox, along with the suggestion to compress or share a Google Drive link instead.

**Short email warnings and word count.** A live word counter while composing, plus a gentle prompt before sending near-empty messages. A "Thanks!" email costs the same infrastructure round-trip as a real one. You can always send anyway.

**Savings tracker.** The popup keeps a running estimate of carbon saved, storage saved, and emails optimized.

## Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/rishikinger10/email-carbon-footprint.git
   ```
2. Open `chrome://extensons/` in Chrome or any Chromium browser.
3. Enable Developer mode (top right toggle).
4. Click "Load unpacked" and select the `extension/` folder.
5. Open Gmail. There is nothing else to install or run.

## Usage

| Where | What you'll see |
|---|---|
| Inbox | Cleanup badges on spammy or stale rows |
| Opened newsletter | Green unsubscribe banner above the message |
| Compose window | Word counter and a "Compress image" button |
| Clicking Send | A reminder if the email is very short or attachments are large |
| Extension popup | Savings stats, deep clean searches, settings |

Each feature can be toggled independently in the popup.

## How it works

```
extension/
├── manifest.json           Manifest V3, storage permission only
├── content/
│   └── content.js          All Gmail integration, no dependencies
├── popup/
│   ├── popup.html          Stats, deep clean, settings
│   └── popup.js
└── assets/
    ├── css/                Styles injected into Gmail
    └── icons/
```

A single content script watches Gmail's DOM with a debounced MutationObserver, since Gmail is a single-page app and there are no page loads to hook into. Classification is a keyword heuristic: two or more bulk-mail markers ("unsubscribe", "limited time", "% off" and so on) flag a message as spam, and one marker plus age past the retention window flags it as deletable. Send interception uses a capture-phase click listener so the reminder runs before Gmail's own handler. Attachment sizes are parsed from the text of Gmail's compose chips. Settings and stats live in `chrome.storage.sync`, so they follow your Chrome profile.

## License

MIT
