/**
 * Restore — Vercel Node.js Function
 * POST /api/process-image
 */

const OPENAI_PROMPTS = {
  definition: `Professional archival digitization: enhance the sharpness and clarity of this historical photograph. Increase apparent resolution and recover fine details in textures, clothing and background. Reduce blur and grain noise while preserving the authentic vintage character. Non-commercial archival project.`,
  color: `Professional archival digitization: correct the exposure, contrast and tonal range of this historical photograph. Recover detail in highlights and shadows. Improve overall clarity and dynamic range while maintaining natural period-accurate tones. Non-commercial archival project.`,
  colorize: `Professional archival digitization: apply historically accurate colorization to this black and white historical photograph. Use natural period-appropriate colors from the mid 20th century. Preserve all original details and textures without alteration. Avoid oversaturation. Non-commercial archival project.`,
};

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, action } = req.body || {};
  if (!image || !action) return res.status(400).json({ error: 'Missing image or action' });

  try {
    if (action === 'restore') {
      return await startReplicate(image, res);
    } else {
      return await processWithOpenAI(image, action, res);
    }
  } catch (err) {
    console.error('process-image error:', err);
    return res.status(500).json({ error: 'processing_failed', message: err.message });
  }
}

async function startReplicate(imageDataUrl, res) {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) throw new Error('REPLICATE_API_KEY not configured');

  const r = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
      input: { image: imageDataUrl, scale: 4, face_enhance: true },
    }),
  });

  if (!r.ok) throw new Error(`Replicate create: ${r.status} ${await r.text()}`);

  const prediction = await r.json();
  return res.status(200).json({
    type: 'polling',
    predictionId: prediction.id,
  });
}

async function processWithOpenAI(imageDataUrl, action, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const prompt = OPENAI_PROMPTS[action];
  if (!prompt) throw new Error(`Unknown action: ${action}`);

  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image format');

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const blob = new Blob([buffer], { type: mimeType });

  const formData = new FormData();
  formData.append('model', 'gpt-image-1');
  formData.append('prompt', prompt);
  formData.append('n', '1');
  formData.append('size', '1024x1024');
  formData.append('quality', 'medium');
  formData.append('response_format', 'b64_json');
  formData.append('image', blob, 'photo.jpg');

  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!r.ok) {
    const errText = await r.text();
    if (r.status === 400) {
      return res.status(422).json({
        error: 'content_policy',
        message: 'Imagen rechazada por políticas de contenido. Prueba con Restaurar.',
      });
    }
    throw new Error(`OpenAI ${r.status}: ${errText}`);
  }

  const data = await r.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image in OpenAI response');

  return res.status(200).json({
    type: 'result',
    resultImage: `data:image/png;base64,${b64}`,
  });
}
