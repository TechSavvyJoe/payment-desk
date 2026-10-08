// Chrome can hold a native panel blank until its initial document and frames
// finish loading. Let the lightweight panel finish first, then start the app
// on its first visible frame. A slow/broken worksheet now leaves usable tools
// and a loading/retry message instead of a grey panel.
export function installWorksheet(onReady, onUnavailable) {
  const desk = document.getElementById('desk');
  const loading = document.getElementById('worksheet-loading');
  const message = document.getElementById('worksheet-loading-message');
  const retry = document.getElementById('worksheet-retry');
  let observer;
  let timer;
  let ready = false;
  const worksheetDocument = () => {
    const doc = desk.contentDocument;
    return doc && new URL(doc.URL).pathname === '/desk/index.html' ? doc : null;
  };

  const checkReady = () => {
    const doc = worksheetDocument();
    if (!doc || doc.readyState !== 'complete' || !doc.getElementById('sale-price')) return false;
    if (!ready) {
      ready = true;
      clearTimeout(timer);
      observer?.disconnect();
      loading.hidden = true;
      onReady();
    }
    return true;
  };
  const armRecovery = () => {
    clearTimeout(timer);
    loading.hidden = false;
    message.textContent = 'Opening Payment Desk…';
    retry.hidden = true;
    timer = setTimeout(() => {
      if (checkReady()) return;
      message.textContent = 'The worksheet is taking longer to open. Try again.';
      retry.hidden = false;
    }, 15_000);
  };
  desk.addEventListener('load', () => {
    observer?.disconnect();
    if (checkReady()) return;
    // A completed reload without the worksheet invalidates parent review gating.
    if (ready) {
      ready = false;
      onUnavailable();
    }
    armRecovery();
    const doc = worksheetDocument();
    if (!doc) return;
    // React can commit just after the document's load event.
    observer = new MutationObserver(checkReady);
    observer.observe(doc, { childList: true, subtree: true });
  });
  const start = () => {
    if (ready || checkReady()) return;
    observer?.disconnect();
    armRecovery();
    desk.src = 'desk/index.html';
  };
  retry.addEventListener('click', start);
  // A rAF callback runs before paint. Starting the iframe in that first
  // callback can put Chrome straight back into its initial frame-loading hold.
  // Give the panel one complete frame to paint its tools/loading message.
  const afterPanelLoad = () => requestAnimationFrame(() => requestAnimationFrame(start));
  if (document.readyState === 'complete') afterPanelLoad();
  else window.addEventListener('load', afterPanelLoad, { once: true });
}
