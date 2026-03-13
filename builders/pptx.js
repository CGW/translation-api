/**
 * PPTX Rebuilder
 *
 * Strategy: Instead of reconstructing slides from scratch (which loses all
 * original styling, images, and layout), we take the original PPTX ZIP,
 * find each text string in the slide XML, and replace it with the translation.
 *
 * This is the key insight that makes the pipeline practical:
 * the backend never needs to know about fonts, colors, or layouts.
 */

const JSZip = require('jszip');

/**
 * Rebuild a PPTX by replacing original text with translated text.
 *
 * @param {Buffer} originalBuffer - The original PPTX file
 * @param {Array} originalSections - Sections from parsePptx()
 * @param {Array} translatedSections - Same structure, text replaced with translations
 * @returns {Promise<Buffer>} - The new PPTX file as a buffer
 */
async function rebuildPptx(originalBuffer, originalSections, translatedSections) {
  const zip = await JSZip.loadAsync(originalBuffer);

  // Build a lookup: slideFile -> map of { originalText -> translatedText }
  const replacementMap = buildReplacementMap(originalSections, translatedSections);

  for (const [slideFile, replacements] of Object.entries(replacementMap)) {
    if (!zip.files[slideFile]) continue;

    let xml = await zip.files[slideFile].async('string');

    // Replace each original text string with its translation
    // We work with the raw XML string for reliability
    for (const [original, translated] of Object.entries(replacements)) {
      if (!original.trim() || original === translated) continue;

      // Escape for XML context, then replace
      const escapedOriginal = escapeXml(original);
      const escapedTranslated = escapeXml(translated);

      // Replace within <a:t>...</a:t> tags to avoid touching attribute values
      xml = replaceInXmlTextNodes(xml, escapedOriginal, escapedTranslated);
    }

    zip.file(slideFile, xml);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Build a map of { slideFile: { originalText: translatedText } }
 */
function buildReplacementMap(originalSections, translatedSections) {
  const map = {};

  for (let i = 0; i < originalSections.length; i++) {
    const orig = originalSections[i];
    const trans = translatedSections.find(s => s.id === orig.id);
    if (!trans) continue;

    if (!map[orig.slideFile]) map[orig.slideFile] = {};

    for (let j = 0; j < orig.blocks.length; j++) {
      const origBlock = orig.blocks[j];
      const transBlock = trans.blocks[j];

      // Skip blocks marked as keep (TEKS codes, etc.)
      if (origBlock.keep || !transBlock) continue;

      const origText = origBlock.text;
      const transText = transBlock.text;

      if (origText && transText && origText !== transText) {
        map[orig.slideFile][origText] = transText;
      }
    }
  }

  return map;
}

/**
 * Replace text only within <a:t>...</a:t> XML nodes.
 * This prevents accidentally replacing text in attribute values or other elements.
 */
function replaceInXmlTextNodes(xml, original, translated) {
  // Match <a:t> content and replace within it
  return xml.replace(/<a:t([^>]*)>([\s\S]*?)<\/a:t>/g, (match, attrs, content) => {
    if (content.includes(original)) {
      return `<a:t${attrs}>${content.split(original).join(translated)}</a:t>`;
    }
    return match;
  });
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { rebuildPptx };
