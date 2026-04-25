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

// ============================================================================
// PROMPTS DE FLUX-KONTEXT — afinados quirúrgicamente
// Cada acción hace UNA SOLA cosa, sin invadir el territorio de las otras.
// La preservación de identidad es férrea en los tres.
// ============================================================================

// Bloqueo de identidad — se prepende a TODOS los prompts.
const IDENTITY_LOCK = (
  "ABSOLUTE RULE — IDENTITY PRESERVATION: " +
  "Do NOT alter, regenerate, redraw, beautify, idealize, smooth, or change in any way " +
  "the faces, facial features, facial expressions, eyes, nose, mouth, ears, hair style, " +
  "hair line, age, wrinkles, skin marks, ethnicity, body shape, body proportions, or identity " +
  "of ANY person in the photograph. Every person must remain pixel-faithful to the original — " +
  "same exact face, same age, same expression, same identity. " +
  "Do NOT change the composition, framing, pose, or any object's shape. " +
  "Do NOT regenerate or 'enhance' faces. Treat all human features as untouchable. "
);

// Bloqueo de scope — refuerza que la acción NO debe invadir otras tareas.
const SCOPE_LOCK = (
  "STAY IN YOUR LANE — Do ONLY the task described below. " +
  "Do NOT do anything else. If the task is not listed below, do not do it. "
);

const PROMPTS = {
  // ─── DEFINICIÓN — solo nitidez, NUNCA color ────────────────────────────────
  definition: IDENTITY_LOCK + SCOPE_LOCK +
    "TASK: Enhance the perceived resolution and sharpness of this photograph. " +
    "Recover fine details and textures in fabric, hair, skin pores, eyes, background and surfaces. " +
    "Reduce blur and softness. Make grain crisp and authentic. " +
    "STRICT FORBIDDEN: do NOT add color, do NOT colorize, do NOT shift hues, do NOT change saturation. " +
    "If the photograph is black-and-white or sepia, the output MUST remain black-and-white or sepia respectively. " +
    "Do NOT change exposure, do NOT change contrast, do NOT alter lighting, do NOT remove damage or scratches. " +
    "ONLY improve sharpness and recover detail. Treat this as a 'better scan, not a painting'.",

  // ─── COLOREA — solo color, NUNCA nitidez ni reparación ─────────────────────
  colorize: IDENTITY_LOCK + SCOPE_LOCK +
    "TASK: Apply realistic, historically accurate colorization to this black and white or sepia photograph. " +
    "Use natural, period-appropriate colors (early-to-mid 20th century palette by default, unless clothing or context indicate otherwise). " +
    "Skin tones must be natural and match the apparent ethnicity of each person without altering their features. " +
    "Clothing colors must look authentic to the era. Environmental hues (sky, foliage, walls, wood, metal) must be plausible. " +
    "STRICT FORBIDDEN: do NOT increase resolution, do NOT sharpen, do NOT change definition, do NOT increase contrast beyond what colorization requires, " +
    "do NOT remove scratches, dust, stains, tears or any physical damage. " +
    "Do NOT oversaturate. Do NOT use vibrant or modern colors. The mood must remain vintage. " +
    "ONLY add natural color where there is none.",

  // ─── REPARA — solo daño físico, NUNCA color ni nitidez ────────────────────
  repair: IDENTITY_LOCK + SCOPE_LOCK +
    "TASK: Repair physical damage in this photograph. " +
    "Specifically: remove scratches, dust spots, stains, tears, creases, fold marks, fingerprints, water marks, mold spots, " +
    "missing corners, torn edges, and emulsion damage. Reconstruct each damaged area to seamlessly match the surrounding " +
    "content, textures, grain and tone of the original. " +
    "STRICT FORBIDDEN: do NOT add color, do NOT colorize, do NOT shift hues, do NOT change saturation. " +
    "If the photograph is black-and-white or sepia, the output MUST remain black-and-white or sepia respectively. " +
    "Do NOT increase resolution, do NOT sharpen, do NOT change exposure, do NOT alter contrast or lighting. " +
    "ONLY repair physical damage. The repaired areas must be invisible — they should look like the damage was never there.",
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
