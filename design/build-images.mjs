// 이미지 자산 일괄 생성 — design/*.svg 원본을 래스터로 변환한다.
//
//   design/icon-app.svg        → app/icon.png(512) · app/apple-icon.png(180)  파비콘·홈 화면
//   design/og-image.svg        → app/opengraph-image.png(1200×630)            링크 공유 미리보기
//   design/hero-readme.svg     → design/hero.png(1280×400)                    README 배너
//   design/certificate-a4.svg  → design/certificate-a4.png(3508×2480)         포상 상장 인쇄용
//
// app/ 아래 파일명은 Next.js App Router 규약이다 — icon.png·apple-icon.png·
// opengraph-image.png를 자동 인식해 <link>·og:image 메타를 만든다. 설정 불필요.
//
// 한글 텍스트(OG·배너)는 SVG <text>로 넣고 시스템 Malgun Gothic으로 렌더된다.
// 이 스크립트는 Windows 로컬에서만 돌리고 산출물 PNG를 커밋한다(빌드 파이프라인 아님).
//
// sharp는 next의 전이 의존성이라 루트에 링크되지 않는다. .pnpm 스토어에서 직접 찾는다.
// 실행: node design/build-images.mjs   (저장소 루트에서)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = path.resolve("node_modules/.pnpm");
const dir = fs
  .readdirSync(store)
  .find(
    (d) =>
      /^sharp@/.test(d) &&
      fs.existsSync(path.join(store, d, "node_modules/sharp/lib/index.js"))
  );
if (!dir) {
  console.error("sharp를 찾지 못했습니다. 저장소 루트에서 pnpm install 후 다시 실행하세요.");
  process.exit(1);
}
const sharp = require(path.join(store, dir, "node_modules/sharp/lib/index.js"));

async function raster(src, out, width, height) {
  const buf = await sharp(fs.readFileSync(src), { density: 288 })
    .resize(width, height)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  fs.writeFileSync(out, buf);
  console.log(`${out.padEnd(30)} ${String(width).padStart(4)}×${height}  ${(buf.length / 1024).toFixed(1)} KB`);
}

await raster("design/icon-app.svg", "app/icon.png", 512, 512);
await raster("design/icon-app.svg", "app/apple-icon.png", 180, 180);
await raster("design/og-image.svg", "app/opengraph-image.png", 1200, 630);
await raster("design/hero-readme.svg", "design/hero.png", 1280, 400);
await raster("design/certificate-a4.svg", "design/certificate-a4.png", 3508, 2480);
