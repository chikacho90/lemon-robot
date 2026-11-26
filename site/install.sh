#!/bin/bash
# 줄바꿈은 LF여야 한다(.gitattributes). CRLF면 bash가 깨진다.
# 레몬 로봇 설치(터미널 한 줄): curl -fsSL https://github.com/chikacho90/lemon-robot/releases/latest/download/install.sh | bash
# 원본: woo-infra automations/mac9/lemondesk/dist/install.sh. 내려받기 페이지에서 짧은 주소로 쓰려고 여기에도 둔다(https://lemonrobot.interaction.hnine.com/install.sh).
# 터미널로 받은 파일에는 격리 표시가 안 붙어서 'Apple이 확인할 수 없음' 창 없이 바로 열린다. 다시 돌리면 최신으로 바꿔 깐다.
set -euo pipefail
REPO="${LR_REPO:-chikacho90/lemon-robot}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
echo "레몬 로봇 받는 중..."
curl -fsSL "https://github.com/$REPO/releases/latest/download/LemonRobot.zip" -o "$T/a.zip"
ditto -x -k "$T/a.zip" "$T"
DEST=/Applications; [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
pkill -x lemonrobot 2>/dev/null && sleep 1 || true
rm -rf "$DEST/Lemon Robot.app"
mv "$T/Lemon Robot.app" "$DEST/"
open "$DEST/Lemon Robot.app"
echo "다 됐어요. 화면 아래 Lemon Desk 띠 왼쪽 끝에 로봇이 보여요."
echo "처음 한 번 '다른 앱의 데이터에 접근' 창이 뜨면 허용을 눌러 주세요(게임의 폰 연결 키를 읽어요)."
