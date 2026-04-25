/**
 * Restore — Vercel Node.js Function
 * POST /api/process-image
 * 
 * Stack: 100% Replicate
 *  - definition / color / colorize → flux-kontext-pro con prompt específico
 *  - restore                       → flux-kontext-apps/restore-image (todo en uno)
 *
 * Variables de entorno:
 *   REPLICATE_API_KEY = r8_...
 */

// IDENTITY_LOCK: directiva común que se prepende a todos los prompts.
// El énfasis en preservar rasgos faciales es CRÍTICO — flux-kontext puede alterar caras
// si el prompt no es muy explícito. Esto se repite intencionalmente.
const IDENTITY_LOCK = "CRITICAL: Do NOT alter, regenerate, redraw, beautify, idealize or change in any way the faces, facial features, facial expressions, eyes, nose, mouth, ears, hair, age, ethnicity, body proportions, or identity of ANY person in the photograph. Every person must remain exactly identical to the original — same face, same age, same expression, same identity. Only modify lighting, color, texture clarity, damage and background as instructed. ";

const PROMPTS = {
  definition: IDENTITY_LOCK + "Task: Enhance the sharpness, clarity and detail of this old photograph. Recover fine textures in fabric and background. Preserve the authentic vintage character. The faces and people must look IDENTICAL to the original.",

  color: IDENTITY_LOCK + "Task: Improve the color balance, contrast and lighting of this old photograph. Recover details in shadows and highlights. Make it look natural and well-exposed. The faces and people must look IDENTICAL to the original.",

  colorize: IDENTITY_LOCK + "Task: Colorize this black and white photograph with realistic, historically accurate colors from the mid 20th century. Use natural, period-appropriate clothing colors and environmental hues. The faces and people must look IDENTICAL to the original — same exact features, only adding natural color.",
};

// Modelos en Replicate (versiones más recientes)
const MODELS = {
  // flux-kontext-pro: edición conversacional
  edit: 'black-forest-labs/flux-kontext-pro',
  // flux-kontext-apps/restore-image: restauración total automática
  restore: 'flux-kontext-apps/restore-image',
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, action } = req.body || {};
  if (!image || !action) return res.status(400).json({ error: 'Missing image or action' });

  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'REPLICATE_API_KEY not configured' });

  try {
    let body;

    if (action === 'restore') {
      // flux-kontext-apps/restore-image: especialista en fotos antiguas.
      // Solo acepta input_image y seed; preserva rostros por diseño del modelo.
      body = {
        input: {
          input_image: image,
        },
      };
    } else {
      // flux-kontext-pro con prompt específico
      const prompt = PROMPTS[action];
      if (!prompt) return res.status(400).json({ error: `Unknown action: ${action}` });
      body = {
        input: {
          prompt,
          input_image: image,
          output_format: 'jpg',
          safety_tolerance: 6, // máximo permisivo (1-6)
        },
      };
    }

    // Usar el endpoint oficial del modelo (sin necesidad de version hash)
    const modelPath = MODELS[action === 'restore' ? 'restore' : 'edit'];
    const r = await fetch(`https://api.replicate.com/v1/models/${modelPath}/predictions`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=5', // espera hasta 5s por si termina rápido
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('Replicate error:', r.status, errText);
      return res.status(500).json({ error: 'replicate_error', message: errText.slice(0, 200) });
    }

    const prediction = await r.json();

    // Si ya terminó (raro pero posible con Prefer: wait)
    if (prediction.status === 'succeeded' && prediction.output) {
      const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      const imgRes = await fetch(outputUrl);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const b64 = buffer.toString('base64');
      const mime = imgRes.headers.get('content-type') || 'image/jpeg';
      return res.status(200).json({
        type: 'result',
        resultImage: `data:${mime};base64,${b64}`,
      });
    }

    // Lo normal: devolver predictionId para que el frontend haga polling
    return res.status(200).json({
      type: 'polling',
      predictionId: prediction.id,
    });

  } catch (err) {
    console.error('process-image error:', err);
    return res.status(500).json({ error: 'processing_failed', message: err.message });
  }
}
