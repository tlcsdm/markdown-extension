// Background service worker for Chrome extension
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('markdown-viewer.html')
  });
});
