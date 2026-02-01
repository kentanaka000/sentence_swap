// Background service worker for Sentence Swap extension
// Handles DeepSeek API calls to avoid CORS issues in content scripts

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
    throw new Error('DeepSeek API key not configured. Please set it in extension options.');
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
  const failed = results.length - successful;

  return {
    completed: true,
    summary: { successful, failed, total: results.length }
  };
}

async function translateSentence(sentence, context, targetLanguage, apiKey) {
  const prompt = buildPrompt(sentence, context, targetLanguage);

  const systemPrompt = `Translate sentences to ${targetLanguage}. Return JSON only.

First, check if the sentence boundary is correct (not split mid-URL, decimal, abbreviation like "e.g.", or name like "Stephen A. Smith"). Use the surrounding context to judge.

Response format:
- Valid: {"valid": true, "translation": "..."}
- Invalid: {"valid": false}

Keep proper nouns as-is unless they have well-known translations.`;

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API request failed: ${response.status}`);
  }

  const data = await response.json();

  // Validate response structure
  if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
    throw new Error('Invalid API response structure');
  }

  const content = data.choices[0].message.content.trim();

  let result;
  try {
    result = JSON.parse(content);
  } catch (e) {
    throw new Error('Invalid JSON response from API');
  }

  if (!result.valid) {
    throw new Error('Sentence not valid for translation');
  }

  return result.translation;
}

function buildPrompt(sentence, context, targetLanguage) {
  let prompt = '';

  if (context.before) {
    prompt += `Context before: "${context.before}"\n\n`;
  }

  prompt += `Translate this sentence to ${targetLanguage}:\n"${sentence}"`;

  if (context.after) {
    prompt += `\n\nContext after: "${context.after}"`;
  }

  return prompt;
}
