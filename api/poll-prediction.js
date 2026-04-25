/**
 * GET /api/poll-prediction?id=PREDICTION_ID
 * Comprueba el estado de una predicción de Replicate y devuelve el resultado si está listo.
 * Llamada rápida (<1s), sin timeout.
 */

export const config = { maxDuration: 10 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing prediction id' }, 400);

  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) return json({ error: 'REPLICATE_API_KEY not configured' }, 500);

  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { 'Authorization': `Token ${apiKey}` },
  });

  if (!res.ok) {
    return json({ error: 'replicate_error', message: `${res.status}` }, 500);
  }

  const data = await res.json();

  if (data.status === 'succeeded') {
    // Descargar la imagen y convertirla a base64
    const imgRes = await fetch(data.output);
    const buffer = await imgRes.arrayBuffer();
    const b64 = bufferToBase64(buffer);
    const mime = imgRes.headers.get('content-type') || 'image/png';
    return json({ status: 'succeeded', resultImage: `data:${mime};base64,${b64}` });
  }

  if (data.status === 'failed' || data.status === 'canceled') {
    return json({ status: data.status, error: data.error || 'Prediction failed' });
  }

  // starting / processing
  return json({ status: data.status });
}

function bufferToBase64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
