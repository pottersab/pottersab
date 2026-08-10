// render-promo.js
// Render video promo dari slides.html (timeline animasi) menjadi MP4 1080x1920 + musik latar.
// Pipeline: headless Chrome memicu window.__setT(t) tiap frame -> screenshot PNG (di temp lokal,
// bukan Google Drive) -> ffmpeg encode H.264 + mix audio, output ke proyek.

const puppeteer = require('puppeteer-core');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileP = promisify(execFile);

// ---------- KONFIG ----------
const PROJ = 'G:/My Drive/Website Potter/Website 2.4';
const SLIDES_HTML = path.join(PROJ, 'video-materials', 'slides', 'slides.html');
const OUT_MP4 = path.join(PROJ, 'promo-resmi-rilis.mp4');
const AUDIO = path.join(PROJ, 'video-materials', 'audio', 'Young Company.mp3');

const FPS = 30;
const W = 1080;
const H = 1920;

const CHROME = 'C:/Users/Kerayan/.cache/puppeteer/chrome/win64-150.0.7871.24/chrome-win64/chrome.exe';
const FFMPEG = 'C:/Users/Kerayan/promo-render/node_modules/ffmpeg-static/ffmpeg.exe';

// Frame sementara di temp lokal (bukan Drive) biar tidak bikin sync Google Drive berat.
const FRAMES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-frames-'));

function frameName(i) { return path.join(FRAMES_DIR, `f${String(i).padStart(5, '0')}.png`); }

(async () => {
  const t0 = Date.now();
  console.log(`→ Frames dir: ${FRAMES_DIR}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: ['--hide-scrollbars', '--force-device-scale-factor=1'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('file:///' + SLIDES_HTML.replace(/\\/g, '/'), { waitUntil: 'networkidle2', timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);

  // Baca TOTAL dari DUR yang ada di dalam <script> slides.html.
  const TOTAL = await page.evaluate(() => {
    const text = Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
    const m = text.match(/const DUR\s*=\s*\[([^\]]+)\]/);
    if (!m) return null;
    return m[1].split(',').map(Number).reduce((a, b) => a + b, 0);
  });
  if (!TOTAL) throw new Error('Tidak bisa membaca DUR dari slides.html');
  console.log(`→ Total timeline: ${TOTAL}s  (${Math.round(TOTAL * FPS)} frame @ ${FPS}fps)`);

  await page.evaluate(() => window.__setT(0));

  // ---------- CAPTURE FRAME ----------
  const nFrames = Math.floor(TOTAL * FPS);
  let existing = 0;
  for (let i = 0; i < nFrames; i++) {
    const p = frameName(i);
    if (fs.existsSync(p)) { existing++; continue; }
    const t = i / FPS;
    await page.evaluate((tt) => window.__setT(tt), t);
    await page.screenshot({ path: p, type: 'png' });
    if (i % 150 === 0) {
      console.log(`  frame ${i}/${nFrames} (${Math.round((i / nFrames) * 100)}%)  ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }
  console.log(`→ Capture selesai: ${nFrames} frame (${existing} reuse). ${Math.round((Date.now() - t0) / 1000)}s`);
  await browser.close();

  // ---------- ENCODE ----------
  const input = path.join(FRAMES_DIR, 'f%05d.png');
  const afadeOutSt = Math.max(0, (TOTAL - 1).toFixed(2));
  const args = [
    '-y',
    '-framerate', String(FPS),
    '-i', input,
    '-i', AUDIO,
    '-t', String(TOTAL),
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', 'format=yuv420p',
    '-af', `afade=t=in:st=0:d=0.6,afade=t=out:st=${afadeOutSt}:d=1`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    OUT_MP4,
  ];
  console.log(`→ Encoding… ${OUT_MP4}`);
  await execFileP(FFMPEG, args, { maxBuffer: 1024 * 1024 * 64 });
  console.log(`→ Done: ${(fs.statSync(OUT_MP4).size / 1024 / 1024).toFixed(1)} MB, ${TOTAL}s`);
  console.log(`→ Frame temp (bisa dihapus): ${FRAMES_DIR}`);
})().catch((e) => { console.error('✗ GAGAL:', e.message); process.exit(1); });
