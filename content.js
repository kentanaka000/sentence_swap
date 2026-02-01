// Content script for Sentence Swap extension
// Extracts sentences from main content and replaces random ones with translations

(async function() {
  // Prevent running multiple times
  if (window.__sentenceSwapInitialized) {
    return;
  }

  window.__sentenceSwapInitialized = true;

  // Load settings
  const settings = await loadSettings();

  if (!settings.enabled) {
    return;
  }

  if (!settings.apiKey) {
    console.log('Sentence Swap: API key not configured');
    return;
  }

  // Wait for page to be fully loaded
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  }

  // Small delay to let dynamic content load
  await new Promise(resolve => setTimeout(resolve, 500));

  // Listen for translation results from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translationResult') {
      applyTranslation(request.translation);
      sendResponse({ received: true });
    }
    return true;
  });

  try {
    await processPage(settings);
  } catch (error) {
    console.error('Sentence Swap error:', error);
  }
})();

async function loadSettings() {
  // Load non-sensitive settings from sync storage
  const syncSettings = await new Promise(resolve => {
    chrome.storage.sync.get({
      enabled: true,
      targetLanguage: 'Spanish',
      percentage: 15
    }, resolve);
  });

  // Load API key from local storage (more secure, doesn't sync across devices)
  const localSettings = await new Promise(resolve => {
    chrome.storage.local.get({
      apiKey: ''
    }, resolve);
  });

  return { ...syncSettings, ...localSettings };
}

async function processPage(settings) {
  // Find main content
  const mainContent = findMainContent();
  if (!mainContent) {
    console.log('Sentence Swap: No main content found');
    return;
  }

  // Extract text nodes with sentences
  const textNodes = extractTextNodes(mainContent);
  if (textNodes.length === 0) {
    console.log('Sentence Swap: No text content found');
    return;
  }

  // Parse all sentences with their positions
  const allSentences = parseSentences(textNodes);
  const numValidSentences = allSentences.filter(s => s.valid).length;
  if (numValidSentences === 0) {
    console.log('Sentence Swap: No sentences found');
    return;
  }

  // Calculate total characters in all text nodes
  const totalChars = allSentences.reduce((sum, s) => sum + s.sentence.length, 0);

  // Calculate total characters in valid sentences
  const validSentenceChars = allSentences.filter(s => s.valid).reduce((sum, s) => sum + s.sentence.length, 0);

  // Adjust percentage so that x% of total text gets translated
  // Formula: (adjusted% of valid sentences) * validChars = x% * totalChars
  const adjustedPercentage = validSentenceChars > 0
    ? (totalChars / validSentenceChars) * settings.percentage
    : settings.percentage;

  // Select random sentences - each valid sentence has adjustedPercentage chance of being picked
  const selectedSentences = selectRandomSentences(allSentences, adjustedPercentage);

  // Pre-wrap selected sentences with placeholder spans
  wrapSentencesWithPlaceholders(selectedSentences, allSentences);

  // Prepare sentences with context for translation
  const sentencesWithContext = selectedSentences.map(item => ({
    index: item.index,
    sentence: item.sentence,
    context: {
      before: item.index > 0 ? allSentences[item.index - 1]?.sentence : null,
      after: item.index < allSentences.length - 1 ? allSentences[item.index + 1]?.sentence : null
    }
  }));

  // Request translations from background script (they'll arrive asynchronously)
  const response = await chrome.runtime.sendMessage({
    action: 'translate',
    sentences: sentencesWithContext,
    targetLanguage: settings.targetLanguage,
    apiKey: settings.apiKey
  });

  if (response.error) {
    console.error('Sentence Swap translation error:', response.error);
    // Remove placeholders on error
    removePlaceholders();
    return;
  }

  console.log('Sentence Swap: Translation complete', response.summary);
}

function wrapSentencesWithPlaceholders(selectedSentences, allSentences) {
  // Group by text node and sort by offset descending (so we replace from end to start)
  const byTextNode = new Map();

  for (const sentence of selectedSentences) {
    const sentenceInfo = allSentences[sentence.index];
    if (!byTextNode.has(sentenceInfo.textNode)) {
      byTextNode.set(sentenceInfo.textNode, []);
    }
    byTextNode.get(sentenceInfo.textNode).push({
      ...sentenceInfo,
      originalIndex: sentence.index
    });
  }

  // Process each text node
  for (const [textNode, sentences] of byTextNode) {
    // Sort by offset descending
    sentences.sort((a, b) => b.startOffset - a.startOffset);

    const parent = textNode.parentNode;
    if (!parent) continue;

    const originalText = textNode.textContent;
    const fragment = document.createDocumentFragment();

    // Sort ascending for building the fragment
    const sortedAsc = [...sentences].sort((a, b) => a.startOffset - b.startOffset);

    let currentPos = 0;
    for (const sent of sortedAsc) {
      // Add text before this sentence
      if (sent.startOffset > currentPos) {
        fragment.appendChild(document.createTextNode(originalText.slice(currentPos, sent.startOffset)));
      }

      // Create placeholder span
      const wrapper = document.createElement('span');
      wrapper.className = 'sentence-swap-placeholder';
      wrapper.dataset.sentenceIndex = sent.originalIndex;
      wrapper.dataset.original = sent.sentence;
      wrapper.textContent = sent.sentence; // Show original until translation arrives

      fragment.appendChild(wrapper);
      currentPos = sent.endOffset;
    }

    // Add remaining text
    if (currentPos < originalText.length) {
      fragment.appendChild(document.createTextNode(originalText.slice(currentPos)));
    }

    // Replace the text node
    parent.replaceChild(fragment, textNode);
  }
}

function applyTranslation(translation) {
  // Find the placeholder span for this sentence
  const placeholder = document.querySelector(
    `.sentence-swap-placeholder[data-sentence-index="${translation.index}"]`
  );

  if (!translation.success || !translation.translated) {
    // Log the error
    console.error('Sentence Swap: Translation failed for:', translation.original, translation.error || 'Unknown error');
    // Remove the placeholder for failed translations
    if (placeholder) {
      // Replace with original text
      placeholder.replaceWith(document.createTextNode(placeholder.dataset.original));
    }
    return;
  }

  if (!placeholder) {
    console.warn('Sentence Swap: Could not find placeholder for index', translation.index);
    return;
  }

  // Convert placeholder to translated span
  placeholder.className = 'sentence-swap-translated';
  placeholder.dataset.translated = translation.translated;
  placeholder.textContent = translation.translated;
  placeholder.title = translation.original;
}

function removePlaceholders() {
  const placeholders = document.querySelectorAll('.sentence-swap-placeholder');
  for (const placeholder of placeholders) {
    placeholder.replaceWith(document.createTextNode(placeholder.dataset.original));
  }
}

function findMainContent() {
  // Priority order for finding main content
  const selectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
    '.post',
    '.article'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim().length > 200) {
      return element;
    }
  }

  // Fallback: find the element with the most paragraph text
  const paragraphs = document.querySelectorAll('p');
  if (paragraphs.length > 0) {
    // Find common ancestor of most paragraphs
    const body = document.body;
    let bestContainer = body;
    let bestScore = 0;

    const containers = document.querySelectorAll('div, section, article');
    for (const container of containers) {
      const containedParagraphs = container.querySelectorAll('p');
      const textLength = Array.from(containedParagraphs)
        .reduce((sum, p) => sum + p.textContent.length, 0);

      if (textLength > bestScore && textLength > 500) {
        bestScore = textLength;
        bestContainer = container;
      }
    }

    return bestContainer;
  }

  return document.body;
}

function extractTextNodes(root) {
  const textNodes = [];
  const skipTags = new Set(['script', 'style', 'noscript', 'iframe', 'nav', 'header', 'footer', 'aside', 'button', 'input', 'textarea', 'select', 'code', 'pre']);

  // Walk elements first, skipping entire hidden subtrees
  function walkElement(element) {
    const tagName = element.tagName.toLowerCase();

    // Skip entire subtree for these tags
    if (skipTags.has(tagName)) {
      return;
    }

    // Skip navigation and menu subtrees
    const role = element.getAttribute('role');
    if (role === 'navigation' || role === 'banner' || role === 'contentinfo') {
      return;
    }

    // Skip hidden elements and their subtrees
    if (!element.checkVisibility({ checkVisibilityCSS: true })) {
      return;
    }

    // Process child nodes
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent.trim()) {
          textNodes.push(child);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walkElement(child);
      }
    }
  }

  walkElement(root);
  return textNodes;
}

function parseSentences(textNodes) {
  const sentences = [];

  for (const textNode of textNodes) {
    const text = textNode.textContent;

    // Use matchAll to avoid global regex state issues
    // Matches sentence boundaries: punctuation followed by whitespace or end of text
    const matches = text.matchAll(/([^.!?]*[.!?]+)(?=\s|$)/g);

    for (const match of matches) {
      const rawMatch = match[1];
      const sentence = rawMatch.trim();

      // Calculate correct offsets for the trimmed sentence
      const leadingWhitespace = rawMatch.length - rawMatch.trimStart().length;
      const trailingWhitespace = rawMatch.length - rawMatch.trimEnd().length;
      const startOffset = match.index + leadingWhitespace;
      const endOffset = match.index + rawMatch.length - trailingWhitespace;

      // Skip short sentences and those not starting with a capital letter
      const startsWithCapital = /^[A-Z]/.test(sentence);
      const valid = sentence.length > 20 && startsWithCapital;
      sentences.push({
        index: sentences.length,
        sentence: sentence,
        textNode: textNode,
        startOffset: startOffset,
        endOffset: endOffset,
        valid: valid
      });
    }
  }

  return sentences;
}

function selectRandomSentences(sentences, percentage) {
  const selected = [];
  const maxSentences = 30;
  const probability = percentage / 100;

  for (const sentence of sentences) {
    // Only consider valid sentences
    if (!sentence.valid) {
      continue;
    }

    // Randomly pick this sentence with the given probability
    if (Math.random() < probability) {
      selected.push(sentence);

      // Stop if we've reached the maximum
      if (selected.length >= maxSentences) {
        break;
      }
    }
  }

  return selected;
}