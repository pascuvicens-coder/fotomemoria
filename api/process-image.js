/**
 * Restore — Vercel Node.js Function
 * POST /api/process-image
 *
 * Stack: 100% Replicate (una sola REPLICATE_API_KEY)
 *  - definition → topazlabs/image-upscale       (definición + nitidez profesional)
 *  - repair     → microsoft/bringing-old-photos-back-to-life (arañazos, roturas, daño físico)
 *  - colorize   → black-forest-labs/flux-kontext-pro (B/N → color natural)
 *
 * Variables de entorno:
 *   REPLICATE_API_KEY = r8_...
 */

// ============================================================================
// PROMPT DE COLORIZACIÓN — solo lo usa Flux Kontext (los otros dos modelos no
// aceptan prompt). La preservación de identidad es férrea.
// ============================================================================

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

const SCOPE_LOCK = (
  "STAY IN YOUR LANE — Do ONLY the task described below. " +
  "Do NOT do anything else. If the task is not listed below, do not do it. "
);

const COLORIZE_PROMPT = IDENTITY_LOCK + SCOPE_LOCK +
  "TASK: Apply realistic, historically accurate colorization to this black and white or sepia photograph. " +
  "Use natural, period-appropriate colors (early-to-mid 20th century palette by default, unless clothing or context indicate otherwise). " +
  "Skin tones must be natural and match the apparent ethnicity of each person without altering their features. " +
  "Clothing colors must look authentic to the era. Environmental hues (sky, foliage, walls, wood, metal) must be plausible. " +
  "STRICT FORBIDDEN: do NOT increase resolution, do NOT sharpen, do NOT change definition, do NOT increase contrast beyond what colorization requires, " +
  "do NOT remove scratches, dust, stains, tears or any physical damage. " +
  "Do NOT oversaturate. Do NOT use vibrant or modern colors. The mood must remain vintage. " +
  "ONLY add natural color where there is none.";

// ============================================================================
// CONFIGURACIÓN POR ACCIÓN
// ============================================================================

const ACTIONS = {
  // ─── DEFINICIÓN — Topaz Image Upscale (modelo "official", precio fijo) ───
  // Usa High Fidelity V2 para preservar máximo detalle original sin alucinar.
  // upscale_factor: 2 → suficiente para mejorar nitidez sin agrandar 4x (más caro).
  // face_enhancement: true → crítico para fotos antiguas con caras.
  // creativity 0 + strength 0.8 → look natural, sin "plástico".
  definition: {
    model: 'topazlabs/image-upscale',
    buildInput: (image) => ({
      image,
      enhance_model: 'High Fidelity V2',
      upscale_factor: '2x',
      output_format: 'jpg',
      subject_detection: 'All',
      face_enhancement: true,
      face_enhancement_creativity: 0,
      face_enhancement_strength: 0.8,
    }),
  },

  // ─── REPARA — Bringing Old Photos Back to Life ──────────────────────────
  // Modelo de Microsoft especializado en daño físico. No acepta prompt.
  // HR: true → soporte para alta resolución (mejor calidad, más lento).
  // with_scratch: true → activa el detector de arañazos. Lo dejamos siempre on
  // porque las fotos antiguas casi siempre tienen alguno.
  // ⚠️ Puede tardar hasta 4 minutos en T4 GPU. Polling obligatorio.
  repair: {
    model: 'microsoft/bringing-old-photos-back-to-life',
    buildInput: (image) => ({
      image,
      HR: true,
      with_scratch: true,
    }),
  },

  // ─── COLOREA — FLUX Kontext Pro (lo que ya teníamos) ────────────────────
  // safety_tolerance 6 = máximo permisivo (1-6).
  colorize: {
    model: 'black-forest-labs/flux-kontext-pro',
    buildInput: (image) => ({
      prompt: COLORIZE_PROMPT,
      input_image: image,
      output_format: 'jpg',
      safety_tolerance: 6,
    }),
  },
};

// ============================================================================
// VERCEL FUNCTION CONFIG
// ============================================================================

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

// ============================================================================
// HANDLER
// ============================================================================

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

  const cfg = ACTIONS[action];
  if (!cfg) return res.status(400).json({ error: `Unknown action: ${action}` });

  try {
    const body = { input: cfg.buildInput(image) };

    // Endpoint oficial del modelo (sin necesidad de version hash)
    const r = await fetch(`https://api.replicate.com/v1/models/${cfg.model}/predictions`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        // Para Topaz y Flux puede terminar en pocos segundos.
        // Para Bringing Old Photos esto se ignorará (tarda mucho más).
        'Prefer': 'wait=5',
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`Replicate error [${action}]:`, r.status, errText);
      return res.status(500).json({
        error: 'replicate_error',
        message: errText.slice(0, 200),
      });
    }

    const prediction = await r.json();

    // Si ya terminó (raro pero posible con Prefer: wait — Topaz a veces lo hace)
    if (prediction.status === 'succeeded' && prediction.output) {
      const outputUrl = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
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
    console.error(`process-image error [${action}]:`, err);
    return res.status(500).json({
      error: 'processing_failed',
      message: err.message,
    });
  }
}
