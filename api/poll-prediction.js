/**
 * GET /api/poll-prediction?id=PREDICTION_ID
 */

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing prediction id' });

  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'REPLICATE_API_KEY not configured' });

  try {
    const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Token ${apiKey}` },
    });

    if (!r.ok) {
      return res.status(500).json({ error: 'replicate_error', message: `${r.status}` });
    }

    const data = await r.json();

    if (data.status === 'succeeded') {
      const imgRes = await fetch(data.output);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const b64 = buffer.toString('base64');
      const mime = imgRes.headers.get('content-type') || 'image/png';
      return res.status(200).json({
        status: 'succeeded',
        resultImage: `data:${mime};base64,${b64}`,
      });
    }

    if (data.status === 'failed' || data.status === 'canceled') {
      return res.status(200).json({ status: data.status, error: data.error || 'Failed' });
    }

    return res.status(200).json({ status: data.status });
  } catch (err) {
    console.error('poll-prediction error:', err);
    return res.status(500).json({ error: 'poll_failed', message: err.message });
  }
}
