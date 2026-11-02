// Background service worker for Chrome extension
const viewerUrl = chrome.runtime.getURL('markdown-viewer.html');

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: viewerUrl }, (tab) => {
    chrome.tabs.setZoomSettings(tab.id, { scope: 'per-tab' });
  });
});

// Ensure every viewer tab gets per-tab zoom so zooming one window
// does not affect other open viewer windows.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url && changeInfo.url.startsWith(viewerUrl)) {
    chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' });
  }
});
