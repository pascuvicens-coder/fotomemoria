/**
 * Restore — Vercel Edge Function
 * POST /api/process-image
 *
 * Variables de entorno en Vercel:
 *   OPENAI_API_KEY    = sk-proj-...
 *   REPLICATE_API_KEY = r8_...
 *
 * Estrategia:
 *   definition / color / colorize → OpenAI gpt-image-1
 *   restore                       → Replicate GFPGAN (sin filtros, especializado en fotos antiguas)
 */

export const config = { runtime: 'edge' };

const OPENAI_PROMPTS = {
  definition: `Professional archival digitization: enhance the sharpness and clarity of this historical photograph. Increase apparent resolution and recover fine details in textures, clothing and background. Reduce blur and grain noise while preserving the authentic vintage character. Non-commercial archival project.`,
  color: `Professional archival digitization: correct the exposure, contrast and tonal range of this historical photograph. Recover detail in highlights and shadows. Improve overall clarity and dynamic range while maintaining natural period-accurate tones. Non-commercial archival project.`,
  colorize: `Professional archival digitization: apply historically accurate colorization to this black and white historical photograph. Use natural period-appropriate colors from the mid 20th century. Preserve all original details and textures without alteration. Avoid oversaturation. Non-commercial archival project.`,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { image, action } = body;
  if (!image || !action) return json({ error: 'Missing image or action' }, 400);

  try {
    return action === 'restore'
      ? await processWithReplicate(image)
      : await processWithOpenAI(image, action);
  } catch (err) {
    console.error('process-image error:', err);
    return json({ error: 'processing_failed', message: err.message }, 500);
  }
}

async function processWithReplicate(imageDataUrl) {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('REPLICATE_API_KEY not configured');

  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: '0fbacf7afc6c144e5be9767cff80f25aff23e52b0708f17e20f9879b2f21516c',
      input: { img: imageDataUrl, version: 'v1.4', scale: 2 },
    }),
  });

  if (!createRes.ok) throw new Error(`Replicate create: ${createRes.status} ${await createRes.text()}`);

  const prediction = await createRes.json();
  const pollUrl = prediction.urls?.get;
  if (!pollUrl) throw new Error('No polling URL from Replicate');

  for (let i = 0; i < 30; i++) {
    await wait(2000);
    const poll = await fetch(pollUrl, { headers: { 'Authorization': `Token ${apiKey}` } });
    const result = await poll.json();

    if (result.status === 'succeeded') {
      const imgRes = await fetch(result.output);
      const b64 = bufferToBase64(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get('content-type') || 'image/png';
      return json({ resultImage: `data:${mime};base64,${b64}` });
    }
    if (result.status === 'failed' || result.status === 'canceled') {
      throw new Error(`Replicate ${result.status}: ${result.error || ''}`);
    }
  }
  throw new Error('Replicate timeout');
}

async function processWithOpenAI(imageDataUrl, action) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const prompt = OPENAI_PROMPTS[action];
  if (!prompt) throw new Error(`Unknown action: ${action}`);

  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image format');

  const imageBlob = new Blob([base64ToBytes(match[2])], { type: match[1] });
  const formData = new FormData();
  formData.append('model', 'gpt-image-1');
  formData.append('prompt', prompt);
  formData.append('n', '1');
  formData.append('size', '1024x1024');
  formData.append('quality', 'medium');
  formData.append('response_format', 'b64_json');
  formData.append('image', imageBlob, 'photo.jpg');

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 400) {
      return new Response(JSON.stringify({
        error: 'content_policy',
        message: 'Imagen rechazada por políticas de contenido. Prueba con Restaurar todo.',
      }), { status: 422, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image in OpenAI response');
  return json({ resultImage: `data:image/png;base64,${b64}` });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function base64ToBytes(b64) { const bin = atob(b64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
function bufferToBase64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]); return btoa(s); }
