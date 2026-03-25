(() => {
  const MARKERS = ['unsubscribe', 'limited time', '% off'];
  function classify(t) {
    return MARKERS.filter(m => t.toLowerCase().includes(m)).length >= 2 ? 'spam' : null;
  }
  function scan() {
    document.querySelectorAll('tr.zA').forEach(row => {
      if (row.dataset.ecf) return;
      if (classify(row.innerText || '') !== 'spam') return;
      row.dataset.ecf = 'spam';
      const b = document.createElement('span');
      b.className = 'ecf-badge';
      b.textContent = 'Likely spam';
      row.appendChild(b);
    });
  }
  new MutationObserver(() => { clearTimeout(window.__t); window.__t = setTimeout(scan, 400); })
    .observe(document.body, { childList: true, subtree: true });
  scan();
})();
