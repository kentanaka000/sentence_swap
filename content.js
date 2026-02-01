// Content script for Sentence Swap extension
// Extracts sentences from main content and replaces random ones with translations

(async function() {
  // Prevent running multiple times
  if (window.__sentenceSwapInitialized) return;
  window.__sentenceSwapInitialized = true;

  // Store for sentence data (needed for applying translations)
  window.__sentenceSwapData = {
    allSentences: [],
    pendingTranslations: new Map()
  };

  // Listen for translation results from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translationResult') {
      applyTranslation(request.translation);
      sendResponse({ received: true });
    }
    return false;
  });

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
  if (document.readyState !== 'complete') {
    await new Promise(resolve => window.addEventListener('load', resolve));
  }

  // Small delay to let dynamic content load
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    await processPage(settings);
  } catch (error) {
    console.error('Sentence Swap error:', error);
  }
})();

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get({
      enabled: true,
      apiKey: '',
      targetLanguage: 'Spanish',
      percentage: 15
    }, resolve);
  });
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
  if (allSentences.length === 0) {
    console.log('Sentence Swap: No sentences found');
    return;
  }

  // Store for later use when translations arrive
  window.__sentenceSwapData.allSentences = allSentences;

  // Calculate total characters in all text nodes
  const totalChars = textNodes.reduce((sum, node) => sum + node.textContent.length, 0);

  // Calculate total characters in valid sentences
  const validSentenceChars = allSentences.reduce((sum, s) => sum + s.sentence.length, 0);

  // Adjust percentage so that x% of total text gets translated
  // Formula: (adjusted% of valid sentences) * validChars = x% * totalChars
  const adjustedPercentage = validSentenceChars > 0
    ? (totalChars / validSentenceChars) * settings.percentage
    : settings.percentage;

  // Select random sentences based on adjusted percentage, capped at 30
  const selectedCount = Math.min(30, Math.max(1, Math.floor(allSentences.length * (adjustedPercentage / 100))));
  const selectedSentences = selectRandomSentences(allSentences, selectedCount);

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

  console.log(response)
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
  if (!translation.success || !translation.translated) {
    // Remove the placeholder for failed translations
    const placeholder = document.querySelector(
      `.sentence-swap-placeholder[data-sentence-index="${translation.index}"]`
    );
    if (placeholder) {
      // Replace with original text
      placeholder.replaceWith(document.createTextNode(placeholder.dataset.original));
    }
    return;
  }

  // Find the placeholder span for this sentence
  const placeholder = document.querySelector(
    `.sentence-swap-placeholder[data-sentence-index="${translation.index}"]`
  );

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
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip empty nodes
        if (!node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip script, style, and other non-visible elements
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName.toLowerCase();
        const skipTags = ['script', 'style', 'noscript', 'iframe', 'nav', 'header', 'footer', 'aside', 'button', 'input', 'textarea', 'select', 'code', 'pre'];
        if (skipTags.includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip hidden elements
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip navigation and menu items
        if (parent.closest('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]')) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }

  return textNodes;
}

function parseSentences(textNodes) {
  const sentences = [];

  // Regex to split by sentence boundaries
  const sentenceRegex = /([^.!?]*[.!?]+[\s]*)/g;

  for (const textNode of textNodes) {
    const text = textNode.textContent;
    let match;
    let lastIndex = 0;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentence = match[1].trim();
      // Skip short sentences and those not starting with a capital letter
      const startsWithCapital = /^[A-Z]/.test(sentence);
      if (sentence.length > 20 && startsWithCapital) {
        sentences.push({
          index: sentences.length,
          sentence: sentence,
          textNode: textNode,
          startOffset: match.index,
          endOffset: match.index + match[1].length
        });
      }
      lastIndex = sentenceRegex.lastIndex;
    }
  }

  return sentences;
}

function selectRandomSentences(sentences, count) {
  const shuffled = [...sentences].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).sort((a, b) => {
    // Sort by textNode order, then by offset within the node
    const nodeIndexA = sentences.indexOf(a);
    const nodeIndexB = sentences.indexOf(b);
    return nodeIndexA - nodeIndexB;
  });
}
