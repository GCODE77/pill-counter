# 약품명 검색 중계 (Vercel)

식약처 인증키를 앱에 넣지 않고 서버에만 두기 위한 중계입니다. 앱 → Vercel 함수 → 식약처 API.

## 배포 (GitHub 로그인, 약 5분, 무료·카드 불필요)
1. https://vercel.com → **Continue with GitHub**로 가입
2. **Add New → Project** → 저장소 `pillcounter` **Import**
3. **Root Directory**를 `proxy`로 지정 (Edit 버튼)
4. **Environment Variables**에 이름 `DRUG_KEY`, 값에 식약처 인증키 → **Deploy**
5. 배포된 주소 + `/api/drug`(예: `https://pillcounter-xxxx.vercel.app/api/drug`)를 `index.html`의 `PROXY_URL`에 넣고 푸시

서울 리전(icn1)으로 실행합니다. 허용 주소는 `api/drug.js`의 `ALLOW`.
