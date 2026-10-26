# 화면기능 명세

백엔드 계약은 jarvis_agent 의 `docs/api-spec.md` 다. 이 앱은 백엔드를 갖지 않으므로 `api-spec.md` 가 없다.

## 화면 목록

경로 알파벳순. 화면은 한 장이고 나머지는 그 위에 겹친다.

| 경로 | 화면 | 목적 | 상태 |
|---|---|---|---|
| `/` | 대화 | 질문을 보내고 JARVIS 의 응답을 본다 | 구현됨 |
| `/` (`#sessions`) | 세션 서랍 | 세션 전환, 새 세션 | 구현됨 |
| `/` (`#settings`) | 서버 연결 시트 | 서버 주소와 접근 키, 알림 켜기 | 구현됨 |
| `/` (`#approval`) | 실행 승인 시트 | 도구 실행 허용, 거부 | 구현됨 |

---

## 화면별 상세

### `/` — 대화

**목적** — 질문을 보내고 JARVIS 의 응답을 스트리밍으로 본다. 아래 영역은 대화 기록이 아니라 지금 응답 하나만 보이고, 테두리나 배경 없이 별 배경 위에 글만 얹는다.

**레이아웃** — 위에서 아래로. 노치와 홈 인디케이터는 `safe-area-inset` 만큼 비운다. 별 배경과 주사선이 전체에 깔린다.

```
┌─────────────────────────┐
│ ☰      ● ONLINE      ⚙  │
│                         │
│      ╭───────────╮      │
│      │  리액터   │      │  남는 높이 전부. 폭과 높이 중 작은 쪽, 최대 560px
│      │ (구체+링) │      │
│      ╰───────────╯      │
│       ● ACTIVE          │  상태 라벨(hud.js)
│     "에이전트 명언"     │
├─────────────────────────┤
│ 응답 (스크롤, 박스 없음) │  화면 높이의 30% (--dock)
├─────────────────────────┤
│ [입력창]           [↑]  │
└─────────────────────────┘
```

스와이프 전환: 기억한 세션이 서버의 `GET /api/sessions` 에 아직 그 에이전트 것으로 있으면 그 세션, 없으면 그 에이전트의 다른 세션, 그것도 없으면 `POST /api/sessions` 로 새로 만든다. 새로 만드는 동안 다시 밀어도 무시한다(생성은 멱등하지 않다). 색과 이름은 밀자마자 바뀌고, 구체 아래 점이 에이전트 위치를 보인다(에이전트가 하나면 숨김).

음성: 구체를 탭하면 듣기 시작하고, 말한 뒤 1.2초 조용하면 스스로 멈춰 16kHz WAV 로 받아 적는다. 네이티브 앱은 이 WAV 를 Apple 음성 인식(`SFSpeechRecognizer`, ko-KR, `ios/App/App/SpeechPlugin.swift`)에 먼저 넘기고, 권한 거부나 오류면 `voice_stt_submit` 으로 서버 STT 에 보낸다. Apple 이 말이 없었다고 하면(빈 결과) 서버로 보내지 않고 "말소리를 듣지 못했습니다(최대 음량 …)" 줄을 남긴다. whisper 는 조용한 녹음에서 말을 지어내기 때문이다. 듣다가 7초 동안 말이 없어 접을 때도 같은 줄을 남긴다(승인 답을 기다릴 때는 남기지 않는다). 듣는 중에 "Jarvis", "헤이 자비스" 만 들었으면 질문으로 보내지 않고 `wake_up` 을 읽은 뒤 다시 듣는다(`src/wake-call.ts`). 웹앱은 바로 서버 STT 로 보낸다(`connected.voice.stt_mode` 가 `server` 일 때만). `webkitSpeechRecognition` 은 마이크를 따로 잡아 웨이크워드 캡처와 부딪히므로 쓰지 않는다. 7초 동안 말이 없으면 보내지 않고 접고, 최대 30초. 말의 시작과 끝은 80ms 묶음의 음량을 그동안 가장 조용했던 음량의 3배(최소 0.008)와 비교해 정한다(`src/endpoint.ts`). 듣기 직전 320ms 도 붙여 첫 음절이 잘리지 않게 한다. 웨이크워드: `connected.voice.wake` 면 마이크를 열어 두고, 기다리는 동안(듣기, 읽기, 응답, 승인 중이 아니고 화면이 보일 때) 16kHz int16 80ms 바이너리 프레임을 보낸다. `voice_wake` 가 오면 대화에 "◉ 웨이크 감지 (점수 0.00)" 회색 줄을 남기고(부르지 않았는데 깨는지 가르려고) 녹음 문구 `wake_up` 을 읽고 듣는다. 웨이크워드, 말하기, 소리 재생은 AudioContext 하나와 마이크 스트림 하나를 같이 쓴다(`src/mic.ts`, `public/mic-worklet.js`). 컨텍스트는 첫 탭에서 풀고 닫지 않으며, iOS 가 멈추면(`onstatechange`) 다시 깨운다. 그래도 탭 없이 온 읽기가 막히면 구체에 "탭해서 소리 켜기" 를 띄우고 빨간 시스템 줄을 남긴다. 기기 음성(`speechSynthesis`)도 첫 탭에서 빈 문장을 읽어 풀어 둔다. 받아 적은 글(Apple 인식 결과나 `voice_stt_result`)은 입력창 자리에 따옴표로 비추고 `user_message` 로 보낸다. "포커스 모드 …" 는 `/focus` 명령으로 바꾼다. 이렇게 말로 시작한 요청(HUD 의 Default 모드와 같다)에만 답을 `voice_tts_request{source:reply|answer}` 로 읽어 달라고 한다. 도구를 부를 때(`tool_execution_start`)마다 그때까지 새로 나온 말을, 루트 `agent_end` 에서 나머지를 읽어 화면과 소리의 차례를 맞춘다(HUD 는 끝에서 한꺼번에 읽는다). 그리고 `voice_tts_audio` 의 WAV 를 WebAudio 로 읽는다. `data` 가 비면(한국어처럼 서버 TTS 가 읽지 않는 글) 기기 음성(`speechSynthesis`, ko-KR)이 읽는다. 서버가 `SPEAK_ENGLISH` 면 JARVIS 의 reply, answer 는 서버가 영어로 옮겨 JARVIS 목소리 WAV 로 보낸다(화면 글은 한국어 그대로). 지금 에이전트가 `main`(JARVIS)이면 `data` 가 비어도 기기 음성으로 읽지 않고(JARVIS 는 JARVIS 목소리로만 말한다), 대기 안내(filler)는 말로 시작하지 않았어도 `speak` 면 녹음 문구 `horizontal_task` 로 읽는다. 같은 요청 동안 💬 filler 는 녹음 문구 `horizontal_task`, 🔔 와 승인 요청은 합성으로 읽고, `web_search`, `remember_task_pattern` 도구와 Focus 켜기, 끄기, 분석 시작에는 녹음 문구(`GET /api/voice/phrases/{name}`, 처음 쓸 때 받아 둔다)를 읽고 `voice_spoken` 을 보낸다. `proactive_message.speak` 면 말로 시작하지 않았어도 읽는다. 읽는 동안 잠금 화면 재생기에 지금 에이전트 이름과 앱 아이콘을 넣고(`navigator.mediaSession`), 다 읽으면 비운다. JARVIS 가 아닌 에이전트(KAREN)는 합성이 느린 목소리라 읽을 글을 문장 단위로 나눠(`src/speech-split.ts`) 조각마다 `voice_tts_request{part, full_text(첫 조각만)}` 를 보내고, 조각이 순서 없이 와도 보낸 차례대로 이어 읽는다. 서버는 첫 조각에서만 `full_text` 로 밖에 알린다. 읽는 중에 탭하면 멈추고, 늦게 온 결과는 `id` 로 버린다. 구체에 듣기 초록, 대기 강조색, 읽기 마젠타 고리가 뜨고 리액터는 LISTENING, SPEAKING 이 된다.

슬래시 명령: 커서 앞이 맨 앞이나 공백 뒤의 `/조각` 이면 `connected.slash_commands` 를 이름 앞부분으로 거른 목록이 입력창 위에 뜬다. 항목 탭, Enter, Tab 은 조각을 `/이름 ` 으로 바꾸고, 목록이 열려 있는 동안 Enter 는 보내지 않는다. 명령은 그대로 `user_message` 로 가고 처리는 서버가 한다.

리액터 상태: `agent_start`, `tool_execution_end` 는 THINKING, `tool_execution_start` 는 EXECUTING, 루트 `agent_end` 는 ACTIVE, `agent_error` 는 3초 동안 ERROR. 세션 에이전트가 바뀌면 `jarvis:palette` 이벤트로 링, 구, 별, CSS 색이 그 에이전트 팔레트로 바뀐다. 헤더의 표시는 소켓 연결만 보인다(ONLINE, LINKING, OFFLINE).

**데이터**

| 출처 | 호출 | 쓰이는 곳 |
|---|---|---|
| REST | `GET /api/agents` | 시작할 때 한 번. 이름, 색, 새 세션 버튼 |
| REST | `GET /api/sessions/{id}/messages` | `connected` 를 받을 때마다. 마지막 assistant 응답 하나로 다시 그린다 |
| WS | `/ws?session_id=&token=` | 대화 스트림, 승인, 🔔, 리마인더, 음성 |
| REST | `GET /api/voice/phrases/{name}` | 녹음 문구 WAV. 이름은 `connected.voice.phrases` |

**상태·파라미터**

| 이름 | 위치 | 기본값 | 효과 |
|---|---|---|---|
| `jarvis_session` | localStorage | `default` | 앱을 열면 붙는 세션. `connected` 의 `session_id` 로 갱신 |
| `jarvis_agent_sessions` | localStorage | `{}` | 에이전트 id 별 마지막 세션. 스와이프로 돌아오면 그 세션에 다시 붙는다 |
| `jarvis_connection` | localStorage | `{server:"", token:""}` | 서버 주소와 키. 주소가 비면 페이지와 같은 출처 |
| `body.busy` | DOM | 없음 | 루트 에이전트가 도는 중. 보내기 버튼이 중단 버튼이 된다 |
| `voiceMode` | 메모리 | false | 이번 요청을 말로 시작했다. 루트 `agent_end`, `agent_error`, 세션 전환에서 내린다 |

**인터랙션**

| 사용자 행동 | 결과 |
|---|---|
| Enter 또는 ↑ | `user_message` 전송, 응답 영역을 비운다(내 말은 그리지 않는다). 한글 조합 중 Enter 는 보내지 않고, Shift+Enter 는 줄바꿈 |
| 응답 중 ■ | `abort` 전송 |
| 💭 줄 누르기 | 해석 전문이 펼쳐진다 |
| 🔔 아래 네, 아니오 | `proactive_feedback` 전송, 버튼이 문구로 바뀐다 |
| 코드 블록 COPY | 코드를 클립보드에 복사 |
| 앱을 내렸다가 다시 열기 | 끊긴 소켓이면 기다리지 않고 다시 붙고 히스토리를 다시 받는다 |
| 구체 탭(10px 미만 움직임) | 듣기 시작(말이 끝나면 스스로 보낸다), 듣는 중이면 바로 멈추고 전송, 읽는 중이면 읽기를 멈춘다. 서버 STT 가 없으면 빨간 시스템 줄 |
| "Hey Jarvis" 라고 부르기 | 앱이 화면에 떠 있고 첫 터치 뒤면 `wake_up` 문구를 읽고 듣는다 |
| `/` 입력 | 슬래시 명령 목록. ↑↓ 로 고르고 Esc 로 닫는다 |
| 구체를 왼쪽으로 밀기 | 다음 에이전트로 전환. 오른쪽은 이전. 60px 미만이거나 세로가 더 길면 제자리로 돌아온다 |

화면에 그리는 서버 이벤트: `agent_start`(첫 단계만 새 말풍선), `message_update`, `stream_delta`, `tool_execution_start`/`end`(말풍선 위 칩), `agent_end`(`continues` 면 입력 잠금 유지), `agent_error`, `error`, `inner_thought`(💭), `proactive_message`(💬 filler, 🔔 proactive, `answer` 는 그리지 않음), `reminder`(⏰, `agent` 가 지금 에이전트가 아니면 그 에이전트 이름을 붙인다. 서버가 열린 화면 모두에 보낸다), `approval_request`/`resolved`, `focus_state`와 `focus_panel`(녹음 문구에만 씀), `voice_tts_audio`, `voice_stt_result`. 나머지는 무시한다.

**빈 상태** — 응답이 없으면 입력창만 보인다. 보낸 직후 첫 응답 조각이 오기 전에도 비어 있고, 그동안 상태는 구체 아래 라벨이 보인다. 💭, 🔔, 리마인더, 오류는 지금 응답 아래에 붙고 다음 질문을 보낼 때 함께 치워진다.

**에러 상태** — 히스토리를 못 받으면 목록에 빨간 시스템 줄. 소켓이 끊기면 상태가 "끊김 · 다시 연결 중"(1초에서 10초까지 늘려 재시도). `4401`, `4404` 로 닫히면 재시도하지 않고 서버 연결 시트를 사유와 함께 연다. `GET /api/agents` 가 실패해도 시트를 연다.

### `/` (`#sessions`) — 세션 서랍

**목적** — 다른 세션으로 옮기거나 에이전트를 골라 새 세션을 만든다.

**레이아웃** — 왼쪽에서 밀려 나오는 패널. 위에 세션 목록(id, 에이전트 이름), 아래에 에이전트별 "+ 이름" 버튼.

**데이터**

| 출처 | 호출 | 쓰이는 곳 |
|---|---|---|
| REST | `GET /api/sessions` | 서랍을 열 때마다 |
| REST | `POST /api/sessions` | 새 세션 버튼 |

**인터랙션**

| 사용자 행동 | 결과 |
|---|---|
| ☰ | 서랍을 열고 목록을 다시 받는다 |
| 세션 누르기 | 서랍을 닫고 그 세션으로 다시 붙는다 |
| + 에이전트 | 세션을 만들고 그 세션으로 붙는다. 응답이 올 때까지 버튼을 잠근다(생성은 멱등하지 않다) |
| 바깥 누르기 | 닫는다 |

**빈 상태** — 서버는 항상 `default` 를 띄우므로 목록이 비지 않는다.

**에러 상태** — 목록 자리에 에러 문장. 생성 실패는 대화 목록에 빨간 시스템 줄.

### `/` (`#settings`) — 서버 연결 시트

**목적** — 서버 주소와 접근 키를 저장한다.

**인터랙션**

| 사용자 행동 | 결과 |
|---|---|
| ⚙ | 저장된 값으로 시트를 연다 |
| 저장 | 주소를 정규화(앞뒤 공백, 끝 슬래시 제거, 스킴이 없으면 `https://`)해 저장하고 처음부터 다시 연결 |
| 닫기 | 아무것도 바꾸지 않는다 |
| 알림 켜기 | 권한을 묻고 `GET /api/push/vapid` 로 구독, `PUT /api/push/subscriptions` 로 서버에 등록. 이미 켜져 있으면 버튼이 "다시 등록"이 되어 같은 구독을 서버에 다시 맞춘다. 받은 푸시는 본문의 `icon`(에이전트 아바타)을 알림 아이콘으로 쓰고, 없으면 앱 아이콘 |

네이티브 앱에서 주소가 비어 있으면 시작하자마자 연다. 연결 실패로 열리면 사유를 빨간 글로 보인다.

### `/` (`#approval`) — 실행 승인 시트

**목적** — 도구 실행 승인 요청에 답한다.

**레이아웃** — 아래에서 올라오는 시트. 사유, 명령(고정폭, 줄바꿈), 버튼 셋(거부, 항상 허용, 허용). 항상 허용은 `always_pattern` 이 있을 때만.

**인터랙션**

| 사용자 행동 | 결과 |
|---|---|
| 거부 | `approval_response{approved:false}` |
| 허용 | `approval_response{approved:true, always:false}` |
| 항상 허용 | `approval_response{approved:true, always:true}` |
| 바깥 누르기, 스와이프 | 닫히지 않는다. 버튼이나 말로만 끝난다 |
| 말로 답하기 | 말로 시작한 요청이면 시트가 모달이 아닌 아래 띠로 뜨고(구체가 보인다), 질문을 읽은 뒤 스스로 듣는다. 말이 끝나면 키워드로 판정하고(부정어가 있으면 거부), 애매하면 `reply_classify` 로 서버에 묻고(8초), 그래도 애매하면 거부한다. 판정을 `approval_response` 로 보내고 "허용으로 들었습니다" 같은 문장을 읽는다. 지금 에이전트가 `main`(JARVIS)이면 질문과 이 문장을 영어로 써서("Sir, shall I run …? Allow or deny.", "Allowed, sir.") 서버가 JARVIS 목소리로 읽게 한다. 전사가 비거나 말이 없으면 최대 20번 다시 듣는다. 버튼으로 먼저 답하면 듣던 녹음은 버린다. 어느 쪽으로 답하든 아직 읽던 질문은 멈춘다(곧 올 답 읽기와 겹치지 않게) |
| 다른 연결이 먼저 답함 | `approval_resolved` 로 시트가 닫힌다 |

---

## 공통 컴포넌트

| 컴포넌트 | 위치 | 받는 것 | 쓰는 화면 |
|---|---|---|---|
| 마크다운 렌더 | `src/markdown.js` (HUD 복사본) | 마크다운 원문 | 대화 |
| 재연결 소켓 | `src/socket.ts` | 주소, 이벤트 처리기 | 대화 |
| 리액터 링, 별 배경 | `src/reactor/hud.js` (HUD 복사본) | `window.HUD.setState`, `jarvis:palette` | 대화 |
| 입자 구 | `src/reactor/sphere.js` (HUD 복사본, three 0.186.0) | `window.HUD.state`, `jarvis:palette` | 대화 |

---

## 미구현 / 알려진 제약

- Full-voice 모드, 🔔 피드백에 말로 답하기 없음.
- 웨이크워드는 앱이 화면에 떠 있을 때만 듣는다(iOS 는 백그라운드 마이크를 막는다). 앱을 연 뒤 첫 터치 전에는 iOS 가 마이크 처리를 멈춰 둔다. 기다리는 동안 마이크 표시가 계속 켜지고 서버로 약 32KB/s(시간당 약 115MB)를 보낸다.
- iOS 는 화면을 한 번 탭하기 전에는 오디오를 막는다. 앱을 연 뒤 탭 전에 온 읽기(`speak` 🔔)는 소리 없이 넘어간다.
- 한국어 답은 기기 음성이 읽는다. JARVIS 목소리는 녹음 문구와 영어 문장(서버 Piper)뿐이고, 이건 서버 TTS 설정 몫이다.
- AGENDA, Focus 화면, 사용량 표시 없음. `focus_state`, `focus_panel` 은 녹음 문구에만 쓰고 `agenda_changed` 는 무시한다.
- 입력창의 `/명령` 강조 표시, `/schedule` 때 알림 권한 묻기 없음(알림은 설정 시트에서 켠다).
- 지난 응답과 내가 보낸 말은 화면에서 다시 볼 수 없다. 다시 연결하면 마지막 응답만 돌아오고, 🔔, 리마인더, 💭 는 히스토리 API 에 없어서 사라진다.
- 승인 요청은 한 번에 하나만 띄운다. 떠 있는 동안 온 새 요청이 앞의 것을 덮는다.
- 열린 것처럼 보이지만 죽은 소켓은 감지하지 못한다.
- 알림은 홈 화면 웹앱에서만 켤 수 있다. Safari 탭이면 홈 화면 추가 안내, 네이티브 앱이면 지원하지 않음으로 보인다. 백엔드의 `/api/push/*` 가 없으면 알림 켜기는 실패를 보인다.
