/**
 * Restore — Vercel Node.js Function
 * POST /api/process-image
 *
 * Motores por acción (cada uno usa el modelo más adecuado):
 *
 *  definition  → nightmareai/real-esrgan
 *                Modelo de super-resolución puro. No "entiende" la imagen,
 *                solo aumenta píxeles. Nunca coloriza ni altera tonos.
 *
 *  colorize    → black-forest-labs/flux-kontext-pro
 *                Editor de imagen guiado por texto. Aquí sí brilla: es
 *                capaz de colorizar con contexto histórico preservando caras.
 *
 *  repair      → flux-kontext-apps/restore-image
 *                Modelo especializado en fotos antiguas (daño físico).
 *                Entrenado expresamente para manchas, arañazos y roturas.
 *
 * Variables de entorno:
 *   REPLICATE_API_KEY = r8_...
 */

// ============================================================================
// PROMPTS — solo para colorize (flux-kontext-pro acepta texto)
// ============================================================================

const IDENTITY_LOCK =
  "ABSOLUTE RULE — IDENTITY PRESERVATION: " +
  "Do NOT alter, regenerate, redraw, beautify, idealize, smooth, or change in any way " +
  "the faces, facial features, facial expressions, eyes, nose, mouth, ears, hair style, " +
  "hair line, age, wrinkles, skin marks, ethnicity, body shape, body proportions, or identity " +
  "of ANY person in the photograph. Every person must remain pixel-faithful to the original — " +
  "same exact face, same age, same expression, same identity. " +
  "Do NOT change the composition, framing, pose, or any object's shape. " +
  "Do NOT regenerate or enhance faces. Treat all human features as untouchable. ";

const SCOPE_LOCK =
  "STAY IN YOUR LANE — Do ONLY the task described below. Do NOT do anything else. ";

const PROMPTS = {
  colorize:
    IDENTITY_LOCK + SCOPE_LOCK +
    "TASK: Apply realistic, historically accurate colorization to this black and white or sepia photograph. " +
    "Use natural, period-appropriate colors (early-to-mid 20th century palette unless context indicates otherwise). " +
    "Skin tones: natural, warm, matching apparent ethnicity — never orange or washed out. " +
    "Clothing: muted, era-authentic colors (navy, olive, burgundy, grey, beige). " +
    "Backgrounds: natural hues — stone walls warm grey, wood brown, sky pale blue, foliage muted green. " +
    "Keep the vintage mood: slightly desaturated, never vivid or modern. " +
    "FORBIDDEN: do NOT change resolution, sharpness, or contrast beyond what the colorization itself requires. " +
    "Do NOT remove scratches, tears, or physical damage. ONLY add color.",
};

// ============================================================================
// MODELOS
// ============================================================================

const REALESRGAN_MODEL  = 'nightmareai/real-esrgan';
const FLUX_KONTEXT_MODEL = 'black-forest-labs/flux-kontext-pro';
const RESTORE_MODEL     = 'flux-kontext-apps/restore-image';

// ============================================================================

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: { sizeLimit: '5mb' },
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
    let modelPath;
    let body;

    if (action === 'definition') {
      // Real-ESRGAN: super-resolución pura, sin texto, sin edición creativa.
      // face_enhance activa GFPGAN internamente para proteger rostros.
      modelPath = REALESRGAN_MODEL;
      body = {
        input: {
          image,
          scale: 4,
          face_enhance: true,
        },
      };

    } else if (action === 'colorize') {
      // flux-kontext-pro: edición guiada por texto → ideal para colorizar.
      modelPath = FLUX_KONTEXT_MODEL;
      body = {
        input: {
          prompt: PROMPTS.colorize,
          input_image: image,
          output_format: 'jpg',
          safety_tolerance: 6,
        },
      };

    } else if (action === 'repair') {
      // restore-image: especialista en daño físico de fotografías antiguas.
      // Sin prompt — el modelo sabe lo que tiene que hacer con la imagen sola.
      modelPath = RESTORE_MODEL;
      body = {
        input: {
          input_image: image,
        },
      };

    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const r = await fetch(`https://api.replicate.com/v1/models/${modelPath}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=5',
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('Replicate error:', r.status, errText);
      return res.status(500).json({ error: 'replicate_error', message: errText.slice(0, 200) });
    }

    const prediction = await r.json();

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

    return res.status(200).json({
      type: 'polling',
      predictionId: prediction.id,
    });

  } catch (err) {
    console.error('process-image error:', err);
    return res.status(500).json({ error: 'processing_failed', message: err.message });
  }
}
