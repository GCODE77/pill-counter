// 필카운터 약품명 검색 중계 서버 (Cloudflare Workers)
// 식약처 API 인증키(DRUG_KEY)는 이 Worker의 비밀 변수에만 있고, 앱·GitHub에는 나오지 않습니다.
const ALLOW = ['https://gcode77.github.io', 'http://localhost:8766', 'http://localhost:8765'];   // 이 주소의 앱만 사용 가능
const API = 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnInq08';

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = ALLOW.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : null;
    const json = (o, st = 200, extra = {}) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json; charset=utf-8', ...(cors || {}), ...extra } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...(cors || {}), 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (!cors) return json({ error: '허용되지 않은 주소입니다' }, 403);

    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 40);
    if (q.length < 2) return json({ error: '두 글자 이상 입력하세요' }, 400);

    // 같은 검색어는 하루 동안 저장해 두고 재사용 → API 호출 한도 절약
    const cache = caches.default, ck = new Request('https://cache.local/drug?q=' + encodeURIComponent(q));
    const hit = await cache.match(ck);
    if (hit) return json(await hit.json());

    try {
      const r = await fetch(`${API}?serviceKey=${encodeURIComponent(env.DRUG_KEY)}&type=json&pageNo=1&numOfRows=30&item_name=${encodeURIComponent(q)}`);
      const j = await r.json();
      const h = j.header || {};
      if (j.OpenAPI_ServiceResponse || (h.resultCode && h.resultCode !== '00')) return json({ error: '조회 실패' }, 502);
      let it = (j.body || {}).items; if (it && it.item) it = it.item; if (it && !Array.isArray(it)) it = [it];
      it = (it || []).map(x => x.item || x);
      const items = [...it.filter(x => !x.CANCEL_DATE), ...it.filter(x => x.CANCEL_DATE)]
        .map(x => ({ name: x.ITEM_NAME || '', entp: x.ENTP_NAME || '', old: !!x.CANCEL_DATE })).filter(x => x.name);
      const out = { items, total: (j.body || {}).totalCount || it.length };
      ctx.waitUntil(cache.put(ck, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'max-age=86400' } })));
      return json(out);
    } catch (e) { return json({ error: '조회 실패' }, 502); }
  },
};
