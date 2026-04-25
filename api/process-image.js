/**
 * FotoMemoria — Vercel Edge Function
 * POST /api/process-image
 *
 * Body: { image: "data:image/jpeg;base64,...", action: "definition"|"color"|"colorize"|"restore" }
 * Returns: { resultImage: "data:image/jpeg;base64,..." }
 *
 * Deploy: coloca este archivo en /api/process-image.js en la raíz de tu proyecto Vercel.
 * Variables de entorno en Vercel Dashboard → Settings → Environment Variables:
 *   OPENAI_API_KEY = sk-...
 */

export const config = { runtime: 'edge' };

// ─── PROMPTS REALES ──────────────────────────────────────────────────────────
const PROMPTS = {
  definition: `Enhance the resolution and sharpness of this old photograph 4x. 
    Clarify facial features, fabric textures and background details. 
    Preserve grain authenticity — avoid over-smoothing. 
    This should look like a better scan, not a painting. 
    Do not alter, distort, or regenerate any faces, human features, or key objects. 
    Family portrait, archival restoration, non-commercial use.`,

  color: `Improve overall color balance, contrast, and dynamic range while maintaining a natural look. 
    Correct white balance and lighting inconsistencies without altering skin tones, facial features, 
    or object colors. Avoid oversaturation or unnatural color shifts. 
    Recover blown-out areas and lift crushed blacks. Apply a subtle S-curve for natural contrast 
    without losing the vintage atmosphere. 
    Family portrait, archival restoration, non-commercial use.`,

  colorize: `Apply realistic and context-aware colorization to this black and white photograph. 
    Use natural, historically and visually plausible colors (mid 20th century palette). 
    Preserve all original details, textures, and facial features without modification. 
    Avoid exaggerated or artificial tones. Use historically accurate skin tones, 
    period-appropriate clothing colors, and natural environmental hues. 
    Family portrait, archival restoration, non-commercial use.`,

  restore: `Apply a full restoration to this old photograph: 
    1) Remove noise, dust, scratches, stains, and compression artifacts. 
    2) Reconstruct damaged or missing areas subtly while preserving original textures. 
    3) Enhance resolution and sharpness 4x. 
    4) Rebalance exposure, shadows and highlights. 
    5) Restore degraded facial features — recover eyes, skin texture and facial structure 
       while strictly preserving the unique identity of each person. Do not idealize or alter age appearance. 
    6) If black and white, colorize realistically with historically accurate tones. 
    Preserve the authentic vintage character. 
    Family portrait, archival restoration, non-commercial use.`,
};

// ─── HANDLER ─────────────────────────────────────────────────────────────────
export default async function handler(req) {
  // CORS — permite peticiones desde cualquier origen (ajusta en producción)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { image, action } = body;

  if (!image || !action) {
    return new Response(JSON.stringify({ error: 'Missing image or action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const prompt = PROMPTS[action];
  if (!prompt) {
    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Convertir dataURL a Blob para el FormData
    const base64Match = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) throw new Error('Invalid image format');

    const mimeType = base64Match[1];
    const base64Data = base64Match[2];

    // En Edge Runtime usamos fetch + FormData directamente
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const imageBlob = new Blob([bytes], { type: mimeType });

    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);
    formData.append('n', '1');
    formData.append('size', '1024x1024');
    formData.append('quality', 'medium');       // 'low' | 'medium' | 'high'
    formData.append('response_format', 'b64_json');
    formData.append('image', imageBlob, 'photo.jpg');

    const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // NO poner Content-Type manual con FormData — fetch lo pone solo con boundary
      },
      body: formData,
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error:', openaiRes.status, errText);

      // Si OpenAI rechaza por política (ej. menores), devolvemos error descriptivo
      if (openaiRes.status === 400) {
        return new Response(JSON.stringify({
          error: 'content_policy',
          message: 'La imagen fue rechazada por las políticas de contenido. Prueba con otra foto o usa la acción de Definición o Color.'
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      throw new Error(`OpenAI ${openaiRes.status}: ${errText}`);
    }

    const openaiData = await openaiRes.json();
    const b64Result = openaiData?.data?.[0]?.b64_json;

    if (!b64Result) {
      throw new Error('No image in OpenAI response');
    }

    return new Response(JSON.stringify({
      resultImage: `data:image/png;base64,${b64Result}`
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('process-image error:', err);
    return new Response(JSON.stringify({ error: 'processing_failed', message: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
