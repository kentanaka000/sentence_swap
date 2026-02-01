# Sentence Swap

A Chrome extension that randomly translates sentences on web pages to help you learn languages through immersive reading.

## Features

- Automatically translates a percentage of sentences on any webpage
- Hover over translated text to reveal the original
- Configurable target language and translation percentage
- Skips navigation, headers, footers, and code blocks
- Only translates valid sentences (starts with capital letter, ends with punctuation)

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the `sentence_swap` folder
5. Open `generate-icons.html` in a browser and download the icons to the `icons/` folder

## Configuration

1. Click the extension icon and select "Settings"
2. Enter your DeepSeek API key ([get one here](https://platform.deepseek.com/api_keys))
3. Choose your target language
4. Adjust the translation percentage (what % of page text to translate)

## How It Works

1. When you visit a page, the extension extracts text from the main content
2. It identifies valid sentences (20+ characters, starts with capital, ends with punctuation)
3. Randomly selects sentences to translate based on your percentage setting
4. Sends sentences to DeepSeek API with surrounding context for better translations
5. Replaces original sentences with translations (hover to see original)

## Files

- `manifest.json` - Extension configuration
- `background.js` - Service worker handling API calls
- `content.js` - DOM manipulation and sentence extraction
- `popup.html/js` - Extension popup UI
- `options.html/js` - Settings page
- `styles.css` - Styling for translated text

## License

MIT
