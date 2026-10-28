# 약품명 검색 중계 서버 (Cloudflare Workers)

식약처 인증키를 앱에 넣지 않고 서버에만 두기 위한 중계입니다. 앱 → 이 Worker → 식약처 API.

## 배포 (대시보드에서 복사·붙여넣기, 약 10분)
1. https://dash.cloudflare.com 가입(무료, 카드 불필요) → **Workers & Pages** → **Create** → **Hello World** → 이름 `pillcounter-drug` → **Deploy**
2. **Edit code** → 기존 코드를 지우고 `drug-proxy.js` 내용을 붙여넣기 → **Deploy**
3. Worker 화면 **Settings → Variables and Secrets → Add** → Type **Secret**, 이름 `DRUG_KEY`, 값에 식약처 인증키 → **Deploy**
4. Worker 주소(`https://pillcounter-drug.<계정>.workers.dev`)를 `index.html`의 `PROXY_URL`에 넣고 배포

## 보호 장치
- `ALLOW` 목록의 주소(GitHub Pages)에서 온 요청만 응답 (다른 사이트가 가져다 쓰는 것을 막음)
- 같은 검색어는 하루 동안 저장해 API 호출 한도 절약, 검색어는 2~40자만 허용
