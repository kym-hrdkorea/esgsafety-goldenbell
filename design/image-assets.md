# 이미지 자산 제작 명세 (생성 프롬프트 포함)

현재 저장소에는 **이미지가 한 장도 없다.** `public/`에는 배경음악 2개뿐이고, 종·자물쇠
아이콘은 인라인 SVG다(`components/BellIcon.tsx`). 파비콘도 없어서 브라우저 탭이 비어 있고,
링크를 공유해도 미리보기가 나오지 않는다.

이 문서는 시각성을 높일 이미지 후보를 우선순위대로 정리하고, 각각의 생성 프롬프트를 담는다.

---

## 먼저 읽을 것 — 3가지 원칙

### 1. 한국어 텍스트는 이미지로 만들지 않는다

이미지 생성 모델은 한글을 거의 못 만든다. 자모가 깨지거나 없는 글자를 만들어낸다.
**모든 프롬프트에 `no text, no letters` 를 넣고**, 글자는 HTML·SVG로 얹는다.
로고도 종 심볼만 생성하고 "HRDK 안전·청렴 ON! 골든벨"은 웹폰트로 조판한다.

### 2. 색은 생성 후 보정한다

생성 모델은 지정한 hex를 정확히 내놓지 않는다. 프롬프트에 hex를 적어 방향을 잡되,
받은 뒤 편집기(Figma·Photopea·Paint.NET)에서 아래 값으로 맞춘다.

| 역할 | hex | 쓰는 곳 |
|---|---|---|
| 페이지 배경 | `#0b0f1d` | 최외곽 |
| 화면 배경 | `#12172b` | 캐비닛 바디 |
| 카드 | `#1b2239` | 선택지·입력 |
| **세이프티 옐로** | `#FFD400` | 주색. CTA·타이머·현재 진행 |
| **브라스 골드** | `#C9A227` | **성취 전용.** 만점·1위·완료 배지·종 |
| 세이프티 그린 | `#24B24C` | 정답 |
| 세이프티 레드 | `#E23A2E` | 오답. 최소 사용 |
| 본문 텍스트 | `#EDF0F7` | — |

**옐로와 골드를 섞어 쓰지 않는다.** 옐로는 조작·진행, 골드는 성취다. 이 구분이 무너지면
"1위"의 무게가 사라진다.

### 3. 공통 스타일 문장 (모든 프롬프트에 붙인다)

```
STYLE: flat vector illustration, bold 3px dark outlines, hard-edged offset drop
shadow with zero blur (4px right 4px down), sharp corners with 2-4px radius only,
limited flat palette on deep navy #12172b ground, safety yellow #FFD400 as the
only bright accent, high contrast poster composition. Aesthetic reference: 1980s
arcade cabinet side-art crossed with Korean industrial safety signage (KOSHA).
Screen-print feel, two to three flat tones per shape, no rendering.

NEGATIVE: no text, no letters, no Korean characters, no numbers, no pixel art,
no dot/bitmap font, no CRT scanlines, no neon glow, no lens flare, no soft
gradient, no blur, no 3D render, no photorealism, no cute mascot character,
no emoji, no coin/life/game-over motif, no alarming or comedic tone.
```

마지막 두 항목은 `design/1_claude-design.md` 톤 가드레일에서 왔다. 72문항 중 상당수가
심정지·화재 문항이라, 실패를 놀리는 연출이나 유치한 캐릭터는 톤을 무너뜨린다.
**아케이드 연출은 성취 쪽에만 쏟는다.**

---

## 1단계 — 없어서 실제로 문제가 되는 것

### 1-1. 앱 아이콘 / 파비콘

**왜 필요한가**: 지금 브라우저 탭이 비어 있다. 1,800명이 모바일에서 홈 화면에 추가할 것을
감안하면 아이콘이 첫 접점이다.

**규격**: 정사각 1024×1024 PNG 1장 생성 → `512`(PWA) / `192`(안드로이드) / `180`(apple-touch)
/ `32`·`16`(파비콘)으로 축소. 배치: `app/icon.png`, `app/apple-icon.png` (Next.js가 자동 인식).
용량 각 20KB 이하.

**16px에서도 종으로 읽혀야 하므로 디테일을 극단적으로 줄인다.**

```
A single brass-gold bell, front-facing and perfectly symmetrical, centered on a
deep navy square. The bell is one solid shape in brass gold #C9A227 with a
thinner highlight edge in warm gold, a small clapper visible under the rim, and
a bold dark outline. Behind the bell, a single 45-degree safety-yellow #FFD400
diagonal stripe crosses the lower-right corner as a hazard accent. Background is
flat deep navy #12172b with a 3px yellow border frame.

Extremely simplified silhouette designed to stay legible at 16 pixels: no fine
detail, no engraving, no ornament, large solid areas only, maximum contrast
between bell and background.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no ribbon, no confetti, no sparkle, no wreath
```

### 1-2. 링크 공유 미리보기 이미지 (OG image)

**왜 필요한가**: 사내 공지는 카카오톡·메신저·메일로 URL을 뿌린다. 지금은 미리보기가 비어
있어서 링크가 스팸처럼 보인다. **투자 대비 효과가 가장 큰 한 장이다.**

**규격**: 1200×630 PNG. `app/opengraph-image.png`에 두면 Next.js가 메타태그를 자동 생성한다.
용량 200KB 이하.

**중요**: 이 이미지에는 제목 글자가 들어가야 하는데 한글 생성이 불가능하다.
→ **배경 아트만 생성하고, 글자는 `next/og`로 얹는다.** `ImageResponse`는 Next.js 15에
내장되어 있어 라이브러리 추가가 아니다(규칙 8 위반 아님). 아래 프롬프트는 **글자 없는
배경 레이어**용이며, 중앙 가로 560px 영역은 글자가 올라갈 자리이므로 비워 둔다.

```
A wide 1200x630 background plate for a corporate safety quiz campaign. Deep navy
#12172b field. Along the very top edge, a 12px band of 45-degree yellow-and-navy
hazard stripes running the full width. In the left third, a large brass-gold
#C9A227 bell rendered as a flat symmetrical silhouette, tilted slightly as if
mid-ring, with two short motion arcs beside the rim. In the right third, a loose
cluster of flat safety pictogram shapes in muted navy tones a shade lighter than
the background: a hard hat, a fire extinguisher, a clipboard with a checkmark,
an exit-door arrow. These are quiet background texture, never competing with the
bell.

The horizontal center band, roughly 560 pixels wide and 240 pixels tall, is left
as clean empty navy with no elements, reserved for a text overlay added later.

Composition is calm, dignified and institutional. This represents a public
agency, not a game studio.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no crowd of people, no faces, no flames rendered
realistically, no injury imagery, no siren, no blood, no exclamation mark
```

### 1-3. 로고 심볼 (로그인·가입 히어로용)

**왜 필요한가**: 로그인·가입 화면 상단이 지금은 텍스트만이다. 종 심볼이 들어가면
브랜드가 생기고, 첫 화면의 인상이 달라진다.

**규격**: 512×512 투명 배경 PNG(또는 생성 후 SVG로 트레이스). 화면에는 78~120px로 표시.
기존 `BellIcon`은 작은 자리(결과 화면 원형 배지 등)에 계속 쓰고, 이건 히어로 전용이다.

```
An emblem badge for a workplace safety quiz league, transparent background. A
brass-gold #C9A227 bell centered inside a hexagonal safety-sign frame. The frame
has a thick safety-yellow #FFD400 outer border and a deep navy #12172b inner
field. Two short curved motion strokes flank the bell to suggest it is ringing.
Under the bell rim, three tiny yellow spark marks. The bottom edge of the hexagon
carries four short 45-degree hazard stripe segments.

Strictly symmetrical, flat, emblem-like, reads clearly at 80 pixels.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no wings, no laurel wreath, no shield crest, no
ribbon banner, no star burst, no gradient metal shading
```

---

## 2단계 — 화면 완성도를 올리는 것

### 2-1. 로그인·가입 배경

**왜 필요한가**: 디자인 컨셉이 "오락기 앞에 앉은 기분"인데, 지금 배경은 단색 네이비다.
캐비닛 질감이 들어가면 컨셉이 실제로 보인다.

**규격**: 1440×2560 PNG(모바일 세로 대응) 또는 720×1280 후 CSS `background-size: cover`.
**용량 120KB 이하** — 첫 화면 로딩에 직접 영향을 준다. WebP 권장.
`opacity: 0.35` 정도로 깔고 그 위에 폼을 올린다.

```
A vertical background texture evoking the side panel of an arcade cabinet, very
low contrast so that form fields placed on top stay fully readable. Deep navy
#0b0f1d base. Faint darker navy geometric structure: a subtle grid of large
rounded-rectangle panel outlines, a few thin vertical seam lines, and two
diagonal hazard-stripe bands running off the corners at 45 degrees in navy tones
barely lighter than the base. A single very dim brass-gold bell silhouette sits
large and off-center in the lower area, almost dissolved into the background.

Everything is extremely muted — this is texture, not illustration. No element
exceeds 12 percent brightness contrast against the base. The upper 40 percent is
noticeably emptier to leave room for a form.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no bright accents, no yellow saturation above 20
percent, no busy pattern, no visible joystick or buttons, no marquee lighting
```

### 2-2. 회차 주제 일러스트 6종

**왜 필요한가**: 홈의 회차 카드와 사전학습 페이지 헤더가 텍스트만이다. 회차마다 주제
그림이 붙으면 6주 여정이 시각적으로 구분되고, 사전학습 열람률에도 도움이 된다.

**규격**: 각 1024×512 (2:1) PNG. 카드 상단 띠 또는 사전학습 헤더. 각 60KB 이하.
`public/rounds/round-1.webp` ~ `round-6.webp`.

**6장 모두 같은 프롬프트 골격을 쓰고 소재만 바꾼다.** 그래야 6주가 한 세트로 보인다.
아래 공통 골격에 각 회차의 `SUBJECT`만 갈아 끼운다.

```
[공통 골격]
A wide 2:1 banner illustration for week N of a six-week workplace safety
campaign. Deep navy #12172b ground. Centered composition with 2 or 3 flat
safety-related objects, drawn large and simple with bold dark outlines and hard
offset shadows. One single object is highlighted in safety yellow #FFD400; all
other objects use muted steel-blue and slate tones. A thin 45-degree hazard
stripe segment sits in one bottom corner as a consistent series marker. Generous
empty navy space on the left third for a text label added later.

SUBJECT: <아래 회차별 소재>

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no human faces, no injury or blood, no realistic
fire, no ambulance siren, no crowd
```

| 회차 | 주제 (2026-08-26 청렴 혼합 개정) | SUBJECT 문장 |
|---|---|---|
| **1회차** | 안전·청렴, 기본부터 | `Three hard hats of slightly different sizes arranged in a row, the middle one in safety yellow, with a small shield outline containing a check mark floating above them, suggesting safety and integrity starting together from the basics.` |
| **2회차** | 일상의 위험, 금품의 선 | `A simple balance scale in safety yellow with a small gift box outline on one pan, beside an upright clipboard with one bold horizontal line marked across it like a limit line, suggesting everyday risk checks and a clear line on gifts.` |
| **3회차** | 그 순간, 어떻게 할까 | `A stylized clock face in safety yellow beside two arrow paths branching from a single point, the correct arrow curving toward a small open door shape, suggesting a decisive moment and choosing the right way out.` |
| **4회차** | 사무실과 이해관계 점검 | `A desk seen from the side with a monitor on top and a tall filing cabinet strapped to the wall behind it, beside two overlapping circle outlines with a small magnifying glass held over the overlapping area, suggesting an office check that includes overlapping interests.` |
| **5회차** | 실전 판단, 안전과 청렴 | `A fire extinguisher standing upright in safety yellow next to a shield outline of similar height, with a small checklist card leaning between them, suggesting real-situation judgment in both safety and integrity.` |
| **6회차** | 신고가 지키는 우리 | `A brass-gold bell at the center being struck, with a small whistle and a folded report document leaning at its base, and six small square markers arranged in a row beneath it all filled in, suggesting a completed six-week course closed out by reporting.` |

> 6회차만 브라스 골드를 쓴다. 완주 = 성취이기 때문이다. 1~5회차는 옐로만 쓴다.
> ※ 2026-08-26 테마 개정으로 SUBJECT 6건을 재작성했다. **기존 생성 자산은 구 테마 기준**이므로
>   재생성 여부는 별도 태스크로 결정한다(스타일·네거티브 공통문은 불변).

### 2-3. 순위 배지 1·2·3위

**왜 필요한가**: 대시보드 순위표가 숫자뿐이다. 상위 3위에 배지가 붙으면 포상이 걸린
리그라는 성격이 드러난다.

**규격**: 각 256×256 투명 PNG. 표에서 24~32px로 표시. 각 8KB 이하.
**셋을 한 번에 한 장으로 생성하지 말고 각각 따로 생성**해야 크기·정렬이 맞는다.

```
[1위]
A first-place rank badge, transparent background. A hexagonal medal shape with a
thick brass-gold #C9A227 border and a deep navy #12172b center field. Inside the
center, a small brass-gold bell silhouette. A single 45-degree hazard stripe
segment crosses the bottom-left edge of the hexagon. Flat, symmetrical, bold dark
outline, hard offset shadow. Reads clearly at 24 pixels.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no ribbon tails, no laurel, no numeral, no sparkle
burst, no metallic gradient
```

```
[2위]
Identical construction to the first-place badge — same hexagon shape, same
proportions, same hazard stripe placement, same flat treatment — but the border
is cool silver-grey #A8B0C4 and the center holds a small silver bell silhouette.
Slightly lower visual weight than the gold version.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no ribbon tails, no laurel, no numeral, no sparkle
burst, no metallic gradient, no gold tones
```

```
[3위]
Identical construction to the first-place badge — same hexagon shape, same
proportions, same hazard stripe placement, same flat treatment — but the border
is muted bronze-brown #9A6B3C and the center holds a small bronze bell
silhouette. Lowest visual weight of the three.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no ribbon tails, no laurel, no numeral, no sparkle
burst, no metallic gradient, no gold or silver tones
```

### 2-4. 만점 성취 그래픽 (결과 화면)

**왜 필요한가**: 12문항 만점은 이 캠페인의 하이라이트다. 지금은 숫자만 커진다.
"골든벨은 울리는 게 주인공"이라는 컨셉의 정점이다.

**규격**: 640×640 투명 PNG. 결과 화면 중앙. 40KB 이하.
만점(12/12)일 때만 노출하고, 그 외에는 기존 원형 배지를 유지한다.

```
A celebratory achievement graphic for a perfect score, transparent background. A
large brass-gold #C9A227 bell at the center, struck and mid-ring, with four bold
motion arcs radiating symmetrically from the rim. Around the bell, eight short
straight radiating rays in safety yellow #FFD400 arranged evenly like a stamped
seal. Below the bell, a horizontal band of 45-degree hazard stripes forming a
short base line.

The mood is a dignified stamp of accomplishment, like a certification seal — not
a party popper. Restrained, symmetrical, poster-like.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no confetti, no streamers, no fireworks, no
starburst glow, no trophy cup, no thumbs up, no cheering figures
```

### 2-5. 빈 상태 일러스트

**왜 필요한가**: 개시 직후 순위표·내 기록이 비어 있는데, 지금은 문구만 나온다.
1주차 이탈을 줄이려면 빈 화면이 "고장난 것"으로 보이지 않아야 한다.

**규격**: 400×300 투명 PNG. 40KB 이하. 순위·내 기록 공용 1장.

```
A calm empty-state illustration, transparent background. A brass-gold bell
hanging still and silent — clearly not ringing, no motion lines — beside an empty
podium block drawn as three plain stacked rectangles in muted slate-blue with
nothing on top. A single small safety-yellow #FFD400 dot marks the podium's top
step as the only bright accent.

The feeling is quiet anticipation, waiting to begin. Not sad, not broken, not
error-like.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no sad face, no crying, no error symbol, no
crossed-out icon, no question mark, no dust or cobwebs
```

---

## 3단계 — 있으면 좋은 것

### 3-1. README 히어로 배너 (GitHub 첫 화면)

**규격**: 1280×400 PNG, `docs/hero.png` 또는 `design/hero.png`. README 최상단에 삽입.
저장소를 여는 사람의 첫인상을 담당한다. 200KB 이하.

```
A wide 1280x400 repository header banner. Deep navy #12172b field with a 10px
band of 45-degree yellow-and-navy hazard stripes along the top edge, matching the
app's own header treatment. In the left area, a brass-gold #C9A227 bell in flat
symmetrical silhouette. Spread across the middle and right, a horizontal row of
six evenly spaced square card outlines in slightly lighter navy, the first two
filled with a faint yellow tint and the rest empty — representing six weekly
rounds in progress. Wide empty navy space in the upper right for a text overlay.

Clean, technical, restrained. Looks like documentation, not marketing.

STYLE: [공통 스타일 문장]
NEGATIVE: [공통 네거티브] + no code snippets, no terminal window, no browser
chrome, no laptop mockup, no stock-photo people
```

### 3-2. 포상 상장 배경

**규격**: A4 가로 3508×2480 PNG (300dpi). 인쇄용이므로 **밝은 배경**으로 반전한다.
수상자 이름·부서는 별도로 조판한다.

```
An A4 landscape certificate background for a corporate safety award, printed on
white. Warm off-white #FBFAF6 field with a double border frame: an outer thin
brass-gold #C9A227 rule and an inner thicker navy #12172b rule. In each of the
four corners, a small 45-degree hazard stripe corner ornament in gold and navy.
Centered at the top, a brass-gold bell emblem inside a hexagonal frame, sized
modestly. A faint large watermark of the same bell sits at very low opacity
behind the center of the page.

The entire central area is left clean and empty for text. Formal, restrained,
suitable for a public institution.

STYLE: flat vector, precise geometric linework, print-ready, no texture noise
NEGATIVE: no text, no letters, no Korean characters, no signature line drawn,
no seal stamp graphic, no ribbon rosette, no gradient, no photorealism
```

### 3-3. 영역 아이콘 8종 — **생성보다 SVG 직접 작성을 권한다**

`/me` 화면의 영역별 정답률에 쓰일 아이콘 8종(화재·대피, 생활안전, 직장 건강, 사무실 안전,
응급처치, 위험성평가, 안전 법령, 공단 안전)이다.

**작은 단색 아이콘은 생성 이미지보다 손으로 쓴 SVG가 낫다.** 24px에서 선 굵기가 일정해야
하고, 8개가 한 세트로 보여야 하는데 생성 모델은 이 일관성을 못 맞춘다. 무엇보다 기존
`BellIcon`·`LockIcon`이 이미 인라인 SVG 방식이라, 여기만 raster를 섞으면 어긋난다.

필요하시면 `components/CategoryIcons.tsx`에 8종을 `stroke-width: 2.2`, `viewBox="0 0 24 24"`
규격으로 직접 작성해 드릴 수 있다. 기존 두 아이콘과 정확히 같은 규격이다.

---

## 적용 시 주의

**용량 예산.** 1,800명이 주로 모바일로 접속하고 100 VU 부하 목표가 있다. 전체 이미지
합계를 **500KB 이하**로 유지하고, 사진이 아닌 플랫 일러스트이므로 WebP로 변환하면
PNG 대비 60~70% 줄어든다. 배경 이미지는 `loading="lazy"`를 쓸 수 없으므로(첫 화면)
특히 작게 유지한다.

**다크 전용이다.** 이 앱은 배경이 원래 어둡고 라이트 모드가 없다(`design/1_claude-design.md`).
투명 배경 PNG를 쓰되, 밝은 배경에서의 대비는 고려하지 않아도 된다. 예외는 상장(3-2)뿐이다.

**생성 순서 권장.** 1-2(OG) → 1-1(아이콘) → 2-2(회차 6종) 순이 체감 효과가 가장 크다.
1-2와 1-1은 없어서 생기는 문제를 없애고, 2-2는 매주 보는 화면을 바꾼다.

**저작권.** 생성 이미지를 쓰되, KOSHA 안전보건표지의 **공식 도안을 그대로 재현하지 않는다.**
표지는 규격이 법으로 정해져 있어 유사 도안이 오히려 혼란을 준다. 프롬프트가 "safety
signage 스타일"을 참조하는 것은 괜찮지만, 실제 표지를 모방한 결과물은 걸러낸다.
