# 레몬 로봇 피드백 받기

우의 개인서버(집맥)에서 도는 작은 서버. `lemonrobot.woo.moi` (Cloudflare 터널).

- `POST /api`: 레몬 로봇 페이지 `/feedback/` 글상자가 보낸 글을 `DATA_DIR/feedback.jsonl`에 쌓는다.
- `GET /`: 모인 글 보기. woo.moi 구글 로그인(우)만. 로그인 확인은 배포 때 옆에 두는 `woo-session.mjs`(woo-projects 것)가 한다. 이 공개 저장소에는 넣지 않는다.
- 실행: `node server.mjs` (PORT 기본 8790, 127.0.0.1에만 붙음). 의존성 없음, Node 20 이상.
