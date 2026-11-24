import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, put, del, list } from '@vercel/blob';
import sharp from 'sharp';
import seed from '../lib/seed.json' with { type: 'json' };

const catalogPath = 'cms/catalog.json';
const cookieName = '__Host-lt_session';
const hour = 3600000;
const options = { access: 'private', addRandomSuffix: false };
const groups = { clothing: 'Үндэсний хувцас', fabric: 'Торго, материал', embroidery: 'Хатгамал, чимэглэл', accessory: 'Гоёл чимэглэл', campaign: 'Урам зориг' };
const statuses = ['new', 'working', 'done', 'closed'];
const conflictText = 'Өөр цонхноос өөрчлөлт орсон байна. Жагсаалтаа шинэчлээд дахин оролдоно уу.';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const inquiryId = /^\d{8}-\d{13}-[0-9a-f-]{36}$/;
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function str(v, max, required = false) {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(400, 'Талбарын мэдээллээ шалгана уу.');
  return v.trim();
}
function hmac(value) { return createHmac('sha256', process.env.CMS_SECRET).update(value).digest('hex'); }
function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function collision(e) { return /PreconditionFailed|already exists|precondition failed/i.test(e.constructor.name + ' ' + e.message); }
async function read(path, fallback = null) {
  // A compressed JSON response carries a weak HTTP validator. Blob conditional
  // writes require the strong ETag of the exact representation we just read.
  const r = await get(path, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } });
  return r ? { data: await new Response(r.stream).json(), etag: r.blob.etag } : { data: fallback, etag: null };
}
async function write(path, value, etag, extra = {}) {
  return put(path, JSON.stringify(value), { ...options, contentType: 'application/json', ...(etag ? { ifMatch: etag, allowOverwrite: true } : {}), ...extra });
}
async function quota(req, kind, limit, windowMs) {
  const addr = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
  const path = 'quota/' + hmac(kind + ':' + addr + ':' + Math.floor(Date.now() / windowMs)) + '.json';
  for (let i = 0; i < 5; i++) {
    const { data, etag } = await read(path, 0);
    if (data >= limit) fail(429, 'Хүсэлтийн хязгаарт хүрлээ. Түр хүлээгээд дахин оролдоно уу.');
    try { await write(path, data + 1, etag, { ttlDays: 1 }); return; }
    catch (e) { if (!collision(e)) throw e; }
  }
  fail(429, 'Түр хүлээгээд дахин оролдоно уу.');
}
function sessionPath(req) {
  const token = String(req.headers.cookie || '').match(/(?:^|;\s*)__Host-lt_session=([0-9a-f]{64})(?:;|$)/)?.[1];
  return token && 'sessions/' + hmac(token) + '.json';
}
async function auth(req) {
  const path = sessionPath(req);
  if (!path || !((await read(path)).data?.expires > Date.now())) fail(401, 'Админ эрхээр нэвтэрнэ үү.');
  return path;
}
function cookie(res, value, age) {
  res.setHeader('Set-Cookie', cookieName + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + age);
}
async function uploadedImage(data) {
  const m = typeof data === 'string' && data.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length > 3700000) fail(400, 'Зургаа JPG, PNG эсвэл WebP хэлбэрээр оруулна уу.');
  let buffer;
  try {
    const img = sharp(Buffer.from(m[1], 'base64'), { limitInputPixels: 25000000, failOn: 'error' });
    if (!['jpeg','png','webp'].includes((await img.metadata()).format)) throw Error();
    buffer = await img.rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  } catch { fail(400, 'Зургийг унших боломжгүй байна. Өөр зураг сонгоно уу.'); }
  const key = createHash('sha256').update(buffer).digest('hex');
  try { await put('media/' + key + '.webp', buffer, { ...options, contentType: 'image/webp' }); }
  catch (e) { if (!collision(e)) throw e; }
  return '/api/cms?action=image&key=' + key;
}
async function changePost(b) {
  const snapshot = await read(catalogPath, seed);
  const posts = snapshot.data;
  const idx = posts.findIndex(p => p.id === b.id), old = posts[idx];
  if (!old && (!uuid.test(b.id) || b.rev !== 0)) fail(400, 'Нийтлэлийн дугаар буруу байна.');
  if (b.action === 'archive' && old && old.archived === b.archived) return { ok: true, post: old };
  if (old && b.rev !== old.rev) fail(409, conflictText);
  let post;
  if (b.action === 'archive') {
    if (!old || typeof b.archived !== 'boolean') fail(400, 'Төлөв буруу байна.');
    post = { ...old, archived: b.archived };
  } else {
    if (!Object.hasOwn(groups, b.cat) || (b.price !== null && (!Number.isSafeInteger(b.price) || b.price < 0 || b.price > 999999999999))) fail(400, 'Үнэ, ангиллаа шалгана уу.');
    post = { id: b.id, title: str(b.title, 120, true), description: str(b.description, 350), body: str(b.body, 6000), price: b.price, cat: b.cat, group: groups[b.cat], tag: old?.tag || 'Шинэ', archived: old?.archived || false };
    post.img = b.image ? await uploadedImage(b.image) : old?.img;
    if (!post.img) fail(400, 'Нийтлэлийн зургаа сонгоно уу.');
  }
  post.rev = (old?.rev || 0) + 1;
  post.updated = new Date().toISOString();
  let current = snapshot;
  for (let attempt = 0; attempt < 4; attempt++) {
    const index = current.data.findIndex(row => row.id === b.id);
    const latest = current.data[index];
    if (b.action === 'archive' && latest?.archived === b.archived) return { ok: true, post: latest };
    if ((latest?.rev ?? 0) !== b.rev) fail(409, conflictText);
    const next = [...current.data];
    if (latest) next[index] = post;
    else next.unshift(post);
    try {
      await write(catalogPath, next, current.etag);
      return { ok: true, post };
    } catch (error) {
      if (!collision(error)) throw error;
      current = await read(catalogPath, seed);
    }
  }
  fail(409, 'Каталогт зэрэг хэд хэдэн өөрчлөлт орлоо. Дахин оролдоно уу.');
}
function datePrefix(date) {
  return String(99999999 - Number(date.replaceAll('-', ''))).padStart(8,'0');
}
function ticket() {
  const key = Date.now() + '.' + randomUUID();
  return key + '.' + hmac('contact:' + key);
}
async function contact(b, req) {
  const [ts, nonce, mac] = str(b.ticket, 150, true).split('.');
  if (!/^\d{13}$/.test(ts) || !uuid.test(nonce) || !equal(hmac('contact:' + ts + '.' + nonce), mac || '')) fail(400, 'Хүсэлтээ дахин илгээнэ үү.');
  const id = datePrefix(new Date(+ts + 8 * hour).toISOString().slice(0,10)) + '-' + (9999999999999 - Number(ts)) + '-' + nonce;
  const path = 'inquiries/' + id + '.json';
  if ((await read(path)).data) return { ok: true };
  if (Date.now() - Number(ts) > hour) fail(410, 'Илгээх хугацаа дууслаа. Дахин илгээнэ үү.');
  const name = str(b.name, 80, true), phone = str(b.phone, 25, true), service = str(b.service, 80, true), timing = str(b.timing, 10), details = str(b.details, 1200), items = str(b.items, 6000);
  if (!/^[+\d() .-]+$/.test(phone) || phone.replace(/\D/g,'').length < 6 || (timing && !/^\d{4}-\d\d-\d\d$/.test(timing))) fail(400,'Утасны дугаар, хугацаагаа шалгана уу.');
  await quota(req, 'contact', 10, hour);
  try { await write(path, { id, name, phone, service, timing, details, items, status:'new', created:new Date(+ts).toISOString(), rev:1 }, null); }
  catch(e) { if (!collision(e)) throw e; }
  return { ok:true };
}
async function inquiries(q) {
  const date = q.date || '';
  if (date && !/^\d{4}-\d\d-\d\d$/.test(date)) fail(400, 'Огноо буруу байна.');
  const page = await list({ prefix:'inquiries/' + (date ? datePrefix(date) + '-' : ''), limit:15, cursor:q.cursor || undefined });
  const rows = await Promise.all(page.blobs.map(async x => (await read(x.pathname)).data));
  return { rows:rows.filter(Boolean), cursor:page.hasMore ? page.cursor : null };
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const q = req.query || {}, post = req.method === 'POST', b = req.body || {};
    if (!post && req.method !== 'GET') fail(405, 'Зөвшөөрөөгүй арга.');
    if (post) {
      let origin;
      try { origin = new URL(req.headers.origin).host; } catch {}
      if (origin !== req.headers.host || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(403, 'Хүсэлтийн эх сурвалж буруу байна.');
    }
    const a = post ? b.action : q.action;
    if (!post && a === 'catalog') return res.json({ posts:(await read(catalogPath, seed)).data.filter(p => !p.archived) });
    if (!post && a === 'image') {
      if (!/^[0-9a-f]{64}$/.test(q.key)) fail(404, 'Зураг олдсонгүй.');
      const result = await get('media/' + q.key + '.webp', { access:'private' });
      if (!result) fail(404, 'Зураг олдсонгүй.');
      res.setHeader('Content-Type','image/webp');
      res.setHeader('Cache-Control','public, max-age=31536000, immutable');
      return res.end(Buffer.from(await new Response(result.stream).arrayBuffer()));
    }
    if (!post && a === 'ticket') return res.json({ ticket:ticket() });
    if (post && a === 'contact') return res.json(await contact(b, req));
    if (post && a === 'login') {
      await quota(req,'login',8,15*60000);
      const user = str(b.user,80,true), password = str(b.password,256,true);
      const [salt, hash] = process.env.CMS_PASSWORD_HASH.split(':');
      const valid = equal(scryptSync(password,salt,64).toString('hex'),hash);
      if (!valid || user !== 'zakituul') fail(401,'Нэвтрэх нэр эсвэл нууц үг буруу байна.');
      const token = randomBytes(32).toString('hex');
      await write('sessions/' + hmac(token) + '.json',{ expires:Date.now() + 8*hour },null,{ ttlDays:1 });
      cookie(res, token, 8*3600);
      return res.json({ ok:true });
    }
    const path = await auth(req);
    if (post && a === 'logout') { await del(path); cookie(res,'',0); return res.json({ ok:true }); }
    if (!post && a === 'posts') return res.json({ posts:(await read(catalogPath,seed)).data });
    if (!post && a === 'inquiries') return res.json(await inquiries(q));
    if (post && ['save','archive'].includes(a)) return res.json(await changePost(b));
    if (post && a === 'status') {
      if (!inquiryId.test(b.id) || !statuses.includes(b.status)) fail(400,'Төлөв буруу байна.');
      const key = 'inquiries/' + b.id + '.json', { data, etag } = await read(key);
      if (!data) fail(404,'Хүсэлт олдсонгүй.');
      if (data.rev !== b.rev) fail(409,conflictText);
      const row = { ...data, status:b.status, rev:data.rev+1, updated:new Date().toISOString() };
      try { await write(key,row,etag); } catch(e) { if (collision(e)) fail(409,conflictText); throw e; }
      return res.json({ row });
    }
    fail(404,'Олдсонгүй.');
  } catch(e) {
    if (!e.status) console.error('CMS operation failed', e.constructor.name, String(e.message).replace(/vercel_blob_\S+/g,'[redacted]').slice(0,240));
    return res.status(e.status || 503).json({ error:e.status ? e.message : 'Сервертэй холбогдох боломжгүй байна. Түр хүлээгээд дахин оролдоно уу.' });
  }
}
