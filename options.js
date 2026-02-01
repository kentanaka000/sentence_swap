// Options page script for Sentence Swap extension

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settingsForm');
  const apiKeyInput = document.getElementById('apiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKey');
  const targetLanguageSelect = document.getElementById('targetLanguage');
  const percentageInput = document.getElementById('percentage');
  const percentageValue = document.getElementById('percentageValue');
  const status = document.getElementById('status');

  // Load current settings
  const settings = await new Promise(resolve => {
    chrome.storage.sync.get({
      apiKey: '',
      targetLanguage: 'Spanish',
      percentage: 15
    }, resolve);
  });

  // Populate form with current settings
  apiKeyInput.value = settings.apiKey;
  targetLanguageSelect.value = settings.targetLanguage;
  percentageInput.value = settings.percentage;
  percentageValue.textContent = `${settings.percentage}%`;

  // Handle percentage slider change
  percentageInput.addEventListener('input', () => {
    percentageValue.textContent = `${percentageInput.value}%`;
  });

  // Handle API key visibility toggle
  toggleApiKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyBtn.textContent = '👁';
    }
  });

  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const newSettings = {
      apiKey: apiKeyInput.value.trim(),
      targetLanguage: targetLanguageSelect.value,
      percentage: parseInt(percentageInput.value, 10)
    };

    try {
      await chrome.storage.sync.set(newSettings);
      showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      showStatus('Error saving settings: ' + error.message, 'error');
    }
  });

  function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;

    setTimeout(() => {
      status.className = 'status';
    }, 3000);
  }
});
