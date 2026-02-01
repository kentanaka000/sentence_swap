// Content script for Sentence Swap extension
// Extracts sentences from main content and replaces random ones with translations

(async function() {
  // Prevent running multiple times
  if (window.__sentenceSwapInitialized) return;
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

  // Select random sentences based on percentage
  const selectedCount = Math.max(1, Math.floor(allSentences.length * (settings.percentage / 100)));
  const selectedSentences = selectRandomSentences(allSentences, selectedCount);

  // Prepare sentences with context for translation
  const sentencesWithContext = selectedSentences.map(item => ({
    index: item.index,
    sentence: item.sentence,
    context: {
      before: item.index > 0 ? allSentences[item.index - 1]?.sentence : null,
      after: item.index < allSentences.length - 1 ? allSentences[item.index + 1]?.sentence : null
    }
  }));

  // Request translations from background script
  const response = await chrome.runtime.sendMessage({
    action: 'translate',
    sentences: sentencesWithContext,
    targetLanguage: settings.targetLanguage,
    apiKey: settings.apiKey
  });

  if (response.error) {
    console.error('Sentence Swap translation error:', response.error);
    return;
  }

  // Apply translations to the DOM
  applyTranslations(response.translations, allSentences);
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
      if (sentence.length > 20) { // Skip very short sentences
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

    // Handle remaining text without sentence-ending punctuation
    const remaining = text.slice(lastIndex).trim();
    if (remaining.length > 50) {
      sentences.push({
        index: sentences.length,
        sentence: remaining,
        textNode: textNode,
        startOffset: lastIndex,
        endOffset: text.length
      });
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

function applyTranslations(translations, allSentences) {
  console.log(translations, allSentences)
  // Group translations by text node
  const translationMap = new Map();
  for (const trans of translations) {
    if (!trans.translated) continue;

    const sentenceInfo = allSentences[trans.index];
    if (!sentenceInfo) continue;

    if (!translationMap.has(sentenceInfo.textNode)) {
      translationMap.set(sentenceInfo.textNode, []);
    }
    translationMap.set(sentenceInfo.textNode, [
      ...translationMap.get(sentenceInfo.textNode),
      {
        ...trans,
        startOffset: sentenceInfo.startOffset,
        endOffset: sentenceInfo.endOffset
      }
    ]);
  }

  // Apply translations to each text node
  for (const [textNode, nodeTranslations] of translationMap) {
    // Sort by offset descending so we can replace from end to start
    nodeTranslations.sort((a, b) => b.startOffset - a.startOffset);

    replaceInTextNode(textNode, nodeTranslations);
  }
}

function replaceInTextNode(textNode, translations) {
  const parent = textNode.parentNode;
  if (!parent) return;

  const originalText = textNode.textContent;
  const fragment = document.createDocumentFragment();

  let currentPos = 0;

  // Sort translations by start offset ascending for processing
  const sortedTranslations = [...translations].sort((a, b) => a.startOffset - b.startOffset);

  for (const trans of sortedTranslations) {
    // Add text before this translation
    if (trans.startOffset > currentPos) {
      fragment.appendChild(document.createTextNode(originalText.slice(currentPos, trans.startOffset)));
    }

    // Create the hover-to-reveal wrapper
    const wrapper = document.createElement('span');
    wrapper.className = 'sentence-swap-translated';
    wrapper.dataset.original = trans.original;
    wrapper.dataset.translated = trans.translated;
    wrapper.textContent = trans.translated;

    // Add tooltip with original text
    wrapper.title = trans.original;

    fragment.appendChild(wrapper);
    currentPos = trans.endOffset;
  }

  // Add remaining text
  if (currentPos < originalText.length) {
    fragment.appendChild(document.createTextNode(originalText.slice(currentPos)));
  }

  // Replace the text node with our fragment
  parent.replaceChild(fragment, textNode);
}
