// 필카운터 약품명 검색 중계 (Vercel 서버리스 함수)
// 식약처 인증키는 Vercel 환경 변수 DRUG_KEY에만 있고, 앱·GitHub에는 나오지 않습니다.
const ALLOW = ['https://gcode77.github.io', 'http://localhost:8766', 'http://localhost:8765'];   // 이 주소의 앱만 사용 가능
const API = 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnInq08';

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const ok = ALLOW.includes(origin);
  if (ok) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET'); res.statusCode = 204; return res.end(); }
  const send = (st, o) => { res.statusCode = st; res.end(JSON.stringify(o)); };
  if (!ok) return send(403, { error: '허용되지 않은 주소입니다' });

  const q = String((req.query && req.query.q) || '').trim().slice(0, 40);
  if (q.length < 2) return send(400, { error: '두 글자 이상 입력하세요' });
  if (!process.env.DRUG_KEY) return send(500, { error: '서버에 인증키가 설정되지 않았습니다' });

  try {
    const r = await fetch(`${API}?serviceKey=${encodeURIComponent(process.env.DRUG_KEY)}&type=json&pageNo=1&numOfRows=30&item_name=${encodeURIComponent(q)}`);
    const j = await r.json();
    const h = j.header || {};
    if (j.OpenAPI_ServiceResponse || (h.resultCode && h.resultCode !== '00')) return send(502, { error: '조회 실패' });
    let it = (j.body || {}).items; if (it && it.item) it = it.item; if (it && !Array.isArray(it)) it = [it];
    it = (it || []).map(x => x.item || x);
    const items = [...it.filter(x => !x.CANCEL_DATE), ...it.filter(x => x.CANCEL_DATE)]
      .map(x => ({ name: x.ITEM_NAME || '', entp: x.ENTP_NAME || '', old: !!x.CANCEL_DATE })).filter(x => x.name);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');   // 같은 검색어는 하루 동안 재사용 → 호출 한도 절약
    send(200, { items, total: (j.body || {}).totalCount || it.length });
  } catch (e) { send(502, { error: '조회 실패' }); }
};
