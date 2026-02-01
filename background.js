// Background service worker for Sentence Swap extension
// Handles Gemini API calls to avoid CORS issues in content scripts

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request.sentences, request.targetLanguage, request.apiKey, sender.tab.id)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep message channel open for async response
  }
});

async function handleTranslation(sentences, targetLanguage, apiKey, tabId) {
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Please set it in extension options.');
  }

  // Fire off all translation requests in parallel
  const translationPromises = sentences.map(item =>
    translateSentence(item.sentence, item.context, targetLanguage, apiKey)
      .then(translated => ({
        index: item.index,
        original: item.sentence,
        translated,
        success: true
      }))
      .catch(error => {
        console.error('Translation error for sentence:', item.sentence, error);
        return {
          index: item.index,
          original: item.sentence,
          translated: null,
          error: error.message,
          success: false
        };
      })
      .then(result => {
        // Send each translation to content script as it completes
        chrome.tabs.sendMessage(tabId, {
          action: 'translationResult',
          translation: result
        }).catch(() => {
          // Tab might be closed, ignore
        });
        return result;
      })
  );

  // Wait for all to complete (success or failure)
  const results = await Promise.all(translationPromises);

  // Return summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    completed: true,
    summary: { successful, failed, total: results.length }
  };
}

async function translateSentence(sentence, context, targetLanguage, apiKey) {
  const prompt = buildPrompt(sentence, context, targetLanguage);

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500
      }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text.trim();
}

function buildPrompt(sentence, context, targetLanguage) {
  let prompt = `You are a translator. Translate the given sentence to ${targetLanguage}.
Only output the translated sentence, nothing else.
Maintain the same tone and style as the original.
If the sentence contains proper nouns, keep them as-is unless they have a well-known translation.\n`;


  if (context.before) {
    prompt += `Context before: "${context.before}"\n\n`;
  }

  prompt += `Translate this sentence to ${targetLanguage}:\n"${sentence}"`;

  if (context.after) {
    prompt += `\n\nContext after: "${context.after}"`;
  }

  return prompt;
}
