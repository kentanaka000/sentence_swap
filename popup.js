// Popup script for Sentence Swap extension

document.addEventListener('DOMContentLoaded', async () => {
  const enabledToggle = document.getElementById('enabledToggle');
  const languageDisplay = document.getElementById('languageDisplay');
  const percentageDisplay = document.getElementById('percentageDisplay');
  const apiWarning = document.getElementById('apiWarning');
  const optionsBtn = document.getElementById('optionsBtn');
  const openOptions = document.getElementById('openOptions');
  const reloadBtn = document.getElementById('reloadBtn');

  // Load current settings (sync for preferences, local for API key)
  const syncSettings = await new Promise(resolve => {
    chrome.storage.sync.get({
      enabled: true,
      targetLanguage: 'Spanish',
      percentage: 15
    }, resolve);
  });
  const localSettings = await new Promise(resolve => {
    chrome.storage.local.get({
      apiKey: ''
    }, resolve);
  });
  const settings = { ...syncSettings, ...localSettings };

  // Update UI with current settings
  enabledToggle.checked = settings.enabled;
  languageDisplay.textContent = settings.targetLanguage;
  percentageDisplay.textContent = `${settings.percentage}%`;

  // Show warning if API key not set
  if (!settings.apiKey) {
    apiWarning.style.display = 'block';
  }

  // Handle toggle change
  enabledToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ enabled: enabledToggle.checked });
  });

  // Handle options button
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Handle options link in warning
  openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Handle reload button
  reloadBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.reload(tab.id);
      window.close();
    }
  });
});
