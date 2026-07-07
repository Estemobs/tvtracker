import { fetchWithRetry } from './httpRetry.js';

const API_BASE = 'https://api.mymemory.translated.net/get';
const MAX_CHUNK = 480; // MyMemory's anonymous tier hard-caps queries at 500 chars

function splitIntoChunks(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current + ' ' + sentence).length > MAX_CHUNK) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, MAX_CHUNK)];
}

async function translateChunk(text, langpair) {
  const url = new URL(API_BASE);
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', langpair);
  const resp = await fetchWithRetry(url);
  if (!resp.ok) throw new Error(`Erreur de traduction (${resp.status})`);
  const data = await resp.json();
  if (data.responseStatus !== 200 || !data.responseData?.translatedText) {
    throw new Error('Traduction indisponible.');
  }
  return data.responseData.translatedText;
}

export async function translateToFrench(text) {
  if (!text) return '';
  const chunks = splitIntoChunks(text);
  const translated = [];
  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk, 'en|fr'));
  }
  return translated.join(' ');
}
