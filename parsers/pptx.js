/**
 * PPTX Parser
 *
 * Strategy: PPTX files are ZIP archives containing XML slide files.
 * We unzip, extract text from each slide's XML (a:t elements),
 * and store the original file for later reassembly via text replacement.
 *
 * This approach preserves ALL original formatting, images, and layout
 * because we replace text in-place rather than rebuilding from scratch.
 */

const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['p:sp', 'a:p', 'a:r', 'a:t', 'p:graphicFrame', 'a:tr', 'a:tc'].includes(name),
});

/**
 * Parse a PPTX buffer into structured sections (one per slide).
 * @param {Buffer} buffer - Raw PPTX file bytes
 * @returns {Promise<{ sections: Array, slideCount: number, zipData: Buffer }>}
 */
async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  // Find all slide files, sorted in presentation order
  const slideFiles = Object.keys(zip.files)
    .filter(name => name.match(/^ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)[1]);
      const numB = parseInt(b.match(/slide(\d+)/)[1]);
      return numA - numB;
    });

  const sections = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.files[slideFiles[i]].async('string');
    const parsed = parser.parse(slideXml);

    const blocks = [];
    extractTextBlocks(parsed, blocks);

    // Use first heading-like text as the section title
    const titleBlock = blocks.find(b => b.type === 'heading') || blocks[0];
    const title = titleBlock ? titleBlock.text : `Slide ${i + 1}`;

    sections.push({
      id: `slide_${i + 1}`,
      slideFile: slideFiles[i],
      title: title.slice(0, 80), // cap title length
      blocks: blocks.filter(b => b.text.trim().length > 0),
    });
  }

  return { sections, slideCount: slideFiles.length };
}

/**
 * Walk the parsed XML tree and extract text blocks with type hints.
 */
function extractTextBlocks(node, blocks, depth = 0) {
  if (!node || typeof node !== 'object') return;

  // Shapes (p:sp) contain text frames
  const shapes = getArray(node, 'p:sp') || getArray(node?.['p:cSld']?.['p:spTree'], 'p:sp') || [];

  for (const shape of shapes) {
    const txBody = shape?.['p:txBody'];
    if (!txBody) continue;

    const paragraphs = getArray(txBody, 'a:p') || [];
    let isFirst = true;

    for (const para of paragraphs) {
      const text = extractParagraphText(para);
      if (!text.trim()) continue;

      // Heuristic: first text in first shape, or large bold text = heading
      const isBold = isTextBold(para);
      const type = (isFirst && depth === 0) ? 'heading' : (isBold ? 'heading' : 'body');

      blocks.push({
        type,
        text: text.trim(),
        // keep: true means "do not translate this" — flag TEKS codes etc.
        keep: /TEKS\s+\d|^\s*[A-Z]{2,}\s*$/.test(text),
      });
      isFirst = false;
    }
  }

  // Recurse into child nodes (handles grouped shapes, etc.)
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      child.forEach(c => extractTextBlocks(c, blocks, depth + 1));
    } else if (typeof child === 'object') {
      extractTextBlocks(child, blocks, depth + 1);
    }
  }
}

function extractParagraphText(para) {
  const runs = getArray(para, 'a:r') || [];
  return runs
    .map(r => {
      const t = r?.['a:t'];
      if (typeof t === 'string') return t;
      if (typeof t === 'object') return t['#text'] || '';
      return '';
    })
    .join('');
}

function isTextBold(para) {
  const runs = getArray(para, 'a:r') || [];
  return runs.some(r => r?.['a:rPr']?.['@_b'] === '1' || r?.['a:rPr']?.['@_b'] === true);
}

function getArray(obj, key) {
  if (!obj) return [];
  const val = obj[key];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

module.exports = { parsePptx };
