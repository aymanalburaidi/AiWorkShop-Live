// يصك توكنات LiveKit لغرف AiWorkShop-Live: المقدّم بعد التحقق من مفتاحه عبر aiws_verify، والمستمع استماعًا فقط.
// الأسرار (LIVEKIT_URL و LIVEKIT_API_KEY و LIVEKIT_API_SECRET) في أسرار Supabase، ونسختها المحلية في secrets/livekit.env.
// النشر: supabase functions deploy aiws_live_token --no-verify-jwt --project-ref dqedhfwaquqaddbtfvtx
import { AccessToken } from 'npm:livekit-server-sdk@2.19.1';

const ROOMS = new Set(['live-lab']);   // لا غرف ورشة العمل الأصلية (hs7-ai, hs7-ai-test) أبدًا
const TTL = '4h';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const clean = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : '';

async function verify(room: string, secret: string, apikey: string) {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_ANON_KEY') || apikey;
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  const r = await fetch(`${url}/rest/v1/rpc/aiws_verify`, {
    method: 'POST', headers, body: JSON.stringify({ p_room: room, p_secret: secret }),
  });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const lkUrl = Deno.env.get('LIVEKIT_URL'), apiKey = Deno.env.get('LIVEKIT_API_KEY'), apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!lkUrl || !apiKey || !apiSecret) return json({ error: 'not_configured' }, 500);

  const body = await req.json().catch(() => ({}));
  const room = clean(body.room, 40);
  if (!ROOMS.has(room)) return json({ error: 'room' }, 400);
  const presenter = body.role === 'presenter';
  if (presenter) {
    const secret = clean(body.key, 200);
    if (!secret || !(await verify(room, secret, req.headers.get('apikey') || ''))) return json({ error: 'key' }, 403);
  }

  // هوية ثابتة لكل جهاز: دخوله من جديد يطرد جلسته القديمة بدل أن تبقى معلّقة
  const id = typeof body.id === 'string' && /^[a-z0-9]{6,32}$/.test(body.id) ? body.id : crypto.randomUUID().slice(0, 12).replace(/-/g, '');
  const identity = presenter ? 'presenter' : 'l-' + id;
  const name = clean(body.name, 40) || identity;
  const lkRoom = 'aiws-live-' + room;

  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: TTL });
  at.addGrant({
    room: lkRoom, roomJoin: true, canSubscribe: true,
    canPublish: presenter, canPublishData: presenter, canUpdateOwnMetadata: false,
  });
  return json({ url: lkUrl, token: await at.toJwt(), identity, room: lkRoom });
});
