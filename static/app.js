/* Achird Local — front-end.
   pdf.js 4.8.69 (TextLayer class API) + Motion springs + vanilla DOM. */
import * as pdfjsLib from "/static/vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.mjs";

const M = window.Motion || null;
const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* springs: critically damped default; bounce only after momentum */
const SPRING = { type: "spring", duration: 0.35, bounce: 0 };
function anim(el, kf, opts = SPRING) {
  if (REDUCED || !M) { Object.assign(el.style, Object.fromEntries(
    Object.entries(kf).map(([k, v]) => [k, Array.isArray(v) ? v[v.length - 1] : v]))); return { finished: Promise.resolve() }; }
  try { return M.animate(el, kf, opts); }
  catch { Object.assign(el.style, kf); return { finished: Promise.resolve() }; }
}

/* ---------------------------------------------------------------- utils */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MD_HREF_RE = /^(https?:|#|mailto:)/i;
const MD_SRC_RE = /^(data:image\/|\/api\/)/i;

function md(src) {
  const html = window.marked ? window.marked.parse(String(src ?? ""), { breaks: true }) : esc(src);
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script,iframe,object,embed,link,style").forEach((e) => e.remove());
  t.content.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const hadTarget = tag === "a" && el.hasAttribute("target");   // 스트립 전에 포착 — target은 허용목록에 없어 아래서 지워진다
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      if (name === "class") return;
      if (tag === "a" && name === "href" && MD_HREF_RE.test(a.value)) return;
      if (tag === "img" && name === "src" && MD_SRC_RE.test(a.value)) return;
      if (tag === "img" && (name === "alt" || name === "title")) return;
      if ((tag === "th" || tag === "td") && name === "align") return;
      if (tag === "input" && name === "type" && a.value.toLowerCase() === "checkbox") return;
      if (tag === "input" && (name === "checked" || name === "disabled")) return;
      el.removeAttribute(a.name);
    });
    if (hadTarget) {
      el.setAttribute("rel", "noopener");
      el.setAttribute("target", "_blank");
    }
  });
  return t.innerHTML;
}

async function api(path, opts = {}) {
  let r;
  try { r = await fetch(path, opts); }
  catch (e) {
    if (e.name === "AbortError") throw e;                        // 취소는 실패가 아니다
    throw new Error(`서버와 연결할 수 없습니다 (${e.name}: ${e.message}) — run.bat으로 서버를 켠 뒤 새로고침하세요.`);
  }
  if (!r.ok) {
    const raw = await r.text().catch(() => "");                  // 본문은 text로 한 번만 — r.json() 먼저 부르면 스트림이 소진돼 재독 불가
    let msg = "";
    try {
      const d = JSON.parse(raw).detail;
      msg = typeof d === "string" ? d
        : Array.isArray(d) ? d.map((x) => `${(x.loc || []).join(".")}: ${x.msg}`).join(" · ")   // 422 검증 오류는 detail 이 배열
        : d ? JSON.stringify(d) : "";
    } catch { /* JSON 아님 — 아래 폴백이 본문 앞머리를 그대로 보여준다 */ }
    if (!msg) msg = `HTTP ${r.status} ${r.statusText}`.trim() + (raw ? ` — ${raw.slice(0, 200)}` : " (응답 본문 없음)");
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return (r.headers.get("content-type") || "").includes("json") ? r.json() : r;
}
const pj = (path, body, method = "POST") =>
  api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function toast(msg, isErr = false) {
  msg = String(msg ?? "").trim() || "원인 불명 오류 — 브라우저 콘솔을 확인하세요";   // 빈 토스트 금지(빈 statusText 등)
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  if (isErr) t.setAttribute("role", "alert");   // assertive + 이 노드만 낭독(컨테이너 role="status" 는 전체 재낭독)
  t.style.opacity = "0"; t.style.transform = "translateY(-6px)";
  const box = $("toasts");
  // 실패 루프(30쪽 시각 추출 등)가 첫 오류를 밀어내면 원인이 사라진다 → 같은 문구는 다시 쌓지 않고,
  // 자리가 없으면 스스로 사라질 토스트부터 버린다(긴 오류는 타이머가 없어 클릭으로만 닫힌다)
  if (isErr && [...box.children].some((k) => k.textContent === msg)) return;
  while (box.children.length >= 4) {
    const kids = [...box.children];
    (kids.find((k) => !k.onclick) || kids[0]).remove();
  }
  box.appendChild(t);
  anim(t, { opacity: 1, transform: "translateY(0)" }, { type: "spring", duration: 0.3, bounce: 0 });
  /* 긴 원인 문장(CLI stderr 등)은 4.2초에 다 못 읽는다 — 드래그해 복사하고 클릭하면 닫는다 */
  if (isErr && msg.length > 80) {
    t.title = "클릭하면 닫힘 · 드래그해 복사";
    t.onclick = () => { if (!getSelection().toString()) t.remove(); };   // 선택 중 클릭으로 사라지지 않게
    return;
  }
  setTimeout(() => {
    anim(t, { opacity: 0, transform: "translateY(-6px)" }, { duration: 0.18, ease: "ease-out" });
    setTimeout(() => t.remove(), 220);
  }, isErr ? 4200 : 2400);
}

/* 클립보드 복사 + 확인 토스트 — 인용 문자열·LaTeX 등 여러 복사 액션이 공용으로 쓴다 */
async function copyText(text, label = "복사됨") {
  try { await navigator.clipboard.writeText(String(text ?? "")); toast(label); }
  catch { toast("복사 실패 — 브라우저 권한을 확인하세요", true); }
}

/* 파일 다운로드 트리거 — Blob을 임시 <a download>로 클릭한다(CSV·BibTeX 내보내기 공용) */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------- icons (SF-symbol-ish strokes) */

const ICONS = {
  back: '<path d="M12.5 4.5 7 10l5.5 5.5"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  minus: '<path d="M4.5 10h11"/>',
  send: '<path d="M3.5 10 16 4l-3.5 12-3.6-4.9L3.5 10z" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4 6h12M8.5 6V4.5h3V6M5.5 6l.7 9.5h7.6L14.5 6M8.3 8.5v4.5M11.7 8.5v4.5"/>',
  doc: '<path d="M5.5 3h6L15 6.5V17h-9.5V3z"/><path d="M11 3v4h4"/><path d="M8 10.5h4.5M8 13h4.5"/>',
  chat: '<path d="M3.5 4.5h13v8.5h-7L6 16.5v-3.5H3.5v-8.5z"/>',
  note: '<path d="M4.5 3.5h11v13h-11z"/><path d="M7 7h6M7 9.5h6M7 12h3.5"/>',
  marker: '<path d="M4 16h12" opacity=".45"/><path d="M6.5 12.5 12 4.2c.6-.9 1.9-.7 2.4.2l.6 1.1c.4.8.1 1.7-.6 2.2l-8 5.3-1.6.6.7-1.1z"/>',
  book: '<path d="M10 5.5C8.8 4.3 6.8 3.8 4 4v11c2.8-.2 4.8.3 6 1.5 1.2-1.2 3.2-1.7 6-1.5V4c-2.8-.2-4.8.3-6 1.5z"/><path d="M10 5.5V16"/>',
  translate: '<path d="M3.5 5h8M7.5 3.5V5M9.7 5C9 8.2 6.8 10.8 4 12.3"/><path d="M5.5 7.5c1.2 2.6 3.4 4.5 6 5.3"/><path d="M11 16.5 14 9l3 7.5M12 14.5h4"/>',
  sparkle: '<path d="M10 3.5 11.4 8 16 9.5 11.4 11 10 15.5 8.6 11 4 9.5 8.6 8 10 3.5z"/>',
  quote: '<path d="M5 12.5c-.8-.8-1.2-1.8-1.2-3C3.8 6.7 5.7 4.8 8 4.5v2C6.8 6.8 6 7.8 6 9h2v4H5v-.5zM12 12.5c-.8-.8-1.2-1.8-1.2-3 0-2.8 1.9-4.7 4.2-5v2c-1.2.3-2 1.3-2 2.5h2v4h-3v-.5z" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="10" cy="10" r="3.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/>',
  moon: '<path d="M16 11.5A6.5 6.5 0 0 1 8.5 4 6.5 6.5 0 1 0 16 11.5z"/>',
  x: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
  export: '<path d="M10 12.5V3M6.5 6 10 2.5 13.5 6"/><path d="M4.5 11.5V16h11v-4.5"/>',
  key: '<path d="M3.5 5.5h7.5"/><path d="M6 10h10.5"/><path d="M3.5 14.5h8.5"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17"/>',
  chevUp: '<path d="M5 12.5l5-5 5 5"/>',
  chevDown: '<path d="M5 7.5l5 5 5-5"/>',
  fig: '<rect x="3.5" y="4.5" width="13" height="11" rx="1.5"/><path d="M6 12.5l3-3 2.5 2.5 2-2 2.5 2.5"/><circle cx="7.5" cy="7.8" r="1" fill="currentColor" stroke="none"/>',
  toc: '<path d="M7.5 5.5h9"/><path d="M7.5 10h9"/><path d="M7.5 14.5h9"/><circle cx="4.2" cy="5.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="4.2" cy="10" r="0.9" fill="currentColor" stroke="none"/><circle cx="4.2" cy="14.5" r="0.9" fill="currentColor" stroke="none"/>',
  term: '<path d="M3.5 14.5 7 5l3.5 9.5"/><path d="M4.8 11.5h4.4"/><path d="M16.5 10.2c0-1.1-.9-1.7-2.1-1.7-1 0-1.8.4-2.2 1"/><path d="M16.5 10.2v4.3M16.5 12c-2.4-.3-4.3.3-4.3 1.6 0 1 .9 1.4 1.8 1.4 1.2 0 2.5-.8 2.5-2"/>',
  pencil: '<path d="M4.5 15.5l.9-3.4 8.2-8.2a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2l-8.2 8.2-3.4.9z"/><path d="M12.2 5.3l2.5 2.5"/>',
  copy: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" opacity=".5"/>',
  formula: '<path d="M14.5 5H6l5 5-5 5h8.5"/>',
  graph: '<path d="M6.5 5.4 13.5 5.8M6.1 6.6 9.5 13.6M13.8 6.8 11 14"/><circle cx="5" cy="5" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.8" fill="currentColor" stroke="none"/><circle cx="10" cy="15" r="1.8" fill="currentColor" stroke="none"/>',
  grid: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1"/><rect x="11" y="11" width="5.5" height="5.5" rx="1"/>',
  map: '<circle cx="10" cy="10" r="2.4"/><circle cx="16.2" cy="5.4" r="1.5"/><circle cx="16.2" cy="14.6" r="1.5"/><circle cx="4" cy="10" r="1.5"/><path d="M12 8.7l2.8-2.6M12 11.3l2.8 2.6M7.6 10h-2"/>',
};
const icon = (name, size = 20) =>
  `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

/* ---------------------------------------------------------------- the binary orbit (signature) */

// Achird(η Cassiopeiae)는 육안 이중성 — 주성과 반성이 공통 질량중심을 돈다.
// 궤도면을 비스듬히 보므로 화면상 궤도는 타원(.star-track)이고, 관측자 쪽으로
// 돌아온 별은 커지고 뒤로 넘어간 별은 작아진다. 뒤쪽 별은 궤도선 뒤에 깔려 가려진다.
// ph 0→1 이 정확히 한 바퀴라 사이클이 이어붙는 자리에 리셋 점프가 없다.
const ORB = 6.8;                        // 궤도 반지름 (viewBox 20 기준)
const TILT = 0.45;                      // 궤도면 기울기 — 세로 축 압축률
const DEPTH = 0.5;                      // 원근에 따른 크기 진폭 (±50%)
const DIM = 0.45;                       // 가장 먼 지점의 불투명도 — 1 까지 연속 보간
const ROT = -16 * Math.PI / 180;        // 궤도 장축을 살짝 눕힌다
const COS_R = Math.cos(ROT), SIN_R = Math.sin(ROT);
const IDLE_PH = 0.15;                   // 멈춰 있을 때 두 별이 겹치지 않는 위상

function starDots(ph) {
  const f = (x) => +x.toFixed(2);
  const dot = (x, y, rr) =>                                   // 원 하나 = 지름 양끝을 잇는 반원 호 두 개
    `M ${f(x - rr)} ${f(y)} A ${f(rr)} ${f(rr)} 0 1 0 ${f(x + rr)} ${f(y)} ` +
    `A ${f(rr)} ${f(rr)} 0 1 0 ${f(x - rr)} ${f(y)} Z`;
  const at = (a, base, fill) => {
    const ux = ORB * Math.cos(a), uy = ORB * TILT * Math.sin(a);
    const z = Math.sin(a);                                    // +1 관측자 쪽, -1 반대편
    return { x: 10 + ux * COS_R - uy * SIN_R, y: 10 + ux * SIN_R + uy * COS_R,
             r: base * (1 + DEPTH * z), o: DIM + (1 - DIM) * (z + 1) / 2, fill, z };
  };
  const a = 2 * Math.PI * ph;                                 // 반대 위상 — 늘 한쪽이 앞, 한쪽이 뒤
  const A = at(a, 2.3, "var(--accent)");                      // 주성 η Cas A — G0V 황백색
  const B = at(a + Math.PI, 1.7, "var(--accent-2)");          // 반성 η Cas B — K7V 주황
  const [far, near] = A.z < B.z ? [A, B] : [B, A];            // z 순으로 그려야 가림이 맞는다
  // 투명도·색은 슬롯이 아니라 별을 따라간다 — 두 별이 z=0 에서 슬롯을 맞바꿀 때
  // 투명도가 서로 같아 이음매가 안 보인다. 슬롯에 고정하면 그 순간 계단이 생긴다.
  const out = (s) => [dot(s.x, s.y, s.r), s.o.toFixed(3), s.fill];
  return [out(far), out(near)];
}
// 뒤 별 → 궤도선 → 앞 별. DOM 순서가 곧 z 순서라 매 프레임 노드를 옮길 필요가 없다.
const STAR_SVG =
  `<path class="star-fill star-far" d=""></path>` +
  `<ellipse class="star-track" cx="10" cy="10" rx="${ORB}" ry="${+(ORB * TILT).toFixed(2)}" transform="rotate(-16 10 10)"></ellipse>` +
  `<path class="star-fill star-near" d=""></path>`;

const busyState = { count: 0, raf: 0 };
function paintStars(ph, root) {
  const [far, near] = starDots(ph);
  const scope = root || document;
  // fill 은 style 로 — .star-fill 의 CSS 규칙이 presentation attribute 를 이기기 때문.
  // var() 그대로 두면 테마를 바꿔도 다시 칠할 필요가 없다.
  const put = (sel, [d, o, fill]) => scope.querySelectorAll(sel).forEach((p) => {
    p.setAttribute("d", d); p.setAttribute("opacity", o); p.style.fill = fill;
  });
  put(".star-glyph .star-far", far);
  put(".star-glyph .star-near", near);
}
function starTick(t) {
  paintStars((t / 2600) % 1);
  busyState.raf = busyState.count > 0 ? requestAnimationFrame(starTick) : 0;
  if (!busyState.raf) paintStars(IDLE_PH);
}
function busy(label) {
  busyState.count++;
  if (label) { $("busy-label").textContent = label; $("busy-label").hidden = false; }
  if (!busyState.raf && !REDUCED) busyState.raf = requestAnimationFrame(starTick);
  return () => {
    busyState.count = Math.max(0, busyState.count - 1);
    if (busyState.count === 0) { $("busy-label").hidden = true; paintStars(IDLE_PH); }
  };
}
// AI 대기 라벨 → thinking-orb 상태. 헤더의 이항성(binary)은 브랜드로 남기고,
// 인라인 대기 표시는 작업의 성격을 말하는 orb 가 맡는다 (orbs.js).
const ORB_RULES = [
  [/검색|찾는|훑는|뒤져|스캔|읽는 중/, "searching"],
  [/분석|심사|겹침|검사|비교/, "solving"],
  [/생각|질문|답하는/, "breathing"],
  [/그래프|인용 관계|연결/, "connecting"],
  [/모으는|합치는|뽑는/, "weaving"],
  [/번역|요약|정리|만드는|그리는|근거표|초안/, "composing"],
];
function orbState(label) {
  for (const [re, st] of ORB_RULES) if (re.test(label)) return st;
  return "working";
}
function starInline(label) {
  const el = document.createElement("div");
  el.className = "star-inline";
  el.appendChild(ThinkingOrbs.create(orbState(label), 20));
  const span = document.createElement("span");
  span.textContent = label;
  el.appendChild(span);
  return el;
}

/* ---------------------------------------------------------------- theme */

const THEME_LABEL = { auto: "자동", light: "라이트", dark: "다크" };
const THEME_NEXT = { auto: "light", light: "dark", dark: "auto" };
function applyTheme(v) {
  if (v === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
  localStorage.setItem("ml.theme", v);
  const dark = v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  /* 읽기 탭과 집필 탭이 각자 테마 버튼을 갖는다 — 한쪽만 갱신하면 탭을 옮겼을 때 아이콘이 어긋난다 */
  ["theme-btn", "theme-btn-w"].forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    btn.innerHTML = icon(dark ? "sun" : "moon", 17);
    btn.classList.add("pressable");
    btn.title = `테마: ${THEME_LABEL[v]}`;
    btn.setAttribute("aria-label", btn.title);
  });
}
function cycleTheme() {
  const cur = localStorage.getItem("ml.theme") || "auto";
  applyTheme(THEME_NEXT[cur]);
}
function initTheme() {
  applyTheme(localStorage.getItem("ml.theme") || "auto");
  $("theme-btn").onclick = cycleTheme;
}

/* ---------------------------------------------------------------- state */

const S = {
  papers: [],
  current: null,      // meta of open paper
  pdf: null,
  pages: [],          // per page: {n,page,tc,raw,index,wrap,hlLayer,textDivs,rendered,rendering,natW,natH}
  scale: 1.3,
  textReady: false,
  sel: null,          // {text, page, rect}
  hl: { items: [] },
  autoHl: [],
  notes: [],
  refs: { style: "numeric", items: [] },
  refMap: new Map(),
  refLinks: new Map(),  // 참고문헌 n(문자열) → 서재 내 매칭 논문 {id,title}
  chatQuote: null,
  io: null,
  view: "pdf",        // 'pdf' | 'parallel'
  inspAutoHid: false, // 병렬 뷰가 인스펙터를 자동으로 접었는지
  inspUserPinned: false, // 방금 수동으로 인스펙터를 토글함 — 다음 setView 1회는 자동 접기/펴기 건너뜀
  trans: { pages: {}, err: {}, inflight: new Set(), running: false, stop: false },
  prefetch: { queue: [], inflight: new Set() },                  // 다음 쪽 번역 프리페치(병렬 뷰 전용, 사용자 요청보다 항상 저순위)
  align: { on: false, pages: {}, err: {}, inflight: new Set(), running: false },
  linkPinned: null,   // 클릭으로 고정된 tc-sent (null=고정 없음)
  kp: { on: false, items: null, placed: false, running: false }, // 핵심 4색 하이라이트
  find: { q: "", list: [], cur: -1, open: false },               // 원문 검색 (Ctrl+F)
  gloss: { items: null, running: false, placed: null },          // 용어집 (+본문 첫 등장 밑줄 배치)
  q: { items: null, running: false },                            // 추천 질문 칩
  scan: { running: false, stop: false, done: 0, todo: 0 },       // 스캔 PDF 시각 추출
  outline: null,                                                 // 목차 캐시
  figs: null,                                                    // 그림 갤러리 캐시
  formulas: null,                                                // 수식 갤러리 캐시
  mysum: { data: null, running: false },                         // 내 정리(하이라이트·노트 요약)
  an: { data: null, running: false },                            // 구조 분석 8섹션
  mm: { nodes: null, running: false, placed: false },            // 마인드맵 (논지 지도)
  cmp: { on: false, sel: [] },                                   // 홈 선택 모드 (비교·근거표·bib 내보내기 공용, 선택 pid들)
  prepRunning: false,                                            // 원클릭 AI 준비
  filter: { status: null, tag: null },                           // 서가 필터 (상태·태그)
  capOn: false,                                                  // 그림 영역 드래그 캡처 모드
};

let pendingJump = null;   // 서재 검색 결과 → 리더 진입 시 {page, src, q}
/* 검색 히트의 출처별로 리더에서 열어줄 인스펙터 탭. 원문·번역은 본문 쪽에서 처리한다. */
const JUMP_TAB = { "내 노트": "notes", "강조": "hl" };

/* ---------------------------------------------------------------- home / library */

function coverHTML(p) {
  if (p.has_thumb) return `<img src="/api/papers/${p.id}/thumb?ts=${p.added}" alt="">`;
  return `<div class="cover-ph"><div class="ph-rule"></div><div class="ph-title">${esc(p.title)}</div></div>`;
}

/* 진행률은 meta.json(서버, OneDrive로 두 PC 공유)이 먼저다. localStorage는 이 PC가 그전에
   혼자 적어둔 값의 폴백 — 서버 값이 생기면 자연히 뒤로 밀린다. */
function readPosRatio(id) {
  const p = S.papers.find((x) => x.id === id);
  if (p?.read_pos?.r > 0) return p.read_pos.r;
  try { return JSON.parse(localStorage.getItem("ml.pos." + id) || "null")?.r || 0; }
  catch { return 0; }
}
function progressHTML(id) {
  const r = readPosRatio(id);
  if (!(r > 0.02)) return "";
  const pct = Math.min(100, Math.round(r * 100));
  return `<div class="read-prog" title="읽기 진행률 ${pct}%"><i style="width:${pct}%"></i></div>`;
}

function renderShelf() {
  const shelf = $("shelf");
  shelf.innerHTML = "";
  const add = document.createElement("button");
  add.className = "add-book"; add.id = "add-book";
  add.innerHTML = `${icon("plus", 26)}<span>PDF 추가</span>`;
  add.onclick = () => $("file-input").click();
  shelf.appendChild(add);

  const list = S.papers.filter((p) =>
    (!S.filter.status || p.status === S.filter.status) &&
    (!S.filter.tag || p.tags?.includes(S.filter.tag)));
  if (S.papers.length && !list.length) {
    const hint = document.createElement("div");
    hint.className = "shelf-hint";
    hint.textContent = "조건에 맞는 논문이 없습니다.";
    shelf.appendChild(hint);
  }

  list.forEach((p, i) => {
    const b = document.createElement("button");
    b.className = "book";
    b.dataset.pid = p.id;
    const bits = [];
    if (p.authors?.length) bits.push(esc(p.authors[0]) + (p.authors.length > 1 ? " 외" : ""));
    if (p.year) bits.push(p.year);
    bits.push(p.pages ? p.pages + "쪽" : "새 논문");
    const status = p.status || "none";
    const statusLabel = status === "reading" ? "읽는 중" : status === "done" ? "완독" : "+ 상태";
    /* 준비 체인 진행 — 다 되면 배지 자체를 안 그린다(완료 상태가 기본이라 소음).
       잡이 이 논문을 물고 도는 중이면 "AI 진행 중"이 우선. nowrap — 배지가 중간에서 줄바꿈되면 못 읽는다 */
    const prep = p.ai_busy
      ? `<span class="tag-chip" style="white-space:nowrap;" title="백그라운드 작업(준비·번역)이 이 논문을 처리하는 중">AI 진행 중</span>`
      : (p.prep && p.prep.done < p.prep.total
        ? `<span class="tag-chip" style="white-space:nowrap;" title="배경 준비 체인 (서지·요약·핵심·용어집·질문·검증)">준비 ${p.prep.done}/${p.prep.total}</span>` : "");
    const tags = p.tags || [];
    const tagChips = tags.slice(0, 3).map((t) => `<span class="tag-chip">${esc(t)}</span>`).join("") +
      (tags.length > 3 ? `<span class="tag-chip more">+${tags.length - 3}</span>` : "");
    b.innerHTML = `
      <div class="cover">${coverHTML(p)}${progressHTML(p.id)}
        <button class="status-chip ${status}" title="읽기 상태 변경">${statusLabel}</button></div>
      <div class="book-name">${esc(p.title)}</div>
      <div class="book-meta"><span>${bits.join(" · ")}${prep ? " " + prep : ""}</span>
        <button class="tag-edit" title="태그 편집" aria-label="태그 편집">${icon("pencil", 12)}</button>
        <button class="book-del" title="삭제" aria-label="삭제">${icon("trash", 13)}</button></div>
      ${tags.length ? `<div class="book-tags">${tagChips}</div>` : ""}`;
    b.querySelector(".book-del").onclick = (e) => { e.stopPropagation(); confirmDelete(p); };
    b.querySelector(".status-chip").onclick = (e) => { e.stopPropagation(); cycleStatus(p); };
    b.querySelector(".tag-edit").onclick = (e) => { e.stopPropagation(); openTagEditor(p, e.currentTarget.getBoundingClientRect()); };
    b.onclick = () => S.cmp.on ? toggleCmpSel(p.id) : openPaper(p);
    if (!REDUCED) {
      b.style.opacity = "0"; b.style.transform = "translateY(8px)";
      setTimeout(() => anim(b, { opacity: 1, transform: "translateY(0)" },
        { type: "spring", duration: 0.4, bounce: 0 }), Math.min(i * 40, 400));
    }
    shelf.appendChild(b);
  });
  $("home-empty").hidden = S.papers.length > 0;
  if (S.cmp.on) {                       // 재렌더 후 선택 시각 상태 복원
    S.cmp.sel = S.cmp.sel.filter((id) => S.papers.some((p) => p.id === id));
    updateCmpUI();
  }
}

/* 서가 필터 바: 상태·태그를 가진 논문이 하나도 없으면 숨김(밋밋한 서재에 UI 소음 방지) */
function renderShelfFilter() {
  const box = $("shelf-filter");
  if (!box) return;
  const hasAny = S.papers.some((p) => (p.status && p.status !== "none") || p.tags?.length);
  box.hidden = !hasAny;
  if (!hasAny) { box.innerHTML = ""; return; }
  const tags = [...new Set(S.papers.flatMap((p) => p.tags || []))].sort((a, b) => a.localeCompare(b, "ko"));
  const chips = [
    { label: "전체", on: !S.filter.status && !S.filter.tag, kind: "all" },
    { label: "읽는 중", on: S.filter.status === "reading", kind: "status", v: "reading" },
    { label: "완독", on: S.filter.status === "done", kind: "status", v: "done" },
    ...tags.map((t) => ({ label: t, on: S.filter.tag === t, kind: "tag", v: t })),
  ];
  box.innerHTML = chips.map((c, i) =>
    `<button class="sf-chip${c.on ? " on" : ""}" data-i="${i}">${esc(c.label)}</button>`).join("");
  box.querySelectorAll(".sf-chip").forEach((b, i) => {
    b.onclick = () => {
      const c = chips[i];
      if (c.kind === "all") { S.filter.status = null; S.filter.tag = null; }
      else if (c.kind === "status") S.filter.status = c.v;
      else S.filter.tag = S.filter.tag === c.v ? null : c.v;
      renderShelf(); renderShelfFilter();
    };
  });
}

async function cycleStatus(p) {
  const next = { none: "reading", reading: "done", done: "none" };
  const status = next[p.status || "none"];
  try {
    const meta = await pj(`/api/papers/${p.id}`, { status }, "PATCH");
    Object.assign(p, meta);
    renderShelf(); renderShelfFilter();
  } catch (e) { toast("상태 변경 실패: " + e.message, true); }
}

function openTagEditor(p, rect) {
  const pop = popShell(rect, `<div class="tag-edit-row">
      <input id="tag-edit-in" type="text" placeholder="쉼표로 구분 — 예: NLP, 강화학습" value="${esc((p.tags || []).join(", "))}">
      <button class="btn primary pressable" id="tag-edit-save">저장</button></div>`);
  const inp = pop.querySelector("#tag-edit-in");
  inp.focus(); inp.select();
  const save = async () => {
    const tags = inp.value.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const meta = await pj(`/api/papers/${p.id}`, { tags }, "PATCH");
      Object.assign(p, meta);
      hideCitePop(true);
      renderShelf(); renderShelfFilter();
    } catch (e) { toast("태그 저장 실패: " + e.message, true); }
  };
  pop.querySelector("#tag-edit-save").onclick = save;
  inp.onkeydown = (e) => {
    e.stopPropagation();                  // 전역 단축키와 분리
    if (e.key === "Enter") save();
    else if (e.key === "Escape") hideCitePop(true);
  };
}

async function loadPapers() {
  try {
    S.papers = await api("/api/papers");
    renderShelf(); renderShelfFilter(); renderContinueCard();
    openPaperFromHash();
    refreshZoteroBadge();   // 논-블로킹 — 첫 스캔은 sqlite 복사라 서가 렌더를 기다리게 하지 않는다
  } catch (e) { toast("라이브러리를 불러오지 못했습니다: " + e.message, true); }
}

/* ---- 딥링크: Obsidian 노트의 "Achird에서 열기" 링크가 #paper=<pid> 로 들어온다.
   서버가 이미 떠 있으면 그 창/새 탭에서 바로 리더가 열린다. ---- */
function openPaperFromHash() {
  const m = location.hash.match(/^#paper=([0-9a-f]{8})$/);
  if (!m) return;
  const p = S.papers.find((x) => x.id === m[1]);
  if (p && S.current?.id !== p.id) openPaper(p);
  else if (!p) toast("링크가 가리키는 논문이 서재에 없습니다", true);
}
window.addEventListener("hashchange", openPaperFromHash);

/* ---- 이어 읽기 카드: 마지막으로 연 논문을 홈 상단에 노출 ---- */
function renderContinueCard() {
  const box = $("continue-card");
  if (!box) return;
  let last = null;
  try { last = JSON.parse(localStorage.getItem("ml.last") || "null"); } catch { /* corrupt */ }
  const p = last && S.papers.find((x) => x.id === last.id);
  const r = p ? readPosRatio(p.id) : 0;
  if (!p || p.status === "done" || r <= 0.02) { box.hidden = true; box.innerHTML = ""; return; }
  const pct = Math.min(100, Math.round(r * 100));
  const bits = [`${pct}% 읽음`];
  if (p.authors?.length) bits.push(esc(p.authors[0]) + (p.authors.length > 1 ? " 외" : ""));
  if (p.year) bits.push(p.year);
  box.innerHTML = `
    <div class="cc-cover">${coverHTML(p)}</div>
    <div class="cc-body">
      <div class="cc-title">${esc(p.title)}</div>
      <div class="cc-sub">${bits.join(" · ")}</div>
    </div>
    <button class="btn primary pressable cc-go">이어 읽기</button>`;
  box.hidden = false;
  box.onclick = () => openPaper(p);
  box.querySelector(".cc-go").onclick = (e) => { e.stopPropagation(); openPaper(p); };
}

async function uploadFiles(files) {
  const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name));
  if (!pdfs.length) { toast("PDF 파일만 올릴 수 있습니다", true); return; }
  $("thin-bar").classList.add("on");
  let added = 0, dup = 0;
  for (const f of pdfs) {
    try {
      const fd = new FormData(); fd.append("file", f);
      const m = await api("/api/papers", { method: "POST", body: fd });
      if (m && m.duplicate) dup++; else added++;
    } catch (e) { toast(`${f.name} 업로드 실패: ${e.message}`, true); }
  }
  $("thin-bar").classList.remove("on");
  const parts = [];
  if (added) parts.push(`${added}편 추가`);
  if (dup) parts.push(`${dup}편 이미 있음`);
  if (parts.length) toast(parts.join(", "));
  loadPapers();
}

function initUpload() {
  $("file-input").onchange = (e) => { uploadFiles(e.target.files); e.target.value = ""; };
  $("empty-upload").onclick = () => $("file-input").click();
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; $("add-book")?.classList.add("drag"); });
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("add-book")?.classList.remove("drag"); } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault(); depth = 0; $("add-book")?.classList.remove("drag");
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });
  $("zotero-btn").innerHTML = icon("book", 17);
  $("zotero-btn").classList.add("pressable");
  $("zotero-btn").onclick = openZoteroImport;
}

/* Zotero 신착 배지 — 아직 안 가져온 항목 수를 가져오기 버튼에 표시. 실패는 조용히 무시(정보성). */
async function refreshZoteroBadge() {
  let n = 0;
  try { n = (await api("/api/import/zotero/badge")).new || 0; } catch { return; }
  const b = $("zotero-btn");
  if (!b) return;
  b.querySelector(".zbadge")?.remove();
  if (n > 0) {
    const s = document.createElement("span");
    s.className = "zbadge";
    s.textContent = n > 99 ? "99+" : String(n);
    s.style.cssText = "position:absolute;top:-5px;right:-5px;background:var(--accent-text,#c33);color:#fff;font-size:.625rem;line-height:1;padding:2px 4px;border-radius:8px;pointer-events:none;";
    b.style.position = "relative";
    b.appendChild(s);
    b.title = `Zotero에 아직 안 가져온 논문 ${n}건`;
  }
}

/* ---------------------------------------------------------------- library-wide search (서재 전체 검색)
   서버가 전 논문의 원문·번역을 브루트포스+캐시로 검색한다. 결과 클릭 → 논문 열고 해당 쪽으로
   점프, 원문 매치면 검색어를 리더 Ctrl+F에 이어받아 전체 하이라이트+순회까지. */

function markSnip(s, q) {
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(s);
  return esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length));
}

let libT = 0, libSeq = 0;
function initLibSearch() {
  document.querySelector("#lib-search .ls-glass").innerHTML = icon("search", 15);
  $("lib-clear").innerHTML = icon("x", 13);
  const inp = $("lib-in");
  inp.addEventListener("input", () => {
    $("lib-clear").hidden = !inp.value;
    clearTimeout(libT);
    libT = setTimeout(() => runLibSearch(inp.value), 250);
  });
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();                    // 전역 단축키와 분리
    if (e.key === "Escape") { clearLibSearch(); inp.blur(); }
  });
  $("lib-clear").onclick = clearLibSearch;
}

function clearLibSearch() {
  $("lib-in").value = "";
  $("lib-clear").hidden = true;
  renderLibResults(null, "");
}

async function runLibSearch(raw) {
  const q = raw.trim();
  const seq = ++libSeq;
  if (q.length < 2) { renderLibResults(null, ""); return; }
  try {
    const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== libSeq) return;             // 뒤늦은 응답이 최신 입력의 결과를 덮지 않게
    renderLibResults(r.papers, q);
  } catch (e) { if (seq === libSeq) toast("검색 실패: " + e.message, true); }
}

function renderLibResults(papers, q) {
  const box = $("lib-results");
  const active = Array.isArray(papers);
  box.hidden = !active;
  $("shelf").hidden = active;
  $("home-empty").hidden = active ? true : S.papers.length > 0;
  if (!active) { box.innerHTML = ""; return; }
  if (!papers.length) {
    box.innerHTML = `<div class="ipane-hint">${icon("search", 26)}<br>"${esc(q)}" — 일치하는 논문이 없습니다.</div>`;
    return;
  }
  box.innerHTML = papers.map((p, pi) => `
    <div class="lsr-paper">
      <button class="lsr-head" data-open="${p.id}">
        <span class="lsr-title">${markSnip(p.title, q)}</span>
        <span class="lsr-total">${p.total ? p.total + "곳" : "제목 일치"}</span>
      </button>
      ${p.hits.map((h, hi) => `
        <button class="lsr-hit" data-p="${pi}" data-h="${hi}">
          <span class="lsr-badge${h.src === "원문" ? "" : " alt"}">${h.n ? h.n + "쪽" + (h.src === "원문" ? "" : " · ") : ""}${h.src === "원문" ? "" : esc(h.src)}</span>
          <span class="lsr-snip">${markSnip(h.snip, q)}</span>
        </button>`).join("")}
    </div>`).join("");
  box.querySelectorAll(".lsr-head").forEach((b) => {
    b.onclick = () => { const p = S.papers.find((x) => x.id === b.dataset.open); if (p) openPaper(p); };
  });
  box.querySelectorAll(".lsr-hit").forEach((b) => {
    b.onclick = () => {
      const p = papers[+b.dataset.p], h = p.hits[+b.dataset.h];
      const meta = S.papers.find((x) => x.id === p.id);
      if (!meta) return;
      pendingJump = { page: h.n || 1, src: h.src, q };   // 쪽 없는 매치(Obsidian 메모)는 1쪽으로
      openPaper(meta);
    };
  });
}

/* ---------------------------------------------------------------- library AI (서재 질문 · 논문 비교 · 근거표 · 인용 그래프 · bib 내보내기) */

function initLibAI() {
  $("ask-btn").onclick = () => runLibraryAsk();
  const ain = $("ask-in");
  ain.addEventListener("keydown", (e) => {
    e.stopPropagation();                    // 전역 단축키와 분리
    if (e.key === "Enter" && !e.isComposing) runLibraryAsk();
    else if (e.key === "Escape") ain.blur();
  });
  $("cmp-btn").onclick = toggleCmpMode;
  /* 화살표로 감싼다 — 핸들러에 그냥 넘기면 첫 인자로 이벤트 객체가 들어와 concepts가 늘 켜진다 */
  $("graph-btn").onclick = () => runLibraryGraph();
  $("find-btn").onclick = openWorkSearch;
  $("queue-btn").onclick = runQueue;
  $("review-btn").onclick = runReviewQueue;
  $("trends-btn").onclick = () => runTrends(false);
  $("jobs-btn").onclick = runJobs;
}

/* ---- 다시 볼 논문: 강조·노트를 남겼는데 오래 안 연 편. 표시해 둔 게 없는 논문은 부르지 않는다 —
   다시 볼 이유가 있어야 큐에 오른다. ---- */

async function runReviewQueue(days = 30) {
  showLibAI("다시 볼 논문", `${days}일 이상 안 봄`, "서재를 훑는 중…");
  const done = busy("복습 큐 만드는 중");
  try {
    renderReviewQueue(await api(`/api/library/review?days=${days}`));
  } catch (e) {
    renderLibAIError("복습 큐 실패 — " + e.message);
  } finally { done(); }
}

function renderReviewQueue(r) {
  const body = aiBody();
  if (!body) return;
  const items = r.items || [];
  const head = `<div class="row-actions" style="margin-top:0;">
      ${[7, 30, 90].map((d) => `<button class="btn pressable rq-d${d === r.days ? " primary" : ""}" data-d="${d}">${d}일</button>`).join("")}
    </div>`;
  if (!items.length) {
    body.innerHTML = head + `<div class="ipane-hint">${icon("book", 26)}<br>${r.days}일 넘게 안 본 논문 중<br>강조·노트를 남긴 것이 없습니다.</div>`;
  } else {
    body.innerHTML = head +
      `<div class="mysum-stamp" style="margin:0 0 .5rem;">${items.length}편 · 표시가 많은 순</div>` +
      items.map((q) => `<div class="ref-item">
          <span class="rn">${q.marks}</span>
          <span><button class="ev-cite" data-id="${esc(q.pid)}">${esc(q.title)}</button>
            <br><span class="ev-memo">${q.days == null ? "연 적 없음" : `${q.days}일 전`}${q.pos ? ` · ${q.pos.p}쪽까지` : ""}${q.status === "done" ? " · 완독" : ""}</span></span>
        </div>`).join("");
    wireOpenButtons(body);
  }
  body.querySelectorAll("[data-d]").forEach((b) => { b.onclick = () => runReviewQueue(+b.dataset.d); });
}

/* ---- 연구 트렌드: 관심 분야를 고르게 하지 않는다 — 서재가 곧 관심사다.
   각 논문의 OpenAlex topic 을 모아 상위 3개를 뽑고, 그 주제의 최근 논문을 피인용 순으로 본다. ---- */

async function runTrends(refresh) {
  showLibAI("연구 트렌드", "OpenAlex", "서재 주제를 뽑는 중… (첫 실행은 논문 수만큼 걸립니다)");
  const done = busy("트렌드 불러오는 중");
  try {
    renderTrends(await api(`/api/library/trends?days=90${refresh ? "&refresh=1" : ""}`));
  } catch (e) {
    renderLibAIError("트렌드 실패 — " + e.message);
  } finally { done(); }
}

function renderTrends(r) {
  const body = aiBody();
  if (!body) return;
  const items = r.results || [];
  body.innerHTML =
    `<div class="mysum-stamp" style="margin:0 0 .4rem;">서재에서 뽑은 주제 — ${
      (r.topics || []).map((t) => `${esc(t.name)}(${t.papers}편)`).join(" · ")}</div>` +
    `<div class="mysum-stamp" style="margin:0 0 .5rem;">${r.since} 이후 ${r.total.toLocaleString()}건 중 피인용 상위 ${items.length}건${r.cached ? " · 저장된 결과" : ""}</div>` +
    (items.length ? items.map(relatedItem).join("")
                  : `<div class="ipane-hint">최근 논문을 찾지 못했습니다.</div>`) +
    `<div class="row-actions"><button class="btn pressable" id="tr-refresh">${icon("sparkle", 13)} 다시 받기</button></div>
     <div class="ipane-hint" style="text-align:left;padding:.5rem 0;">주제는 서재 논문의 OpenAlex topic 을 집계한 것입니다. 서재가 바뀌면 '다시 받기'로 갱신하세요.</div>`;
  wireOaBadges(body, items);
  $("tr-refresh").onclick = () => runTrends(true);
}

/* 심화 검색·논문 찾기·트렌드가 같은 카드(relatedItem)를 쓰므로 배지 배선도 한 곳에 둔다 */
function wireOaBadges(root, items) {
  const byOa = new Map(items.map((w) => [w.oa_id, w]));
  root.querySelectorAll(".ref-lib-badge").forEach((b) => {
    if (b.dataset.zot) {
      b.onclick = () => { const w = byOa.get(b.dataset.zot); if (w) zoteroSave(w, b); };
    } else if (b.dataset.open) {
      b.onclick = () => { const p = S.papers.find((x) => x.id === b.dataset.open); if (p) openPaper(p); };
    } else if (b.dataset.oa) {
      b.onclick = async () => {
        const w = byOa.get(b.dataset.oa);
        if (!w) return;
        await queueAdd(w);
        b.textContent = "담김"; b.disabled = true;
      };
    }
  });
}

/* ---- 백그라운드 작업: 서버가 번역을 돌리고 화면은 진행률만 본다.
   리더를 닫아도, 홈으로 나가도, 다른 논문을 읽어도 계속된다. ---- */

let jobsTimer = null;

async function runJobs() {
  showLibAI("백그라운드 작업", null, "작업 목록 불러오는 중…");
  const done = busy("작업 목록 불러오는 중");
  try {
    renderJobs(await api("/api/jobs"));
  } catch (e) {
    renderLibAIError("작업 목록 실패 — " + e.message);
  } finally { done(); }
}

const JOB_STATE = { running: "진행 중", done: "완료", stopped: "중지됨" };

function renderJobs(r) {
  const body = aiBody();
  if (!body) { clearTimeout(jobsTimer); jobsTimer = null; return; }
  const items = r.items || [];
  const running = items.filter((j) => j.state === "running").length;
  body.innerHTML = `
    <div class="row-actions" style="margin-top:0;">
      <button class="btn primary pressable" id="jb-all">서재 전체 번역 시작</button>
      <button class="btn pressable" id="jb-prep" title="서지·요약·핵심 4색·용어집·추천 질문·출처 검증 중 빠진 것만 채웁니다 (번역 제외)">서재 준비</button>
    </div>
    <div class="ipane-hint" style="text-align:left;padding:0 0 .5rem;">
      번역·준비 모두 안 된 것만 골라 돕니다. 창을 닫아도 서버가 계속 돌립니다 — 다시 눌러도 안전합니다.
    </div>` +
    (items.length ? items.map((j) => {
      const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
      const errN = Object.keys(j.errs || {}).length;
      const unit = j.kind === "prep" ? "단계" : "쪽";
      return `<div class="ref-item">
        <span class="rn">${pct}%</span>
        <span><b>${esc(j.label)}</b> · ${j.done}/${j.total}${unit} · ${JOB_STATE[j.state] || j.state}
          ${j.failed ? `<br><span class="ev-memo" style="color:var(--danger);">실패 ${j.failed}${unit}${errN ? ` — ${esc(Object.values(j.errs)[0])}` : ""}</span>` : ""}
          <div class="read-prog jb-bar"><i style="width:${pct}%"></i></div></span>
        <button class="ref-lib-badge jb-stop" data-id="${esc(j.id)}" data-run="${j.state === "running" ? 1 : ""}">${j.state === "running" ? "중지" : "지우기"}</button>
      </div>`;
    }).join("") : `<div class="ipane-hint">아직 작업이 없습니다.</div>`);
  body.querySelectorAll(".jb-stop").forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/jobs/${b.dataset.id}`, { method: "DELETE" });
        if (b.dataset.run) toast("작업을 중지합니다 — 진행 중인 쪽은 마저 끝냅니다");
      }
      catch (e) { toast((b.dataset.run ? "중지" : "삭제") + " 실패 — " + e.message, true); }
      runJobs();
    };
  });
  $("jb-all").onclick = () => startTranslateJob([]);
  $("jb-prep").onclick = async () => {
    const done = busy("준비 작업 시작");
    try {
      const r = await pj("/api/prep", {});
      toast(r.started ? `${r.label} — ${r.total}단계 준비를 백그라운드로 시작했습니다` : r.reason);
      if (r.started) runJobs();
    } catch (e) { toast("준비 시작 실패 — " + e.message, true); }
    finally { done(); }
  };
  /* 진행 중일 때만 폴링한다 — 끝나면 스스로 멈춘다(가만있는 화면이 5초마다 서버를 찌르지 않게) */
  clearTimeout(jobsTimer);
  jobsTimer = running ? setTimeout(() => api("/api/jobs").then(renderJobs).catch(() => {}), 4000) : null;
}

async function startTranslateJob(ids) {
  const done = busy("번역 작업 시작");
  try {
    const j = await pj("/api/jobs/translate", { ids });
    toast(`${j.label} — ${j.total}쪽 번역을 백그라운드로 시작했습니다`);
    if (!aiPanel().hidden) runJobs();
  } catch (e) {
    if (e.status === 400) toast("번역할 쪽이 없습니다");
    else if (e.status === 409) toast("이미 같은 번역 작업이 실행 중입니다");
    else toast("작업 시작 실패 — " + e.message, true);
  } finally { done(); }
}

/* 결과 패널은 화면마다 하나뿐이다 — 읽기 탭은 #lib-ai, 집필 탭은 #wr-ai.
   근거표·번호 인용·통합 용어집은 양쪽에서 쓰므로 어느 패널에 그릴지를 여기서 갈아 끼운다. */
let aiPanelId = "lib-ai";
const aiPanel = () => $(aiPanelId);
const aiBody = () => aiPanel().querySelector(".la-body");

function showLibAI(kind, sub, busyLabel) {
  const p = aiPanel();
  p.hidden = false;
  p.innerHTML = `<div class="la-head"><span class="la-kind">${esc(kind)}</span>` +
    (sub ? `<span class="la-sub">${esc(sub)}</span>` : "") +
    `<button class="fb-btn" id="la-close" style="margin-left:auto;" title="닫기" aria-label="닫기">${icon("x", 13)}</button></div>` +
    `<div class="la-body"></div>`;
  $("la-close").onclick = closeLibAI;
  const body = p.querySelector(".la-body");
  body.appendChild(starInline(busyLabel || (kind === "논문 비교" ? "논문을 나란히 읽는 중… (~2분)" : "서재를 뒤져 답하는 중… (~1분)")));
  return body;
}
function closeLibAI() { aiPanel().hidden = true; aiPanel().innerHTML = ""; }

function renderLibAIResult(mdText, papers, redo) {
  const body = aiBody();
  if (!body) return;                        // 사용자가 닫았으면 그대로 둔다
  let legend = "";
  if (papers?.length) {
    legend = `<div class="la-legend">` + papers.map((pp) =>
      `<button class="la-chip" data-id="${pp.id}" title="논문 열기">[${pp.n}] ${esc(pp.title.slice(0, 38))}${pp.title.length > 38 ? "…" : ""}</button>`).join("") + `</div>`;
  }
  body.innerHTML = legend + `<div class="prose">${md(mdText)}</div>` +
    (redo ? `<div class="row-actions" style="margin-top:.6rem;"><button class="btn pressable" id="la-redo">${icon("sparkle", 13)} 다시 생성</button></div>` : "");
  body.querySelectorAll(".la-chip").forEach((c) => {
    c.onclick = () => { const meta = S.papers.find((x) => x.id === c.dataset.id); if (meta) openPaper(meta); };
  });
  if (redo) $("la-redo").onclick = redo;
}
function renderLibAIError(msg) {
  const body = aiBody();
  if (body) body.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">${esc(msg)}</div>`;
}

let askRunning = false;
async function runLibraryAsk() {
  const q = $("ask-in").value.trim();
  if (!q) { $("ask-in").focus(); return; }
  if (askRunning) return;
  askRunning = true;
  showLibAI("서재 질문", q);
  const done = busy("서재 질문 중");
  try {
    const r = await pj("/api/library/ask", { question: q });
    renderLibAIResult(r.answer, r.papers, null);
  } catch (e) {
    renderLibAIError("질문 실패 — " + e.message);
  } finally { askRunning = false; done(); }
}

async function runLibraryCompare(ids, force = false) {
  showLibAI("논문 비교");
  const done = busy("논문 비교 중");
  try {
    const r = await pj("/api/library/compare", { ids, force });
    renderLibAIResult(r.markdown, r.papers, () => runLibraryCompare(ids, true));
  } catch (e) {
    renderLibAIError("비교 실패 — " + e.message);
  } finally { done(); }
}

/* ---- 근거표: 선택한 논문들에서 대상·문제/방법/데이터/결과/한계를 뽑은 표(리뷰논문용) ---- */

async function runLibraryTable(ids, force = false) {
  if (ids.length < 2 || ids.length > 8) { toast("근거표는 2~8편을 선택하세요", true); return; }
  showLibAI("근거표", `${ids.length}편 선택`, "근거표를 만드는 중… (~2분)");
  const done = busy("근거표 생성 중");
  try {
    const r = await pj("/api/library/table", { ids, refresh: force });
    renderTableResult(r, ids);
  } catch (e) {
    renderLibAIError("근거표 생성 실패 — " + e.message);
  } finally { done(); }
}

function renderTableResult(data, ids) {
  const body = aiBody();
  if (!body) return;                        // 사용자가 닫았으면 그대로 둔다
  const cols = data.columns || [];
  const rowsHtml = (data.rows || []).map((row) => `
    <tr>
      <td><button class="tbl-open" data-id="${row.pid}">${esc(row.title)}${row.year ? ` <span class="tbl-year">${row.year}</span>` : ""}</button></td>
      ${row.cells.map((c) => `<td>${esc(c)}</td>`).join("")}
    </tr>`).join("");
  body.innerHTML = `
    <div class="row-actions" style="margin-top:0;">
      <button class="btn pressable" id="tbl-md">${icon("export", 13)} Markdown</button>
      <button class="btn pressable" id="tbl-copy">${icon("note", 13)} 복사</button>
      <button class="btn pressable" id="tbl-csv">${icon("export", 13)} CSV</button>
      <button class="btn pressable" id="tbl-redo">${icon("sparkle", 13)} 다시 만들기</button>
    </div>
    <div class="tbl-scroll"><table class="ev-table">
      <thead><tr><th>논문</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`;
  body.querySelectorAll(".tbl-open").forEach((b) => {
    b.onclick = () => { const meta = S.papers.find((x) => x.id === b.dataset.id); if (meta) openPaper(meta); };
  });
  $("tbl-csv").onclick = () => {
    downloadBlob(`achird-table-${data.rows.length}.csv`,
      new Blob([tableToCSV(data)], { type: "text/csv;charset=utf-8" }));
    toast("CSV로 내보냈습니다");
  };
  /* 리뷰논문·Obsidian에 그대로 붙는 형태. CSV는 엑셀용이라 문서에 붙이면 깨진다. */
  $("tbl-md").onclick = () => {
    downloadBlob(`achird-table-${data.rows.length}.md`,
      new Blob([tableToMarkdown(data)], { type: "text/markdown;charset=utf-8" }));
    toast("Markdown으로 내보냈습니다");
  };
  $("tbl-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(tableToMarkdown(data));
      toast("Markdown 표를 클립보드에 복사했습니다");
    } catch (e) { toast("복사 실패 — " + e.message, true); }
  };
  $("tbl-redo").onclick = () => runLibraryTable(ids, true);
}

/* GFM 표. 셀 안의 |는 이스케이프하고 개행은 <br>로 접는다 — 표는 한 줄이 한 행이라
   개행이 그대로 들어가면 표 자체가 끊긴다. */
function mdCell(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function tableToMarkdown(data) {
  const cols = data.columns || [];
  const head = ["논문", ...cols];
  const lines = [
    `| ${head.map(mdCell).join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
  ];
  (data.rows || []).forEach((row) => {
    const paper = row.title + (row.year ? ` (${row.year})` : "");
    lines.push(`| ${[paper, ...row.cells].map(mdCell).join(" | ")} |`);
  });
  return lines.join("\n") + "\n";
}

/* ---- 저장된 근거표: 서버 캐시(_table_*.json)를 목록으로 꺼낸다. 예전엔 같은 조합을
   서가에서 똑같이 다시 골라야만 재사용할 수 있어서, 사실상 매번 2분짜리 생성을 다시 물었다. ---- */

async function runSavedTables() {
  showLibAI("저장된 근거표", null, "불러오는 중…");
  const done = busy("저장된 근거표 불러오는 중");
  try {
    const r = await api("/api/library/tables");
    renderSavedTables(r.tables || []);
  } catch (e) {
    renderLibAIError("불러오기 실패 — " + e.message);
  } finally { done(); }
}

function renderSavedTables(tables) {
  const body = aiBody();
  if (!body) return;
  if (!tables.length) {
    body.innerHTML = `<div class="ipane-hint">${icon("export", 26)}<br>아직 만든 근거표가 없습니다.<br>선택 모드에서 논문 2~8편을 고르고 '근거표'를 누르세요.</div>`;
    return;
  }
  body.innerHTML = tables.map((t) => `
    <button class="btn pressable savedtbl" data-key="${esc(t.key)}"
            style="display:block;width:100%;text-align:left;margin-bottom:.4rem;">
      <span style="font-weight:600;">${t.papers.length}편</span>
      <span style="color:var(--ink-2);"> · ${esc(t.papers.map((p) => p.title || p.pid).join(" · "))}</span>
    </button>`).join("");
  body.querySelectorAll(".savedtbl").forEach((b) => {
    b.onclick = async () => {
      const done = busy("근거표 불러오는 중");
      try {
        const r = await api(`/api/library/table/${b.dataset.key}`);
        renderTableResult(r, (r.rows || []).map((x) => x.pid));
      } catch (e) { renderLibAIError("불러오기 실패 — " + e.message); } finally { done(); }
    };
  });
}

/* CSV 셀 이스케이프 — 쉼표·따옴표·개행이 있으면 큰따옴표로 감싸고 내부 따옴표는 두 배로 */
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function tableToCSV(data) {
  const header = ["논문", ...(data.columns || [])];
  const lines = [header.map(csvCell).join(",")];
  (data.rows || []).forEach((row) => {
    const paper = row.title + (row.year ? ` (${row.year})` : "");
    lines.push([paper, ...row.cells].map(csvCell).join(","));
  });
  const BOM = String.fromCharCode(0xfeff);   // 엑셀이 한글을 UTF-8로 인식하게 하는 바이트 순서 표식
  return BOM + lines.join("\r\n") + "\r\n";
}

/* 결과 목록의 출처 버튼 → 그 논문 열기. 근거 보드·초안 점검·대기열이 공유한다. */
function wireOpenButtons(root) {
  root.querySelectorAll(".ev-cite").forEach((b) => {
    b.onclick = () => { const p = S.papers.find((x) => x.id === b.dataset.id); if (p) openPaper(p); };
  });
}

/* ---- 근거 보드: 내가 그은 강조 · 내가 쓴 노트 · AI 핵심 4색을 서재 전체에서 한 목록으로.
   셋 다 논문별 사이드카에만 있어서, 리뷰논문을 쓸 때 "결과로 표시해 둔 문장 전부"를 보려면
   편마다 열어야 했다. 필터는 서버를 다시 부르지 않고 여기서만 건다(수백 건 규모). ---- */

const KP_LABEL = { nov: "독창성", met: "방법", res: "결과", lim: "한계" };
/* 내 강조와 AI 강조를 한 칩에 묶지 않는다 — 리뷰논문에 쓸 때 필요한 건 내가 고른 쪽이고,
   합쳐 세면 "내 강조 26"처럼 사실과 다른 숫자가 뜬다. */
const EV_CHIPS = [["all", "전체"], ["mine", "내 강조"], ["ai", "AI 강조"], ["note", "내 노트"],
                  ["an", "구조 분석"],
                  ["nov", "독창성"], ["met", "방법"], ["res", "결과"], ["lim", "한계"]];

let evData = null;
let evFilter = { kind: "all", pid: "all" };

function evLabel(it) {
  if (it.kind === "kp") return KP_LABEL[it.cat] || "핵심";
  if (it.kind === "hl") return it.src === "ai" ? "AI 강조" : (it.src === "zotero" ? "Zotero 강조" : "내 강조");
  if (it.kind === "an") return it.memo || "구조 분석";   // memo에 8섹션의 칸 이름이 들어 있다
  return "내 노트";
}

function evKindMatch(it, k) {
  if (k === "all") return true;
  if (k === "mine") return it.kind === "hl" && it.src !== "ai";
  if (k === "ai") return it.kind === "hl" && it.src === "ai";
  if (k === "note") return it.kind === "note";
  if (k === "an") return it.kind === "an";
  return it.kind === "kp" && it.cat === k;      // nov/met/res/lim
}

function evMatches(it) {
  if (evFilter.pid !== "all" && it.pid !== evFilter.pid) return false;
  return evKindMatch(it, evFilter.kind);
}

async function runEvidence() {
  showLibAI("근거 보드", null, "서재의 강조·노트를 모으는 중…");
  const done = busy("근거 모으는 중");
  try {
    await loadEvidence(true);
    evFilter = { kind: "all", pid: "all" };
    renderEvidence();
  } catch (e) {
    renderLibAIError("근거 보드 실패 — " + e.message);
  } finally { done(); }
}

/* 서버 왕복 한 번이면 충분하다 — 근거 보드와 집필 탭이 같은 목록을 본다 */
async function loadEvidence(force) {
  if (!evData || force) evData = await api("/api/library/evidence");
  return evData;
}

/* pick: null=버튼 없음 · "out"=이 절에 담기 · "in"=이미 담김(누르면 뺀다) */
function evRow(it, pick) {
  const tint = it.kind === "kp" && it.cat ? ` kp-mark kp-${it.cat}` : "";
  const btn = !pick ? "" :
    `<button class="ref-lib-badge ev-pick${pick === "in" ? " on" : ""}" data-key="${esc(it.key)}"
       title="${pick === "in" ? "이 절에서 빼기" : "이 절에 담기"}">${pick === "in" ? "담김" : "담기"}</button>`;
  return `<div class="ref-item">
      <span class="rn ev-kind">${esc(evLabel(it))}</span>
      <span><span class="ev-text${tint}">${esc(it.text)}</span>
        ${it.memo ? `<br><span class="ev-memo">${esc(it.memo)}</span>` : ""}
        <br><button class="ev-cite" data-id="${esc(it.pid)}">${esc(it.cite)}${it.page ? ` · ${it.page}쪽` : ""}</button>
      </span>
      ${btn}
    </div>`;
}

/* 근거 필터 칩 + 논문 셀렉트 — 읽기 탭의 근거 보드와 집필 탭 왼쪽 패널이 함께 쓴다 */
function evFilterHTML(all, papers) {
  const n = (k) => all.filter((it) => evKindMatch(it, k)).length;
  return `<div class="shelf-filter" style="margin:0 0 .55rem;">` +
    EV_CHIPS.filter(([k]) => k === "all" || n(k)).map(([k, label]) =>
      `<button class="sf-chip${evFilter.kind === k ? " on" : ""}" data-k="${k}">${label} ${n(k)}</button>`).join("") +
    `</div>
     <select class="gl-in ev-paper" aria-label="논문으로 좁히기">
       <option value="all">모든 논문 (${papers.length}편)</option>
       ${papers.map((p) => `<option value="${esc(p.id)}"${evFilter.pid === p.id ? " selected" : ""}>${esc(p.title.slice(0, 46))} · ${p.count}</option>`).join("")}
     </select>`;
}

/* 칩·셀렉트를 하나의 재렌더 콜백에 묶는다 — 두 화면이 각자 자기 렌더러를 넘긴다 */
function wireEvFilter(root, rerender) {
  root.querySelectorAll(".sf-chip").forEach((c) => {
    c.onclick = () => { evFilter.kind = c.dataset.k; rerender(); };
  });
  const sel = root.querySelector(".ev-paper");
  if (sel) sel.onchange = (e) => { evFilter.pid = e.target.value; rerender(); };
}

function renderEvidence() {
  const body = aiBody();
  if (!body || !evData) return;
  const all = evData.items || [], papers = evData.papers || [];
  if (!all.length) {
    body.innerHTML = `<div class="ipane-hint">${icon("note", 26)}<br>아직 모을 근거가 없습니다.<br>논문에서 문장을 드래그해 강조·노트를 남기거나, 핵심 4색(K)을 켜보세요.</div>`;
    return;
  }
  const shown = all.filter(evMatches);
  body.innerHTML = evFilterHTML(all, papers) +
    `<div class="row-actions" style="margin:.6rem 0;">
      <button class="btn pressable" id="ev-md">${icon("export", 13)} Markdown</button>
      <button class="btn pressable" id="ev-copy">${icon("note", 13)} 복사</button>
    </div>
    <div class="mysum-stamp" style="margin:0 0 .3rem;">${shown.length}건 표시 (전체 ${all.length}건)</div>` +
    (shown.length ? shown.map((it) => evRow(it)).join("")
                  : `<div class="ipane-hint">이 조건에 맞는 근거가 없습니다.</div>`);
  wireEvFilter(body, renderEvidence);
  $("ev-md").onclick = () => {
    downloadBlob(`achird-evidence-${shown.length}.md`,
      new Blob([evidenceToMarkdown(shown, papers)], { type: "text/markdown;charset=utf-8" }));
    toast(`근거 ${shown.length}건을 Markdown으로 내보냈습니다`);
  };
  $("ev-copy").onclick = () => copyText(evidenceToMarkdown(shown, papers), `근거 ${shown.length}건 복사됨`);
  wireOpenButtons(body);
}

/* 리뷰논문·Obsidian에 그대로 붙는 형태 — 논문별로 묶고 항목마다 출처·쪽을 단다. */
function evidenceToMarkdown(items, papers) {
  const lines = [`# 근거 목록 (${items.length}건)`, ""];
  papers.forEach((p) => {
    const mine = items.filter((it) => it.pid === p.id);
    if (!mine.length) return;
    lines.push(`## ${p.title}${p.year ? ` (${p.year})` : ""}`, "");
    mine.forEach((it) => {
      lines.push(`- **${evLabel(it)}** — ${it.cite}${it.page ? `, p.${it.page}` : ""}`);
      lines.push(`  > ${String(it.text).replace(/\s+/g, " ").trim()}`);
      if (it.memo) lines.push(`  - ${String(it.memo).replace(/\s+/g, " ").trim()}`);
    });
    lines.push("");
  });
  return lines.join("\n");
}

/* ---- 번호 인용: 선택 논문을 1..N으로 매기고 번호식 참고문헌 목록을 만든다.
   번호 순서는 고른 순서 그대로 — 본문에서 처음 인용한 순서는 글쓴이만 안다. ---- */

const CITE_STYLE_LABEL = { acs: "ACS", apa: "APA", bibtex: "BibTeX" };

async function runCitations(ids, style = "acs") {
  showLibAI("번호 인용", ids.length ? `${ids.length}편` : "서재 전체", "인용 목록 만드는 중…");
  const done = busy("인용 목록 만드는 중");
  try {
    renderCitations(await pj("/api/export/citations", { ids, style }), ids);
  } catch (e) {
    renderLibAIError("인용 목록 실패 — " + e.message);
  } finally { done(); }
}

function renderCitations(r, ids) {
  const body = aiBody();
  if (!body) return;
  const items = r.items || [];
  if (!items.length) {
    body.innerHTML = `<div class="ipane-hint">${icon("doc", 26)}<br>서지정보가 있는 논문이 없습니다.<br>논문의 "인용" 탭에서 서지정보를 먼저 추출하세요.</div>`;
    return;
  }
  body.innerHTML = `
    <div class="row-actions" style="margin-top:0;">
      ${Object.keys(CITE_STYLE_LABEL).map((s) =>
        `<button class="btn pressable cite-style${s === r.style ? " on" : ""}" data-s="${s}">${CITE_STYLE_LABEL[s]}</button>`).join("")}
      <button class="btn pressable" id="cite-copy">${icon("note", 13)} 목록 복사</button>
      <button class="btn pressable" id="cite-dl">${icon("export", 13)} 내려받기</button>
    </div>
    <div class="tbl-scroll"><table class="ev-table">
      <thead><tr><th>번호</th><th>본문 표기</th><th>참고문헌 항목</th></tr></thead>
      <tbody>${items.map((it) => `<tr>
        <td><button class="ev-cite" data-id="${esc(it.pid)}">[${it.n}]</button></td>
        <td>${esc(it.short)}</td>
        <td class="cite-cell">${esc(it.cite)}</td>
      </tr>`).join("")}</tbody>
    </table></div>` +
    (r.skipped ? `<div class="mysum-stamp">서지정보가 없어 건너뛴 논문 ${r.skipped}편</div>` : "") +
    `<div class="ipane-hint" style="text-align:left;padding:.6rem 0;">번호는 고른 순서대로 매겼습니다. 본문에서 처음 인용한 순서로 바꾸려면 선택 모드에서 그 순서로 다시 고르세요.</div>`;
  body.querySelectorAll(".cite-style").forEach((b) => {
    b.onclick = () => runCitations(ids, b.dataset.s);
  });
  $("cite-copy").onclick = () => copyText(r.text, `참고문헌 ${items.length}건 복사됨`);
  $("cite-dl").onclick = () => {
    const ext = r.style === "bibtex" ? "bib" : "md";
    downloadBlob(`achird-refs-${items.length}.${ext}`,
      new Blob([r.text], { type: "text/plain;charset=utf-8" }));
    toast("참고문헌 목록을 내보냈습니다");
  };
  wireOpenButtons(body);
}

/* ---- 초안 점검: 쓴 문단과 서재 원문·번역의 연속 어절 겹침을 찾는다.
   AI도 네트워크도 안 쓰는 순수 문자열 비교 — 환각도 대기시간도 없다. ---- */

function openOverlapPane() {
  showLibAI("초안 점검");
  const body = aiBody();
  body.innerHTML = `
    <div class="ipane-hint" style="text-align:left;padding:0 0 .55rem;">
      쓴 문단을 붙여넣으면 서재의 원문·번역과 겹치는 구간을 찾습니다. AI를 쓰지 않아 즉시 끝납니다.
    </div>
    <textarea class="ov-ta" id="ov-ta" rows="7" placeholder="초안 문단을 붙여넣으세요…" spellcheck="false"></textarea>
    <div class="row-actions" style="margin:.55rem 0 .4rem;">
      <button class="btn primary pressable" id="ov-run">겹침 검사</button>
      <label class="ov-k">최소 <input id="ov-k" type="number" min="4" max="20" value="8"> 어절 연속</label>
    </div>
    <div id="ov-out"></div>`;
  $("ov-run").onclick = runOverlap;
  $("ov-ta").focus();
}

async function runOverlap() {
  const ta = $("ov-ta"), out = $("ov-out");
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  const k = Math.max(4, Math.min(20, parseInt($("ov-k").value, 10) || 8));
  out.innerHTML = `<div class="ipane-hint">겹침을 찾는 중…</div>`;
  const done = busy("초안 겹침 검사 중");
  try {
    renderOverlap(await pj("/api/library/overlap", { text, k }));
  } catch (e) {
    out.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">검사 실패 — ${esc(e.message)}</div>`;
  } finally { done(); }
}

function renderOverlap(r) {
  const out = $("ov-out");
  if (!out) return;
  const hits = r.hits || [];
  if (!hits.length) {
    out.innerHTML = `<div class="mysum-stamp">${r.words}어절 검사 · ${r.k}어절 이상 연속으로 겹치는 곳 없음</div>`;
    return;
  }
  const pct = r.words ? Math.round((r.matched / r.words) * 1000) / 10 : 0;
  /* spots 는 서버가 자르기 전의 진짜 개수 — 목록이 잘렸으면 그 사실을 숨기지 않는다 */
  const spots = r.spots ?? hits.length;
  const cut = spots > hits.length ? ` (긴 것부터 ${hits.length}곳 표시)` : "";
  out.innerHTML =
    `<div class="mysum-stamp">${r.words}어절 중 ${r.matched}어절(${pct}%)이 서재와 겹칩니다 · ${spots}곳${cut}</div>` +
    hits.map((h) => `<div class="ref-item">
        <span class="rn">${h.words}어절</span>
        <span><span class="ov-hit">${esc(h.text)}</span>
          <br><button class="ev-cite" data-id="${esc(h.pid)}">${esc(h.title)} · ${esc(h.src)} ${h.page}쪽</button></span>
      </div>`).join("") +
    `<div class="ipane-hint" style="text-align:left;padding:.6rem 0;">겹친다고 곧 표절은 아닙니다 — 인용부호를 빠뜨렸거나 요약이 아직 원문에 붙어 있는 곳을 직접 보라는 표시입니다.</div>`;
  wireOpenButtons(out);
}

/* ---- 서재 통합 용어집: 논문별 용어집을 원어 기준으로 합치고, 역어가 갈린 것을 보여준다.
   대표 역어를 고정하면 이후 모든 페이지 번역이 그 역어를 쓴다. ---- */

async function runLibGlossary() {
  showLibAI("통합 용어집", null, "논문별 용어집을 합치는 중…");
  const done = busy("용어집 합치는 중");
  try {
    renderLibGlossary(await api("/api/library/glossary"));
  } catch (e) {
    renderLibAIError("통합 용어집 실패 — " + e.message);
  } finally { done(); }
}

function glRow(t) {
  const kos = t.kos.map((k) =>
    `<button class="la-chip gl-pick" data-key="${esc(t.key)}" data-ko="${esc(k.ko)}" title="이 역어로 고정">${esc(k.ko)} <span style="opacity:.55;">${k.papers.length}</span></button>`).join(" ");
  return `<tr class="${t.conflict ? "gl-conflict" : ""}">
    <td><strong>${esc(t.term)}</strong>
      ${t.def ? `<br><span class="ev-memo">${esc(t.def)}</span>` : ""}</td>
    <td>${kos || `<span style="color:var(--ink-2);">—</span>`}</td>
    <td><input class="gl-in" data-key="${esc(t.key)}" value="${esc(t.canon)}" placeholder="비우면 고정 해제" spellcheck="false"></td>
  </tr>`;
}

function renderLibGlossary(r) {
  const body = aiBody();
  if (!body) return;
  const terms = r.terms || [];
  if (!terms.length) {
    body.innerHTML = `<div class="ipane-hint">${icon("book", 26)}<br>아직 용어집이 없습니다.<br>논문의 "용어" 탭에서 용어집을 먼저 만드세요.</div>`;
    return;
  }
  const conflicts = terms.filter((t) => t.conflict).length;
  body.innerHTML = `
    <div class="row-actions" style="margin-top:0;">
      <button class="btn primary pressable" id="gl-save">대표 역어 저장</button>
      <button class="btn pressable" id="gl-auto">충돌만 최다 역어로 채우기</button>
    </div>
    <div class="mysum-stamp" style="margin:0 0 .5rem;">용어 ${terms.length}개 · 역어 충돌 ${conflicts}개 · 고정 ${r.canon_count}개</div>
    <div class="tbl-scroll"><table class="ev-table">
      <thead><tr><th>원어</th><th>쓰이는 역어 (논문 수)</th><th>대표 역어</th></tr></thead>
      <tbody>${terms.map(glRow).join("")}</tbody>
    </table></div>
    <div class="ipane-hint" style="text-align:left;padding:.6rem 0;">고정한 역어는 이후 페이지 번역에서 논문별 용어집보다 우선합니다. 이미 번역된 쪽은 다시 번역해야 반영됩니다.</div>`;
  body.querySelectorAll(".gl-pick").forEach((b) => {
    b.onclick = () => {
      const input = body.querySelector(`.gl-in[data-key="${CSS.escape(b.dataset.key)}"]`);
      if (input) { input.value = b.dataset.ko; input.focus(); }
    };
  });
  $("gl-auto").onclick = () => {
    let filled = 0;
    terms.forEach((t) => {
      if (!t.conflict || !t.kos.length) return;
      const input = body.querySelector(`.gl-in[data-key="${CSS.escape(t.key)}"]`);
      if (input && !input.value.trim()) { input.value = t.kos[0].ko; filled++; }   // kos는 논문 수 내림차순
      });
    toast(filled ? `${filled}개를 최다 역어로 채웠습니다 — 확인 후 저장하세요` : "채울 빈 칸이 없습니다");
  };
  $("gl-save").onclick = async () => {
    const out = {};
    body.querySelectorAll(".gl-in").forEach((i) => {
      const v = i.value.trim();
      if (v) out[i.dataset.key] = v;
    });
    const done = busy("대표 역어 저장 중");
    try {
      const res = await pj("/api/library/glossary", { terms: out }, "PUT");
      toast(`대표 역어 ${res.count}개를 고정했습니다`);
      runLibGlossary();
    } catch (e) { toast("저장 실패 — " + e.message, true); } finally { done(); }
  };
}

/* ---- 읽을 논문 대기열: 심화 검색에서 찾은 논문을 서지정보만 담아둔다.
   PDF는 저작권 때문에 자동으로 못 가져온다 — 나중에 그 PDF를 올리면 "서재에 있음"으로 바뀐다. ---- */

async function runQueue() {
  showLibAI("읽을 논문 대기열", null, "대기열 불러오는 중…");
  const done = busy("대기열 불러오는 중");
  try {
    renderQueue(await api("/api/queue"));
  } catch (e) {
    renderLibAIError("대기열 실패 — " + e.message);
  } finally { done(); }
}

function renderQueue(r) {
  const body = aiBody();
  if (!body) return;
  const items = r.items || [];
  if (!items.length) {
    body.innerHTML = `<div class="ipane-hint">${icon("plus", 26)}<br>대기열이 비어 있습니다.<br>논문의 "인용" 탭 → 심화 검색 결과에서 "담기"를 누르세요.</div>`;
    return;
  }
  body.innerHTML =
    `<div class="mysum-stamp" style="margin:0 0 .5rem;">${items.length}건 · 이미 서재에 들어온 것 ${r.arrived}건</div>` +
    items.map((q) => {
      const who = [q.venue, q.year].filter(Boolean).join(" · ");
      const link = q.url || (q.doi ? `https://doi.org/${q.doi}` : "");
      return `<div class="ref-item">
        <span class="rn">${q.in_library ? "✓" : "·"}</span>
        <span>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(q.title || q.doi)}</a>`
                     : esc(q.title || q.doi)}
          ${who ? `<br><span class="ev-memo">${esc(who)}</span>` : ""}
          ${q.note ? `<br><span class="ev-memo">${esc(q.note)}</span>` : ""}
        </span>
        ${q.in_library ? `<button class="ref-lib-badge ev-cite" data-id="${esc(q.in_library)}">서재에 있음</button>` : ""}
        ${q.in_zotero ? `<button class="ref-lib-badge q-zimp" data-att="${esc(q.in_zotero)}"
          title="이 논문의 PDF가 Zotero에 있습니다 — 바로 서재로 가져오기">Zotero에 도착 — 가져오기</button>` : ""}
        <button class="ref-lib-badge q-zot" data-id="${esc(q.id)}" title="실행 중인 Zotero에 서지 저장">Zotero</button>
        <button class="ref-lib-badge q-del" data-id="${esc(q.id)}" title="대기열에서 빼기">빼기</button>
      </div>`;
    }).join("");
  const byId = new Map(items.map((q) => [q.id, q]));
  body.querySelectorAll(".q-zimp").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      const done = busy("Zotero에서 가져오는 중");
      try {
        const r = await pj("/api/import/zotero", { keys: [b.dataset.att] });
        if (r.imported?.length) { toast(`가져옴: ${r.imported[0].title}`); await loadPapers(); }
        else toast(r.skipped?.[0]?.reason || "가져오지 못했습니다", true);
        runQueue();
      } catch (e) { toast("가져오기 실패 — " + e.message, true); b.disabled = false; }
      finally { done(); }
    };
  });
  body.querySelectorAll(".q-zot").forEach((b) => {
    b.onclick = () => { const q = byId.get(b.dataset.id); if (q) zoteroSave(q, b); };
  });
  body.querySelectorAll(".q-del").forEach((b) => {
    b.onclick = async () => {
      const done = busy("대기열에서 빼는 중");
      try { await api(`/api/queue/${b.dataset.id}`, { method: "DELETE" }); runQueue(); }
      catch (e) { toast("삭제 실패 — " + e.message, true); } finally { done(); }
    };
  });
  wireOpenButtons(body);
}

/* ---- 논문 찾기: 서재 밖 OpenAlex를 주제어로 검색한다. 심화 검색이 "이 논문과 이어진 것"만
   보여주는 데 비해 여기는 처음부터 주제로 찾는다. 결과의 '담기'는 대기열과 같은 경로를 쓴다. ---- */

let workSearch = { q: "", year: 0, page: 1 };

function openWorkSearch() {
  showLibAI("논문 찾기", "OpenAlex");
  const body = aiBody();
  body.innerHTML = `
    <div class="ipane-hint" style="text-align:left;padding:0 0 .55rem;">
      주제어로 논문을 찾습니다. 서재에 이미 있으면 표시되고, 없으면 '담기'로 대기열에 넣습니다.
      PDF는 저작권 때문에 자동으로 가져오지 않습니다.
    </div>
    <div class="row-actions" style="margin:0 0 .5rem;">
      <input class="gl-in" id="ws-in" placeholder="예: non-thermal plasma PET degradation" spellcheck="false" style="flex:1;min-width:12rem;">
      <label class="ov-k">${new Date().getFullYear() - 10}년 이후 <input id="ws-year" type="number" min="1900" max="2100" placeholder="전체" style="width:5rem;"></label>
      <button class="btn primary pressable" id="ws-go">검색</button>
    </div>
    <div id="ws-out"></div>`;
  const input = $("ws-in");
  input.value = workSearch.q;
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.isComposing) runWorkSearch(1);
  });
  $("ws-go").onclick = () => runWorkSearch(1);
  input.focus();
}

async function runWorkSearch(page) {
  const out = $("ws-out");
  if (!out) return;
  const q = $("ws-in").value.trim();
  if (q.length < 2) { $("ws-in").focus(); return; }
  const year = parseInt($("ws-year").value, 10) || 0;
  workSearch = { q, year, page };
  out.innerHTML = `<div class="ipane-hint">OpenAlex에서 찾는 중…</div>`;
  const done = busy("논문 찾는 중");
  try {
    const qs = `q=${encodeURIComponent(q)}&page=${page}` + (year ? `&year_from=${year}` : "");
    renderWorkSearch(await api(`/api/search/works?${qs}`));
  } catch (e) {
    out.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">검색 실패 — ${esc(e.message)}</div>`;
  } finally { done(); }
}

function renderWorkSearch(r) {
  const out = $("ws-out");
  if (!out) return;
  const items = r.results || [];
  if (!items.length) {
    out.innerHTML = `<div class="ipane-hint">"${esc(r.q)}"로 찾은 논문이 없습니다.<br>주제어를 넓혀보세요.</div>`;
    return;
  }
  const from = (r.page - 1) * 20;
  out.innerHTML =
    `<div class="mysum-stamp">${r.total.toLocaleString()}건 중 ${from + 1}–${from + items.length} · 피인용 순이 아니라 관련도 순입니다</div>` +
    items.map(relatedItem).join("") +
    `<div class="row-actions" style="margin-top:.6rem;">
      ${r.page > 1 ? `<button class="btn pressable" id="ws-prev">이전</button>` : ""}
      ${from + items.length < r.total ? `<button class="btn pressable" id="ws-next">다음 20건</button>` : ""}
    </div>
    <div class="ipane-hint" style="text-align:left;padding:.5rem 0;">출처 OpenAlex (CC0). 담은 논문은 '읽을 논문 대기열'에 쌓이고, 나중에 그 PDF를 올리면 '서재에 있음'으로 바뀝니다.</div>`;
  wireOaBadges(out, items);
  const prev = $("ws-prev"), next = $("ws-next");
  if (prev) prev.onclick = () => runWorkSearch(r.page - 1);
  if (next) next.onclick = () => runWorkSearch(r.page + 1);
}

/* ================================================================ 집필 탭 (근거 작업대)
   읽기 탭이 "한 편을 이해"라면 여기는 "여러 편을 가로질러 뽑아낸다".
   왼쪽에 서재 전체의 근거, 오른쪽에 절 단위 초안을 두고 그 사이를 오간다.

   일부러 안 만든 것: 서식·문단 편집·문장 자동 생성. Word·한글·Obsidian이 이긴다.
   Achird가 소유하는 건 근거와 출처이고, 산문은 워드프로세서가 소유한다. */

const DRAFT_SEED = ["서론", "본론", "결론"];
let draft = null;                 // {title, sections:[{id,name,text,ev:[key]}]}
let draftSec = 0;                 // 편집 중인 절 index
let draftTimer = null;
let evIndex = new Map();          // 근거 key → 항목 (초안이 든 key를 되찾는 데 쓴다)

function initWriter() {
  document.querySelectorAll(".seg-btn").forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $("theme-btn-w").onclick = cycleTheme;
  $("wr-savedtbl").onclick = runSavedTables;
  $("wr-cite").onclick = () => runCitations([]);
  $("wr-gloss").onclick = runLibGlossary;
  $("wr-bib").onclick = runExportBib;
  $("wr-export").onclick = exportDraft;
  $("wr-docx").onclick = exportDraftDocx;
  const t = $("wr-title");
  t.addEventListener("keydown", (e) => e.stopPropagation());     // 전역 단축키와 분리
  t.oninput = () => { if (draft) { draft.title = t.value; queueDraftSave(); } };
}

async function setMode(mode) {
  /* 리더에서 탭을 바꾸면 논문을 먼저 닫는다 — 안 그러면 pdf.js가 살아 있는 채로 화면만 가려진다 */
  if ($("reader").classList.contains("on")) closePaper();
  document.querySelectorAll(".seg-btn").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (mode === "write") { aiPanelId = "wr-ai"; show("writer"); await openWriter(); }
  else { aiPanelId = "lib-ai"; flushDraftSave(); show("home"); }
}

/* 서버에서 근거를 다시 받아 색인을 세운다. 집필 탭 진입과 리더에서 돌아올 때 둘 다 지난다 —
   읽으며 그은 강조가 돌아왔을 때 목록에 없으면 이 탭을 만든 이유가 사라진다. */
async function refreshWriterEvidence() {
  const ev = await loadEvidence(true);
  evIndex = new Map((ev.items || []).map((i) => [i.key, i]));
}

async function openWriter() {
  const done = busy("집필 자료 불러오는 중");
  try {
    /* loadConfig — citeInline 이 CFG.cite_citekey 를 동기적으로 읽으므로 먼저 채워 둔다 */
    const [d] = await Promise.all([api("/api/draft"), refreshWriterEvidence(), loadConfig()]);
    draft = (d && d.sections?.length) ? d
      : { title: d?.title || "", sections: DRAFT_SEED.map((n, i) => ({ id: "s" + i, name: n, text: "", ev: [] })) };
    draftSec = Math.max(0, Math.min(draftSec, draft.sections.length - 1));
    $("wr-title").value = draft.title || "";
    renderWriterEv();
    renderWriterDraft();
  } catch (e) {
    toast("집필 탭 불러오기 실패 — " + e.message, true);
  } finally { done(); }
}

/* ---- 왼쪽: 서재 전체 근거 + 이 절에 담기 ---- */

function renderWriterEv() {
  const box = $("wr-ev");
  const all = evData?.items || [], papers = evData?.papers || [];
  if (!all.length) {
    box.innerHTML = `<div class="ipane-hint">${icon("note", 26)}<br>아직 모을 근거가 없습니다.<br>읽기 탭에서 문장을 강조·노트로 남기거나<br>핵심 4색(K)을 켜보세요.</div>`;
    return;
  }
  const shown = all.filter(evMatches);
  const inSec = new Set(draft?.sections[draftSec]?.ev || []);
  box.innerHTML = `<div class="wr-ev-head">${evFilterHTML(all, papers)}
      <div class="mysum-stamp">${shown.length}건 / 전체 ${all.length}건</div></div>` +
    (shown.length ? shown.map((it) => evRow(it, inSec.has(it.key) ? "in" : "out")).join("")
                  : `<div class="ipane-hint">이 조건에 맞는 근거가 없습니다.</div>`);
  wireEvFilter(box, renderWriterEv);
  box.querySelectorAll(".ev-pick").forEach((b) => { b.onclick = () => toggleSecEv(b.dataset.key); });
  wireOpenButtons(box);
}

function toggleSecEv(key) {
  const sec = draft.sections[draftSec];
  const i = sec.ev.indexOf(key);
  if (i === -1) sec.ev.push(key); else sec.ev.splice(i, 1);
  queueDraftSave();
  renderWriterEv();
  renderWriterDraft();
}

/* ---- 오른쪽: 절 탭 + 초안 + 담은 근거 ---- */

function evChip(it) {
  const short = it.text.length > 64 ? it.text.slice(0, 64) + "…" : it.text;
  return `<div class="wr-chip">
      <span class="wr-chip-t" title="${esc(it.text)}">${esc(short)}</span>
      <span class="wr-chip-c">${esc(citeInline(it))}</span>
      <button class="ref-lib-badge wr-ins" data-key="${esc(it.key)}" title="커서 위치에 인용 넣기">인용</button>
      <button class="ref-lib-badge wr-rm" data-key="${esc(it.key)}" title="이 절에서 빼기">빼기</button>
    </div>`;
}

/* "Kim et al. (2021)" → "(Kim et al., 2021, p.4)" — 저자-연도 본문 인용 형태.
   config.cite_citekey 가 켜져 있고 논문에 Zotero citekey 가 있으면 pandoc 식
   "[@kim2021attention, p.4]" — 초안을 Obsidian·pandoc 파이프라인에 그대로 옮길 수 있다. */
function citeInline(it) {
  if (CFG?.cite_citekey && it.citekey)
    return `[@${it.citekey}${it.page ? `, p.${it.page}` : ""}]`;
  const who = String(it.cite).replace(/\s*\((\d{4})\)\s*$/, ", $1");
  return `(${who}${it.page ? `, p.${it.page}` : ""})`;
}

function renderWriterDraft() {
  const box = $("wr-draft");
  const sec = draft.sections[draftSec];
  const picked = (sec.ev || []).map((k) => evIndex.get(k)).filter(Boolean);
  const lost = (sec.ev || []).length - picked.length;
  box.innerHTML = `
    <div class="wr-secs" role="tablist" aria-label="절">
      ${draft.sections.map((s, i) =>
        `<button class="wr-sec${i === draftSec ? " on" : ""}" data-i="${i}" role="tab"
          aria-selected="${i === draftSec}">${esc(s.name)}${s.ev.length ? `<span class="wr-sec-n">${s.ev.length}</span>` : ""}</button>`).join("")}
      <button class="wr-sec wr-add" id="wr-add" title="절 추가" aria-label="절 추가">+</button>
    </div>
    ${coverageHTML()}
    <div class="row-actions" style="margin:.6rem 0 .5rem;">
      <input class="gl-in wr-name" id="wr-name" value="${esc(sec.name)}" aria-label="절 이름" spellcheck="false">
      <button class="btn primary pressable" id="wr-check">겹침 검사</button>
      <label class="ov-k">최소 <input id="ov-k" type="number" min="4" max="20" value="8"> 어절</label>
      <button class="btn pressable" id="wr-review">초안 채점</button>
      <button class="btn pressable" id="wr-secdel">절 삭제</button>
    </div>
    <textarea class="ov-ta wr-ta" id="wr-ta" spellcheck="false"
      placeholder="${esc(sec.name)} 본문. 아래 근거의 '인용'을 누르면 커서 자리에 출처가 들어갑니다."></textarea>
    <div id="ov-out"></div>
    <div id="rv-out"></div>
    <div class="kp-head" style="margin-top:.9rem;">이 절에 담은 근거 ${picked.length}건${lost ? ` · 못 찾은 근거 ${lost}건` : ""}</div>
    <div class="wr-chips">${picked.map(evChip).join("") ||
      `<div class="ipane-hint" style="padding:.9rem 0;">왼쪽 목록에서 '담기'를 눌러 이 절의 근거를 모으세요.</div>`}</div>`;

  const ta = $("wr-ta");
  ta.value = sec.text || "";
  ta.addEventListener("keydown", (e) => e.stopPropagation());
  ta.oninput = () => { sec.text = ta.value; queueDraftSave(); };
  ta.onblur = flushDraftSave;

  box.querySelectorAll(".wr-sec[data-i], .cov-cell[data-i]").forEach((b) => {
    b.onclick = () => { flushDraftSave(); draftSec = +b.dataset.i; renderWriterEv(); renderWriterDraft(); };
  });
  $("wr-add").onclick = () => {
    if (draft.sections.length >= 30) { toast("절은 30개까지입니다", true); return; }
    draft.sections.push({ id: "s" + Math.random().toString(36).slice(2, 8), name: "새 절", text: "", ev: [] });
    draftSec = draft.sections.length - 1;
    queueDraftSave(); renderWriterEv(); renderWriterDraft();
    $("wr-name").select();
  };
  const nameIn = $("wr-name");
  nameIn.addEventListener("keydown", (e) => e.stopPropagation());
  nameIn.oninput = () => {
    sec.name = nameIn.value;
    const tab = box.querySelector(`.wr-sec[data-i="${draftSec}"]`);
    if (tab) tab.firstChild.nodeValue = nameIn.value;    // 탭 라벨만 갱신 — 전체 재렌더는 입력 포커스를 잃는다
    queueDraftSave();
  };
  $("wr-secdel").onclick = () => {
    if (draft.sections.length <= 1) { toast("마지막 절은 지울 수 없습니다", true); return; }
    confirmDestructive("절 삭제", `"${sec.name}"의 본문과 담아둔 근거 ${sec.ev.length}건이 함께 사라집니다.`, () => {
      draft.sections.splice(draftSec, 1);
      draftSec = Math.max(0, draftSec - 1);
      /* queue→flush 순서를 지킨다. flush 는 '대기 중인 저장을 지금 보내라'는 뜻이라
         큐가 비어 있으면 아무것도 안 한다 — 삭제만 하고 flush 하면 서버에 절이 남는다. */
      queueDraftSave(); flushDraftSave();
      renderWriterEv(); renderWriterDraft();
    });
  };
  $("wr-check").onclick = runSectionOverlap;
  $("wr-review").onclick = runSectionReview;
  box.querySelectorAll(".wr-ins").forEach((b) => {
    b.onclick = () => { const it = evIndex.get(b.dataset.key); if (it) insertAtCursor(ta, citeInline(it)); };
  });
  box.querySelectorAll(".wr-rm").forEach((b) => { b.onclick = () => toggleSecEv(b.dataset.key); });
}

/* ---- 근거 커버리지: 절마다 담은 근거 수를 한 줄 막대로. 리뷰논문에서 정작 위험한 건
   근거가 적은 절이 아니라 **0건인 절**이다 — 본문이 다 채워져 있으면 눈으로는 안 보인다.
   AI도 서버도 안 쓴다(이미 손에 있는 숫자다). ---- */

function coverageHTML() {
  const secs = draft?.sections || [];
  if (secs.length < 2) return "";
  const counts = secs.map((s) => (s.ev || []).filter((k) => evIndex.has(k)).length);
  const max = Math.max(1, ...counts);
  const empty = counts.filter((c) => !c).length;
  return `<div class="cov-row" title="절별 담은 근거">` +
    secs.map((s, i) => {
      const c = counts[i];
      const h = Math.round((c / max) * 100);
      return `<button class="cov-cell${c ? "" : " zero"}${i === draftSec ? " on" : ""}" data-i="${i}"
        title="${esc(s.name)} — 근거 ${c}건"><i style="height:${c ? Math.max(12, h) : 100}%"></i>
        <span>${c}</span></button>`;
    }).join("") +
    `<span class="cov-note${empty ? " warn" : ""}">${empty ? `근거 0건인 절 ${empty}개` : "모든 절에 근거 있음"}</span></div>`;
}

/* 커서 자리에 끼워 넣고 되돌리기 이력을 살린다 — value 를 직접 갈면 Ctrl+Z 가 죽는다 */
function insertAtCursor(ta, text) {
  ta.focus();
  if (!document.execCommand("insertText", false, text)) {
    const a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
  }
  draft.sections[draftSec].text = ta.value;
  queueDraftSave();
}

async function runSectionOverlap() {
  const sec = draft.sections[draftSec];
  const out = $("ov-out");
  if (!sec.text.trim()) { $("wr-ta").focus(); return; }
  const k = Math.max(4, Math.min(20, parseInt($("ov-k").value, 10) || 8));
  out.innerHTML = `<div class="ipane-hint">겹침을 찾는 중…</div>`;
  const done = busy("겹침 검사 중");
  try {
    renderOverlap(await pj("/api/library/overlap", { text: sec.text, k }));
  } catch (e) {
    out.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">검사 실패 — ${esc(e.message)}</div>`;
  } finally { done(); }
}

/* ---- 초안 채점: 겹침 검사가 "옮겨 쓴 곳"을 잡는다면 여기는 "논증이 서 있는지"를 본다.
   네 축 중 셋(근거·인용·용어)은 서버에서 AI 없이 끝나고, 구조·피어리뷰만 모델을 부른다.
   고쳐 쓴 문장은 받지 않는다 — Achird는 산문을 소유하지 않는다. ---- */

async function runSectionReview() {
  const sec = draft.sections[draftSec];
  const out = $("rv-out");
  if (!out) return;
  if (sec.text.trim().length < 100) { toast("100자 이상 써야 점검할 수 있습니다", true); $("wr-ta").focus(); return; }
  /* pid·page 도 같이 보낸다 — 서버가 (저자, 연도, p.N) 인용을 이 절이 담은 근거와 대조한다 */
  const evidence = (sec.ev || []).map((k) => evIndex.get(k)).filter(Boolean)
    .map((it) => ({ cite: it.cite, text: it.text, pid: it.pid, page: it.page }));
  out.innerHTML = "";
  out.appendChild(starInline("절을 심사하는 중… (30초~1분)"));
  const done = busy("초안 채점 중");
  try {
    renderReview(await pj("/api/draft/review", { name: sec.name, text: sec.text, evidence }));
  } catch (e) {
    out.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">채점 실패 — ${esc(e.message)}</div>`;
  } finally { done(); }
}

const RV_VERDICT = { accept: "그대로 통과", minor: "손볼 곳 있음", major: "크게 고쳐야 함", reject: "다시 써야 함" };

function renderReview(r) {
  const out = $("rv-out");
  if (!out) return;
  const c = r.checks;
  const stat = (label, val, warn) =>
    `<span class="rv-stat${warn ? " warn" : ""}"><b>${esc(String(val))}</b> ${esc(label)}</span>`;
  /* 인용 밀도 0.1 = 문장 열에 하나 — 리뷰논문에서 그 아래면 근거 없이 흘러가는 문단이 있다는 뜻 */
  const thin = c.sentences >= 5 && c.density < 0.1;
  let html = `<div class="kp-head" style="margin-top:1rem;">초안 채점 — ${esc(r.name)}</div>
    <div class="rv-stats">
      ${stat("문장", c.sentences)}${stat("인용", c.cites.total, c.cites.total === 0)}
      ${stat("문장당 인용", c.density, thin)}${stat("담은 근거", c.evidence_total)}
      ${stat("안 쓴 근거", c.uncited.length, c.uncited.length > 0)}
      ${stat("역어 충돌", c.terms.length, c.terms.length > 0)}
      ${stat("인용 오류", c.inline_bad ?? 0, (c.inline_bad ?? 0) > 0)}
    </div>`;

  const inline = c.inline || [];
  const bad = inline.filter((i) => i.kind !== "outside");
  const outside = inline.filter((i) => i.kind === "outside");
  if (bad.length) {
    html += `<div class="kp-head">인용이 가리킨 자리 ${bad.length}건</div>` +
      bad.map((i) => `<div class="ref-item"><span class="rn">${i.kind === "page_range" ? "쪽" : "근거"}</span>
        <span><span class="ov-hit">${esc(i.raw)}</span> — ${
          i.kind === "page_range"
            ? `${esc(i.title)}는 ${i.pages}쪽까지입니다.`
            : `${esc(i.title)}의 ${i.page}쪽에서 담아둔 근거가 이 절에 없습니다.`}</span></div>`).join("");
  }
  if (outside.length) {
    html += `<div class="mysum-stamp">서재 밖 출처 ${outside.length}건 — ${
      outside.slice(0, 6).map((i) => esc(i.raw)).join(" ")}${outside.length > 6 ? " …" : ""} (오류가 아닙니다)</div>`;
  }

  if (c.uncited.length) {
    html += `<div class="kp-head">이 절에 담아놓고 본문에 안 쓴 근거 ${c.uncited.length}건</div>` +
      c.uncited.map((u) => `<div class="ref-item"><span class="rn">미인용</span>
        <span><span class="ev-text">${esc(u.text)}</span><br><span class="ev-memo">${esc(u.cite)}</span></span></div>`).join("");
  }
  if (c.terms.length) {
    html += `<div class="kp-head">대표 역어와 다른 표기 ${c.terms.length}건</div>` +
      c.terms.map((t) => `<div class="ref-item"><span class="rn">용어</span>
        <span><b>${esc(t.term)}</b> — 대표 역어 "<b>${esc(t.canon)}</b>"인데 본문은
        ${t.used.map((u) => `"${esc(u)}"`).join(", ")}를 씁니다${t.fixed ? " (둘이 섞여 있습니다)" : ""}.</span></div>`).join("");
  }
  if (!c.uncited.length && !c.terms.length && !bad.length && !thin && c.cites.total) {
    html += `<div class="mysum-stamp">근거·인용·용어·무결성 축은 걸린 곳이 없습니다.</div>`;
  }

  if (r.ai_error) {
    html += `<div class="ipane-hint" style="text-align:left;color:var(--danger);padding:.6rem 0;">
      구조·피어리뷰는 실패했습니다 — ${esc(r.ai_error)}<br>위 세 축은 AI를 쓰지 않아 그대로 유효합니다.</div>`;
  } else if (r.ai) {
    const st = r.ai.structure || [];
    if (st.length) {
      html += `<div class="kp-head">구조 ${st.length}건</div>` + st.map((s) => `<div class="ref-item">
        <span class="rn">구조</span>
        <span>${s.where ? `<span class="ov-hit">${esc(s.where)}</span><br>` : ""}
          ${esc(s.issue || "")}${s.fix ? `<br><span class="ev-memo">→ ${esc(s.fix)}</span>` : ""}</span></div>`).join("");
    }
    (r.ai.reviewers || []).forEach((rv) => {
      html += `<div class="kp-head">${esc(rv.who || "심사자")}
          <span class="npage" style="margin-left:auto;">${esc(RV_VERDICT[rv.verdict] || rv.verdict || "")}</span></div>
        <ul class="rv-points">${(rv.points || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
    });
  }
  html += `<div class="ipane-hint" style="text-align:left;padding:.6rem 0;">채점은 지적까지입니다 — 고쳐 쓴 문장은 내놓지 않습니다. 문장은 Word·한글에서 손보세요.</div>`;
  out.innerHTML = html;
}

/* ---- 저장: 타자마다 보내지 않고 접었다가, 절을 옮기거나 나갈 때 확실히 흘려보낸다 ---- */

function queueDraftSave() {
  $("wr-saved").textContent = "저장 대기…";
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 900);
}

function flushDraftSave() {
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; saveDraft(); }
}

async function saveDraft() {
  draftTimer = null;
  if (!draft) return;
  try {
    await pj("/api/draft", draft, "PUT");
    $("wr-saved").textContent = "저장됨";
  } catch (e) {
    $("wr-saved").textContent = "저장 실패";
    toast("초안 저장 실패 — " + e.message, true);
  }
}

/* ---- 내보내기: 본문 뒤에 절별 근거를 붙인다. 워드로 옮겨 쓸 때 출처가 같이 따라가야 한다 ---- */

function draftToMarkdown() {
  const lines = [`# ${draft.title || "제목 없는 원고"}`, ""];
  draft.sections.forEach((s) => {
    lines.push(`## ${s.name}`, "", (s.text || "").trim() || "_(비어 있음)_", "");
  });
  const withEv = draft.sections.filter((s) => s.ev.some((k) => evIndex.has(k)));
  if (withEv.length) {
    lines.push("---", "", "# 담은 근거", "");
    withEv.forEach((s) => {
      lines.push(`## ${s.name}`, "");
      s.ev.map((k) => evIndex.get(k)).filter(Boolean).forEach((it) => {
        lines.push(`- **${evLabel(it)}** — ${it.cite}${it.page ? `, p.${it.page}` : ""}`);
        lines.push(`  > ${String(it.text).replace(/\s+/g, " ").trim()}`);
        if (it.memo) lines.push(`  - ${String(it.memo).replace(/\s+/g, " ").trim()}`);
      });
      lines.push("");
    });
  }
  return lines.join("\n");
}

function exportDraft() {
  flushDraftSave();
  const name = (draft.title || "achird-draft").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "achird-draft";
  downloadBlob(`${name}.md`, new Blob([draftToMarkdown()], { type: "text/markdown;charset=utf-8" }));
  toast("초안을 Markdown으로 내보냈습니다");
}

/* .docx 는 서버가 만든다 — 저장된 초안을 그대로 읽으므로 먼저 흘려보내고 부른다.
   Markdown 은 서식을 안 푼다: Achird 가 소유하는 건 근거와 출처이고 산문은 Word 몫이다. */
async function exportDraftDocx() {
  flushDraftSave();
  const name = (draft.title || "achird-draft").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "achird-draft";
  const done = busy(".docx 만드는 중");
  try {
    const r = await pj("/api/export/docx", { style: "acs" });
    downloadBlob(`${name}.docx`, await r.blob());
    toast("초안을 .docx로 내보냈습니다");
  } catch (e) {
    toast(e.status === 501 ? "python-docx가 없습니다 — run.bat을 한 번 다시 실행하세요"
                           : ".docx 내보내기 실패 — " + e.message, true);
  } finally { done(); }
}

/* 심화 검색 결과 → 대기열 담기. 이미 담겼으면 서버가 409로 막는다. */
async function queueAdd(w) {
  try {
    await pj("/api/queue", { title: w.title, doi: w.doi, url: w.url, venue: w.venue, year: w.year });
    toast("대기열에 담았습니다");
  } catch (e) {
    toast(e.status === 409 ? "이미 대기열에 있습니다" : "담기 실패 — " + e.message, e.status !== 409);
  }
}

/* ---- 서재 인용 그래프: refs.json 매칭으로 서버가 만든 엣지를 원형 배치 SVG로 그린다(라이브러리 없이
   직접 생성). AI 호출이 없고, 레이아웃은 힘-시뮬레이션 대신 원형 배치라 입력이 같으면 항상 같은
   그림이 나온다 — 각 노드의 각도를 피인용 수 내림차순으로 결정론적으로 배정한다. ---- */

let graphConcepts = false;      // 노트의 [[개념]]을 노드로 함께 그릴지

async function runLibraryGraph(concepts = graphConcepts) {
  graphConcepts = !!concepts;
  showLibAI("인용 그래프", graphConcepts ? "개념 포함" : null, "서재 인용 관계를 불러오는 중…");
  const done = busy("인용 그래프 불러오는 중");
  try {
    const r = await api(`/api/library/graph${graphConcepts ? "?concepts=1" : ""}`);
    renderGraphResult(r);
  } catch (e) {
    renderLibAIError("인용 그래프를 불러오지 못했습니다 — " + e.message);
  } finally { done(); }
}

/* 개념 토글은 결과가 비었을 때도 있어야 한다 — 켜보고 비면 그때 끄면 된다 */
function graphToggleHTML() {
  return `<div class="row-actions" style="margin:.1rem 0 .6rem;">
      <button class="btn pressable" id="gr-concepts">${graphConcepts ? "개념 숨기기" : "노트 개념 포함"}</button>
    </div>`;
}

function wireGraphToggle(body) {
  const b = $("gr-concepts");
  if (b) b.onclick = () => runLibraryGraph(!graphConcepts);
}

function renderGraphResult(data) {
  const body = aiBody();
  if (!body) return;
  const nodes = data.nodes || [], edges = data.edges || [];
  if (nodes.length < 2) {
    body.innerHTML = graphToggleHTML() +
      `<div class="ipane-hint">${icon("graph", 26)}<br>그래프를 그리려면 서재에 논문이 2편 이상 있어야 합니다.</div>`;
    wireGraphToggle(body);
    return;
  }
  if (!edges.length) {
    body.innerHTML = graphToggleHTML() +
      `<div class="ipane-hint">${icon("graph", 26)}<br>서재 안에서 서로 인용된 관계를 아직 찾지 못했습니다.<br>
        각 논문의 인용 탭에서 'AI로 재분석' 후 '출처 검증'을 돌리면 참고문헌이 채워집니다.` +
      (graphConcepts ? `<br>노트 메모에 <code>[[개념]]</code>을 적으면 개념 노드로도 이어집니다.` : "") +
      `</div>`;
    wireGraphToggle(body);
    return;
  }
  const verified = edges.filter((e) => e.why === "doi_verified").length;
  const wiki = edges.filter((e) => e.why === "wikilink").length;
  const bits = [`논문 ${nodes.filter((n) => n.kind !== "concept").length}편`];
  if (data.concepts) bits.push(`개념 ${data.concepts}개`);
  bits.push(`이음 ${edges.length}개`);
  if (verified) bits.push(`DOI 확인 ${verified}개`);
  if (wiki) bits.push(`노트 연결 ${wiki}개`);
  body.innerHTML = graphToggleHTML() +
    `<div class="mysum-stamp" style="margin:0 0 .4rem;">${esc(bits.join(" · "))}</div>` +
    `<div class="graph-scroll">${buildGraphSVG(nodes, edges)}</div>`;
  wireGraphToggle(body);
  wireGraphInteractions(body.querySelector(".graph-svg"));
}

/* 제목을 노드 라벨 길이로 축약 */
function shortTitle(t, n = 26) {
  const s = String(t || "").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function buildGraphSVG(nodes, edges) {
  const n = nodes.length;
  const inDeg = new Map(nodes.map((nd) => [nd.id, 0]));
  const outDeg = new Map(nodes.map((nd) => [nd.id, 0]));
  edges.forEach((e) => {
    if (inDeg.has(e.to)) inDeg.set(e.to, inDeg.get(e.to) + 1);
    if (outDeg.has(e.from)) outDeg.set(e.from, outDeg.get(e.from) + 1);
  });
  // 배치 순서: 피인용 수 내림차순(동률은 제목순) → 12시 방향에서 시계 방향으로 각도 배정.
  // 입력(노드·엣지)이 같으면 항상 같은 각도가 나와 그림이 재현된다 — 많이 인용된 논문일수록 앞쪽에 모인다.
  const order = [...nodes].sort((a, b) =>
    (inDeg.get(b.id) - inDeg.get(a.id)) || String(a.title).localeCompare(String(b.title)));
  const R = Math.max(110, Math.min(420, n * 26));
  const pad = 190;
  const W = 2 * (R + pad), H = W, cx = W / 2, cy = H / 2;
  const pos = new Map();
  order.forEach((nd, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pos.set(nd.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a });
  });
  const maxDeg = Math.max(1, ...nodes.map((nd) => inDeg.get(nd.id)));
  const rad = (id) => 6 + Math.round((inDeg.get(id) / maxDeg) * 9);   // 피인용 많을수록 큰 점

  const edgesSVG = edges.map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return "";
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const ra = rad(e.from) + 2, rb = rad(e.to) + 7;    // rb는 화살촉이 노드 밖에 그려지게 여유를 더 둔다
    const x1 = a.x + ux * ra, y1 = a.y + uy * ra;
    const x2 = b.x - ux * rb, y2 = b.y - uy * rb;
    return `<line class="graph-edge" data-from="${e.from}" data-to="${e.to}" ` +
      `x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" marker-end="url(#ml-arrow)"></line>`;
  }).join("");

  const nodesSVG = order.map((nd) => {
    const p = pos.get(nd.id), r = rad(nd.id);
    const iso = inDeg.get(nd.id) === 0 && outDeg.get(nd.id) === 0;   // 인용도 피인용도 없는 고립 노드
    const concept = nd.kind === "concept";
    const right = Math.cos(p.a) >= 0;
    const lx = p.x + (right ? r + 8 : -(r + 8));
    const label = concept ? shortTitle(nd.title) : shortTitle(nd.title) + (nd.year ? ` (${nd.year})` : "");
    /* 개념 노드는 열 논문이 없다 — 버튼 역할을 주지 않는다(누르면 아무 일도 안 나는 버튼은 거짓말이다) */
    return `<g class="graph-node${iso ? " iso" : ""}${concept ? " concept" : ""}" data-id="${nd.id}"` +
      (concept ? ` aria-label="${esc(nd.title)} — 노트 ${nd.refs}건"` :
        ` tabindex="0" role="button" aria-label="${esc(nd.title)} 열기"`) + `>` +
      `<circle class="graph-hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 14}"></circle>` +
      `<circle class="graph-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"></circle>` +
      `<text class="graph-label" x="${lx.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${right ? "start" : "end"}" dominant-baseline="middle">${esc(label)}</text></g>`;
  }).join("");

  return `<svg class="graph-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    `<marker id="ml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="graph-arrow" d="M0,0 L10,5 L0,10 z"></path></marker>` +
    `<marker id="ml-arrow-hl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="graph-arrow-hl" d="M0,0 L10,5 L0,10 z"></path></marker>` +
    `</defs>` +
    `<g class="graph-edges">${edgesSVG}</g><g class="graph-nodes">${nodesSVG}</g></svg>`;
}

/* hover → 연결된 엣지·노드만 강조(나머지는 흐리게), 클릭·Enter/Space → 서재에서 해당 논문 열기 */
function wireGraphInteractions(svg) {
  if (!svg) return;
  const nodeEls = new Map([...svg.querySelectorAll(".graph-node")].map((g) => [g.dataset.id, g]));
  const edgeEls = [...svg.querySelectorAll(".graph-edge")];
  const openNode = (id) => { const p = S.papers.find((x) => x.id === id); if (p) openPaper(p); };
  const clear = () => {
    svg.classList.remove("hovering");
    nodeEls.forEach((g) => g.classList.remove("hl"));
    edgeEls.forEach((e) => { e.classList.remove("hl"); e.setAttribute("marker-end", "url(#ml-arrow)"); });
  };
  const hover = (id) => {
    svg.classList.add("hovering");
    const connected = new Set([id]);
    edgeEls.forEach((e) => {
      const on = e.dataset.from === id || e.dataset.to === id;
      e.classList.toggle("hl", on);
      e.setAttribute("marker-end", on ? "url(#ml-arrow-hl)" : "url(#ml-arrow)");
      if (on) { connected.add(e.dataset.from); connected.add(e.dataset.to); }
    });
    nodeEls.forEach((g, nid) => g.classList.toggle("hl", connected.has(nid)));
  };
  nodeEls.forEach((g, id) => {
    g.addEventListener("pointerenter", () => hover(id));
    g.addEventListener("pointerleave", clear);
    g.addEventListener("focus", () => hover(id));
    g.addEventListener("blur", clear);
    if (g.classList.contains("concept")) return;   // 개념 노드는 열 논문이 없다 — hover만
    g.addEventListener("click", () => openNode(id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNode(id); } });
  });
}

/* ---- 서재 전체 .bib 내보내기: 선택 모드에 고른 논문이 있으면 그것만, 없으면 서재 전체 ---- */

async function runExportBib() {
  const ids = S.cmp.on ? [...S.cmp.sel] : [];
  const done = busy("BibTeX 내보내는 중");
  try {
    const r = await pj("/api/export/bib", { ids });
    const text = await r.text();
    downloadBlob("achird-library.bib", new Blob([text], { type: "text/plain;charset=utf-8" }));
    toast(ids.length ? `선택한 ${ids.length}편 BibTeX 내보냄` : "서재 전체 BibTeX 내보냄");
  } catch (e) {
    toast("BibTeX 내보내기 실패: " + e.message, true);
  } finally { done(); }
}

/* ---- 선택 모드: 서가에서 책 최대 8권 선택 — 비교(2~3편)·근거표(2~8편)·bib 내보내기가 공유 ---- */

function toggleCmpMode() { S.cmp.on ? exitCmpMode() : (S.cmp.on = true, S.cmp.sel = [], updateCmpUI()); }
function exitCmpMode() { S.cmp.on = false; S.cmp.sel = []; updateCmpUI(); }

function toggleCmpSel(pid) {
  const i = S.cmp.sel.indexOf(pid);
  if (i !== -1) S.cmp.sel.splice(i, 1);
  else if (S.cmp.sel.length < 8) S.cmp.sel.push(pid);
  else { toast("선택은 최대 8편까지입니다"); return; }
  updateCmpUI();
}

function updateCmpUI() {
  $("shelf").classList.toggle("cmp", S.cmp.on);
  const btn = $("cmp-btn");
  btn.textContent = S.cmp.on ? "선택 취소" : "선택 모드";
  btn.classList.toggle("on", S.cmp.on);
  let run = $("cmp-run");
  if (S.cmp.on && S.cmp.sel.length >= 2 && S.cmp.sel.length <= 3) {
    if (!run) {
      run = document.createElement("button");
      run.id = "cmp-run"; run.className = "btn primary pressable";
      btn.after(run);
    }
    run.textContent = `선택 ${S.cmp.sel.length}편 비교`;
    run.onclick = () => { const ids = [...S.cmp.sel]; exitCmpMode(); runLibraryCompare(ids); };
  } else run?.remove();
  let tbl = $("tbl-run");
  if (S.cmp.on && S.cmp.sel.length >= 2) {
    if (!tbl) {
      tbl = document.createElement("button");
      tbl.id = "tbl-run"; tbl.className = "btn pressable";
      ($("cmp-run") || btn).after(tbl);
    }
    tbl.textContent = `선택 ${S.cmp.sel.length}편 근거표`;
    tbl.onclick = () => { const ids = [...S.cmp.sel]; exitCmpMode(); runLibraryTable(ids); };
  } else tbl?.remove();
  /* 번호 인용은 1편만 골라도 뜻이 있다(그 논문의 서지 문자열 확인) — 근거표와 달리 하한이 없다 */
  let cite = $("cite-run");
  if (S.cmp.on && S.cmp.sel.length >= 1) {
    if (!cite) {
      cite = document.createElement("button");
      cite.id = "cite-run"; cite.className = "btn pressable";
      ($("tbl-run") || $("cmp-run") || btn).after(cite);
    }
    cite.textContent = `선택 ${S.cmp.sel.length}편 번호 인용`;
    cite.onclick = () => { const ids = [...S.cmp.sel]; exitCmpMode(); runCitations(ids); };
  } else cite?.remove();
  const bib = $("bib-btn");
  if (bib) bib.textContent = S.cmp.on && S.cmp.sel.length ? `선택 ${S.cmp.sel.length}편 .bib` : "전체 .bib";
  document.querySelectorAll("#shelf .book").forEach((b) => {
    const k = S.cmp.sel.indexOf(b.dataset.pid);
    b.classList.toggle("cmp-sel", k !== -1);
    const cov = b.querySelector(".cover");
    if (cov) { if (k !== -1) cov.dataset.n = k + 1; else delete cov.dataset.n; }
  });
}

/* 포커스 트랩 — 다이얼로그 밖으로 Tab이 못 나가게, Esc로 닫기(콜백), 닫히면 이전 포커스로 복귀 */
function trapFocus(el, onClose) {
  const prev = document.activeElement;
  const focusables = () => [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && n.offsetParent !== null);
  focusables()[0]?.focus();
  const onKey = (e) => {
    if (e.key === "Escape") { onClose?.(); return; }
    if (e.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const a = items[0], b = items[items.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
    else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
  };
  el.addEventListener("keydown", onKey);
  return () => { el.removeEventListener("keydown", onKey); prev?.focus?.(); };
}

/* 스크림 다이얼로그 공통 오픈: 등장 스프링 + 포커스 트랩 + 취소/바깥클릭 닫기 배선. close 반환. */
function openDialog(scrimId, cancelId) {
  const scrim = $(scrimId);
  scrim.classList.add("show");
  const dlg = scrim.querySelector(".dialog");
  dlg.style.transform = "scale(0.96)"; dlg.style.opacity = "0";
  anim(dlg, { transform: "scale(1)", opacity: 1 }, { type: "spring", duration: 0.3, bounce: 0 });
  let close;
  const untrap = trapFocus(dlg, () => close());
  close = () => { scrim.classList.remove("show"); untrap(); };
  $(cancelId).onclick = close;
  scrim.onclick = (e) => { if (e.target === scrim) close(); };
  return close;
}

/* destructive confirm (scrim + focus trap). 되돌릴 수 없는 동작은 전부 이걸 지난다. */
function confirmDestructive(title, msg, onOk, okLabel = "삭제") {
  $("dlg-title").textContent = title;
  $("dlg-msg").textContent = msg;
  $("dlg-ok").textContent = okLabel;
  const close = openDialog("scrim", "dlg-cancel");
  $("dlg-ok").onclick = () => { close(); onOk(); };
}

function confirmDelete(p) {
  confirmDestructive("논문 삭제", `"${p.title}"와 요약·노트·채팅 기록이 함께 삭제됩니다.`, async () => {
    try {
      await api(`/api/papers/${p.id}`, { method: "DELETE" });
      try { localStorage.removeItem("ml.pos." + p.id); } catch { /* best-effort */ }
      toast("삭제됨"); loadPapers();
    } catch (e) { toast("삭제 실패: " + e.message, true); }
  });
}

/* ---------------------------------------------------------------- reader open/close */

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
  $(id).classList.add("on");
}

async function openPaper(p) {
  if (S.pdf) {          // 리더 안에서 다른 논문으로 직행(인용 '서재에서 열기' 등) — 이전 문서 정리
    saveReadPos();      // S.current가 아직 이전 논문일 때 저장해야 그 논문 위치로 남는다
    try { S.pdf.destroy(); } catch { /* already gone */ }
    S.io?.disconnect();
  }
  S.current = p;
  if (!p.status || p.status === "none") {   // 처음 열면 자동으로 '읽는 중' — best-effort
    p.status = "reading";
    pj(`/api/papers/${p.id}`, { status: "reading" }, "PATCH").catch(() => {});
  }
  try { localStorage.setItem("ml.last", JSON.stringify({ id: p.id, ts: Date.now() })); } catch { /* best-effort */ }
  S.pages = []; S.pdf = null; S.textReady = false; S.sel = null;
  S.hl = { items: [] }; S.autoHl = []; S.notes = []; S.refs = { style: "numeric", items: [] };
  S.refMap = new Map(); S.refLinks = new Map(); S.chatQuote = null;
  S.trans.stop = true;
  S.trans = { pages: {}, err: {}, inflight: new Set(), running: false, stop: false };
  S.prefetch = { queue: [], inflight: new Set() };
  S.align = { on: false, pages: {}, err: {}, inflight: new Set(), running: false };
  S.linkPinned = null;
  S.kp = { on: false, items: null, placed: false, running: false };
  $("key-btn").classList.remove("on");
  $("kp-legend").hidden = true;
  S.find = { q: "", list: [], cur: -1, open: false };
  $("find-bar").hidden = true;
  $("find-in").value = "";
  S.gloss = { items: null, running: false, placed: null };
  S.q = { items: null, running: false };
  renderChatChips();
  S.scan = { running: false, stop: false, done: 0, todo: 0 };
  S.outline = null;
  S.figs = null;
  S.formulas = null;
  S.mysum = { data: null, running: false };
  S.an = { data: null, running: false };
  S.mm = { nodes: null, running: false, placed: false };
  $("map-well").innerHTML = "";
  $("scan-banner").hidden = true;
  $("dup-banner").hidden = true;
  S.inspUserPinned = false;
  setView("pdf");
  $("rd-title").textContent = p.title;
  $("rd-page").textContent = "";
  $("pages").innerHTML = "";
  $("chat-log").innerHTML = "";
  show("reader");
  setTab("summary");

  const done = busy("논문 여는 중");
  try {
    // 로컬 서버라 range 스트리밍 이득이 없고, 부분 로드가 XRef 복구(페이지 소실)를
    // 유발할 수 있어 통째로 받는다
    const load = (bust) => pdfjsLib.getDocument({
      url: `/api/papers/${p.id}/pdf` + (bust ? `?bust=${Date.now()}` : ""),
      disableRange: true, disableStream: true,
    }).promise;
    S.pdf = await load(false);
    // OneDrive 동기화 직후 등 일시적 짧은 읽기로 페이지가 소실된 채 복구-파싱될 수 있다
    if (p.pages && S.pdf.numPages < p.pages) {
      try { S.pdf.destroy(); } catch { /* ignore */ }
      S.pdf = await load(true);
      if (S.pdf.numPages < p.pages)
        toast(`주의: PDF가 ${S.pdf.numPages}쪽만 열렸습니다 (기록상 ${p.pages}쪽)`, true);
    }
    await buildPages();
    const jump = pendingJump; pendingJump = null;
    if (jump) gotoPage(jump.page);   // 서재 검색에서 진입 — 읽던 위치보다 우선
    else restoreReadPos();           // 읽던 위치 복원 (wrap 크기가 잡힌 직후)
    done();
    const sideP = loadSidecars();
    const exP = extractAll();        // background: text cache + refs + thumb
    if (jump?.src === "번역") {      // 번역 매치 → 번역 캐시 로드 후 병렬 뷰로
      sideP.then(() => { if (S.current === p) setView("parallel"); });
    } else if (JUMP_TAB[jump?.src]) {
      /* 노트·강조 매치는 본문에 없을 수도 있다(메모·AI 이유는 한국어) — 원문을 뒤지는 대신
         그 매치가 실제로 사는 패널을 연다. */
      sideP.then(() => {
        if (S.current !== p) return;
        $("inspector").classList.remove("hidden");
        setTab(JUMP_TAB[jump.src]);
      });
    } else if (jump?.q) {            // 원문 매치 → 인덱스 준비 후 검색어 하이라이트+순회
      exP.then(() => {
        if (S.current !== p) return;
        openFind(); $("find-in").value = jump.q; runFind(jump.q, jump.page);
      });
    }
  } catch (e) {
    done();
    let msg = e.message;
    // 서버 꺼짐은 원인을 덮지 않고 앞에 붙인다 — 오프라인과 PDF 손상이 겹치면 둘 다 알아야 한다
    try { await fetch("/api/papers", { cache: "no-store" }); }
    catch { msg = `서버가 꺼져 있습니다 — run.bat으로 서버를 켠 뒤 다시 시도하세요. (${msg})`; }
    toast("PDF를 열지 못했습니다: " + msg, true); show("home");
  }
}

function closePaper() {
  saveReadPos();
  try { S.pdf?.destroy(); } catch { /* already gone */ }
  S.io?.disconnect();
  S.trans.stop = true;
  S.pdf = null; S.current = null; S.pages = [];
  $("pages").innerHTML = "";
  hideSelPop(); hideCitePop(); hideTermTip();
  /* 집필 탭의 근거에서 논문을 열었으면 뒤로가기도 집필 탭으로 — 서가로 튕기면 쓰던 자리를 잃는다.
     읽는 동안 그은 강조·노트가 곧바로 목록에 오도록 근거를 다시 받는다. */
  if (aiPanelId === "wr-ai") {
    show("writer");
    refreshWriterEvidence()
      .then(() => { if (draft) { renderWriterEv(); renderWriterDraft(); } })
      .catch((e) => toast("근거 갱신 실패 — " + e.message, true));
  } else { show("home"); }
  loadPapers();
}

/* ---------------------------------------------------------------- page scaffolding & lazy render */

async function buildPages() {
  const n = S.pdf.numPages;
  const first = await S.pdf.getPage(1);
  const v1 = first.getViewport({ scale: 1 });
  S.io = new IntersectionObserver(onIntersect, { root: $("pages-scroll"), rootMargin: "700px 0px" });

  for (let i = 1; i <= n; i++) {
    const st = { n: i, page: i === 1 ? first : null, tc: null, raw: "", index: null,
                 wrap: null, row: null, transCell: null,
                 hlLayer: null, textDivs: null, rendered: false, rendering: null,
                 natW: v1.width, natH: v1.height };
    const row = document.createElement("div");
    row.className = "page-row";
    row.dataset.n = i;
    const wrap = document.createElement("div");
    wrap.className = "page-wrap page-ph";
    wrap.dataset.n = i;
    wrap.textContent = i;
    st.wrap = wrap;
    const cell = document.createElement("div");
    cell.className = "trans-cell";
    cell.dataset.n = i;
    st.transCell = cell;
    st.row = row;
    sizeWrap(st, wrap);       // st.transCell 할당 후 호출 → 셀 max-height도 원문 높이로
    row.appendChild(wrap);
    row.appendChild(cell);
    S.pages.push(st);
    $("pages").appendChild(row);
    S.io.observe(wrap);       // 원문 wrap 관찰 → lazy 렌더 (병렬 여부 무관)
  }
  $("rd-page").textContent = `1 / ${n}`;
  $("pages-scroll").onscroll = onPagesScroll;
  renderPage(1);
}

function sizeWrap(st, wrap = st.wrap) {
  const h = Math.floor(st.natH * S.scale);
  wrap.style.width = Math.floor(st.natW * S.scale) + "px";
  wrap.style.height = h + "px";
  wrap.style.setProperty("--scale-factor", String(S.scale));
  // 병렬 뷰: 번역 셀을 원문 페이지 높이로 제한 → 넘치는 번역은 셀 안에서 스크롤
  if (st.transCell) st.transCell.style.maxHeight = h + "px";
}

function onIntersect(entries) {
  for (const en of entries) if (en.isIntersecting) renderPage(+en.target.dataset.n);
  if (S.view === "parallel") queuePrefetch(currentPageNo());   // 같은 가시성 신호로 다음 쪽 번역 예약
}

function currentPageNo() {
  const scTop = $("pages-scroll").getBoundingClientRect().top;
  let cur = 1;
  for (const st of S.pages) {
    if (st.wrap.getBoundingClientRect().top - scTop <= 90) cur = st.n; else break;
  }
  return cur;
}

function onPagesScroll() {
  // AI 결과 카드는 스크롤해도 유지(fixed라 제자리) · 메뉴·힌트는 기존대로 닫힘
  hideSelPop(); if (!$("cite-pop").dataset.sticky) hideCitePop(); hideTermTip();
  $("rd-page").textContent = `${currentPageNo()} / ${S.pages.length}`;
  gcFarPages($("pages-scroll").getBoundingClientRect());
  schedulePosSave();
}

/* 멀리 벗어난 페이지의 캔버스 회수 — 렌더된 페이지가 무한 누적되면 캔버스만
   페이지당 수 MB(dpr²·줌² 배)라 긴 논문에서 수백 MB까지 자란다. 텍스트 캐시
   (tc/index)는 가벼우니 남기고 캔버스·텍스트레이어만 접는다. 다시 다가오면
   IntersectionObserver가 재렌더한다(관찰 대상인 wrap 요소는 그대로라서). */
const UNRENDER_PX = 3000;
let gcLast = 0;
function gcFarPages(scRect) {
  const now = performance.now();
  if (now - gcLast < 500) return;
  gcLast = now;
  for (const st of S.pages) {
    if (!st.rendered) continue;
    const r = st.wrap.getBoundingClientRect();
    if (r.bottom < scRect.top - UNRENDER_PX || r.top > scRect.bottom + UNRENDER_PX) {
      st.rendered = false; st.rendering = null; st.textDivs = null; st.hlLayer = null;
      st.wrap.innerHTML = "";
      st.wrap.classList.add("page-ph");
      st.wrap.textContent = st.n;
    }
  }
}

async function getPageState(n) {
  const st = S.pages[n - 1];
  if (!st.page) st.page = await S.pdf.getPage(n);
  if (!st.tc) {
    st.tc = await st.page.getTextContent();
    st.raw = st.tc.items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join("");
    const v = st.page.getViewport({ scale: 1 });
    st.natW = v.width; st.natH = v.height;
    st.index = buildIndex(st.tc.items);
  }
  return st;
}

/* normalized index: lowercase, no whitespace/hyphens/soft chars, ligatures expanded.
   map[k] = {i, o} — source item index AND char offset within item.str, so a match
   can be highlighted at exact character bounds (not the whole textDiv). */
function buildIndex(items) {
  let norm = ""; const map = [];
  const drop = /[\s­​‐‑‒–—-]/;
  items.forEach((it, idx) => {
    const s = it.str;
    for (let o = 0; o < s.length; o++) {
      const ch = s[o].toLowerCase();
      if (drop.test(ch)) continue;
      const t = ch === "ﬁ" ? "fi" : ch === "ﬂ" ? "fl" : ch;
      for (const c of t) { norm += c; map.push({ i: idx, o }); }
    }
  });
  return { norm, map };
}
function normQuery(s) {
  return String(s).toLowerCase()
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl")
    .replace(/[\s­​‐‑‒–—-]/g, "");
}

async function renderPage(n) {
  const st = S.pages[n - 1];
  if (!st) return;
  if (st.rendered) return;
  if (st.rendering) return st.rendering;
  st.rendering = (async () => {
    await getPageState(n);
    const viewport = st.page.getViewport({ scale: S.scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const wrap = st.wrap;
    wrap.classList.remove("page-ph");
    wrap.textContent = "";
    sizeWrap(st);

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + "px";
    canvas.style.height = Math.floor(viewport.height) + "px";
    wrap.appendChild(canvas);
    // 숨겨진 탭에서는 rAF가 멎어 display 인텐트 렌더가 끝나지 않는다 → print 인텐트(setTimeout 스케줄링)
    await st.page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      intent: document.hidden ? "print" : "display",
    }).promise;

    const hlLayer = document.createElement("div");
    hlLayer.className = "hl-layer";
    wrap.appendChild(hlLayer);
    st.hlLayer = hlLayer;

    const tld = document.createElement("div");
    tld.className = "textLayer";
    wrap.appendChild(tld);
    const tl = new pdfjsLib.TextLayer({
      textContentSource: { items: st.tc.items, styles: st.tc.styles },
      container: tld, viewport,
    });
    await tl.render();
    const eoc = document.createElement("div");
    eoc.className = "endOfContent";
    tld.appendChild(eoc);
    st.textDivs = tl.textDivs;
    st.rendered = true;
    st.rendering = null;

    applyHighlights(st);
    applyCiteHotspots(st);
    if (n === 1) maybeThumb(canvas);
  })();
  return st.rendering;
}

/* ---------------------------------------------------------------- zoom */

function setZoom(mult) {
  const sc = $("pages-scroll");
  const ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
  S.scale = Math.min(2.6, Math.max(0.6, +(S.scale * mult).toFixed(2)));
  for (const st of S.pages) {
    st.rendered = false; st.rendering = null; st.textDivs = null; st.hlLayer = null;
    st.wrap.innerHTML = ""; st.wrap.classList.add("page-ph"); st.wrap.textContent = st.n;
    sizeWrap(st);
  }
  sc.scrollTop = ratio * sc.scrollHeight;
  const scRect = sc.getBoundingClientRect();
  for (const st of S.pages) {
    const r = st.wrap.getBoundingClientRect();
    if (r.bottom > scRect.top - 700 && r.top < scRect.bottom + 700) renderPage(st.n);
  }
}

/* ---------------------------------------------------------------- full extraction (text cache, refs, thumb) */

async function extractAll() {
  const p = S.current;
  const pdf = S.pdf, pages = S.pages;       // 로컬 고정 — 도중에 논문이 바뀌어도 이 논문 것만 다룬다
  const alive = () => S.current === p && S.pdf === pdf;
  $("thin-bar").classList.add("on");
  try {
    for (let i = 1; i <= pdf.numPages; i++) { await getPageState(i); if (!alive()) return; }
    S.textReady = true;
    parseRefsClient();
    renderRefsPane();
    if (!p.has_text || p.text_provisional) {   // pypdf 임시본은 pdf.js 정본으로 교체
      let title = p.title;
      /* PDF 내부 Title은 조판 아티팩트("RSC_CS_xxx 3..26")가 흔하다 — Zotero 유래 제목은 안 건드린다 */
      if (!p.zotero_key && !p.citekey) {
        try {
          const meta = await pdf.getMetadata();
          const t = (meta?.info?.Title || "").trim();
          if (t && t.length > 6) title = t;
        } catch { /* metadata optional */ }
      }
      if (!alive()) return;                 // PUT은 이 논문 pages로만 — 다른 논문 레코드 오염 방지
      await pj(`/api/papers/${p.id}/text`, {
        title, pages: pages.map((st) => ({ n: st.n, text: st.raw })),
      }, "PUT");
      p.has_text = true;
      p.text_provisional = false;
      if (title !== p.title) { p.title = title; $("rd-title").textContent = title; }
    }
    buildOutline();             // pdf.js 북마크 → 목차 패널
    checkScanned();             // 추출이 거의 비면 스캔 PDF 배너 (시각 추출 제안)
    placeGlossary();            // 용어집이 먼저 로드돼 있으면 이제 본문 밑줄 배치
    /* 마인드맵 앵커는 페이지 색인이 있어야 맞춘다 — 지도를 먼저 열어뒀다면 지금 다시 그린다 */
    if (S.mm.nodes) { placeMindmap(); if (S.view === "map") renderMindmapWell(); }
    if (!p.meta_ai && !p.authors?.length) {   // 서지정보 1회 추출 (haiku) — 서가·내보내기용
      pj(`/api/papers/${p.id}/metadata`, {})
        .then((m) => { if (m && S.current === p) Object.assign(p, m); })
        .catch(() => { /* best-effort */ });
    }
  } catch (e) {
    toast("본문 추출 실패: " + e.message, true);
  } finally {
    $("thin-bar").classList.remove("on");
  }
}

async function maybeThumb(canvas) {
  const p = S.current;
  if (!p || p.has_thumb) return;
  try {
    const w = 360, h = Math.round((canvas.height / canvas.width) * w);
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    off.getContext("2d").drawImage(canvas, 0, 0, w, h);
    const blob = await new Promise((res) => off.toBlob(res, "image/jpeg", 0.72));
    if (!blob) return;
    await api(`/api/papers/${p.id}/thumb`, { method: "PUT", body: blob });
    p.has_thumb = true;
  } catch { /* thumbnail is best-effort */ }
}

/* ---------------------------------------------------------------- selection popover */

const SEL_ACTIONS = [
  { id: "translate", label: "번역", icon: "translate" },
  { id: "explain", label: "설명", icon: "sparkle" },
  { id: "figure", label: "그림·표", icon: "fig" },
  { id: "hl", label: "강조", icon: "marker" },
  { id: "note", label: "노트", icon: "note" },
  { id: "quote", label: "채팅 인용", icon: "quote" },
];

function initSelPop() {
  const pop = $("sel-pop");
  pop.innerHTML = SEL_ACTIONS.map((a, i) =>
    (i === 3 ? '<div class="sp-sep"></div>' : "") +
    `<button data-act="${a.id}" role="menuitem">${icon(a.icon, 15)}${a.label}</button>`).join("");
  pop.querySelectorAll("button").forEach((b) => {
    b.onclick = () => runSelAction(b.dataset.act);
  });

  document.addEventListener("pointerup", (e) => {
    if (pop.contains(e.target) || $("cite-pop").contains(e.target)) return;
    setTimeout(() => {
      const sel = getSelection();
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      if (text.length < 2) { hideSelPop(); return; }
      const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const wrap = node?.closest?.(".page-wrap");
      if (!wrap) { hideSelPop(); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      S.sel = { text, page: +wrap.dataset.n, rect };
      showSelPop(rect);
    }, 0);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hideSelPop(true); hideCitePop(true); $("scrim").classList.remove("show"); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!pop.contains(e.target)) hideSelPop();
    // sticky 결과 카드는 ×/Esc 로만 닫는다 — 논문 읽으며 클릭해도 안 사라지게
    if (!$("cite-pop").contains(e.target) && !$("cite-pop").dataset.sticky) hideCitePop();
  });
  new MutationObserver(ensureCiteChrome).observe($("cite-pop"), { childList: true });
  /* 사용자가 카드 모서리를 끌어 크기를 바꾸면 × 버튼·드래그 손잡이 좌표가 어긋난다.
     body 직속 크롬이라 자동으로 안 따라오므로 관측해서 다시 맞추고, 커진 카드가
     화면 밖으로 나가면 안쪽으로 되민다. */
  new ResizeObserver(() => {
    const p = $("cite-pop");
    if (!p.dataset.sticky || !p.classList.contains("show")) return;
    const m = 8;
    const L = Math.max(m, Math.min(innerWidth - p.offsetWidth - m, parseFloat(p.style.left) || 0));
    const T = Math.max(56, Math.min(innerHeight - p.offsetHeight - m, parseFloat(p.style.top) || 0));
    p.style.left = L + "px"; p.style.top = T + "px";
    ensureCiteChrome();
  }).observe($("cite-pop"));
  /* 보험: 네이티브 리사이즈는 언제나 pointerup 으로 끝난다. ResizeObserver 가 (창이 그리지
     않는 상황 등에서) 늦거나 안 오더라도 손을 떼는 순간 좌표를 맞춘다. */
  document.addEventListener("pointerup", () => {
    if ($("cite-pop").dataset.sticky) ensureCiteChrome();
  });
}

function showSelPop(rect) {
  const pop = $("sel-pop");
  pop.classList.add("show");
  const w = pop.offsetWidth, pad = 8;
  let x = rect.left + rect.width / 2;
  x = Math.max(w / 2 + pad, Math.min(innerWidth - w / 2 - pad, x));
  let y = rect.top - 10;
  let below = false;
  if (y - pop.offsetHeight < 60) { y = rect.bottom + 10; below = true; }
  pop.style.left = x + "px"; pop.style.top = y + "px";
  pop.style.transformOrigin = below ? "center top" : "center bottom";
  const base = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
  pop.style.transform = `${base} scale(0.96)`;
  pop.style.opacity = "0";
  anim(pop, { transform: `${base} scale(1)`, opacity: 1 }, { type: "spring", duration: 0.25, bounce: 0 });
}
function hideSelPop(instant = false) {
  const pop = $("sel-pop");
  if (!pop.classList.contains("show")) return;
  if (instant || REDUCED) { pop.classList.remove("show"); return; }
  anim(pop, { opacity: 0 }, { duration: 0.12, ease: "ease-out" });
  setTimeout(() => { pop.classList.remove("show"); pop.style.opacity = "1"; }, 130);
}

async function runSelAction(act) {
  const sel = S.sel;
  if (!sel) return;
  hideSelPop(true);
  if (act === "translate" || act === "explain") return aiSelection(act, sel);
  if (act === "figure") return aiFigure(sel);
  if (act === "hl") return addManualHighlight(sel);
  if (act === "note") return addNote(sel);
  if (act === "quote") {
    S.chatQuote = sel.text;
    setTab("chat"); renderChatQuote(); $("chat-ta").focus();
  }
}

/* AI popover: anchored result card near the selection (achird's instant answer) */
let citeToken = 0;
/* 결과 카드 이동 — 손잡이는 body 직속이라 카드 내부 스크롤과 무관하게 항상 상단에 있다.
   pointer capture 로 커서가 카드 밖으로 나가도 드래그가 끊기지 않는다. */
function initCiteDrag(bar) {
  let dx = 0, dy = 0, on = false;
  bar.addEventListener("pointerdown", (e) => {
    const pop = $("cite-pop");
    if (!pop.dataset.sticky) return;
    on = true;
    dx = e.clientX - (parseFloat(pop.style.left) || 0);
    dy = e.clientY - (parseFloat(pop.style.top) || 0);
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("grabbing");
    e.preventDefault();            // 드래그 중 텍스트 선택 방지
  });
  bar.addEventListener("pointermove", (e) => {
    if (!on) return;
    const pop = $("cite-pop"), m = 8;
    const L = Math.max(m, Math.min(innerWidth - pop.offsetWidth - m, e.clientX - dx));
    const T = Math.max(m, Math.min(innerHeight - 40, e.clientY - dy));
    pop.style.left = L + "px"; pop.style.top = T + "px";
    ensureCiteChrome();
  });
  const end = (e) => {
    if (!on) return;
    on = false;
    bar.classList.remove("grabbing");
    try { bar.releasePointerCapture(e.pointerId); } catch {}
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
}
/* sticky 결과 카드의 × 버튼과 드래그 손잡이 — 각 호출부가 결과를 pop.innerHTML 로 통째 교체하므로
   지워진다. 자식 변화를 감시해 다시 꽂는다(호출부 수정 없이). */
function ensureCiteChrome() {
  const pop = $("cite-pop");
  let b = document.getElementById("cite-close");
  if (!b) {
    b = document.createElement("button");
    b.id = "cite-close";
    b.className = "cp-close";
    b.type = "button";
    b.setAttribute("aria-label", "닫기");
    b.innerHTML = icon("x", 14);
    b.onclick = () => hideCitePop();
    document.body.appendChild(b);
  }
  let d = document.getElementById("cite-drag");
  if (!d) {
    d = document.createElement("div");
    d.id = "cite-drag";
    d.className = "cp-drag";
    d.innerHTML = '<span class="cp-grip"></span>';
    d.title = "드래그해서 옮기기";
    initCiteDrag(d);
    document.body.appendChild(d);
  }
  /* 카드 안에 두면 backdrop-filter·transform 때문에 카드가 컨테이닝 블록이 돼
     내용과 함께 스크롤돼 사라진다. body 직속으로 두고 카드 모서리에 좌표만 맞춘다. */
  if (!pop.dataset.sticky || !pop.classList.contains("show")) {
    b.classList.remove("show"); d.classList.remove("show"); return;
  }
  const L = parseFloat(pop.style.left) || 0, T = parseFloat(pop.style.top) || 0, W = pop.offsetWidth;
  d.style.left = L + "px"; d.style.top = T + "px";
  d.style.width = Math.max(0, W - 34) + "px";     // × 버튼 자리 비움
  b.style.left = (L + W - 30) + "px";
  b.style.top = (T + 4) + "px";
  d.classList.add("show"); b.classList.add("show");
}
function popShell(rect, html, opts = {}) {
  const pop = $("cite-pop");
  pop.innerHTML = html;
  pop.classList.add("show");
  if (opts.sticky) pop.dataset.sticky = "1"; else delete pop.dataset.sticky;
  /* 크기는 CSS 가 잡는다(sticky 는 resize:both). 직전 카드에서 사용자가 늘려둔
     인라인 width/height 를 지워 새 카드는 항상 기본 크기로 연다. */
  pop.style.width = ""; pop.style.height = "";
  const pad = 10;
  let x = Math.max(pad, Math.min(innerWidth - pop.offsetWidth - pad, rect.left + rect.width / 2 - pop.offsetWidth / 2));
  let y = rect.bottom + 10;
  if (y + pop.offsetHeight > innerHeight - pad) y = Math.max(60, rect.top - pop.offsetHeight - 10);
  pop.style.left = x + "px"; pop.style.top = y + "px";
  pop.style.transformOrigin = "center top";
  pop.style.transform = "scale(0.97)"; pop.style.opacity = "0";
  anim(pop, { transform: "scale(1)", opacity: 1 }, { type: "spring", duration: 0.28, bounce: 0 });
  ensureCiteChrome();
  return pop;
}
function hideCitePop(instant = false) {
  const pop = $("cite-pop");
  if (!pop.classList.contains("show")) return;
  delete pop.dataset.sticky;
  document.getElementById("cite-close")?.classList.remove("show");
  document.getElementById("cite-drag")?.classList.remove("show");
  if (instant || REDUCED) { pop.classList.remove("show"); return; }
  anim(pop, { opacity: 0 }, { duration: 0.12, ease: "ease-out" });
  setTimeout(() => { pop.classList.remove("show"); pop.style.opacity = "1"; }, 130);
}

/* AI 결과 카드 공통 렌더: 제목줄 + 본문 + "노트로 저장". save()가 노트 POST 페이로드를 소유한다. */
function aiResultCard(pop, iconName, label, bodyHtml, save) {
  pop.innerHTML = `
    <div class="res-kind" style="font-size:.6875rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-text);margin-bottom:.4rem;">${icon(iconName, 12)} ${label}</div>
    <div class="prose">${bodyHtml}</div>
    <div style="display:flex;gap:.4rem;margin-top:.6rem;">
      <button class="btn pressable" data-save>노트로 저장</button>
    </div>`;
  pop.querySelector("[data-save]").onclick = async () => {
    try { await save(); toast("노트에 저장됨"); loadNotes(); }
    catch (e) { toast(e.message, true); }
  };
}

async function aiSelection(action, sel) {
  const token = ++citeToken;
  const kind = action === "translate" ? "번역" : "설명";
  const pop = popShell(sel.rect, "", { sticky: true });
  pop.appendChild(starInline(`${kind} 중…`));
  if (!busyState.raf && !REDUCED) busyState.raf = requestAnimationFrame(starTick);
  busyState.count++;
  try {
    const st = S.pages[sel.page - 1];
    const r = await pj("/api/ai/selection", {
      paper_id: S.current.id, action, text: sel.text.slice(0, 4000),
      context: (st?.raw || "").slice(0, 6000), title: S.current.title,
    });
    if (token !== citeToken) return;
    aiResultCard(pop, "sparkle", kind, md(r.result), () =>
      pj(`/api/papers/${S.current.id}/notes`, { page: sel.page, quote: sel.text, memo: `[${kind}] ${r.result}` }));
  } catch (e) {
    if (token === citeToken) pop.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">${kind} 실패 — ${esc(e.message)}</div>`;
  } finally {
    busyState.count = Math.max(0, busyState.count - 1);
  }
}

/* ---------------------------------------------------------------- vision (그림·표 해설 · 스캔 전사)
   pdf.js가 렌더한 페이지를 이미지로 만들어 서버로 보내면 claude CLI가 Read 도구로
   '눈으로' 읽는다. 텍스트 추출이 잃어버리는 것(그림·표·스캔본)을 이 경로가 커버한다. */

async function pageImageBlob(n, scale = 2) {
  const st = await getPageState(n);
  const viewport = st.page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.floor(viewport.width);
  c.height = Math.floor(viewport.height);
  await st.page.render({ canvasContext: c.getContext("2d", { alpha: false }), viewport,
    intent: document.hidden ? "print" : "display" }).promise;
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
}

async function aiFigure(sel) {
  const token = ++citeToken;
  const pop = popShell(sel.rect, "", { sticky: true });
  pop.appendChild(starInline("그림 읽는 중… (페이지 시각 분석, ~1분)"));
  if (!busyState.raf && !REDUCED) busyState.raf = requestAnimationFrame(starTick);
  busyState.count++;
  try {
    const blob = await pageImageBlob(sel.page);
    const fd = new FormData();
    fd.append("n", String(sel.page));
    fd.append("hint", sel.text.slice(0, 200));
    fd.append("image", blob, "page.jpg");
    const r = await api(`/api/papers/${S.current.id}/figure`, { method: "POST", body: fd });
    invalidateFigs(S.current?.id);
    if (token !== citeToken) return;
    aiResultCard(pop, "fig", "그림·표 설명", md(r.markdown), () =>
      pj(`/api/papers/${S.current.id}/notes`,
        { page: sel.page, quote: sel.text, memo: `[그림·표] ${r.markdown}` }));
  } catch (e) {
    if (token === citeToken) pop.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">그림 설명 실패 — ${esc(e.message)}</div>`;
  } finally {
    busyState.count = Math.max(0, busyState.count - 1);
  }
}

/* ---- 그림 영역 드래그 캡처: 페이지 전체 대신 사용자가 지정한 영역만 잘라 보내면
   그림이 여러 개인 페이지에서도 원하는 것만 정확히 짚을 수 있다. 드래그가 끝나면
   그림 해설/수식 변환 중 무엇을 보낼지 작은 선택지를 먼저 띄운다. ---- */

let capDrag = null;   // 진행 중 드래그 {wrap, n, x0, y0, el}

function toggleCapture() {
  S.capOn = !S.capOn;
  $("cap-btn").classList.toggle("on", S.capOn);
  $("pages-scroll").classList.toggle("capturing", S.capOn);
  if (S.capOn) toast("그림·표 영역을 드래그하세요 (Esc 취소)");
  else if (capDrag) { capDrag.el.remove(); capDrag = null; }   // 진행 중 드래그 정리
}

function initCapture() {
  const pages = $("pages");
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  pages.addEventListener("pointerdown", (e) => {
    if (!S.capOn) return;
    const wrap = e.target.closest(".page-wrap");
    if (!wrap) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const x0 = clamp(e.clientX - r.left, r.width), y0 = clamp(e.clientY - r.top, r.height);
    const el = document.createElement("div");
    el.className = "cap-rect";
    el.style.left = x0 + "px"; el.style.top = y0 + "px"; el.style.width = "0px"; el.style.height = "0px";
    wrap.appendChild(el);
    capDrag = { wrap, n: +wrap.dataset.n, x0, y0, el };
    wrap.setPointerCapture?.(e.pointerId);
  });
  pages.addEventListener("pointermove", (e) => {
    if (!capDrag) return;
    const r = capDrag.wrap.getBoundingClientRect();
    const x1 = clamp(e.clientX - r.left, r.width), y1 = clamp(e.clientY - r.top, r.height);
    Object.assign(capDrag.el.style, {
      left: Math.min(capDrag.x0, x1) + "px", top: Math.min(capDrag.y0, y1) + "px",
      width: Math.abs(x1 - capDrag.x0) + "px", height: Math.abs(y1 - capDrag.y0) + "px",
    });
  });
  pages.addEventListener("pointerup", () => {
    if (!capDrag) return;
    const { wrap, n, el } = capDrag;
    const rect = { x: parseFloat(el.style.left), y: parseFloat(el.style.top),
                   w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
    const ok = rect.w >= 24 && rect.h >= 24;
    toggleCapture();                          // 성공·취소 모두 모드 종료(+ .cap-rect 정리)
    if (ok) showCaptureChooser(n, wrap, rect);
  });
}

/* 캡처 영역의 뷰포트 좌표 — popShell 앵커링에 재사용(선택지·그림·수식 결과 팝오버 공통) */
function regionAnchorRect(wrap, r) {
  const wrapRect = wrap.getBoundingClientRect();
  return { left: wrapRect.left + r.x, top: wrapRect.top + r.y,
           bottom: wrapRect.top + r.y + r.h, width: r.w };
}

/* 캡처 영역만 잘라낸 이미지 Blob — captureRegion·captureFormula 공용 크롭 로직 */
async function cropRegionBlob(n, rx, ry, rw, rh) {
  const pageBlob = await pageImageBlob(n, 2);
  const bmp = await createImageBitmap(pageBlob);
  const sx = Math.round(rx * bmp.width), sy = Math.round(ry * bmp.height);
  const sw = Math.round(rw * bmp.width), sh = Math.round(rh * bmp.height);
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  c.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close?.();
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
}

/* 드래그 완료 → 그림 해설/수식 변환 중 선택. Esc·클릭-밖은 기존 cite-pop 전역 핸들러(initSelPop)가
   그대로 닫아준다 — 이 단계에서는 아직 아무 요청도 보내지 않았으니 그냥 닫히는 것 자체가 취소다. */
function showCaptureChooser(n, wrap, r) {
  const rect = regionAnchorRect(wrap, r);
  const pop = popShell(rect, `<div class="row-actions" style="margin-bottom:0;">
      <button class="btn pressable" data-go="fig">${icon("fig", 15)} 그림 해설</button>
      <button class="btn pressable" data-go="formula">${icon("formula", 15)} 수식 변환</button>
    </div>`);
  pop.querySelector('[data-go="fig"]').onclick = () => captureRegion(n, wrap, r);
  pop.querySelector('[data-go="formula"]').onclick = () => captureFormula(n, wrap, r);
}

async function captureRegion(n, wrap, r) {
  const paperId = S.current.id;
  const rx = r.x / wrap.offsetWidth, ry = r.y / wrap.offsetHeight;
  const rw = r.w / wrap.offsetWidth, rh = r.h / wrap.offsetHeight;
  const rect = regionAnchorRect(wrap, r);
  const token = ++citeToken;
  const pop = popShell(rect, "", { sticky: true });
  pop.appendChild(starInline("그림 읽는 중… (~40초)"));
  const done = busy("그림 캡처 분석");
  try {
    const blob = await cropRegionBlob(n, rx, ry, rw, rh);
    const fd = new FormData();
    fd.append("n", String(n));
    fd.append("hint", "");
    fd.append("region", `${rx.toFixed(4)},${ry.toFixed(4)},${rw.toFixed(4)},${rh.toFixed(4)}`);
    fd.append("image", blob, "region.jpg");
    const res = await api(`/api/papers/${paperId}/figure`, { method: "POST", body: fd });
    invalidateFigs(paperId);
    if (S.current?.id !== paperId || token !== citeToken) return;
    aiResultCard(pop, "fig", "그림·표 설명", md(res.markdown), () =>
      pj(`/api/papers/${paperId}/notes`,
        { page: n, quote: `[그림 캡처] ${n}쪽`, memo: `[그림·표] ${res.markdown}` }));
  } catch (e) {
    if (S.current?.id === paperId && token === citeToken)
      pop.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">그림 캡처 실패 — ${esc(e.message)}</div>`;
  } finally {
    done();
  }
}

/* 수식 캡처: /figure와 같은 크롭·폼필드 흐름이지만 결과가 markdown 한 덩어리가 아니라
   latex/explain으로 나뉜다. LaTeX는 타이프셋하지 않고(별도 의존성 없음) 모노스페이스 그대로 보여준다. */
async function captureFormula(n, wrap, r) {
  const paperId = S.current.id;
  const rx = r.x / wrap.offsetWidth, ry = r.y / wrap.offsetHeight;
  const rw = r.w / wrap.offsetWidth, rh = r.h / wrap.offsetHeight;
  const rect = regionAnchorRect(wrap, r);
  const token = ++citeToken;
  const pop = popShell(rect, "", { sticky: true });
  pop.appendChild(starInline("수식 읽는 중… (~40초)"));
  const done = busy("수식 캡처 분석");
  try {
    const blob = await cropRegionBlob(n, rx, ry, rw, rh);
    const fd = new FormData();
    fd.append("n", String(n));
    fd.append("hint", "");
    fd.append("region", `${rx.toFixed(4)},${ry.toFixed(4)},${rw.toFixed(4)},${rh.toFixed(4)}`);
    fd.append("image", blob, "region.jpg");
    const res = await api(`/api/papers/${paperId}/formula`, { method: "POST", body: fd });
    invalidateFormulas(paperId);
    if (S.current?.id !== paperId || token !== citeToken) return;
    pop.innerHTML = `
      <div class="res-kind" style="font-size:.6875rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-text);margin-bottom:.4rem;">${icon("formula", 12)} 수식 변환</div>
      <pre class="formula-tex">${esc(res.latex)}</pre>
      <div class="row-actions" style="margin-bottom:.6rem;">
        <button class="btn pressable" data-copy-tex>${icon("copy", 13)} LaTeX 복사</button>
      </div>
      <div class="prose">${md(res.explain)}</div>`;
    pop.querySelector("[data-copy-tex]").onclick = () => copyText(res.latex, "LaTeX 복사됨");
  } catch (e) {
    if (S.current?.id === paperId && token === citeToken)
      pop.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">수식 캡처 실패 — ${esc(e.message)}</div>`;
  } finally {
    done();
  }
}

/* ---- 스캔 PDF 폴백: 추출 텍스트가 거의 없으면 배너 → 페이지별 시각 전사로 text.json 백필 ---- */

const SCAN_SPARSE = 150;   // 페이지 평균 추출 글자 수가 이보다 적으면 스캔본으로 판단

async function checkScanned() {
  if (!S.pages.length) return;
  const avg = S.pages.reduce((a, st) => a + (st.raw?.length || 0), 0) / S.pages.length;
  if (avg >= SCAN_SPARSE) return;
  try {   // 이전에 시각 추출을 이미 끝냈다면(서버 텍스트가 충분) 조용히 통과
    const t = await api(`/api/papers/${S.current.id}/text`);
    const savg = t.pages.reduce((a, p) => a + (p.text || "").length, 0) / Math.max(1, t.pages.length);
    if (savg >= SCAN_SPARSE) return;
  } catch { /* text.json 없음 — 방금 PUT한 희박본뿐 */ }
  renderScanBanner();
  $("scan-banner").hidden = false;
}

function renderScanBanner() {
  const b = $("scan-banner");
  if (S.scan.running) {
    b.innerHTML = `<span class="sb-msg"></span><span class="sb-spacer"></span>
      <button class="btn pressable" data-stop>${icon("x", 13)} 중지</button>`;
    b.querySelector(".sb-msg").appendChild(starInline(`AI 시각 추출 중… ${S.scan.done}/${S.scan.todo}쪽`));
    b.querySelector("[data-stop]").onclick = (e) => {
      S.scan.stop = true; e.currentTarget.disabled = true;
    };
  } else {
    const sparse = S.pages.filter((st) => (st.raw?.length || 0) < SCAN_SPARSE).length;
    b.innerHTML = `<span class="sb-msg">스캔 PDF로 보입니다 — 텍스트가 없어 번역·요약·채팅이 비게 됩니다.
        AI가 페이지를 눈으로 읽어 텍스트를 복원할 수 있습니다 (쪽당 ~30초).</span>
      <span class="sb-spacer"></span>
      <button class="btn primary pressable" data-run>시각 추출 (${sparse}쪽)</button>
      <button class="btn pressable" data-close>닫기</button>`;
    b.querySelector("[data-run]").onclick = () =>
      runVisionExtract(S.pages.filter((st) => (st.raw?.length || 0) < SCAN_SPARSE).map((st) => st.n));
    b.querySelector("[data-close]").onclick = () => { b.hidden = true; };
  }
}

async function runVisionExtract(list) {
  if (S.scan.running || !list.length) return;
  const paperId = S.current.id;
  const SC = S.scan;
  SC.running = true; SC.stop = false; SC.done = 0; SC.todo = list.length;
  renderScanBanner();
  const doneBusy = busy(`시각 추출 0/${list.length}`);
  const alive = () => S.current?.id === paperId && S.scan === SC;
  let idx = 0;
  const worker = async () => {
    while (!SC.stop && idx < list.length) {
      const n = list[idx++];
      try {
        const blob = await pageImageBlob(n);
        const fd = new FormData();
        fd.append("n", String(n));
        fd.append("image", blob, "page.jpg");
        const r = await api(`/api/papers/${paperId}/vision-text`, { method: "POST", body: fd });
        if (alive()) S.pages[n - 1].raw = r.text;   // 채팅 컨텍스트·참고문헌 파싱용 (하이라이트는 원리상 불가)
      } catch (e) { toast(`${n}쪽 시각 추출 실패: ${e.message}`, true); }
      SC.done++;
      $("busy-label").textContent = `시각 추출 ${SC.done}/${SC.todo}`;
      if (alive()) renderScanBanner();
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, list.length) }, worker));
  SC.running = false;
  doneBusy();
  if (!alive()) return;
  if (SC.stop) {
    toast("시각 추출을 중지했습니다");
    renderScanBanner();
  } else {
    $("scan-banner").hidden = true;
    toast("시각 추출 완료 — 번역·요약·채팅·용어집을 쓸 수 있습니다");
    parseRefsClient(); renderRefsPane();
  }
}

/* ---- 근접 중복: 업로드는 sha256 완전일치만 막는다. 같은 논문의 프리프린트본·재다운로드본은
   바이트가 달라 그물을 빠져나간다. 여기서 DOI·제목으로 한 번 더 보되 **막지는 않는다** —
   오탐으로 진짜 새 논문을 거절하는 손해가 중복 한 편이 남는 손해보다 크다. ---- */

async function checkDupes() {
  const banner = $("dup-banner");
  const pid = S.current.id;
  banner.hidden = true;
  let items = [];
  try { items = (await api(`/api/papers/${pid}/dupes`)).items || []; } catch { return; }
  if (!items.length || S.current?.id !== pid) return;
  banner.innerHTML = `<span>${icon("book", 15)} 서재에 같은 논문이 있을 수 있습니다 — ` +
    items.slice(0, 3).map((d) =>
      `<button class="ev-cite" data-id="${esc(d.pid)}">${esc(d.title)}</button>` +
      `<span class="ev-memo"> (${d.why === "doi" ? "DOI 일치" : "제목 일치"})</span>`).join(", ") +
    `</span><button class="fb-btn" id="dup-x" title="닫기" aria-label="닫기">${icon("x", 13)}</button>`;
  banner.hidden = false;
  wireOpenButtons(banner);
  $("dup-x").onclick = () => { banner.hidden = true; };
}

/* ---------------------------------------------------------------- 목차 (pdf.js 북마크) */

function buildOutline() {
  S.outline = null; renderTocPane();
  (async () => {
    try {
      const raw = await S.pdf.getOutline();
      const flat = [];
      const walk = async (nodes, depth) => {
        for (const nd of nodes || []) {
          let page = null;
          try {
            let dest = nd.dest;
            if (typeof dest === "string") dest = await S.pdf.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) page = (await S.pdf.getPageIndex(dest[0])) + 1;
          } catch { /* 목적지 해석 실패 → 점프 불가(제목만 표시) */ }
          flat.push({ title: (nd.title || "").trim(), page, depth });
          if (nd.items?.length) await walk(nd.items, depth + 1);
        }
      };
      await walk(raw, 0);
      S.outline = flat;
    } catch { S.outline = []; }
    renderTocPane();
  })();
}

function renderTocPane() {
  const pane = $("ipane-toc");
  if (!pane) return;
  if (S.outline === null) { pane.innerHTML = `<div class="ipane-hint">${icon("toc", 28)}<br>목차 불러오는 중…</div>`; return; }
  if (!S.outline.length) {
    pane.innerHTML = `<div class="ipane-hint">${icon("toc", 28)}<br>이 PDF에는 목차(북마크) 정보가 없습니다.<br>상단 쪽 번호를 눌러 원하는 쪽으로 이동할 수 있어요.</div>`;
    return;
  }
  pane.innerHTML = S.outline.map((o, i) =>
    `<button class="toc-item${o.page ? "" : " nodest"}" data-i="${i}" style="padding-left:${0.7 + o.depth * 0.9}rem;">
       <span class="toc-t">${esc(o.title)}</span>${o.page ? `<span class="toc-p">${o.page}</span>` : ""}
     </button>`).join("");
  pane.querySelectorAll(".toc-item").forEach((b) => {
    b.onclick = () => { const o = S.outline[+b.dataset.i]; if (o.page) gotoPage(o.page); };
  });
}

/* ---------------------------------------------------------------- 용어집 (전문용어·약어) */

function renderGlossaryPane() {
  const pane = $("ipane-term");
  if (!pane) return;
  const has = S.gloss.items?.length;
  let html = `<div class="row-actions"><button class="btn primary pressable" id="gloss-btn">${icon("sparkle", 14)} ${S.gloss.items ? "다시 추출" : "용어집 생성"}</button></div>`;
  if (has) {
    html += S.gloss.items.map((g, i) => `
      <div class="gloss-card" data-i="${i}" title="원문에서 '${esc(g.term)}' 찾기">
        <div class="gloss-term">${esc(g.term)}<span class="gloss-ko">${g.ko ? esc(g.ko) : "역어 없음"}</span><button class="gko-edit" data-e="${i}" title="역어 수정 — 이후 번역·재번역에 반영">${icon("pencil", 12)}</button></div>
        <div class="gloss-def">${esc(g.def)}</div>
      </div>`).join("");
  } else if (S.gloss.items) {
    html += `<div class="ipane-hint">${icon("term", 26)}<br>추출된 전문용어가 없습니다.</div>`;
  } else {
    html += `<div class="ipane-hint">${icon("term", 28)}<br>논문의 전문용어·약어를 모아 정리합니다.<br>항목 클릭 → 원문에서 찾기 · 본문 첫 등장엔 점선 밑줄(올려두면 뜻).</div>`;
  }
  pane.innerHTML = html;
  $("gloss-btn").onclick = () => makeGlossary(!!S.gloss.items);
  pane.querySelectorAll(".gloss-card").forEach((c) => {
    c.onclick = (e) => {
      if (e.target.closest(".gko-edit, .gko-in")) return;
      const g = S.gloss.items[+c.dataset.i];
      openFind();
      $("find-in").value = g.term;      // 검색 인프라 재사용 → 첫 등장 점프 + 전체 하이라이트 + 순회
      runFind(g.term);
    };
  });
  pane.querySelectorAll(".gko-edit").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = +btn.dataset.e, g = S.gloss.items[i];
      const span = btn.closest(".gloss-card").querySelector(".gloss-ko");
      const inp = document.createElement("input");
      inp.className = "gko-in";
      inp.value = g.ko || "";
      span.replaceWith(inp);
      btn.hidden = true;
      inp.focus(); inp.select();
      let escaped = false, closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        if (!escaped && inp.value.trim() !== (g.ko || "")) saveGlossKo(i, inp.value);
        else renderGlossaryPane();
      };
      inp.onclick = (ev) => ev.stopPropagation();
      inp.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") inp.blur();
        else if (ev.key === "Escape") { escaped = true; inp.blur(); }
      };
      inp.onblur = finish;
    };
  });
}

async function saveGlossKo(i, ko) {
  const paperId = S.current.id;
  S.gloss.items[i].ko = ko.trim();
  renderGlossaryPane();
  try {
    await pj(`/api/papers/${paperId}/glossary`, { items: S.gloss.items }, "PUT");
    if (S.current?.id === paperId) toast("역어 저장됨 — 이후 번역·재번역에 적용");
  } catch (e) { toast("역어 저장 실패: " + e.message, true); }
}

async function makeGlossary(force = false) {
  if (S.gloss.running) return;
  if (!S.textReady && !S.current.has_text) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
  const paperId = S.current.id;            // 응답이 늦게 와도 다른 논문 상태에 덮어쓰지 않게
  S.gloss.running = true;
  const done = busy("용어집 생성 중");
  try {
    let r = force ? null : await api(`/api/papers/${paperId}/glossary`).catch(() => null);
    if (!r || !r.items) r = await pj(`/api/papers/${paperId}/glossary`, force ? { force: true } : {});
    if (S.current?.id !== paperId) return;
    S.gloss.items = r.items || [];
    renderGlossaryPane();
    toast(`용어 ${S.gloss.items.length}개를 정리했습니다`);
  } catch (e) {
    if (S.current?.id === paperId) toast("용어집 실패: " + e.message, true);
  } finally { if (S.current?.id === paperId) S.gloss.running = false; done(); }
  if (S.current?.id === paperId && S.gloss.items) {
    S.gloss.placed = null;                  // (재)생성 → 본문 밑줄 재배치
    placeGlossary();
    reapplyAllHighlights();                 // placed가 비어도 이전 밑줄 제거
  }
}

/* ---- 본문 용어 밑줄: 첫 등장에 점선, hover로 정의 (cite-hot 패턴 재사용) ---- */

/* 짧은 약어(MT 등)는 정규화 인덱스에서 단어 경계가 사라져 오탐한다("amount"의 mt) →
   raw 텍스트에서 경계 정규식으로 찾고, 접두부 정규화 길이로 norm 위치로 변환한다.
   (buildIndex와 normQuery의 정규화 규칙이 동일해 길이가 곧 인덱스다) */
function locateTerm(term) {
  let re;
  try {
    re = new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`);
  } catch { return locate(term); }
  for (const st of S.pages) {
    if (!st.raw || !st.index) continue;
    const m = re.exec(st.raw);
    if (!m) continue;
    const a = normQuery(st.raw.slice(0, m.index)).length;
    const len = normQuery(m[0]).length;
    if (!len) continue;
    const aPos = st.index.map[a], bPos = st.index.map[a + len - 1];
    if (aPos && bPos) return { page: st.n, a: aPos, b: bPos };
  }
  return locate(term);   // 하이픈 개행 등으로 raw 매칭 실패 시 폴백 (6자 이상만)
}

function placeGlossary() {
  if (!S.textReady || !S.gloss.items?.length || S.gloss.placed) return;
  const placed = [];
  S.gloss.items.forEach((g, i) => {
    const loc = locateTerm(g.term);
    if (loc) placed.push({ i, page: loc.page, a: loc.a, b: loc.b });
  });
  S.gloss.placed = placed;
  if (placed.length) reapplyAllHighlights();
}

function applyTermHots(st) {
  st.wrap.querySelectorAll(".term-hot").forEach((e) => e.remove());
  if (!st.rendered || !st.textDivs || !S.gloss.placed?.length) return;
  for (const p of S.gloss.placed) {
    if (p.page !== st.n) continue;
    for (const r of rectsForSpan(st, p.a, p.b)) {
      const el = document.createElement("div");
      el.className = "term-hot";
      el.dataset.gi = p.i;
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
      st.wrap.appendChild(el);
    }
  }
}

let termTipEl = null;
function showTermTip(hot) {
  const g = S.gloss.items?.[+hot.dataset.gi];
  if (!g) return;
  if (!termTipEl) {
    termTipEl = document.createElement("div");
    termTipEl.className = "term-tip";
    document.body.appendChild(termTipEl);
  }
  termTipEl.innerHTML = `<b>${esc(g.term)}</b>${g.ko ? `<span class="tt-ko">${esc(g.ko)}</span>` : ""}` +
    (g.def ? `<div class="tt-def">${esc(g.def)}</div>` : "");
  termTipEl.style.display = "block";
  const r = hot.getBoundingClientRect();
  const w = termTipEl.offsetWidth, h = termTipEl.offsetHeight, pad = 8;
  const x = Math.max(pad, Math.min(innerWidth - w - pad, r.left + r.width / 2 - w / 2));
  let y = r.top - h - 8;
  if (y < 52) y = r.bottom + 8;              // 상단바에 가리면 아래로
  termTipEl.style.left = x + "px";
  termTipEl.style.top = y + "px";
}
function hideTermTip() { if (termTipEl) termTipEl.style.display = "none"; }

function initTermHover() {
  const pages = $("pages");
  pages.addEventListener("mouseover", (e) => {
    const h = e.target.closest?.(".term-hot");
    if (h) showTermTip(h);
  });
  pages.addEventListener("mouseout", (e) => {
    if (e.target.closest?.(".term-hot")) hideTermTip();
  });
}

/* ---------------------------------------------------------------- highlights */

function locate(text) {
  const nq = normQuery(text);
  if (nq.length < 6) return null;
  for (const st of S.pages) {
    if (!st.index) continue;
    const i = st.index.norm.indexOf(nq);
    if (i !== -1) return { page: st.n, a: st.index.map[i], b: st.index.map[i + nq.length - 1] };
  }
  return null;
}

/* 같은 줄 위의 사각형끼리 간격이 좁으면 하나로 잇는다 — 양쪽정렬 문단에서 단어 사이가
   벌어져 textDiv 경계마다 하이라이트가 줄무늬처럼 끊기는 것을 막기 위함 */
const HL_GAP_RATIO = 0.75;   // 가로 간격이 높이의 이 배수를 넘으면 잇지 않는다 — 2단 조판의 단 사이 여백을 건너뛰지 않기 위한 안전장치
function mergeLineRects(rects) {
  if (rects.length < 2) return rects;
  const sorted = rects.slice().sort((a, b) => (a.top + a.height / 2) - (b.top + b.height / 2));
  const lines = [];
  let line = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = line[line.length - 1];
    const cur = sorted[i];
    const dy = Math.abs((cur.top + cur.height / 2) - (prev.top + prev.height / 2));
    if (dy < 0.5 * Math.min(prev.height, cur.height)) line.push(cur);
    else { lines.push(line); line = [cur]; }
  }
  lines.push(line);

  const out = [];
  for (const ln of lines) {
    ln.sort((a, b) => a.left - b.left);
    let cur = ln[0];
    for (let i = 1; i < ln.length; i++) {
      const next = ln[i];
      const gap = next.left - (cur.left + cur.width);
      if (gap <= HL_GAP_RATIO * Math.max(cur.height, next.height)) {
        const left = Math.min(cur.left, next.left);
        const top = Math.min(cur.top, next.top);
        const right = Math.max(cur.left + cur.width, next.left + next.width);
        const bottom = Math.max(cur.top + cur.height, next.top + next.height);
        cur = { left, top, width: right - left, height: bottom - top };
      } else {
        out.push(cur);
        cur = next;
      }
    }
    out.push(cur);
  }
  return out.sort((a, b) => a.top - b.top || a.left - b.left);   // 읽기 순서(줄→좌우) 유지
}

/* exact-bounds client rects for a normalized span [aPos..bPos] within a page's
   text layer, using Range so only the matched characters are covered — not the
   whole textDiv (which would spill into neighbouring words). Wrap-local coords. */
function rectsForSpan(st, aPos, bPos) {
  if (!st.textDivs || !aPos || !bPos) return [];
  const wrapRect = st.wrap.getBoundingClientRect();
  const out = [];
  for (let idx = aPos.i; idx <= bPos.i && idx < st.textDivs.length; idx++) {
    const div = st.textDivs[idx];
    if (!div) continue;
    const tn = div.firstChild;
    let rects;
    if (tn && tn.nodeType === 3) {
      const len = tn.length;
      const start = idx === aPos.i ? Math.min(aPos.o, len) : 0;
      const end = idx === bPos.i ? Math.min(bPos.o + 1, len) : len;
      if (start >= end) continue;
      const range = document.createRange();
      range.setStart(tn, start);
      range.setEnd(tn, end);
      rects = range.getClientRects();
    } else {
      rects = [div.getBoundingClientRect()];
    }
    for (const r of rects)
      if (r.width >= 1 && r.height >= 1)
        out.push({ left: r.left - wrapRect.left, top: r.top - wrapRect.top, width: r.width, height: r.height });
  }
  return mergeLineRects(out);
}

/* .hl-rect 사각형 4곳(하이라이트/핵심/검색/링크)이 공유하는 배치 — 위아래 하이라이트가
   맞닿지 않도록 세로로 살짝 얇게 그린다 */
const HL_H_RATIO = 0.82;   // 줄 간 여백 확보 — 위아래 하이라이트가 맞닿지 않게
const HL_TOP_BIAS = 0.13;  // 깎는 양을 위쪽에 더 줘 밑줄 쪽에 붙게
function styleHlRect(el, r) {
  el.style.left = (r.left - 1) + "px";
  el.style.top = (r.top + r.height * HL_TOP_BIAS) + "px";
  el.style.width = (r.width + 2) + "px";
  el.style.height = (r.height * HL_H_RATIO) + "px";
}

function applyHighlights(st) {
  if (!st.rendered || !st.hlLayer || !st.index) return;
  st.hlLayer.innerHTML = "";
  for (const h of S.hl.items) {
    if (h.page !== st.n) continue;
    const nq = normQuery(h.text);
    const i = st.index.norm.indexOf(nq);
    if (i === -1 || !nq) continue;
    const a = st.index.map[i], b = st.index.map[i + nq.length - 1];
    for (const r of rectsForSpan(st, a, b)) {
      const el = document.createElement("div");
      el.className = "hl-rect" + (h.source === "ai" ? " ai" : "");
      el.dataset.hid = h.id;
      styleHlRect(el, r);
      st.hlLayer.appendChild(el);
    }
  }
  applyKeypoints(st);   // hlLayer를 비웠으니 핵심 4색도 함께 다시 칠한다
  applyFindRects(st);   // 검색 매치도 마찬가지
  applyTermHots(st);    // 용어 밑줄 (wrap 직속 — 자체 정리 후 재배치)
}
const reapplyAllHighlights = () => S.pages.forEach((st) => st.rendered && applyHighlights(st));

async function saveHighlights() {
  try { await pj(`/api/papers/${S.current.id}/highlights`, { items: S.hl.items }, "PUT"); }
  catch (e) { toast("하이라이트 저장 실패: " + e.message, true); }
}

async function addManualHighlight(sel) {
  const item = { id: Math.random().toString(36).slice(2, 10), page: sel.page,
                 text: sel.text.slice(0, 1200), source: "user" };
  const loc = locate(item.text);
  if (loc) item.page = loc.page;
  S.hl.items.push(item);
  await saveHighlights();
  reapplyAllHighlights(); renderHlPane();
  getSelection()?.removeAllRanges();
  toast("강조 저장됨");
}

async function removeHighlight(id) {
  S.hl.items = S.hl.items.filter((h) => h.id !== id);
  await saveHighlights();
  reapplyAllHighlights(); renderHlPane();
}

async function runAutoHighlight() {
  const done = busy("핵심 문장 찾는 중");
  try {
    const items = await pj(`/api/papers/${S.current.id}/highlights/auto`, {});
    S.autoHl = items;
    let placed = 0;
    for (const it of items) {
      const loc = locate(it.sentence);
      it.page = loc?.page || null;
      if (!loc) continue;
      if (!S.hl.items.some((h) => normQuery(h.text) === normQuery(it.sentence))) {
        S.hl.items.push({ id: Math.random().toString(36).slice(2, 10), page: loc.page,
                          text: it.sentence, source: "ai", reason: it.reason });
      }
      placed++;
    }
    await saveHighlights();
    reapplyAllHighlights(); renderHlPane();
    toast(`핵심 문장 ${items.length}개 중 ${placed}개를 본문에 표시했습니다`);
  } catch (e) {
    toast("자동 강조 실패: " + e.message, true);
  } finally { done(); }
}

/* 강조 탭의 "Zotero 주석 가져오기" 버튼에 신규 주석 수를 붙인다. 없으면 조용히 그대로. */
async function refreshZotAnnBadge(paperId) {
  if (!S.current?.zotero_att_key) return;
  let n = 0;
  try { n = (await api(`/api/papers/${paperId}/zotero-annotations/new`)).new || 0; } catch { return; }
  if (S.current?.id !== paperId || !n) return;
  const b = $("zot-ann-btn");
  if (b) b.textContent = `Zotero 주석 가져오기 (${n} 신규)`;
}

/* Zotero PDF 리더의 형광펜·밑줄 → achird 강조 (단방향, 중복은 서버가 텍스트 정규화로 거름) */
async function importZoteroAnnotations() {
  const paperId = S.current.id;
  const done = busy("Zotero 주석 가져오는 중");
  try {
    const r = await pj(`/api/papers/${paperId}/import/zotero-annotations`, {});
    const hl = await api(`/api/papers/${paperId}/highlights`);
    if (S.current?.id !== paperId) return;   // 로딩 중 다른 논문으로 이동 — 남의 강조로 오염 방지
    S.hl = hl?.items ? hl : { items: [] };
    reapplyAllHighlights(); renderHlPane();
    toast(r.found ? `Zotero 주석 ${r.found}건 중 ${r.added}건 가져옴${r.skipped ? ` (중복 ${r.skipped}건)` : ""}`
                  : "Zotero에 이 논문의 주석이 없습니다");
  } catch (e) {
    toast("주석 가져오기 실패 — " + e.message, true);
  } finally { done(); }
}

function scrollToHl(h) {
  const st = S.pages[(h.page || 1) - 1];
  if (!st) return;
  st.wrap.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  Promise.resolve(renderPage(st.n)).then(() => setTimeout(() => {
    st.hlLayer?.querySelectorAll(`[data-hid="${h.id}"]`).forEach((el) => {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    });
  }, 350));
}

function renderHlPane() {
  const pane = $("ipane-hl");
  const user = S.hl.items.filter((h) => h.source !== "ai");
  const ai = S.hl.items.filter((h) => h.source === "ai");
  const unplaced = S.autoHl.filter((a) =>
    !S.hl.items.some((h) => normQuery(h.text) === normQuery(a.sentence)) && !locate(a.sentence));
  let html = renderMySummaryBox() + `<div class="row-actions">
    <button class="btn primary pressable" id="auto-hl-btn">${icon("sparkle", 14)} AI 핵심 문장 찾기</button>
    ${S.current?.zotero_att_key ? `<button class="btn pressable" id="zot-ann-btn"
      title="Zotero PDF 리더에서 그은 형광펜·밑줄을 이 논문의 강조로 가져옵니다 (중복은 건너뜀)">Zotero 주석 가져오기</button>` : ""}
  </div>`;
  if (S.kp.items?.length) {
    const kcard = (it, ki) => `
      <div class="note-card kp-card" data-kp="${ki}">
        <div class="kp-head"><i class="kp-dot ${KP_META[it.c]?.cls || ""}"></i>${KP_META[it.c]?.label || it.c}
          <span class="npage" style="margin-left:auto;">${it.p ? it.p + "쪽" : "본문 매칭 실패"}</span></div>
        <div class="nq"><span class="kp-mark ${KP_META[it.c]?.cls || ""}">${esc(it.s)}${it.se ? " … " + esc(it.se) : ""}</span></div>
        ${it.note ? `<div class="nmemo" style="color:var(--ink-2);font-size:.75rem;">${esc(it.note)}</div>` : ""}
      </div>`;
    html += `<h4 style="margin:.4rem 0 .5rem;font-size:.75rem;color:var(--ink-2);display:flex;align-items:center;">핵심 4색
        <button class="ndel" id="kp-refresh" style="margin-left:auto;">다시 분석</button></h4>`
          + S.kp.items.map(kcard).join("");
  }
  const card = (h) => `
    <div class="note-card" data-id="${h.id}">
      <div class="nq ${h.source === "ai" ? "ai-side" : ""}"><span>${esc(h.text)}</span></div>
      ${h.reason ? `<div class="nmemo" style="color:var(--ink-2);font-size:.75rem;">${esc(h.reason)}</div>` : ""}
      <div class="nrow"><span class="npage">${h.page ? h.page + "쪽" : ""}</span>
        <button class="ndel" data-del="${h.id}">삭제</button></div>
    </div>`;
  if (ai.length) html += `<h4 style="margin:.4rem 0 .5rem;font-size:.75rem;color:var(--ink-2);">AI 핵심 문장</h4>` + ai.map(card).join("");
  if (user.length) html += `<h4 style="margin:.9rem 0 .5rem;font-size:.75rem;color:var(--ink-2);">내 강조</h4>` + user.map(card).join("");
  if (unplaced.length)
    html += `<h4 style="margin:.9rem 0 .5rem;font-size:.75rem;color:var(--ink-2);">본문 매칭 실패</h4>` +
      unplaced.map((u) => `<div class="note-card"><div class="nq ai-side"><span>${esc(u.sentence)}</span></div>
        <div class="nmemo" style="color:var(--ink-2);font-size:.75rem;">${esc(u.reason || "")}</div></div>`).join("");
  if (!ai.length && !user.length && !unplaced.length)
    html += `<div class="ipane-hint">${icon("marker", 28)}<br>드래그해서 강조를 긋거나,<br>AI에게 핵심 문장을 찾게 해보세요.</div>`;
  pane.innerHTML = html;
  if (S.mysum.running) $("mysum-loading")?.appendChild(starInline("내 정리 만드는 중…"));
  else $("mysum-btn").onclick = makeMySummary;
  $("auto-hl-btn").onclick = runAutoHighlight;
  const zab = $("zot-ann-btn");
  if (zab) zab.onclick = importZoteroAnnotations;
  pane.querySelectorAll(".note-card[data-id]").forEach((c) => {
    c.onclick = (e) => {
      if (e.target.closest("[data-del]")) return;
      const h = S.hl.items.find((x) => x.id === c.dataset.id);
      if (h?.page) scrollToHl(h);
    };
  });
  pane.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); removeHighlight(b.dataset.del); };
  });
  pane.querySelectorAll(".kp-card").forEach((c) => {
    c.onclick = () => {
      const ki = +c.dataset.kp, it = S.kp.items?.[ki];
      if (it) scrollToKp(it, ki);
    };
  });
  const kpr = pane.querySelector("#kp-refresh");
  if (kpr) kpr.onclick = (e) => { e.stopPropagation(); refreshKeypoints(); };
}

/* ---- 내 정리: AI 핵심 문장 찾기(새 하이라이트 발굴)와 달리, 이미 표시해둔 하이라이트·노트'만'으로
   다이제스트를 만든다. 강조 탭 첫 방문 때 GET으로 캐시 1회 로드(ensureFigures와 같은 패턴). ---- */

async function ensureMySummary() {
  if (!S.current || S.mysum.data !== null) return;
  const paperId = S.current.id;
  try {
    const r = await api(`/api/papers/${paperId}/mysummary`);
    if (S.current?.id !== paperId) return;
    S.mysum.data = r || {};
  } catch {
    if (S.current?.id === paperId) S.mysum.data = {};
  }
  if (S.current?.id === paperId) renderHlPane();
}

function renderMySummaryBox() {
  if (S.mysum.running) return `<div class="res-card" id="mysum-loading"></div>`;
  const d = S.mysum.data;
  if (d?.markdown) {
    return `<div class="res-card">
      <div class="prose">${md(d.markdown)}</div>
      <div class="mysum-stamp">하이라이트 ${d.highlights ?? 0}개 · 노트 ${d.notes ?? 0}개 기준으로 생성됨</div>
      <div class="row-actions" style="margin:.6rem 0 0;">
        <button class="btn pressable" id="mysum-btn">${icon("sparkle", 13)} 다시 만들기</button>
      </div>
    </div>`;
  }
  return `<div class="row-actions">
    <button class="btn pressable" id="mysum-btn">${icon("sparkle", 13)} 내 정리 만들기</button>
  </div>`;
}

async function makeMySummary() {
  if (S.mysum.running || !S.current) return;
  const paperId = S.current.id;
  S.mysum.running = true;
  renderHlPane();
  const done = busy("내 정리 만드는 중");
  try {
    const r = await pj(`/api/papers/${paperId}/mysummary`, {});
    if (S.current?.id === paperId) S.mysum.data = r;
  } catch (e) {
    if (S.current?.id === paperId) toast("내 정리 실패: " + e.message, true);   // 400: 하이라이트·노트 없음 메시지도 그대로 노출
  } finally {
    if (S.current?.id === paperId) { S.mysum.running = false; renderHlPane(); }
    done();
  }
}

/* --------------------------------- key points (핵심 4색: 분홍=독창성 · 연두=방법 · 연보라=결과 · 하늘=한계) */

const KP_META = {
  nov: { label: "독창성", cls: "kp-nov" },
  met: { label: "방법",   cls: "kp-met" },
  res: { label: "결과",   cls: "kp-res" },
  lim: { label: "한계",   cls: "kp-lim" },
};

/* 원문 위 3색 칠하기 — 번역 정렬과 같은 앵커(s,se) + 정규화 인덱스 방식이라 글자 단위로 정확 */
function applyKeypoints(st) {
  if (!S.kp.on || !S.kp.items || !st.rendered || !st.hlLayer || !st.index) return;
  S.kp.items.forEach((it, ki) => {
    if (it.p !== st.n) return;
    const range = anchorRange([it], st.index.norm, "s", "se")[0];
    if (!range) return;
    const aPos = st.index.map[range.a], bPos = st.index.map[range.b];
    for (const r of rectsForSpan(st, aPos, bPos)) {
      const el = document.createElement("div");
      el.className = `hl-rect kp ${KP_META[it.c]?.cls || ""}`;
      el.dataset.kpi = ki;
      styleHlRect(el, r);
      st.hlLayer.appendChild(el);
    }
  });
}

/* 모델이 페이지 번호를 틀려도 표시되게 — 선언 페이지에 앵커가 없으면 전 페이지에서 찾는다 */
function placeKeypoints() {
  for (const it of S.kp.items || []) {
    const has = (st) => st?.index && anchorRange([it], st.index.norm, "s", "se")[0];
    if (has(S.pages[it.p - 1])) continue;
    const hit = S.pages.find(has);
    it.p = hit ? hit.n : 0;                    // 0 = 매칭 실패 (강조 패널에 표시)
  }
}

async function toggleKeypoints() {
  if (S.kp.running) return;
  if (S.kp.on) {
    S.kp.on = false;
    $("key-btn").classList.remove("on");
    $("kp-legend").hidden = true;
    reapplyAllHighlights();
    if (S.view === "parallel") S.pages.forEach(fillTransCell);   // 번역 셀 마크도 재렌더로 제거
    return;
  }
  if (!S.textReady) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
  if (!S.kp.items) {
    const paperId = S.current.id;          // 응답이 늦게 와도 다른 논문 상태에 덮어쓰지 않게
    S.kp.running = true;
    const done = busy("핵심 4색 분석 중");
    try {
      let r = await api(`/api/papers/${paperId}/keypoints`);
      if (!r.items) r = await pj(`/api/papers/${paperId}/keypoints`, {});
      if (S.current?.id !== paperId) return;
      S.kp.items = r.items || [];
    } catch (e) {
      if (S.current?.id === paperId) toast("핵심 분석 실패: " + e.message, true);
      return;
    } finally { if (S.current?.id === paperId) S.kp.running = false; done(); }
  }
  if (S.current?.id == null) return;
  if (!S.kp.placed) { placeKeypoints(); S.kp.placed = true; renderHlPane(); }
  S.kp.on = true;
  $("key-btn").classList.add("on");
  renderKpLegend();
  reapplyAllHighlights();
  if (S.view === "parallel") S.pages.forEach(fillTransCell);   // 번역 셀에도 핵심 4색 동기화
}

function renderKpLegend() {
  const lg = $("kp-legend");
  const cnt = (c) => (S.kp.items || []).filter((i) => i.c === c && i.p).length;
  lg.innerHTML = Object.entries(KP_META).map(([c, m]) =>
    `<span class="kp-chip"><i class="kp-dot ${m.cls}"></i>${m.label} ${cnt(c)}</span>`).join("");
  lg.hidden = false;
}

function scrollToKp(it, ki) {
  if (!it.p) return;
  const st = S.pages[it.p - 1];
  if (!st) return;
  st.wrap.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  Promise.resolve(renderPage(st.n)).then(() => setTimeout(() => {
    st.hlLayer?.querySelectorAll(`[data-kpi="${ki}"]`).forEach((el) => {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    });
  }, 350));
}

/* 강제 재분석 — lim 추가 전 구 캐시(3색)를 4색으로 갱신할 때도 쓴다 */
async function refreshKeypoints() {
  if (S.kp.running) return;
  const paperId = S.current.id;
  S.kp.running = true;
  const done = busy("핵심 다시 분석 중");
  try {
    const r = await pj(`/api/papers/${paperId}/keypoints`, { force: true });
    if (S.current?.id !== paperId) return;
    S.kp.items = r.items || [];
    S.kp.placed = false;
    if (S.textReady) { placeKeypoints(); S.kp.placed = true; }
    renderHlPane();
    if (S.kp.on) { renderKpLegend(); reapplyAllHighlights(); }
    if (S.view === "parallel") S.pages.forEach(fillTransCell);   // 번역 셀 핵심 마크도 새 항목으로 갱신
    toast(`핵심 ${S.kp.items.length}개를 다시 추출했습니다`);
  } catch (e) {
    if (S.current?.id === paperId) toast("핵심 재분석 실패: " + e.message, true);
  } finally { if (S.current?.id === paperId) S.kp.running = false; done(); }
}

/* 요약 섹션 ↔ 핵심 색 연동. 문제의식→분홍(독창성) · 방법→연두 · 핵심 결과→연보라 · 한계→하늘.
   섹션 안의 각 문단·목록 항목을 클릭하면 그 분류의 핵심 하이라이트로 순서 매핑(mod)해 점프한다. */
const SUM_CAT = [
  { re: /문제의식|독창/, c: "nov" },
  { re: /한계/, c: "lim" },
  { re: /방법/, c: "met" },
  { re: /핵심 결과|결과/, c: "res" },
];
function linkSummaryToKp() {
  const pane = $("ipane-summary");
  pane.querySelectorAll("h2").forEach((h) => {
    const m = SUM_CAT.find((x) => x.re.test(h.textContent));
    if (!m) return;
    let idx = 0;
    for (let el = h.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
      const blocks = el.tagName === "UL" || el.tagName === "OL" ? [...el.children] : [el];
      for (const b of blocks) {
        if (!b.textContent.trim() || b.classList.contains("row-actions")) continue;
        b.classList.add("sum-link", KP_META[m.c].cls);
        b.dataset.kpc = m.c;
        b.dataset.kps = String(idx++);
        b.title = "클릭하면 원문의 해당 핵심 하이라이트로 이동";
      }
    }
  });
}
async function onSummaryKpClick(e) {
  const b = e.target.closest(".sum-link");
  if (!b) return;
  if (!S.kp.on) await toggleKeypoints();     // 꺼져 있으면 켠다 (최초 클릭이면 분석까지)
  if (!S.kp.on) return;                      // 분석 실패·본문 추출 전
  const cat = b.dataset.kpc;
  const cand = [];
  S.kp.items.forEach((it, ki) => { if (it.c === cat && it.p) cand.push({ it, ki }); });
  if (!cand.length) {
    toast(cat === "lim"
      ? "저장된 핵심에 '한계' 항목이 없습니다 — 강조 탭에서 '다시 분석'을 누르세요."
      : "이 분류의 핵심 문장이 없습니다");
    return;
  }
  const t = cand[+b.dataset.kps % cand.length];
  scrollToKp(t.it, t.ki);
}

/* ================================================================ 마인드맵 (논지 지도)
   8칸 분석이 "편끼리 비교할 고정 축"이라면 여기는 "이 논문이 실제로 어떻게 논증하는가"다.
   장식이 아니라 항법 장치다 — 모든 노드가 본문 한 문장을 가리키고, 누르면 그 쪽으로 뛴다.
   앵커(p/s/se)는 핵심 4색과 같은 스키마라 좌표 매핑·재탐색·점프가 전부 재사용된다.
   배치는 인용 그래프와 같은 원칙: 힘 시뮬레이션 없음, 같은 입력이면 항상 같은 그림. */

const MM_R = [0, 190, 350, 470];        // 깊이별 반지름
const MM_DOT = [11, 8, 5.5, 4.5];       // 깊이별 점 크기

async function ensureMindmap() {
  if (S.mm.nodes || S.mm.running) { renderMindmapWell(); return; }
  S.mm.running = true;
  try {
    const r = await api(`/api/papers/${S.current.id}/mindmap`);
    S.mm.nodes = r.nodes || null;
  } catch { S.mm.nodes = null; }        // 404 = 아직 안 만듦 — 버튼을 보여준다
  finally { S.mm.running = false; placeMindmap(); renderMindmapWell(); }
}

async function makeMindmap(force = false) {
  if (!S.textReady && !S.current.has_text) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
  const paperId = S.current.id;
  const well = $("map-well");
  well.innerHTML = "";
  well.appendChild(starInline("논지 구조를 그리는 중… (30초~2분)"));
  const done = busy("마인드맵 그리는 중");
  try {
    const r = await pj(`/api/papers/${paperId}/mindmap`, { force });
    if (S.current?.id !== paperId) return;
    S.mm.nodes = r.nodes || null;
    S.mm.placed = false;
    placeMindmap();
    renderMindmapWell();
    const lost = (S.mm.nodes || []).filter((n) => n.s && !n.p).length;
    toast(lost ? `마인드맵 완성 — 본문 매칭 실패 ${lost}개` : "마인드맵 완성");
  } catch (e) {
    if (S.current?.id === paperId) renderMindmapWell();
    toast("마인드맵 실패: " + e.message, true);
  } finally { done(); }
}

/* 모델이 쪽을 틀려도 표시되게 — 선언 페이지에 앵커가 없으면 전 페이지에서 찾는다.
   핵심 4색의 placeKeypoints와 같은 규칙이다(같은 앵커 스키마라 그대로 쓴다). */
function placeMindmap() {
  /* textReady 전에는 돌리지 않는다 — 페이지 색인(st.index)은 본문 추출 때 생긴다.
     추출 전에 훑으면 아직 색인이 없는 쪽을 '못 찾았다'로 보고 앵커를 통째로 0 으로 지운다. */
  if (!S.mm.nodes || S.mm.placed || !S.textReady || !S.pages.length) return;
  for (const it of S.mm.nodes) {
    if (!it.s) continue;
    const has = (st) => st?.index && anchorRange([it], st.index.norm, "s", "se")[0];
    if (has(S.pages[it.p - 1])) continue;
    const hit = S.pages.find(has);
    it.p = hit ? hit.n : 0;              // 0 = 매칭 실패 (지도에서 흐리게)
  }
  S.mm.placed = true;
}

function renderMindmapWell() {
  const well = $("map-well");
  if (!well || S.view !== "map") return;
  if (!S.mm.nodes) {
    well.innerHTML = `<div class="map-empty">${icon("map", 30)}
      <h3>논지 지도</h3>
      <p>이 논문이 무엇을 주장하고 무엇으로 받치는지 한 장으로 봅니다.<br>
         모든 마디는 본문 한 문장을 가리킵니다 — 누르면 그 쪽으로 갑니다.</p>
      <button class="btn primary pressable" id="mm-run">${icon("sparkle", 14)} 마인드맵 그리기</button></div>`;
    $("mm-run").onclick = () => makeMindmap(false);
    return;
  }
  placeMindmap();
  const nodes = S.mm.nodes;
  const lost = nodes.filter((n) => n.s && !n.p).length;
  well.innerHTML = `
    <div class="map-bar">
      <span class="pb-status">마디 ${nodes.length}개${lost ? ` · 본문 매칭 실패 ${lost}개` : ""}</span>
      <span class="kp-legend-inline">${Object.entries(KP_META).map(([c, m]) =>
        `<span class="kp-chip"><i class="kp-dot ${m.cls}"></i>${m.label}</span>`).join("")}</span>
      <span class="pb-spacer"></span>
      <button class="btn pressable" id="mm-md">${icon("export", 13)} Markdown</button>
      <button class="btn pressable" id="mm-svg">${icon("export", 13)} SVG</button>
      <button class="btn pressable" id="mm-re">${icon("sparkle", 13)} 다시 그리기</button>
    </div>
    <div class="map-scroll">${buildMindmapSVG(nodes)}</div>`;
  wireMindmap(well.querySelector(".mm-svg"));
  $("mm-re").onclick = () => makeMindmap(true);
  $("mm-md").onclick = () => {
    const name = (S.current.title || "achird").replace(/[\\/:*?"<>|]/g, "").slice(0, 50);
    downloadBlob(`${name}-마인드맵.md`,
      new Blob([mindmapToMarkdown(nodes)], { type: "text/markdown;charset=utf-8" }));
    toast("마인드맵을 Markdown으로 내보냈습니다");
  };
  $("mm-svg").onclick = downloadMindmapSVG;
}

/* 방사형 배치: 잎 개수에 비례해 각도 섹터를 나눈다(가지가 굵을수록 넓은 자리).
   입력 순서가 같으면 좌표도 같다 — 다시 열어도 같은 그림이 나와야 지도로 쓸 수 있다. */
function layoutMindmap(nodes) {
  const kids = new Map();
  nodes.forEach((n) => {
    if (!n.parent) return;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  });
  const weight = new Map();
  const calcW = (id) => {
    const ch = kids.get(id) || [];
    const w = ch.length ? ch.reduce((s, c) => s + calcW(c.id), 0) : 1;
    weight.set(id, w);
    return w;
  };
  calcW("n0");
  const pos = new Map([["n0", { x: 0, y: 0, a: -Math.PI / 2, d: 0 }]]);
  const place = (id, a0, a1, depth) => {
    const ch = kids.get(id) || [];
    if (!ch.length) return;
    const total = ch.reduce((s, c) => s + weight.get(c.id), 0) || 1;
    let a = a0;
    for (const c of ch) {
      const span = (a1 - a0) * (weight.get(c.id) / total);
      const mid = a + span / 2;
      const r = MM_R[Math.min(depth + 1, MM_R.length - 1)];
      pos.set(c.id, { x: r * Math.cos(mid), y: r * Math.sin(mid), a: mid, d: depth + 1 });
      place(c.id, a + span * 0.06, a + span * 0.94, depth + 1);   // 살짝 오므려 형제끼리 안 붙게
      a += span;
    }
  };
  place("n0", -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, 0);
  return pos;
}

function buildMindmapSVG(nodes) {
  const pos = layoutMindmap(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const PAD = 210;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  pos.forEach((p) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  const W = Math.round(maxX - minX + PAD * 2), H = Math.round(maxY - minY + PAD * 2);
  const ox = -minX + PAD, oy = -minY + PAD;
  const X = (p) => (p.x + ox).toFixed(1), Y = (p) => (p.y + oy).toFixed(1);

  /* 링크는 3차 베지어 — 직선은 계통도로 읽히고, 곡선이어야 방사형 지도로 읽힌다 */
  const links = nodes.filter((n) => n.parent && pos.has(n.parent) && pos.has(n.id)).map((n) => {
    const a = pos.get(n.parent), b = pos.get(n.id);
    const ra = Math.hypot(a.x, a.y), rb = Math.hypot(b.x, b.y);
    const mid = (ra + rb) / 2;
    const c1 = { x: mid * Math.cos(a.a) + ox, y: mid * Math.sin(a.a) + oy };
    const c2 = { x: mid * Math.cos(b.a) + ox, y: mid * Math.sin(b.a) + oy };
    return `<path class="mm-link" data-to="${esc(n.id)}" d="M${X(a)},${Y(a)} C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ` +
      `${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${X(b)},${Y(b)}"></path>`;
  }).join("");

  const dots = nodes.map((n) => {
    const p = pos.get(n.id);
    if (!p) return "";
    const r = MM_DOT[Math.min(p.d, MM_DOT.length - 1)];
    const cls = KP_META[n.c]?.cls || (n.c === "root" ? "mm-root" : "mm-idea");
    const anchored = !!(n.s && n.p);
    /* 흐리게 할 대상은 '앵커를 걸었는데 본문에서 못 찾은' 마디뿐이다.
       뿌리와 구조 마디(idea)는 애초에 가리킬 문장이 없다 — 실패가 아니라 종류가 다른 것이다. */
    const failed = !!(n.s && !n.p);
    const right = Math.cos(p.a) >= -0.15 || p.d === 0;
    const lx = +X(p) + (right ? r + 9 : -(r + 9));
    const label = n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label;
    const tip = [n.label, n.note, n.p ? `${n.p}쪽` : (n.s ? "본문 매칭 실패" : "")].filter(Boolean).join(" — ");
    return `<g class="mm-node ${cls}${failed ? " noanchor" : ""}${anchored ? "" : " static"}" data-id="${esc(n.id)}"` +
      (anchored ? ` tabindex="0" role="button"` : "") + ` aria-label="${esc(tip)}">` +
      `<title>${esc(tip)}</title>` +
      `<circle class="mm-hit" cx="${X(p)}" cy="${Y(p)}" r="${r + 15}"></circle>` +
      `<circle class="mm-dot" cx="${X(p)}" cy="${Y(p)}" r="${r}"></circle>` +
      `<text class="mm-label d${p.d}" x="${lx.toFixed(1)}" y="${Y(p)}" text-anchor="${right ? "start" : "end"}" ` +
      `dominant-baseline="middle">${esc(label)}</text></g>`;
  }).join("");

  return `<svg class="mm-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<g class="mm-links">${links}</g><g class="mm-nodes">${dots}</g></svg>`;
}

/* hover → 조상·자손만 남기고 나머지 흐리게. 클릭 → 본문의 그 문장으로. */
function wireMindmap(svg) {
  if (!svg || !S.mm.nodes) return;
  const byId = new Map(S.mm.nodes.map((n) => [n.id, n]));
  const chain = (id) => {                       // 조상 + 자손 전부
    const out = new Set([id]);
    for (let n = byId.get(id); n?.parent; n = byId.get(n.parent)) out.add(n.parent);
    let grew = true;
    while (grew) {
      grew = false;
      S.mm.nodes.forEach((n) => {
        if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; }
      });
    }
    return out;
  };
  const nodeEls = [...svg.querySelectorAll(".mm-node")];
  const linkEls = [...svg.querySelectorAll(".mm-link")];
  const clear = () => {
    svg.classList.remove("hovering");
    nodeEls.forEach((g) => g.classList.remove("hl"));
    linkEls.forEach((l) => l.classList.remove("hl"));
  };
  const hover = (id) => {
    const on = chain(id);
    svg.classList.add("hovering");
    nodeEls.forEach((g) => g.classList.toggle("hl", on.has(g.dataset.id)));
    linkEls.forEach((l) => l.classList.toggle("hl", on.has(l.dataset.to)));
  };
  nodeEls.forEach((g) => {
    const id = g.dataset.id;
    g.addEventListener("pointerenter", () => hover(id));
    g.addEventListener("pointerleave", clear);
    g.addEventListener("focus", () => hover(id));
    g.addEventListener("blur", clear);
    if (!g.getAttribute("role")) return;        // 앵커 없는 마디는 갈 곳이 없다
    const go = () => { const n = byId.get(id); if (n) { setView("pdf"); flashAnchor(n); } };
    g.addEventListener("click", go);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

/* 앵커 문장으로 스크롤 + 잠깐 반짝. 핵심 4색의 scrollToKp와 같은 일을 하되
   kp 목록에 없는 마디라 임시 사각형을 직접 깔고 지운다. */
function flashAnchor(it) {
  if (!it.p) { toast("이 마디는 본문에서 문장을 찾지 못했습니다"); return; }
  const st = S.pages[it.p - 1];
  if (!st) return;
  st.wrap.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  Promise.resolve(renderPage(st.n)).then(() => setTimeout(() => {
    if (!st.index || !st.hlLayer) return;
    const range = anchorRange([it], st.index.norm, "s", "se")[0];
    if (!range) return;
    const aPos = st.index.map[range.a], bPos = st.index.map[range.b];
    for (const r of rectsForSpan(st, aPos, bPos)) {
      const el = document.createElement("div");
      el.className = `hl-rect kp flash ${KP_META[it.c]?.cls || ""}`;
      styleHlRect(el, r);
      st.hlLayer.appendChild(el);
      setTimeout(() => el.remove(), 2400);
    }
  }, 140));
}

function mindmapToMarkdown(nodes) {
  const kids = new Map();
  nodes.forEach((n) => {
    if (!n.parent) return;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  });
  const lines = [`# ${(nodes[0] && nodes[0].label) || S.current.title || "논문"} — 논지 지도`, ""];
  const walk = (id, depth) => {
    for (const n of kids.get(id) || []) {
      const tail = [n.note, n.p ? `p.${n.p}` : null].filter(Boolean).join(" · ");
      lines.push(`${"  ".repeat(depth)}- **${n.label}**${tail ? ` — ${tail}` : ""}`);
      walk(n.id, depth + 1);
    }
  };
  walk("n0", 0);
  return lines.join("\n");
}

/* SVG 파일은 페이지 밖에서 열린다 — CSS 변수가 죽으므로 화면에서 계산된 색을 박아 넣는다 */
function downloadMindmapSVG() {
  const src = $("map-well").querySelector(".mm-svg");
  if (!src) return;
  const clone = src.cloneNode(true);
  const bake = (sel, props) => {
    const live = [...src.querySelectorAll(sel)], cp = [...clone.querySelectorAll(sel)];
    live.forEach((el, i) => {
      const cs = getComputedStyle(el);
      props.forEach((p) => cp[i]?.setAttribute(p, cs.getPropertyValue(p)));
    });
  };
  bake(".mm-link", ["stroke", "stroke-width", "fill"]);
  bake(".mm-dot", ["fill", "stroke", "stroke-width"]);
  bake(".mm-label", ["fill", "font-size", "font-family", "font-weight"]);
  clone.querySelectorAll(".mm-hit").forEach((el) => el.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("style", `background:${getComputedStyle($("map-well")).backgroundColor}`);
  const name = (S.current.title || "achird").replace(/[\\/:*?"<>|]/g, "").slice(0, 50);
  downloadBlob(`${name}-마인드맵.svg`,
    new Blob([clone.outerHTML], { type: "image/svg+xml;charset=utf-8" }));
  toast("마인드맵을 SVG로 내보냈습니다");
}

/* ---------------------------------------------------------------- reading conveniences
   읽던 위치 기억 · 원문 검색(Ctrl+F) · 쪽 점프 · 키보드 단축키 */

const posKey = (id) => "ml.pos." + id;
let posT = 0, posPushT = 0;
function saveReadPos() {
  if (!S.current || !S.pages.length) return;
  const sc = $("pages-scroll");
  if (sc.scrollHeight <= sc.clientHeight) return;
  const r = sc.scrollTop / sc.scrollHeight, p = currentPageNo(), id = S.current.id;
  try {
    localStorage.setItem(posKey(id), JSON.stringify({ r, ts: Date.now() }));
  } catch { /* quota 등 — 위치 기억은 best-effort */ }
  /* 서버에도 남긴다(두 PC 공유). 스크롤마다 PATCH를 던지면 파일 쓰기가 쌓이므로 한 번 더 접는다. */
  const meta = S.papers.find((x) => x.id === id);
  if (meta) meta.read_pos = { p, r: Math.round(r * 1e4) / 1e4 };
  clearTimeout(posPushT);
  posPushT = setTimeout(() => {
    pj(`/api/papers/${id}`, { read_pos: { p, r } }, "PATCH").catch(() => {});
  }, 2500);
}
function schedulePosSave() { clearTimeout(posT); posT = setTimeout(saveReadPos, 400); }
function restoreReadPos() {
  const r = readPosRatio(S.current.id);
  if (!(r > 0.005)) return;              // 첫머리였으면 그대로 시작
  const sc = $("pages-scroll");
  sc.scrollTop = r * sc.scrollHeight;    // 비율 저장이라 줌이 바뀌어도 대체로 유지
  const n = currentPageNo();
  if (n > 1) toast(`읽던 위치로 이동 · ${n}쪽`);
}

function gotoPage(n) {
  const st = S.pages[Math.max(1, Math.min(S.pages.length, n)) - 1];
  st?.wrap.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
}

/* 쪽 번호 클릭 → 점프 입력 팝오버 */
function showPageJump() {
  const N = S.pages.length;
  if (!N) return;
  const pop = popShell($("rd-page").getBoundingClientRect(), `<div class="pj-row">
      <input id="pj-in" type="number" min="1" max="${N}" placeholder="1–${N}" aria-label="이동할 쪽 번호">
      <button class="btn primary pressable" id="pj-go">이동</button></div>`);
  const inp = pop.querySelector("#pj-in");
  inp.focus();
  const go = () => {
    const n = +inp.value;
    if (!n) return;
    hideCitePop(true);
    gotoPage(n);
  };
  pop.querySelector("#pj-go").onclick = go;
  inp.onkeydown = (e) => {
    e.stopPropagation();                  // 전역 단축키와 분리
    if (e.key === "Enter") go();
    else if (e.key === "Escape") hideCitePop(true);
  };
}

/* ---- 원문 검색: 정규화 인덱스(buildIndex) 재사용 → 하이픈·개행·리가처 무시하고 글자 단위 매칭 ---- */

function openFind() {
  S.find.open = true;
  $("find-bar").hidden = false;
  const inp = $("find-in");
  inp.focus(); inp.select();
}
function closeFind() {
  S.find.open = false;
  $("find-bar").hidden = true;
  S.find.q = ""; S.find.list = []; S.find.cur = -1;
  updateFindCount();
  reapplyAllHighlights();                 // find 렉트 제거
}
function runFind(raw, fromPage) {
  const nq = normQuery(raw || "");
  S.find.q = nq; S.find.list = []; S.find.cur = -1;
  if (nq.length >= 2) {
    outer: for (const st of S.pages) {
      if (!st.index) continue;
      let i = st.index.norm.indexOf(nq);
      while (i !== -1) {
        S.find.list.push({ n: st.n, a: i, b: i + nq.length - 1 });
        if (S.find.list.length >= 500) break outer;   // 병적 질의 상한
        i = st.index.norm.indexOf(nq, i + 1);
      }
    }
  }
  if (S.find.list.length) {
    S.find.cur = 0;
    if (fromPage) {                 // 검색 진입점(해당 쪽) 이후의 첫 매치부터
      const k = S.find.list.findIndex((m) => m.n >= fromPage);
      if (k >= 0) S.find.cur = k;
    }
  }
  updateFindCount();
  reapplyAllHighlights();
  if (S.find.cur >= 0) scrollToFind();
}
function updateFindCount() {
  $("find-count").textContent =
    S.find.list.length ? `${S.find.cur + 1}/${S.find.list.length}` : (S.find.q ? "0건" : "");
}
function stepFind(d) {
  const L = S.find.list.length;
  if (!L) return;
  S.find.cur = (S.find.cur + d + L) % L;
  updateFindCount();
  reapplyAllHighlights();                 // 현재 매치 강조 갱신
  scrollToFind();
}
async function scrollToFind() {
  const m = S.find.list[S.find.cur];
  if (!m) return;
  const st = S.pages[m.n - 1];
  await renderPage(m.n);
  const sc = $("pages-scroll");
  const r = rectsForSpan(st, st.index.map[m.a], st.index.map[m.b])[0];
  const wrapTop = st.wrap.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  sc.scrollTo({ top: Math.max(0, wrapTop + (r ? r.top : 0) - 140),
                behavior: REDUCED ? "auto" : "smooth" });
}
function applyFindRects(st) {
  if (!S.find.list.length || !st.rendered || !st.hlLayer || !st.index) return;
  S.find.list.forEach((m, gi) => {
    if (m.n !== st.n) return;
    const aPos = st.index.map[m.a], bPos = st.index.map[m.b];
    for (const r of rectsForSpan(st, aPos, bPos)) {
      const el = document.createElement("div");
      el.className = "hl-rect find" + (gi === S.find.cur ? " cur" : "");
      styleHlRect(el, r);
      st.hlLayer.appendChild(el);
    }
  });
}
function initFindBar() {
  $("fb-glass").innerHTML = icon("search", 14);
  $("find-prev").innerHTML = icon("chevUp", 14);
  $("find-next").innerHTML = icon("chevDown", 14);
  $("find-close").innerHTML = icon("x", 13);
  let t = 0;
  $("find-in").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => runFind($("find-in").value), 160);
  });
  $("find-in").addEventListener("keydown", (e) => {
    e.stopPropagation();                  // 전역 단축키와 분리
    if (e.key === "Enter") stepFind(e.shiftKey ? -1 : 1);
    else if (e.key === "Escape") closeFind();
  });
  $("find-prev").onclick = () => stepFind(-1);
  $("find-next").onclick = () => stepFind(1);
  $("find-close").onclick = closeFind;
}

/* ---- 키보드 단축키: ←/→ 쪽 이동 · T 번역 · K 핵심 · 1~9 탭 · Ctrl+F 검색 (리더) · Ctrl+K 명령 팔레트 (홈·리더 공통) ---- */
function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {   // Ctrl/Cmd+K → 명령 팔레트, 화면 무관
      e.preventDefault(); openCmdPalette(); return;
    }
    if ($("home").classList.contains("on")
        && (e.ctrlKey || e.metaKey) && e.code === "KeyF") {   // 홈 Ctrl+F → 서재 전체 검색
      e.preventDefault(); $("lib-in").focus(); $("lib-in").select(); return;
    }
    if ($("home").classList.contains("on") && e.key === "Escape" && S.cmp.on) {
      exitCmpMode(); return;
    }
    if (!$("reader").classList.contains("on")) return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyF") {   // 브라우저 찾기 대신 원문 검색
      e.preventDefault(); openFind(); return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    if (e.key === "Escape" && S.capOn) { toggleCapture(); return; }
    if (e.key === "Escape") { if (S.find.open) closeFind(); return; }
    switch (e.code) {                     // e.code = 자판 위치 기준 — 한글 IME 상태여도 동작
      case "ArrowLeft":  e.preventDefault(); gotoPage(currentPageNo() - 1); break;
      case "ArrowRight": e.preventDefault(); gotoPage(currentPageNo() + 1); break;
      case "KeyT": setView(S.view === "parallel" ? "pdf" : "parallel"); break;
      case "KeyK": toggleKeypoints(); break;
      case "KeyM": setView(S.view === "map" ? "pdf" : "map"); break;
      case "KeyC": toggleCapture(); break;
      default:
        if (/^Digit[1-9]$/.test(e.code) && +e.code.slice(5) <= TABS.length) {
          $("inspector").classList.remove("hidden");
          setTab(TABS[+e.code.slice(5) - 1].id);
        }
    }
  });
  window.addEventListener("beforeunload", saveReadPos);
}

/* ---------------------------------------------------------------- notes */

async function addNote(sel) {
  try {
    await pj(`/api/papers/${S.current.id}/notes`, { page: sel.page, quote: sel.text, memo: "" });
    toast("노트 저장됨");
    loadNotes();
    getSelection()?.removeAllRanges();
  } catch (e) { toast(e.message, true); }
}

async function loadNotes() {
  const id = S.current.id;
  let notes = [];
  try { notes = await api(`/api/papers/${id}/notes`); } catch { notes = []; }
  if (S.current?.id !== id) return;     // 논문 전환 중이면 이 논문 노트로 덮지 않음
  S.notes = notes;
  renderNotesPane();
}

/* 메모의 [[개념]]을 칩으로 — 같은 이름을 쓴 논문들이 인용 그래프에서 개념 노드로 이어진다.
   md() 가 이미 HTML 이스케이프를 끝낸 문자열이라 여기서 태그를 끼워도 주입이 되지 않는다. */
const WIKI_RE = /\[\[([^\[\]|]{1,80})(?:\|[^\[\]]{0,80})?\]\]/g;
const wikiChips = (html) => html.replace(WIKI_RE, '<span class="wikilink">$1</span>');

function renderNotesPane() {
  const pane = $("ipane-notes");
  const hint = `<div class="ipane-hint" style="text-align:left;padding:.7rem 0 0;">
      메모에 <code>[[개념]]</code>을 적으면 인용 그래프의 '노트 개념 포함'에서 같은 개념을 쓴 논문끼리 이어집니다.</div>`;
  if (!S.notes.length) {
    pane.innerHTML = `<div class="ipane-hint">${icon("note", 28)}<br>본문을 드래그한 뒤 '노트'를 누르면<br>여기에 모입니다. 번역·설명 결과도 저장할 수 있어요.</div>` + hint;
    return;
  }
  pane.innerHTML = S.notes.map((n) => `
    <div class="note-card" data-id="${n.id}" data-page="${n.page}">
      <div class="nq">${esc(n.quote)}</div>
      ${n.memo ? `<div class="nmemo prose" style="font-size:.8125rem;">${wikiChips(md(n.memo))}</div>` : ""}
      <div class="nrow"><span class="npage">${n.page ? n.page + "쪽" : ""}</span>
        <button class="ndel" data-del="${n.id}">삭제</button></div>
    </div>`).join("") + hint;
  pane.querySelectorAll(".note-card").forEach((c) => {
    c.onclick = (e) => {
      if (e.target.closest("[data-del]")) return;
      const pg = +c.dataset.page;
      if (pg) S.pages[pg - 1]?.wrap.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
    };
  });
  pane.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      try { await api(`/api/papers/${S.current.id}/notes/${b.dataset.del}`, { method: "DELETE" }); loadNotes(); }
      catch (err) { toast(err.message, true); }
    };
  });
}

/* ---------------------------------------------------------------- summary */

function renderSummaryPane(mdText) {
  const pane = $("ipane-summary");
  if (!mdText) {
    pane.innerHTML = `<div class="ipane-hint">${icon("doc", 28)}<br>논문 전체를 구조화된 한국어 요약으로 정리합니다.</div>
      <div style="text-align:center;display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;">
        <button class="btn primary pressable" id="prep-btn">${icon("sparkle", 14)} 한 번에 준비</button>
        <button class="btn pressable" id="sum-btn">요약만 생성</button>
      </div>
      <div class="ipane-hint" style="padding:.6rem .75rem 0;">한 번에 준비 = 요약 + 핵심 4색 + 용어집 + 추천 질문</div>`;
    $("sum-btn").onclick = generateSummary;
    $("prep-btn").onclick = prepPaper;
    return;
  }
  pane.innerHTML = `<div class="prose">${md(mdText)}</div>
    <div class="row-actions" style="margin-top:1rem;">
      <button class="btn pressable" id="sum-re">${icon("sparkle", 13)} 다시 생성</button>
      <button class="btn pressable" id="prep-btn" title="핵심 4색·용어집·추천 질문 중 없는 것을 채웁니다">나머지 준비</button>
    </div>
    <div class="chat-chips" id="sum-q-chips"></div>`;
  $("sum-re").onclick = generateSummary;
  $("prep-btn").onclick = prepPaper;
  linkSummaryToKp();     // 문제의식/방법/핵심 결과/한계 섹션 → 4색 점프 연동
  renderSumQuestions();
}

/* 요약 탭에서도 추천 질문 칩을 보여준다 — 클릭은 채팅 탭의 칩과 동일 로직(askChip) 재사용 */
function renderSumQuestions() {
  const box = $("sum-q-chips");
  if (!box) return;
  if (S.q.items?.length) {
    box.hidden = false;
    box.innerHTML = S.q.items.map((t, i) => `<button class="chip" data-i="${i}">${esc(t)}</button>`).join("");
    box.querySelectorAll(".chip").forEach((b) => {
      b.onclick = () => { setTab("chat"); askChip(+b.dataset.i); };
    });
  } else if (S.q.items === null) {
    box.hidden = false;
    box.innerHTML = `<button class="btn pressable" id="sum-q-btn">${icon("sparkle", 13)} 추천 질문 보기</button>`;
    $("sum-q-btn").onclick = async () => { await ensureQuestions(); renderSumQuestions(); };
  } else {
    box.hidden = true; box.innerHTML = "";
  }
}

/* 원클릭 AI 준비 — 요약·핵심 4색·용어집·추천 질문을 병렬로 (서버 세마포어가 동시성 조절,
   이미 있는 것은 캐시 반환이라 재클릭·부분 준비에도 안전) */
async function prepPaper() {
  if (S.prepRunning) return;
  if (!S.textReady && !S.current.has_text) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
  const paperId = S.current.id;
  const alive = () => S.current?.id === paperId;
  S.prepRunning = true;
  const doneBusy = busy("AI 준비 0/4");
  let fin = 0;
  const tick = () => { fin++; if (alive()) $("busy-label").textContent = `AI 준비 ${fin}/4`; };
  const jobs = [
    (async () => {           // 요약 (GET 캐시 → 없으면 생성)
      let r = await api(`/api/papers/${paperId}/summary`).catch(() => null);
      if (!r?.markdown) r = await pj(`/api/papers/${paperId}/summary`, {});
      if (alive() && r?.markdown) renderSummaryPane(r.markdown);
    })(),
    (async () => {           // 핵심 4색 (표시는 K 토글 때)
      const r = await pj(`/api/papers/${paperId}/keypoints`, {});
      if (alive()) { S.kp.items = r.items || []; S.kp.placed = false; renderHlPane(); }
    })(),
    (async () => {           // 용어집 + 본문 밑줄
      const r = await pj(`/api/papers/${paperId}/glossary`, {});
      if (alive()) { S.gloss.items = r.items || []; S.gloss.placed = null; placeGlossary(); renderGlossaryPane(); }
    })(),
    (async () => {           // 추천 질문 칩
      const r = await pj(`/api/papers/${paperId}/questions`, {});
      if (alive()) { S.q.items = r.items || []; renderChatChips(); renderSumQuestions(); }
    })(),
  ].map((p) => p.finally(tick));
  const results = await Promise.allSettled(jobs);
  S.prepRunning = false;
  doneBusy();
  if (!alive()) return;
  const failed = results.filter((r) => r.status === "rejected").length;
  toast(failed ? `AI 준비 완료 — ${failed}건 실패 (해당 탭에서 다시 시도)` : "AI 준비 완료 — 요약·핵심·용어·질문");
}

async function generateSummary() {
  if (!S.textReady && !S.current.has_text) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
  const pane = $("ipane-summary");
  pane.innerHTML = "";
  pane.appendChild(starInline("논문 요약 생성 중… (30초~2분)"));
  const done = busy("요약 생성 중");
  try {
    const r = await pj(`/api/papers/${S.current.id}/summary`, {});
    renderSummaryPane(r.markdown);
  } catch (e) {
    renderSummaryPane(null);
    toast("요약 실패: " + e.message, true);
  } finally { done(); }
}

/* ---------------------------------------------------------------- 구조 분석 (8섹션)
   요약이 산문이라면 여기는 칸이다. 칸이 고정돼 있어 편끼리 같은 자리를 비교할 수 있고,
   각 칸은 그대로 근거 보드로 넘어가 집필 탭에서 절에 담긴다. */

async function ensureAnalysis() {
  if (S.an.data || S.an.running) { renderAnalysisPane(); return; }
  S.an.running = true;
  try {
    const r = await api(`/api/papers/${S.current.id}/analysis`);
    S.an.data = r.items || null;
  } catch { S.an.data = null; }          // 404 = 아직 안 만듦 — 버튼을 보여준다
  finally { S.an.running = false; renderAnalysisPane(); }
}

function renderAnalysisPane() {
  const pane = $("ipane-analysis");
  if (!pane) return;
  const items = S.an.data;
  if (!items) {
    pane.innerHTML = `<div class="ipane-hint">${icon("grid", 28)}<br>논문을 8개 칸으로 정리합니다.<br>
        기본 정보 · 연구 배경 · 이론 · 방법 · 데이터 · 결과 · 한계 · 적용</div>
      <div style="text-align:center;"><button class="btn primary pressable" id="an-run">${icon("sparkle", 14)} 구조 분석</button></div>
      <div class="ipane-hint" style="padding:.6rem .75rem 0;">칸마다 '근거 보드에 담기'가 붙어 집필 탭에서 절에 넣을 수 있습니다.</div>`;
    $("an-run").onclick = makeAnalysis;
    return;
  }
  const filled = items.filter((s) => s.body).length;
  pane.innerHTML =
    `<div class="mysum-stamp">8칸 중 ${filled}칸 채워짐 — 빈 칸은 논문에 그 내용이 없다는 뜻입니다</div>` +
    items.map((s) => `<div class="an-card${s.body ? "" : " empty"}">
        <div class="kp-head">${esc(s.title)}
          ${s.body ? `<button class="ndel an-copy" data-k="${esc(s.key)}" style="margin-left:auto;">복사</button>` : ""}</div>
        <div class="prose an-body">${s.body ? md(s.body) : `<span style="color:var(--ink-2);">—</span>`}</div>
      </div>`).join("") +
    `<div class="row-actions" style="margin-top:.9rem;">
      <button class="btn pressable" id="an-re">${icon("sparkle", 13)} 다시 분석</button>
      <button class="btn pressable" id="an-md">${icon("export", 13)} Markdown</button>
    </div>
    <div class="ipane-hint" style="text-align:left;padding:.6rem 0;">이 8칸은 근거 보드의 '구조 분석'에 함께 뜹니다 — 쓰기 탭에서 절에 담아 쓰세요.</div>`;
  pane.querySelectorAll(".an-copy").forEach((b) => {
    b.onclick = () => {
      const s = items.find((x) => x.key === b.dataset.k);
      if (s) copyText(s.body, `"${s.title}" 복사됨`);
    };
  });
  $("an-re").onclick = makeAnalysis;
  $("an-md").onclick = () => {
    const name = (S.current.title || "achird").replace(/[\\/:*?"<>|]/g, "").slice(0, 50);
    const text = [`# ${S.current.title || ""} — 구조 분석`, ""]
      .concat(items.filter((s) => s.body).flatMap((s) => [`## ${s.title}`, "", s.body, ""])).join("\n");
    downloadBlob(`${name}-분석.md`, new Blob([text], { type: "text/markdown;charset=utf-8" }));
    toast("구조 분석을 Markdown으로 내보냈습니다");
  };
}

async function makeAnalysis() {
  if (!S.textReady && !S.current.has_text) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
  const paperId = S.current.id;
  const pane = $("ipane-analysis");
  pane.innerHTML = "";
  pane.appendChild(starInline("8개 칸으로 정리하는 중… (30초~2분)"));
  const done = busy("구조 분석 중");
  try {
    const r = await pj(`/api/papers/${paperId}/analysis`, {});
    if (S.current?.id !== paperId) return;          // 그새 다른 논문으로 넘어갔으면 화면을 건드리지 않는다
    S.an.data = r.items || null;
    evData = null;                                   // 근거 보드 캐시 무효화 — 새 칸이 목록에 들어와야 한다
    renderAnalysisPane();
    toast("구조 분석 완료 — 근거 보드에서도 꺼낼 수 있습니다");
  } catch (e) {
    if (S.current?.id === paperId) renderAnalysisPane();
    toast("구조 분석 실패: " + e.message, true);
  } finally { done(); }
}

/* ---------------------------------------------------------------- chat */

function chatBubble(role, html, quote) {
  const div = document.createElement("div");
  div.className = "cmsg " + role;
  div.innerHTML = (quote ? `<div class="cite-src">${esc(quote)}</div>` : "") +
    `<div class="cbubble ${role === "ai" ? "prose" : ""}">${html}</div>`;
  $("chat-log").appendChild(div);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
  return div;
}

async function loadChat() {
  const id = S.current.id;
  $("chat-log").innerHTML = "";
  try {
    const hist = await api(`/api/papers/${id}/chat`);
    if (S.current?.id !== id) return;   // 로딩 중 다른 논문으로 이동 → 대화 오염 방지
    for (const m of hist) chatBubble(m.role === "user" ? "user" : "ai",
      m.role === "user" ? esc(m.content) : md(m.content), m.quote);
  } catch { /* empty history */ }
}

function renderChatQuote() {
  document.querySelector(".chat-pending")?.remove();
  if (!S.chatQuote) return;
  const chip = document.createElement("div");
  chip.className = "chat-pending src-chip";
  chip.style.margin = "0 .75rem .4rem";
  chip.innerHTML = `<span style="display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start;">
    <span>${esc(S.chatQuote.slice(0, 300))}</span>
    <button class="ndel" style="border:0;background:none;color:var(--ink-3);cursor:pointer;">${icon("x", 12)}</button></span>`;
  chip.querySelector("button").onclick = () => { S.chatQuote = null; renderChatQuote(); };
  $("chat-ta").parentElement.before(chip);
}

async function sendChat() {
  const ta = $("chat-ta");
  const q = ta.value.trim();
  if (!q) return;
  if (!S.textReady && !S.current.has_text) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
  const quote = S.chatQuote;
  S.chatQuote = null; renderChatQuote();
  ta.value = ""; ta.style.height = "auto";
  $("chat-send").disabled = true;
  chatBubble("user", esc(q), quote);
  const waiting = chatBubble("ai", "");
  waiting.querySelector(".cbubble").appendChild(starInline("생각 중…"));
  const done = busy("채팅 응답 중");
  try {
    const r = await pj(`/api/papers/${S.current.id}/chat`, { question: q, quote });
    waiting.querySelector(".cbubble").innerHTML = md(r.answer);
  } catch (e) {
    waiting.querySelector(".cbubble").innerHTML = `<span style="color:var(--danger)">응답 실패 — ${esc(e.message)}</span>`;
  } finally {
    done(); $("chat-send").disabled = false;
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
  }
}

function initChat() {
  $("chat-send").innerHTML = icon("send", 16);
  $("chat-send").onclick = sendChat;
  const ta = $("chat-ta");
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
  });
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 128) + "px";
  });
}

/* ---------------------------------------------------------------- suggested questions (추천 질문 칩)
   채팅 탭을 처음 열 때 논문당 1회 생성·캐시. 칩 클릭 → 그 질문으로 바로 채팅. */

function renderChatChips() {
  const box = $("chat-chips");
  if (S.q.running) {
    box.hidden = false;
    box.innerHTML = "";
    box.appendChild(starInline("추천 질문 만드는 중…"));
    return;
  }
  const items = S.q.items;
  if (!items?.length) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = items.map((t, i) => `<button class="chip" data-i="${i}">${esc(t)}</button>`).join("");
  box.querySelectorAll(".chip").forEach((b) => {
    b.onclick = () => askChip(+b.dataset.i);
  });
}

/* 칩 클릭 공통 로직 — 채팅 탭 칩, 요약 탭 칩(renderSumQuestions) 둘 다 재사용 */
function askChip(i) {
  const t = S.q.items?.[i];
  if (!t) return;
  S.q.items.splice(i, 1);    // 물어본 칩은 소비
  renderChatChips();
  renderSumQuestions();
  $("chat-ta").value = t;
  sendChat();
}

async function ensureQuestions() {
  if (!S.current || S.q.items !== null || S.q.running) return;
  if (!S.textReady && !S.current.has_text) return;   // 본문 준비 전 — 다음 탭 방문 때 재시도
  const paperId = S.current.id;
  S.q.running = true;
  renderChatChips();
  try {
    const r = await pj(`/api/papers/${paperId}/questions`, {});
    if (S.current?.id !== paperId) return;
    S.q.items = r.items || [];
  } catch {
    if (S.current?.id === paperId) S.q.items = [];   // 실패는 조용히 — 채팅 본기능과 무관한 장식
  } finally {
    if (S.current?.id === paperId) { S.q.running = false; renderChatChips(); }
  }
}

/* ---------------------------------------------------------------- references / citations */

function parseRefsClient() {
  // 전 페이지 추출이 끝나기 전에 돌면 부분 목록이 캐시돼 완전 파싱을 막는다
  if (!S.textReady || S.refs.items.length) return;
  const all = S.pages.map((p) => p.raw).join("\n");
  const m = all.search(/\n\s*(references|bibliography|참\s*고\s*문\s*헌|인용\s*문헌)\s*\n/i);
  if (m === -1) return;
  const tail = all.slice(m);
  const marks = [...tail.matchAll(/\[\s*(\d{1,3})\s*\]/g)];
  const items = [];
  for (let i = 0; i < marks.length; i++) {
    const n = marks[i][1];
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : Math.min(tail.length, start + 1200);
    const text = tail.slice(start, end).replace(/\s+/g, " ").trim();
    if (text.length > 15 && !items.some((x) => x.n === n)) items.push({ n, text });
  }
  if (items.length >= 3) {
    S.refs = { style: "numeric", items };
    S.refMap = new Map(items.map((x) => [x.n, x.text]));
    buildRefLinks();
  }
}

/* 참고문헌 → 서재 내 다른 논문 매칭 (AI 없이 순수 문자열 매칭: doi 포함 또는 정규화한 제목 포함) */
function buildRefLinks() {
  S.refLinks = new Map();
  if (!S.papers.length || !S.refs.items.length) return;
  const alnum = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cands = S.papers.filter((p) => p.id !== S.current?.id).map((p) => {
    const sig = alnum(p.title);
    return { id: p.id, title: p.title, doi: p.doi ? String(p.doi).toLowerCase() : "", sig: sig.length >= 15 ? sig : "" };
  }).filter((c) => c.doi || c.sig);
  if (!cands.length) return;
  for (const r of S.refs.items) {
    const refNorm = alnum(r.text), refLow = r.text.toLowerCase();
    /* 검증된 DOI가 있으면 그것부터 — 완전일치라 제목 부분일치보다 오탐이 없다 */
    const vdoi = r.oa?.doi ? String(r.oa.doi).toLowerCase() : "";
    const hit = cands.find((c) => (vdoi && c.doi === vdoi))
      || cands.find((c) => (c.sig && refNorm.includes(c.sig)) || (c.doi && refLow.includes(c.doi)));
    if (hit) S.refLinks.set(r.n, { id: hit.id, title: hit.title });
  }
}

/* 검증 결과 한 줄 — 찾았으면 링크·연도·저널, 못 찾았으면 미확인. 지어내지 않는 게 요점이다. */
function refVerifyHTML(r) {
  if (r.oa === undefined) return "";
  if (!r.oa) return `<br><span class="ref-unver">⚠ 미확인 — OpenAlex에서 찾지 못했습니다</span>`;
  const w = r.oa;
  const who = [w.year || "", w.venue || ""].filter(Boolean).join(" · ");
  const href = w.doi ? `https://doi.org/${w.doi}` : w.url;
  return `<br><span class="ref-ver">✓ ${esc(who || "확인됨")}</span>` +
    (href ? ` <a class="ref-doi" href="${esc(href)}" target="_blank" rel="noopener">${esc(w.doi || "OpenAlex")}</a>` : "");
}

function renderRefsPane() {
  const pane = $("ipane-refs");
  const items = S.refs.items || [];
  const checked = items.filter((r) => r.oa !== undefined).length;
  const ok = items.filter((r) => r.oa).length;
  let html = `<div class="row-actions">
      <button class="btn pressable" id="refs-ai">${icon("sparkle", 13)} AI로 재분석</button>
      <button class="btn pressable" id="refs-verify">${icon("book", 13)} 출처 검증</button>
      <button class="btn pressable" id="refs-related">${icon("graph", 13)} 심화 검색</button>
    </div><div id="related-box"></div>`;
  if (!items.length) {
    html += `<div class="ipane-hint">${icon("book", 28)}<br>참고문헌 목록을 찾지 못했습니다.<br>AI 재분석을 시도해보세요.</div>`;
  } else {
    if (checked) {
      html += `<div class="mysum-stamp">${checked}건 검증 · 확인 ${ok}건 · 미확인 ${checked - ok}건</div>`;
    }
    html += items.map((r) => {
      const link = S.refLinks.get(r.n);
      return `<div class="ref-item"><span class="rn">[${esc(r.n)}]</span>` +
        `<span>${esc(r.text)}${refVerifyHTML(r)}</span>` +
        (link ? `<button class="ref-lib-badge" data-open="${link.id}">서재에 있음</button>` : "") +
        `</div>`;
    }).join("");
  }
  pane.innerHTML = html;
  pane.querySelectorAll(".ref-lib-badge").forEach((b) => {
    b.onclick = () => { const p = S.papers.find((x) => x.id === b.dataset.open); if (p) openPaper(p); };
  });
  $("refs-ai").onclick = async () => {
    const done = busy("참고문헌 분석 중");
    try {
      const data = await pj(`/api/papers/${S.current.id}/refs`, {});
      S.refs = data;
      S.refMap = new Map((data.items || []).map((x) => [String(x.n), x.text]));
      buildRefLinks();
      renderRefsPane();
      S.pages.forEach((st) => st.rendered && applyCiteHotspots(st));
      toast(`참고문헌 ${data.items.length}건 정리됨`);
    } catch (e) { toast("재분석 실패: " + e.message, true); }
    finally { done(); }
  };
  $("refs-verify").onclick = runRefVerify;
  $("refs-related").onclick = () => runRelated(false);
}

/* ---- 출처 검증: 참고문헌 한 줄씩 OpenAlex에 물어 DOI·서지를 붙인다.
   서재 밖으로 나가고 건당 한 번씩 조회하므로 명시적 클릭으로만 발동한다.
   결과는 refs.json에 남아 인용 그래프의 매칭도 DOI 완전일치로 올라간다. ---- */

async function runRefVerify() {
  const n = (S.refs.items || []).length;
  if (!n) { toast("먼저 'AI로 재분석'으로 참고문헌을 정리하세요", true); return; }
  const done = busy(`출처 검증 중 (${n}건)`);
  try {
    /* 클라이언트 정규식 파싱본은 서버에 없다 — 같이 보내 저장까지 시킨다 */
    const data = await pj(`/api/papers/${S.current.id}/refs/verify`,
      { items: S.refs.items, style: S.refs.style });
    S.refs = data;
    S.refMap = new Map((data.items || []).map((x) => [String(x.n), x.text]));
    buildRefLinks();
    renderRefsPane();
    S.pages.forEach((st) => st.rendered && applyCiteHotspots(st));
    const miss = data.checked - data.verified;
    toast(`검증 ${data.checked}건 — 확인 ${data.verified}건${miss ? ` · 미확인 ${miss}건` : ""}`);
  } catch (e) {
    toast("출처 검증 실패 — " + e.message, true);
  } finally { done(); }
}

/* ---- 심화 검색: OpenAlex에서 이 논문을 인용한 논문 + 관련 논문. 서버가 캐시(related.json)하고
   '서재에 있음'까지 붙여 준다. 서재 밖으로 나가는 유일한 기능이라 명시적 클릭으로만 발동한다. ---- */

async function runRelated(refresh) {
  const box = $("related-box");
  if (!box) return;
  box.innerHTML = `<div class="ipane-hint">OpenAlex에서 찾는 중…</div>`;
  const done = busy("심화 검색 중");
  try {
    const r = await api(`/api/papers/${S.current.id}/related${refresh ? "?refresh=1" : ""}`);
    renderRelated(r);
  } catch (e) {
    box.innerHTML = `<div class="ipane-hint" style="color:var(--danger);">심화 검색 실패 — ${esc(e.message)}</div>`;
  } finally { done(); }
}

function relatedItem(w) {
  const who = [w.authors[0] || "", w.year || "", w.venue || ""].filter(Boolean).join(" · ");
  /* 서재에 없는 논문은 담아둘 곳이 필요하다 — 없으면 탭으로 흘려보내고 다시 못 찾는다 */
  const badge = w.in_library
    ? `<button class="ref-lib-badge" data-open="${esc(w.in_library)}">서재에 있음</button>`
    : `<button class="ref-lib-badge rel-queue" data-oa="${esc(w.oa_id)}" title="읽을 논문 대기열에 담기">담기</button>`;
  /* Zotero 는 서지의 정본 — 발견한 논문을 서재 대기열과 별개로 Zotero 라이브러리에도 밀어 넣는다 */
  const zot = `<button class="ref-lib-badge rel-zot" data-zot="${esc(w.oa_id)}" title="실행 중인 Zotero에 서지 저장">Zotero</button>`;
  return `<div class="ref-item">
      <span class="rn">${w.cited_by_count}</span>
      <span><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a>
        <br><span style="color:var(--ink-2);font-size:.75rem;">${esc(who)}</span></span>
      ${badge}${zot}
    </div>`;
}

async function zoteroSave(w, btn) {
  if (btn) btn.disabled = true;
  try {
    await pj("/api/zotero/save", { title: w.title, doi: w.doi, year: w.year,
                                   venue: w.venue, authors: w.authors, url: w.url });
    toast("Zotero에 저장했습니다 — 현재 선택된 컬렉션에 들어갑니다");
    if (btn) btn.textContent = "저장됨";
  } catch (e) {
    toast(e.message, true);
    if (btn) btn.disabled = false;
  }
}

function renderRelated(r) {
  const box = $("related-box");
  if (!box) return;
  const cited = r.cited_by || [], rel = r.related || [];
  const section = (title, items, empty) =>
    `<div class="kp-head" style="margin-top:.7rem;">${esc(title)}</div>` +
    (items.length ? items.map(relatedItem).join("")
                  : `<div class="ipane-hint" style="padding:.6rem 0;">${esc(empty)}</div>`);
  box.innerHTML =
    `<div class="mysum-stamp">${esc(r.work.title)} — 총 피인용 ${r.work.cited_by_count}회` +
    (r.cached ? " · 저장된 결과" : "") + `</div>` +
    section(`이 논문을 인용한 논문 (${r.cited_by_total}건 중 ${cited.length})`, cited, "아직 인용한 논문이 없습니다.") +
    section("관련 논문", rel, "관련 논문을 찾지 못했습니다.") +
    `<div class="row-actions"><button class="btn pressable" id="rel-refresh">${icon("sparkle", 13)} 다시 받기</button></div>` +
    `<div class="ipane-hint" style="padding:.5rem 0;text-align:left;">출처 OpenAlex (CC0). '관련 논문'은 OpenAlex가 고른 것이라 주제가 어긋나는 경우가 있다.</div>`;
  wireOaBadges(box, [...cited, ...rel]);
  $("rel-refresh").onclick = () => runRelated(true);
}

function expandCiteNums(expr) {
  const out = [];
  for (const part of expr.split(/[,;]/)) {
    const m = part.match(/(\d{1,3})\s*[–-]\s*(\d{1,3})/);
    if (m) { for (let i = +m[1]; i <= Math.min(+m[2], +m[1] + 20); i++) out.push(String(i)); }
    else { const s = part.match(/\d{1,3}/); if (s) out.push(s[0]); }
  }
  return [...new Set(out)];
}

function applyCiteHotspots(st) {
  if (!st.rendered || !st.textDivs) return;
  st.wrap.querySelectorAll(".cite-hot").forEach((e) => e.remove());
  const wrapRect = st.wrap.getBoundingClientRect();
  const re = /\[\s*\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*\s*\]/;
  st.tc.items.forEach((it, i) => {
    if (!re.test(it.str)) return;
    // 참고문헌 목록 페이지 자체는 건너뛴다 (본문 인용만 핫스팟)
    if (/^(\[\s*\d{1,3}\s*\])\s*[A-Z가-힣]/.test(it.str.trim()) && it.str.length > 60) return;
    const d = st.textDivs[i];
    if (!d) return;
    const r = d.getBoundingClientRect();
    if (r.width < 1) return;
    const hot = document.createElement("div");
    hot.className = "cite-hot";
    hot.style.left = r.left - wrapRect.left + "px";
    hot.style.top = r.top - wrapRect.top + "px";
    hot.style.width = r.width + "px";
    hot.style.height = r.height + "px";
    hot.title = "인용 보기";
    hot.onclick = (e) => {
      e.stopPropagation();
      const nums = expandCiteNums(it.str.match(re)[0]);
      showCiteRefs(nums, hot.getBoundingClientRect());
    };
    st.wrap.appendChild(hot);
  });
}

function showCiteRefs(nums, rect) {
  if (!S.refs.items.length) parseRefsClient();
  const found = nums.map((n) => ({ n, text: S.refMap.get(n) })).filter((x) => x.text);
  if (!found.length) {
    popShell(rect, `<div style="font-size:.8125rem;color:var(--ink-2);">참고문헌 목록에서 [${esc(nums.join(", "))}]를 찾지 못했습니다.<br>인용 탭에서 'AI로 재분석'을 실행해보세요.</div>`);
    return;
  }
  const pop = popShell(rect, found.map((f) => {
    const link = S.refLinks.get(f.n);
    return `<div style="margin-bottom:.6rem;"><span class="cp-n">[${esc(f.n)}]</span>${esc(f.text)}` +
      (link ? `<br><button class="btn pressable ref-open" data-open="${link.id}">서재에서 열기 → ${esc(link.title.slice(0, 28))}${link.title.length > 28 ? "…" : ""}</button>` : "") +
      `</div>`;
  }).join(""));
  pop.querySelectorAll(".ref-open").forEach((b) => {
    b.onclick = () => {
      const p = S.papers.find((x) => x.id === b.dataset.open);
      hideCitePop(true);
      if (p) openPaper(p);
    };
  });
}

/* ---------------------------------------------------------------- 그림·수식 갤러리 (해설된 그림·표, 전사된 수식 모아보기) */

/* 갤러리 사이드카 1회 로드 공통기: S[field]가 null(아직)일 때만 받아온다.
   논문을 갈아탄 뒤 도착한 응답은 버린다(paperId 가드). */
async function ensureGallery(field, endpoint) {
  if (!S.current || S[field] !== null) return;
  const paperId = S.current.id;
  renderFigPane();          // "불러오는 중" (S[field] === null)
  try {
    const r = await api(`/api/papers/${paperId}/${endpoint}`);
    if (S.current?.id !== paperId) return;
    S[field] = r.items || [];
  } catch {
    if (S.current?.id === paperId) S[field] = [];
  }
  if (S.current?.id === paperId) renderFigPane();
}

function ensureFigures() { return ensureGallery("figs", "figures"); }
function ensureFormulas() { return ensureGallery("formulas", "formulas"); }

function renderFigPane() {
  const pane = $("ipane-fig");
  if (!pane) return;
  if (S.figs === null || S.formulas === null) { pane.innerHTML = `<div class="ipane-hint">${icon("fig", 28)}<br>불러오는 중…</div>`; return; }
  if (!S.figs.length && !S.formulas.length) {
    pane.innerHTML = `<div class="ipane-hint">${icon("fig", 28)}<br>아직 해설한 그림·수식이 없습니다.<br>그림·수식을 드래그 캡처(C)하거나, 텍스트 선택 → 그림·표 버튼으로 해설을 만들 수 있어요.</div>`;
    return;
  }
  let html = S.figs.map((f) => `
    <div class="fig-card">
      <button class="toc-item" data-n="${f.n}">${f.n}쪽${f.hint ? " · " + esc(f.hint) : ""}</button>
      <div class="prose">${md(f.md)}</div>
    </div>`).join("");
  if (S.formulas.length) {
    html += `<h4 style="margin:.9rem 0 .5rem;font-size:.75rem;color:var(--ink-2);">수식</h4>` +
      S.formulas.map((f, i) => `
      <div class="fig-card">
        <button class="toc-item" data-n="${f.n}">${f.n}쪽${f.hint ? " · " + esc(f.hint) : ""}</button>
        <pre class="formula-tex">${esc(f.latex)}</pre>
        <div class="row-actions" style="margin-bottom:.4rem;">
          <button class="btn pressable" data-copy-formula="${i}">${icon("copy", 13)} LaTeX 복사</button>
        </div>
        <div class="prose">${md(f.explain)}</div>
      </div>`).join("");
  }
  pane.innerHTML = html;
  pane.querySelectorAll(".toc-item").forEach((b) => {
    b.onclick = () => gotoPage(+b.dataset.n);
  });
  pane.querySelectorAll("[data-copy-formula]").forEach((b) => {
    b.onclick = () => copyText(S.formulas[+b.dataset.copyFormula].latex, "LaTeX 복사됨");
  });
}

/* 새 그림 해설이 생기면(aiFigure/captureRegion 성공) 캐시를 무효화 — 그림 탭이 열려 있으면
   즉시 새로고침, 아니면 다음에 그림 탭을 열 때(ensureFigures) 다시 받아온다 */
function invalidateFigs(paperId) {
  if (S.current?.id !== paperId) return;
  S.figs = null;
  if ($("ipane-fig")?.classList.contains("on")) ensureFigures();
}

/* 새 수식 전사가 생기면(captureFormula 성공) 캐시 무효화 — invalidateFigs와 같은 패턴 */
function invalidateFormulas(paperId) {
  if (S.current?.id !== paperId) return;
  S.formulas = null;
  if ($("ipane-fig")?.classList.contains("on")) ensureFormulas();
}

/* ---------------------------------------------------------------- config + export/import */

let CFG = null;
async function loadConfig() {
  if (CFG) return CFG;
  try { CFG = await api("/api/config"); } catch { CFG = {}; }
  return CFG;
}
async function saveConfig(patch) { CFG = await pj("/api/config", patch, "PUT"); return CFG; }

async function renderExportPane() {
  const pane = $("ipane-export");
  const paperId = S.current?.id;
  if (!paperId) return;
  const cfg = await loadConfig();
  if (S.current?.id !== paperId) return;    // 로딩 중 다른 논문으로 이동
  pane.innerHTML = `
    <div id="cite-box" style="margin-bottom:1.1rem;padding-bottom:1rem;border-bottom:.5px solid var(--sep);"></div>
    <div style="margin-bottom:1rem;">
      <label style="display:block;font-size:.75rem;color:var(--ink-2);margin-bottom:.3rem;">Obsidian 볼트 경로</label>
      <input id="vault-path" type="text" placeholder="C:\\Users\\...\\Obsidian Vault"
        value="${esc(cfg.obsidian_vault_path || "")}"
        style="width:100%;box-sizing:border-box;padding:.45rem .6rem;border:.5px solid var(--sep-strong);border-radius:var(--r-sm);background:var(--surface);color:inherit;font-size:.8125rem;">
      <button class="btn pressable" id="vault-save" style="margin-top:.5rem;">경로 저장</button>
    </div>
    <label style="display:flex;gap:.4rem;align-items:center;font-size:.8125rem;margin-bottom:.4rem;cursor:pointer;">
      <input type="checkbox" id="opt-trans" ${cfg.export_translation ? "checked" : ""}> 전체 번역 포함</label>
    <label style="display:flex;gap:.4rem;align-items:center;font-size:.8125rem;margin-bottom:.4rem;cursor:pointer;">
      <input type="checkbox" id="opt-chat" ${cfg.export_chat ? "checked" : ""}> AI 대화 포함</label>
    <label style="display:flex;gap:.4rem;align-items:center;font-size:.8125rem;margin-bottom:.4rem;cursor:pointer;"
      title="쓰기 탭의 '인용' 버튼이 (저자, 연도, p.N) 대신 [@citekey, p.N]을 넣습니다. Zotero(Better BibTeX) citekey가 있는 논문에만 적용됩니다.">
      <input type="checkbox" id="opt-citekey" ${cfg.cite_citekey ? "checked" : ""}> 인용을 [@citekey] 형식으로 (pandoc·Obsidian용)</label>
    <label style="display:flex;gap:.4rem;align-items:center;font-size:.8125rem;margin-bottom:1rem;cursor:pointer;"
      title="업로드·Zotero 가져오기 직후 서지·요약·핵심 4색·용어집·추천 질문·출처 검증을 백그라운드로 자동 실행합니다 (번역 제외).">
      <input type="checkbox" id="opt-prep" ${cfg.auto_prep ? "checked" : ""}> 논문 유입 시 자동 준비</label>
    <div class="row-actions">
      <button class="btn primary pressable" id="exp-one">${icon("export", 14)} 이 논문 내보내기</button>
      <button class="btn pressable" id="exp-diff" title="마지막 내보내기 이후 요약·강조·노트 등이 바뀐 논문만 다시 내보냅니다">변경분만</button>
      <button class="btn pressable" id="exp-all">전체 내보내기</button>
    </div>
    <div id="exp-open" style="padding:0 .5rem;"></div>
    <div class="ipane-hint" style="padding:1rem .5rem;text-align:left;">볼트의 <b>${esc(cfg.obsidian_subfolder || "Achird")}/</b> 폴더에 노트와 PDF가 저장됩니다. 노트 맨 아래 "내 메모"는 재내보내기해도 보존됩니다.</div>`;
  $("vault-save").onclick = async () => {
    try { await saveConfig({ obsidian_vault_path: $("vault-path").value.trim() }); toast("경로 저장됨"); renderExportPane(); }
    catch (e) { toast(e.message, true); }
  };
  const syncOpts = async () => {
    try {
      await saveConfig({ export_translation: $("opt-trans").checked, export_chat: $("opt-chat").checked,
                         cite_citekey: $("opt-citekey").checked, auto_prep: $("opt-prep").checked });
    } catch (e) { toast(e.message, true); }
  };
  $("opt-trans").onchange = syncOpts;
  $("opt-chat").onchange = syncOpts;
  $("opt-citekey").onchange = syncOpts;
  $("opt-prep").onchange = syncOpts;
  $("exp-one").onclick = async () => {
    if (!S.current) return;
    const done = busy("Obsidian 내보내기");
    try {
      const r = await pj(`/api/papers/${S.current.id}/export/obsidian`, {});
      toast(`내보냄: ${r.filename}`);
      $("exp-open").innerHTML = `<a class="btn pressable" style="text-decoration:none;" href="obsidian://open?path=${encodeURIComponent(r.path)}">Obsidian에서 열기</a>`;
    }
    catch (e) { toast("내보내기 실패: " + e.message, true); }
    finally { done(); }
  };
  const bulkExport = (changedOnly) => async () => {
    const done = busy(changedOnly ? "변경분 내보내기" : "전체 내보내기");
    try {
      const r = await pj("/api/export/obsidian", { changed_only: changedOnly });
      const parts = [`${r.count}편 내보냄`];
      if (changedOnly) parts.push(`변경 없음 ${r.skipped}편`);
      if (r.failed?.length) parts.push(`${r.failed.length}편 실패`);
      toast(parts.join(" · "));
    } catch (e) { toast("내보내기 실패: " + e.message, true); }
    finally { done(); }
  };
  $("exp-diff").onclick = bulkExport(true);
  $("exp-all").onclick = bulkExport(false);
  renderCiteBox(paperId);
}

/* ---- 인용 복사: BibTeX/ACS/APA는 저장된 서지정보로 서버가 즉시 조립한다(AI 호출 없음) —
   내보내기 탭을 열 때마다 새로 받아온다. 서지정보가 아직 없으면 빈 인용 대신 추출 액션을 안내한다. ---- */
async function renderCiteBox(paperId) {
  const box = $("cite-box");
  if (!box) return;
  let data = null;
  try { data = await api(`/api/papers/${paperId}/cite`); } catch { /* best-effort */ }
  if (S.current?.id !== paperId) return;      // 로딩 중 다른 논문으로 이동
  if (!data) {
    box.innerHTML = `<div style="color:var(--danger);font-size:.8125rem;">인용 정보를 불러오지 못했습니다.</div>`;
    return;
  }
  const hasMeta = !!(S.current.authors?.length || S.current.year || S.current.venue || S.current.doi);
  if (!hasMeta) {
    box.innerHTML = `<div class="row-actions" style="margin-bottom:.5rem;">
        <button class="btn pressable" id="cite-meta-btn">${icon("sparkle", 13)} ${S.current.meta_ai ? "서지정보 다시 추출" : "서지정보 추출"}</button>
      </div>
      <div class="ipane-hint" style="padding:0 .25rem;text-align:left;">아직 서지정보(저자·연도·출처)를 추출하지 못해 인용을 만들 수 없습니다.</div>`;
    $("cite-meta-btn").onclick = async () => {
      if (!S.textReady && !S.current.has_text) { toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true); return; }
      const done = busy("서지정보 추출 중");
      try {
        const meta = await pj(`/api/papers/${paperId}/metadata`, {});
        if (S.current?.id === paperId) Object.assign(S.current, meta);
        renderCiteBox(paperId);
      } catch (e) { toast("서지정보 추출 실패: " + e.message, true); }
      finally { done(); }
    };
    return;
  }
  box.innerHTML = `
    <h4 style="margin:0 0 .55rem;font-size:.75rem;color:var(--ink-2);">인용</h4>
    <div class="src-chip">${esc(data.acs)}</div>
    <div class="row-actions" style="margin-bottom:0;">
      <button class="btn pressable" data-cite="bibtex">${icon("copy", 13)} BibTeX 복사</button>
      <button class="btn pressable" data-cite="acs">${icon("copy", 13)} ACS 복사</button>
      <button class="btn pressable" data-cite="apa">${icon("copy", 13)} APA 복사</button>
    </div>`;
  box.querySelectorAll("[data-cite]").forEach((b) => {
    const kind = b.dataset.cite, label = { bibtex: "BibTeX", acs: "ACS", apa: "APA" }[kind];
    b.onclick = () => copyText(data[kind], `${label} 복사됨`);
  });
}

async function openZoteroImport() {
  const list = $("zlist"), msg = $("zmsg");
  const close = openDialog("zscrim", "zcancel");
  msg.textContent = "Zotero 라이브러리를 읽는 중…";
  list.innerHTML = ""; $("zok").disabled = true;
  let items = [];
  try { items = await api("/api/import/zotero"); }
  catch (e) { msg.textContent = "읽기 실패: " + e.message; return; }
  if (!items.length) {
    msg.textContent = "새로 가져올 논문이 없습니다 — 이미 서재에 있는 논문은 목록에 표시되지 않습니다.";
    return;
  }
  msg.textContent = `PDF가 있는 논문 ${items.length}건. 가져올 항목을 선택하세요.`;
  list.innerHTML = items.map((it, i) => `
    <label class="zrow${it.resolved ? "" : " off"}">
      <input type="checkbox" data-i="${i}" ${it.resolved ? "" : "disabled"}>
      <span class="ztext"><b>${esc(it.title)}</b>
        <span class="zsub">${esc((it.creators || []).slice(0, 3).join(", "))}${it.pdf_name ? " · " + esc(it.pdf_name) : ""}${it.citekey ? " · @" + esc(it.citekey) : ""}${it.resolved ? "" : " · PDF 경로 미해석"}</span>
      </span>
    </label>`).join("");
  $("zok").disabled = false;
  $("zok").onclick = async () => {
    const keys = [...list.querySelectorAll("input:checked")].map((c) => items[+c.dataset.i].att_key);
    if (!keys.length) { toast("선택된 논문이 없습니다", true); return; }
    close();
    const done = busy("Zotero 가져오는 중");
    try {
      const r = await pj("/api/import/zotero", { keys });
      toast(`${r.imported.length}편 가져옴${r.skipped.length ? `, ${r.skipped.length}편 건너뜀` : ""}`);
      loadPapers();
    } catch (e) { toast("가져오기 실패: " + e.message, true); }
    finally { done(); }
  };
}

/* ---------------------------------------------------------------- parallel translation view */

function setView(v) {
  S.view = v;                                  // 'pdf' | 'parallel' | 'map'
  const parallel = v === "parallel", map = v === "map";
  const wide = parallel || map;                // 둘 다 가로 폭이 필요 — 인스펙터 자동 접기 대상
  $("pages").classList.toggle("parallel", parallel);
  $("parallel-bar").hidden = !parallel;
  $("trans-btn").classList.toggle("on", parallel);
  $("map-btn").classList.toggle("on", map);
  $("map-well").hidden = !map;
  $("pages-scroll").style.display = map ? "none" : "";
  hideSelPop(true); hideCitePop(true);
  // 병렬은 가로 폭이 필요 → 인스펙터 자동 접기 (병렬 끌 때 복원) — 단, 방금 수동으로
  // 토글했다면(inspUserPinned) 이번 전환 한 번은 자동 접기/펴기를 건너뛴다(star-btn과 충돌 방지)
  const insp = $("inspector");
  if (!S.inspUserPinned) {
    if (wide && !insp.classList.contains("hidden")) {
      insp.classList.add("hidden"); S.inspAutoHid = true;
    } else if (!wide && S.inspAutoHid) {
      insp.classList.remove("hidden"); S.inspAutoHid = false;
    }
  }
  S.inspUserPinned = false;
  if (map) { ensureMindmap(); return; }
  if (parallel) {
    renderParallelBar();
    S.pages.forEach(fillTransCell);
    queuePrefetch(currentPageNo());            // 병렬 진입 시점엔 아직 스크롤이 없어 예약을 직접 시드
  } else {
    S.prefetch.queue = [];                     // 단일 뷰로 나가면 대기열은 의미 없음 (진행 중 요청은 조용히 마무리)
  }
  setTimeout(reapplyAllHighlights, 60);        // 원문 폭 변화 후 하이라이트 재배치
}

function renderParallelBar() {
  const bar = $("parallel-bar");
  if (S.view !== "parallel") return;
  const N = S.pages.length;
  const have = S.pages.filter((st) => S.trans.pages[st.n] !== undefined).length;
  const missing = N - have;
  bar.innerHTML = "";
  // 좌: 상태
  if (S.trans.running) {
    bar.appendChild(starInline(`번역 중… ${have}/${N}쪽`));
  } else {
    const label = document.createElement("span");
    label.className = "pb-status";
    label.textContent = have === 0 ? `원문 옆에 번역을 나란히 표시합니다 · 전체 ${N}쪽`
      : missing > 0 ? `번역됨 ${have}/${N}쪽` : `번역 완료 · ${N}쪽`;
    bar.appendChild(label);
  }
  const sp = document.createElement("span"); sp.className = "pb-spacer";
  bar.appendChild(sp);
  if (S.trans.running) {                        // 번역 중 → 중지 버튼만 (재개는 '나머지 N쪽 번역')
    const stop = document.createElement("button");
    stop.className = "btn pressable";
    stop.innerHTML = `${icon("x", 13)} 중지`;
    stop.onclick = () => { S.trans.stop = true; stop.disabled = true; stop.innerHTML = "중지 중…"; };
    bar.appendChild(stop);
    return;
  }
  // 우: 문장 연결 토글 (번역이 하나라도 있을 때) — 번역과 함께 온 정렬 기반
  if (have > 0) {
    const aligned = S.pages.filter((st) => S.align.pages[st.n] !== undefined).length;
    const tgl = document.createElement("button");
    tgl.className = "btn pressable pb-linkbtn" + (S.align.on ? " on" : "");
    tgl.innerHTML = S.align.running
      ? `${icon("quote", 13)} 정렬 중 ${aligned}/${have} — 클릭해 중단`
      : `${icon("quote", 13)} 문장 연결${S.align.on ? " 끄기" : ""}`;
    tgl.onclick = toggleSentenceLink;
    bar.appendChild(tgl);
    const errN = Object.keys(S.align.err).length;
    if (errN > 0) {
      const retry = document.createElement("button");
      retry.className = "btn pressable";
      retry.textContent = `실패 ${errN}쪽 다시 시도`;
      retry.onclick = retryAlignErrors;
      bar.appendChild(retry);
    }
  }
  // 번역 시작/재개
  if (missing > 0) {
    const btn = document.createElement("button");
    btn.className = "btn primary pressable";
    btn.innerHTML = `${icon("translate", 14)} ${have === 0 ? "번역 시작" : `나머지 ${missing}쪽 번역`}`;
    btn.onclick = () => runTranslation(false);
    bar.appendChild(btn);
    /* 창을 닫으면 클라이언트 루프는 거기서 끝난다 — 서버에 걸어두면 다른 논문을 읽는 동안에도 돈다 */
    const bg = document.createElement("button");
    bg.className = "btn pressable";
    bg.innerHTML = `${icon("sparkle", 13)} 백그라운드로`;
    bg.title = "서버가 돌립니다 — 리더를 닫거나 다른 논문으로 가도 계속됩니다";
    bg.onclick = () => startTranslateJob([S.current.id]);
    bar.appendChild(bg);
  }
  // 우측 끝: 전체 재번역 (번역이 하나라도 있을 때)
  if (have > 0) {
    const all = document.createElement("button");
    all.className = "btn pressable";
    all.innerHTML = `${icon("translate", 13)} 전체 재번역`;
    all.onclick = (e) => confirmRetransAll(e.currentTarget.getBoundingClientRect());
    bar.appendChild(all);
  }
}

function fillTransCell(st) {
  const cell = st.transCell;
  if (!cell) return;
  const n = st.n;
  const v = S.trans.pages[n];
  let body;
  if (v !== undefined) {
    body = v.trim()
      ? `<div class="trans-body prose">${md(v)}</div>`
      : `<div class="trans-wait">이 페이지에는 번역할 텍스트가 없습니다.</div>`;
  } else if (S.trans.err[n]) {
    body = `<div class="trans-err">번역 실패 — ${esc(S.trans.err[n])}
      <button class="btn pressable" data-retry="${n}">다시 시도</button></div>`;
  } else if (S.trans.inflight.has(n)) {
    body = `<div class="trans-wait" data-inflight></div>`;
  } else {
    body = `<div class="trans-wait">${S.trans.running ? "대기 중…" : "미번역"}</div>`;
  }
  const inflight = S.trans.inflight.has(n);
  const tagRight = inflight
    ? `<span class="tc-busy">번역 중…</span>`
    : (v !== undefined
        ? `<button class="tc-retrans" data-retrans="${n}" title="이 페이지 재번역">${icon("translate", 12)} 재번역</button>`
        : "");
  cell.innerHTML = `<div class="tc-tag"><span>${n}쪽 번역</span>${tagRight}</div><div class="tc-scroll">${body}</div>`;
  if (inflight && v === undefined)
    cell.querySelector("[data-inflight]")?.appendChild(starInline("번역 중…"));
  if (S.align.on && v !== undefined && v.trim()) {   // 문장 연결 ON → 번역 문장 span 래핑
    const pairs = S.align.pages[n];
    const bodyEl = cell.querySelector(".trans-body");
    if (pairs && bodyEl) wrapSentences(bodyEl, pairs);
  }
  if (S.kp.on && v !== undefined && v.trim()) applyKpTransMarks(st);   // 핵심 4색 동기화
  cell.querySelector("[data-retrans]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    retranslatePage(n);                       // 셀 버튼은 이 페이지만 — 전체는 병렬 바 우측 버튼
  });
  cell.querySelector("[data-retry]")?.addEventListener("click", () => {
    delete S.trans.err[n];
    runTranslation(false);
  });
}

async function runTranslation(force = false) {
  if (S.trans.running || !S.pages.length) return;
  if (!S.textReady && !S.current.has_text) {
    toast("본문 추출 중입니다. 잠시 후 다시 시도해주세요.", true);
    return;
  }
  const T = S.trans;           // 논문 전환 시 새 객체로 교체되므로 로컬 참조에 고정
  const paperId = S.current.id;
  T.running = true; T.stop = false;
  const todo = [];
  for (let n = 1; n <= S.pages.length; n++) if (force || T.pages[n] === undefined) todo.push(n);
  if (!todo.length) { T.running = false; return; }
  const doneBusy = busy(`전체 번역 0/${todo.length}`);
  const alive = () => S.current?.id === paperId && S.trans === T;
  if (S.view === "parallel") { S.pages.forEach(fillTransCell); renderParallelBar(); }
  let fin = 0, idx = 0;
  const worker = async () => {
    while (!T.stop && idx < todo.length) {
      const n = todo[idx++];
      T.inflight.add(n);
      if (alive() && S.view === "parallel") fillTransCell(S.pages[n - 1]);
      try {
        const r = await pj(`/api/papers/${paperId}/translation/page`, { n, force });
        T.pages[n] = r.markdown;
        if (Array.isArray(r.pairs)) S.align.pages[n] = r.pairs;   // 번역과 함께 온 문장 정렬
        delete T.err[n];
      } catch (e) { T.err[n] = e.message; }
      T.inflight.delete(n);
      fin++;
      $("busy-label").textContent = `전체 번역 ${fin}/${todo.length}`;
      if (alive() && S.view === "parallel") { fillTransCell(S.pages[n - 1]); renderParallelBar(); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, todo.length) }, worker));
  T.running = false;
  doneBusy();
  if (alive()) {
    if (T.stop) {
      toast("번역을 중지했습니다");
    } else {
      const failed = Object.keys(T.err).length;
      toast(failed ? `번역 완료 — ${failed}쪽 실패 (해당 쪽에서 다시 시도)` : "전체 번역 완료");
    }
    if (S.view === "parallel") renderParallelBar();
  }
}

/* 단일 페이지 강제 재번역 — 기존 번역을 새 프롬프트(경계·각주·끝 앵커)로 갈아끼운다.
   번역 호출이 정렬을 함께 내므로 그 페이지 문장 정렬도 최신 형식으로 갱신된다. */
async function retranslatePage(n) {
  const T = S.trans;
  if (T.inflight.has(n)) return;
  const paperId = S.current.id;
  T.inflight.add(n);
  fillTransCell(S.pages[n - 1]);              // 헤더에 '번역 중…' 표시(본문은 기존 번역 유지)
  const done = busy(`${n}쪽 재번역`);
  try {
    const r = await pj(`/api/papers/${paperId}/translation/page`, { n, force: true });
    if (S.current?.id !== paperId) return;
    T.pages[n] = r.markdown;
    if (Array.isArray(r.pairs)) S.align.pages[n] = r.pairs;
    delete T.err[n];
  } catch (e) {
    T.err[n] = e.message;
    toast(`${n}쪽 재번역 실패: ${e.message}`, true);
  } finally {
    T.inflight.delete(n);
    done();
    if (S.current?.id === paperId && S.view === "parallel") {
      fillTransCell(S.pages[n - 1]);
      renderParallelBar();
    }
  }
}

/* 전체 재번역은 비용이 커서 원클릭 확인을 거친다 (페이지별 셀 버튼은 즉시 실행). */
function confirmRetransAll(rect) {
  const pop = popShell(rect, `<div class="retrans-opts">
      <button data-go>${icon("translate", 13)} 전체 ${S.pages.length}쪽을 다시 번역</button>
    </div>`);
  pop.querySelector("[data-go]").onclick = () => {
    hideCitePop(true);
    if (S.trans.running) { toast("이미 번역 중입니다"); return; }
    runTranslation(true);      // force → 모든 페이지 재번역 (병렬 바에 진행·중지 표시)
  };
}

/* ---------------------------------------------------------------- 다음 쪽 번역 프리페치 (병렬 뷰 전용)
   레이지 렌더러와 같은 가시성 신호(onIntersect)에서 currentPageNo()로 '현재 쪽'을 읽어 N+1·N+2를
   대기열에 넣는다. 사용자 작업(전체 번역·재번역)보다 항상 낮은 우선순위 — 동시 최대 1건, 사용자
   요청이 진행 중이면 아예 쏘지 않는다. 완전히 조용히: 스피너·토스트 없음, 실패해도 잊을 뿐(그
   쪽이 다시 현재 쪽 근처로 오면 자연히 재시도됨). */

function queuePrefetch(cur) {
  if (S.view !== "parallel" || !S.current || !S.pages.length) return;
  const Q = S.prefetch.queue;
  for (const cand of [cur + 1, cur + 2]) {
    if (cand < 1 || cand > S.pages.length) continue;
    if (S.trans.pages[cand] !== undefined) continue;    // 이미 번역/캐시됨
    if (S.trans.inflight.has(cand)) continue;            // 사용자 요청이 이미 처리 중
    if (S.prefetch.inflight.has(cand)) continue;          // 이미 프리페치 중
    if (Q.includes(cand)) continue;                       // 이미 대기 중
    Q.push(cand);
  }
  S.prefetch.queue = Q.filter((n) => Math.abs(n - cur) <= 2);   // 먼 쪽으로 점프 → 안 맞는 예약 폐기
  runPrefetch();
}

async function runPrefetch() {
  if (S.prefetch.inflight.size > 0) return;                   // 동시 1건 제한
  if (S.trans.running || S.trans.inflight.size > 0) return;   // 사용자 번역 작업이 항상 우선
  if (S.view !== "parallel" || !S.current) return;
  const T = S.trans, paperId = S.current.id;
  const n = S.prefetch.queue.shift();
  if (n === undefined) return;
  if (T.pages[n] !== undefined || T.inflight.has(n)) { runPrefetch(); return; }  // 그새 다른 경로로 채워짐
  S.prefetch.inflight.add(n);
  const alive = () => S.current?.id === paperId && S.trans === T;
  try {
    const r = await pj(`/api/papers/${paperId}/translation/page`, { n, force: false });
    if (alive()) {
      T.pages[n] = r.markdown;
      if (Array.isArray(r.pairs)) S.align.pages[n] = r.pairs;
      if (S.view === "parallel") { fillTransCell(S.pages[n - 1]); renderParallelBar(); }
    }
  } catch { /* 조용히 실패 — 스피너·토스트 없음. inflight만 정리하고 자연 재시도에 맡긴다 */ }
  finally {
    S.prefetch.inflight.delete(n);
    if (alive()) runPrefetch();        // 대기열에 남은 다음 후보 (최대 동시 1건 유지)
  }
}

/* ---------------------------------------------------------------- sentence linking (align) */

function toggleSentenceLink() {
  S.align.on = !S.align.on;
  if (!S.align.on) {
    clearLinkHighlights();
    S.linkPinned = null;
  }
  S.pages.forEach(fillTransCell);      // span 입히거나(on) 제거(off)
  renderParallelBar();
  if (S.align.on) runAlignment();      // 미정렬 페이지 haiku 백그라운드 정렬
}

/* 정렬 실패 페이지만 다시 시도 — 실패 기록을 지우면 runAlignment의 pending 계산에 다시 잡힌다 */
function retryAlignErrors() {
  const A = S.align;
  if (A.running || !Object.keys(A.err).length) return;
  for (const n of Object.keys(A.err)) delete A.err[n];
  A.on = true;
  S.pages.forEach(fillTransCell);
  renderParallelBar();
  runAlignment();
}

/* 정렬이 없는 페이지(번역 통합 이전의 구 번역)를 뒤늦게 정렬한다. 새 번역은 번역 호출이
   정렬을 함께 내므로 여기 오지 않는다 — 이 경로는 구 번역 보정용이라 페이지당 ~100초. */
async function runAlignment() {
  const A = S.align, T = S.trans;
  if (A.running) return;
  const paperId = S.current.id;
  const pending = [];
  for (let n = 1; n <= S.pages.length; n++)
    if (T.pages[n] !== undefined && T.pages[n].trim() && A.pages[n] === undefined) pending.push(n);
  if (!pending.length) { renderParallelBar(); return; }
  A.running = true;
  renderParallelBar();
  const alive = () => S.current?.id === paperId && S.align === A;
  let idx = 0;
  const worker = async () => {
    while (A.on && idx < pending.length) {
      const n = pending[idx++];
      A.inflight.add(n);
      if (alive() && S.view === "parallel") renderParallelBar();
      try {
        const r = await pj(`/api/papers/${paperId}/align/page`, { n });
        A.pages[n] = r.pairs;
        delete A.err[n];
      } catch (e) { A.err[n] = e.message; }
      A.inflight.delete(n);
      if (alive() && S.view === "parallel") {
        if (S.align.on) fillTransCell(S.pages[n - 1]);
        renderParallelBar();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker));
  A.running = false;
  if (alive()) {
    const errN = Object.keys(A.err).length;
    if (errN) toast(`문장 정렬 실패 ${errN}쪽`, true);
    if (S.view === "parallel") renderParallelBar();
  }
}

/* 각 문장의 [시작, 끝] 정규화 인덱스 범위. sk/ek = 시작·끝 앵커 키(원문 s/se, 번역 t/te).
   끝 앵커로 문장 끝을 확정하므로 "다음 앵커"에 의존하지 않는다 — 마지막 문장이 페이지 끝
   (각주 등)까지 번지거나 섹션 경계에서 어긋나는 문제를 없앤다. 앞 문장 뒤부터 검색(cursor)해
   앵커 중복 시 순서를 지킨다. 못 찾으면 null. 끝 앵커가 없으면 시작 앵커까지만(안전 폴백). */
function anchorRange(anchors, norm, sk, ek) {
  const out = []; let cursor = 0;
  for (const a of anchors) {
    const snq = normQuery(a[sk] || "");
    if (snq.length < 3) { out.push(null); continue; }
    const start = norm.indexOf(snq, cursor);
    if (start === -1) { out.push(null); continue; }
    let end = start + snq.length;
    const enq = normQuery(a[ek] || "");
    if (enq.length >= 3) {
      const ei = norm.indexOf(enq, start);
      if (ei !== -1) end = ei + enq.length;
    }
    out.push({ a: start, b: end - 1 });
    cursor = end;
  }
  return out;
}

/* 번역 셀 본문에서 각 문장을 <span.tc-sent>로 감싼다. 문장 범위 = 이 앵커(t) 시작 ~
   다음 앵커 시작 직전. surroundContents가 DOM을 바꿔 뒤 오프셋을 무효화하므로 역순 래핑. */
/* DOM 텍스트 정규화 인덱스 — buildIndex(pdf.js 텍스트 아이템용)와 같은 정규화 규칙, 대상만
   DOM 텍스트노드. drop 문자·리가처 확장 규칙을 바꾸면 buildIndex와 함께 고칠 것. */
function buildDomIndex(bodyEl) {
  const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);
  let norm = ""; const map = [];
  const drop = /[\s­​‐‑‒–—-]/;
  let node;
  while ((node = walker.nextNode())) {
    const s = node.nodeValue;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i].toLowerCase();
      if (drop.test(ch)) continue;
      const t = ch === "ﬁ" ? "fi" : ch === "ﬂ" ? "fl" : ch;
      for (const c of t) { norm += c; map.push({ node, offset: i }); }
    }
  }
  return { norm, map };
}

function wrapSentences(bodyEl, anchors) {
  const { norm, map } = buildDomIndex(bodyEl);
  const ranges = anchorRange(anchors, norm, "t", "te");
  const hits = [];
  for (let si = 0; si < anchors.length; si++) {
    const r = ranges[si];
    if (r && r.b >= r.a) hits.push({ si, a: r.a, b: r.b });
  }
  for (let k = hits.length - 1; k >= 0; k--) {
    const { si, a, b } = hits[k];
    const sNode = map[a], eNode = map[b];
    try {
      const range = document.createRange();
      range.setStart(sNode.node, sNode.offset);
      range.setEnd(eNode.node, eNode.offset + 1);
      const span = document.createElement("span");
      span.className = "tc-sent";
      span.dataset.si = String(si);
      range.surroundContents(span);       // 여러 요소 경계 걸치면 throw → 스킵
    } catch { /* 문단/서식 경계 걸침 → 이 문장은 링크 안 함 */ }
  }
}

/* 번역 셀에 핵심 4색 동기화 — 원문 kp 앵커(s/se)를 문장 정렬쌍(s/se↔t/te)으로 번역 쪽
   앵커(t/te)에 대응시켜 같은 색으로 칠한다. wrapSentences와 같은 TreeWalker+역순 래핑 패턴. */
function applyKpTransMarks(st) {
  if (!S.kp.on || !S.kp.items?.length) return;
  const pairs = S.align.pages[st.n];
  if (!pairs?.length || !st.index) return;
  const bodyEl = st.transCell?.querySelector(".trans-body");
  if (!bodyEl) return;

  const pairRanges = anchorRange(pairs, st.index.norm, "s", "se");   // 원문 norm 공간의 정렬쌍 범위

  const { norm, map } = buildDomIndex(bodyEl);
  const tRanges = anchorRange(pairs, norm, "t", "te");   // 번역 norm 공간의 정렬쌍 범위

  const hits = [];
  const usedSi = new Set();   // 같은 번역 문장(si)에 kp가 2개 매치되면 먼저 매치된 것만 쓴다
  for (const it of S.kp.items) {
    if (it.p !== st.n) continue;
    const kr = anchorRange([it], st.index.norm, "s", "se")[0];
    if (!kr) continue;
    let si = -1, best = 0;                  // 겹침 길이가 최대인 정렬쌍을 찾는다
    pairRanges.forEach((pr, pi) => {
      if (!pr) return;
      const overlap = Math.min(kr.b, pr.b) - Math.max(kr.a, pr.a) + 1;
      if (overlap > best) { best = overlap; si = pi; }
    });
    if (si === -1 || usedSi.has(si)) continue;
    const tr = tRanges[si];
    if (!tr) continue;
    usedSi.add(si);
    hits.push({ a: tr.a, b: tr.b, cls: KP_META[it.c]?.cls });
  }

  hits.sort((x, y) => x.a - y.a);
  for (let k = hits.length - 1; k >= 0; k--) {   // surroundContents가 DOM을 바꾸므로 역순
    const { a, b, cls } = hits[k];
    const sNode = map[a], eNode = map[b];
    try {
      const range = document.createRange();
      range.setStart(sNode.node, sNode.offset);
      range.setEnd(eNode.node, eNode.offset + 1);
      const span = document.createElement("span");
      span.className = `kp-mark ${cls || ""}`;
      range.surroundContents(span);
    } catch { /* 문단/서식 경계 걸침 → 이 항목만 스킵 */ }
  }
}

function clearLinkHighlights() {
  document.querySelectorAll(".hl-rect.link").forEach((e) => e.remove());
}

/* 페이지 pageN의 si번째 문장을 원문에서 찾아 옅은 하이라이트. 범위 = s앵커 ~ 다음 s앵커 직전. */
function highlightSourceByAnchor(pageN, si) {
  clearLinkHighlights();
  const anchors = S.align.pages[pageN];
  const st = S.pages[pageN - 1];
  if (!anchors || !st?.rendered || !st.index || !st.hlLayer) return null;
  const range = anchorRange(anchors, st.index.norm, "s", "se")[si];
  if (!range) return null;
  const aPos = st.index.map[range.a], bPos = st.index.map[range.b];
  for (const r of rectsForSpan(st, aPos, bPos)) {
    const el = document.createElement("div");
    el.className = "hl-rect link";
    styleHlRect(el, r);
    st.hlLayer.appendChild(el);
  }
  return st;
}

function initSentenceLink() {
  const pages = $("pages");
  const sentAt = (e) => {
    const s = e.target.closest?.(".tc-sent");
    if (!s) return null;
    const row = s.closest(".page-row");
    return row ? { s, n: +row.dataset.n, si: +s.dataset.si } : null;
  };
  pages.addEventListener("mouseover", (e) => {
    if (S.linkPinned) return;
    const h = sentAt(e);
    if (!h) return;
    h.s.classList.add("hover");
    highlightSourceByAnchor(h.n, h.si);
  });
  pages.addEventListener("mouseout", (e) => {
    if (S.linkPinned) return;
    const s = e.target.closest?.(".tc-sent");
    if (!s) return;
    s.classList.remove("hover");
    clearLinkHighlights();
  });
  pages.addEventListener("click", (e) => {
    const h = sentAt(e);
    if (!h) return;
    if (S.linkPinned === h.s) {                 // 재클릭 → 고정 해제
      S.linkPinned = null; h.s.classList.remove("pinned");
      clearLinkHighlights();
    } else {
      document.querySelectorAll(".tc-sent.pinned").forEach((x) => x.classList.remove("pinned"));
      S.linkPinned = h.s; h.s.classList.add("pinned");
      const st = highlightSourceByAnchor(h.n, h.si);
      if (st) st.wrap.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "nearest" });
    }
  });
}

/* ---------------------------------------------------------------- inspector: tabs + resize */

const TABS = [
  { id: "summary", label: "요약", icon: "doc" },
  { id: "analysis", label: "분석", icon: "grid" },
  { id: "toc", label: "목차", icon: "toc" },
  { id: "chat", label: "채팅", icon: "chat" },
  { id: "notes", label: "노트", icon: "note" },
  { id: "hl", label: "강조", icon: "marker" },
  { id: "term", label: "용어", icon: "term" },
  { id: "refs", label: "인용", icon: "book" },
  { id: "fig", label: "그림", icon: "fig" },
  { id: "export", label: "내보내기", icon: "export" },
];

function setTab(id) {
  document.querySelectorAll(".itab").forEach((t) => {
    const on = t.dataset.tab === id;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".ipane").forEach((p) => p.classList.toggle("on", p.id === "ipane-" + id));
  if (id === "analysis") ensureAnalysis();  // 분석 첫 방문 → 저장된 8섹션 1회 fetch (없으면 버튼)
  if (id === "chat") ensureQuestions();     // 채팅 첫 방문 → 추천 질문 1회 생성 (캐시)
  if (id === "fig") { ensureFigures(); ensureFormulas(); }  // 그림 첫 방문 → 그림·수식 목록 1회 fetch (캐시)
  if (id === "hl") ensureMySummary();       // 강조 첫 방문 → 내 정리 캐시 1회 fetch
}

function initInspector() {
  $("insp-tabs").innerHTML = TABS.map((t) =>
    `<button class="itab" data-tab="${t.id}" role="tab" aria-selected="false" aria-controls="ipane-${t.id}">${icon(t.icon, 17)}<span>${t.label}</span></button>`).join("");
  document.querySelectorAll(".itab").forEach((t) => { t.onclick = () => setTab(t.dataset.tab); });

  const insp = $("inspector");
  const saved = +localStorage.getItem("ml.inspw");
  if (saved) insp.style.width = saved + "px";
  $("star-btn").onclick = () => {
    insp.classList.toggle("hidden");
    S.inspAutoHid = false;               // 수동 토글 후에는 병렬 해제 시 자동 복원 안 함
    S.inspUserPinned = true;             // 다음 뷰 전환에서 자동 접기/펴기와 싸우지 않게
    setTimeout(reapplyAllHighlights, 60);
  };
  // 요약 문단 클릭 → 핵심 하이라이트 점프 (innerHTML 교체에도 살아남게 위임)
  $("ipane-summary").addEventListener("click", onSummaryKpClick);

  /* drag-resize with 1:1 tracking + rubber-band past bounds (§9) */
  const grip = $("insp-grip");
  const MIN = 272, MAX = 544;
  let startX = 0, startW = 0, dragging = false;
  const rubber = (over, dim = 240, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
  grip.addEventListener("pointerdown", (e) => {
    dragging = true; startX = e.clientX; startW = insp.offsetWidth;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("active");
    document.body.style.cursor = "col-resize";
  });
  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    let w = startW - (e.clientX - startX);
    if (w < MIN) w = MIN - rubber(MIN - w);
    else if (w > MAX) w = MAX + rubber(w - MAX);
    insp.style.width = w + "px";
  });
  grip.addEventListener("pointerup", () => {
    dragging = false;
    grip.classList.remove("active");
    document.body.style.cursor = "";
    const w = insp.offsetWidth;
    const target = Math.max(MIN, Math.min(MAX, w));
    if (target !== w) anim(insp, { width: target + "px" }, { type: "spring", duration: 0.35, bounce: 0.15 });
    localStorage.setItem("ml.inspw", target);
    setTimeout(reapplyAllHighlights, 120);
  });
}

/* ---------------------------------------------------------------- 명령 팔레트 (Ctrl/Cmd+K)
   홈·리더 어디서든 여는 키보드 오버레이. 새 동작은 만들지 않는다 — 항목마다 이미 있는 함수를
   그대로 호출한다. 목록은 열 때마다 새로 만든다(서재 목록·화면이 그새 바뀔 수 있어서). */

let cmdk = { open: false, all: [], items: [], sel: 0, prevFocus: null };

function buildCmdList() {
  const list = [];
  TABS.forEach((t, i) => list.push({
    label: `탭: ${t.label}`, hint: String(i + 1), icon: t.icon, readerOnly: true,
    run: () => { $("inspector").classList.remove("hidden"); setTab(t.id); },
  }));
  S.papers.forEach((p) => list.push({
    label: p.title, hint: "서재", icon: "book", readerOnly: false,
    run: () => openPaper(p),
  }));
  list.push({ label: "홈으로 돌아가기", hint: "이동", icon: "back", readerOnly: true, run: closePaper });
  /* 집필 탭은 세그먼트 컨트롤로만 갈 수 있었다 — 팔레트에서도 닿게 한다(리더 안에서도) */
  list.push({ label: "쓰기 탭 (집필)", hint: "이동", icon: "pencil", readerOnly: false, run: () => setMode("write") });
  list.push({ label: "읽기 탭 (서재)", hint: "이동", icon: "book", readerOnly: false, run: () => setMode("read") });
  list.push({ label: "번역 보기 토글", hint: "T", icon: "translate", readerOnly: true,
    run: () => setView(S.view === "parallel" ? "pdf" : "parallel") });
  list.push({ label: "핵심 4색 토글", hint: "K", icon: "key", readerOnly: true, run: toggleKeypoints });
  list.push({ label: "마인드맵 (논지 지도)", hint: "M", icon: "map", readerOnly: true,
    run: () => setView(S.view === "map" ? "pdf" : "map") });
  list.push({ label: "다시 볼 논문", hint: "복습", icon: "book", readerOnly: false,
    run: () => { setMode("read"); runReviewQueue(); } });
  list.push({ label: "연구 트렌드", hint: "OpenAlex", icon: "graph", readerOnly: false,
    run: () => { setMode("read"); runTrends(false); } });
  list.push({ label: "백그라운드 작업", hint: "번역", icon: "translate", readerOnly: false,
    run: () => { setMode("read"); runJobs(); } });
  list.push({ label: "그림 캡처 토글", hint: "C", icon: "fig", readerOnly: true, run: toggleCapture });
  list.push({ label: "원문 검색 열기", hint: "Ctrl+F", icon: "search", readerOnly: true, run: openFind });
  list.push({ label: "테마 전환", hint: "설정", icon: "sun", readerOnly: false, run: cycleTheme });
  list.push({ label: "한 번에 준비", hint: "AI", icon: "sparkle", readerOnly: true, run: prepPaper });
  list.push({ label: "구조 분석 (8칸)", hint: "AI", icon: "grid", readerOnly: true,
    run: () => { $("inspector").classList.remove("hidden"); setTab("analysis"); } });
  list.push({ label: "참고문헌 출처 검증", hint: "OpenAlex", icon: "book", readerOnly: true, run: runRefVerify });
  list.push({ label: "논문 찾기 (주제어)", hint: "OpenAlex", icon: "search", readerOnly: false,
    run: () => { setMode("read"); openWorkSearch(); } });
  return list;
}

/* 부분 문자열이 최우선(시작 일치 > 포함), 순서 보존 subsequence 매치를 보조로 — 목록이 짧아
   입력마다 새로 계산해도 부담이 없다. */
function cmdFuzzy(s, q) {
  let qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) if (s[i] === q[qi]) qi++;
  return qi === q.length;
}
function filterCmds(all, raw) {
  const q = raw.trim().toLowerCase();
  if (!q) return all.slice();
  const scored = [];
  for (const c of all) {
    const s = c.label.toLowerCase();
    let score;
    if (s.startsWith(q)) score = 0;
    else if (s.includes(q)) score = 1;
    else if (cmdFuzzy(s, q)) score = 2;
    else continue;
    scored.push({ c, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((x) => x.c);
}

function renderCmdList() {
  const box = $("cmdk-list");
  if (!cmdk.items.length) { box.innerHTML = `<div class="cmdk-empty">일치하는 명령이 없습니다.</div>`; return; }
  box.innerHTML = cmdk.items.map((c, i) => `
    <button class="cmdk-item${i === cmdk.sel ? " sel" : ""}" data-i="${i}" role="option" aria-selected="${i === cmdk.sel}">
      ${icon(c.icon, 15)}<span class="cmdk-label">${esc(c.label)}</span><span class="cmdk-hint">${esc(c.hint || "")}</span>
    </button>`).join("");
  box.querySelectorAll(".cmdk-item").forEach((b) => {
    b.onmouseenter = () => setCmdSel(+b.dataset.i);
    b.onclick = () => runCmd(+b.dataset.i);
  });
}

function setCmdSel(i) {
  cmdk.sel = i;
  $("cmdk-list").querySelectorAll(".cmdk-item").forEach((b, bi) => {
    b.classList.toggle("sel", bi === i);
    b.setAttribute("aria-selected", String(bi === i));
  });
}
function moveCmdSel(d) {
  if (!cmdk.items.length) return;
  const n = cmdk.items.length;
  setCmdSel((cmdk.sel + d + n) % n);
  $("cmdk-list").children[cmdk.sel]?.scrollIntoView({ block: "nearest" });
}
function runCmd(i) {
  const c = cmdk.items[i];
  if (!c) return;
  closeCmdPalette();
  c.run();
}

function filterCmd() {
  const raw = $("cmdk-in").value;
  let items = filterCmds(cmdk.all, raw);
  const q = raw.trim(), n = +q;
  if (/^\d+$/.test(q) && $("reader").classList.contains("on") && n >= 1 && n <= S.pages.length) {
    items = [{ label: `${n}쪽으로 이동`, hint: "Enter", icon: "toc", run: () => gotoPage(n) }, ...items];
  }
  cmdk.items = items;
  cmdk.sel = 0;
  renderCmdList();
}

function openCmdPalette() {
  if (cmdk.open) return;
  cmdk.open = true;
  cmdk.prevFocus = document.activeElement;
  const readerOn = $("reader").classList.contains("on");
  cmdk.all = buildCmdList().filter((c) => !c.readerOnly || readerOn);
  $("cmdk-scrim").classList.add("show");
  const pal = $("cmdk-pal");
  pal.style.transform = "scale(0.97) translateY(-4px)"; pal.style.opacity = "0";
  anim(pal, { transform: "scale(1) translateY(0)", opacity: 1 }, { type: "spring", duration: 0.28, bounce: 0 });
  const inp = $("cmdk-in");
  inp.value = "";
  filterCmd();
  inp.focus();
}
function closeCmdPalette() {
  if (!cmdk.open) return;
  cmdk.open = false;
  $("cmdk-scrim").classList.remove("show");
  cmdk.prevFocus?.focus?.();
  cmdk.prevFocus = null;
}

function initCmdPalette() {
  const scrim = $("cmdk-scrim");
  const inp = $("cmdk-in");
  $("cmdk-glass").innerHTML = icon("search", 15);
  inp.addEventListener("input", filterCmd);
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();                    // 전역·리더 단축키와 분리 — 팔레트 안에서 소비되고 끝난다
    if (e.key === "ArrowDown") { e.preventDefault(); moveCmdSel(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveCmdSel(-1); }
    else if (e.key === "Enter") { e.preventDefault(); runCmd(cmdk.sel); }
    else if (e.key === "Escape") { e.preventDefault(); closeCmdPalette(); }
    else if (e.key === "Tab") e.preventDefault();      // 포커스는 입력창에 고정 — 화살표로만 이동
  });
  scrim.onclick = (e) => { if (e.target === scrim) closeCmdPalette(); };
}

async function loadSidecars() {
  const id = S.current.id;
  const alive = () => S.current?.id === id;
  renderSummaryPane(null);              // 우선 스켈레톤(생성 버튼)
  renderTocPane();                      // buildOutline은 백그라운드 — 우선 "불러오는 중"
  loadChat(); renderChatQuote();
  loadNotes();
  // 서로 독립인 사이드카는 병렬 GET — 순차 await 워터폴(localhost라도 왕복이 쌓인다) 제거.
  // 404·에러는 null로 흡수하고 각자 기본값으로 폴백.
  const get = (p) => api(`/api/papers/${id}/${p}`).catch(() => null);
  const [summary, hl, autoHl, kp, gloss, refs, tr, al, qs] = await Promise.all([
    get("summary"), get("highlights"), get("highlights/auto"), get("keypoints"),
    get("glossary"), get("refs"), get("translation"), get("align"), get("questions"),
  ]);
  if (!alive()) return;                 // 로딩 중 다른 논문으로 이동 → 이 논문 데이터로 패널 오염 방지
  if (summary?.markdown) renderSummaryPane(summary.markdown);
  S.hl = hl?.items ? hl : { items: [] };
  S.autoHl = Array.isArray(autoHl) ? autoHl : [];
  if (kp?.items?.length) S.kp.items = kp.items;   // 배치(placed)는 첫 토글 때 — 인덱스 준비 후
  renderHlPane();
  if (gloss?.items?.length) { S.gloss.items = gloss.items; placeGlossary(); }
  renderGlossaryPane();
  if (qs?.items?.length) { S.q.items = qs.items; renderChatChips(); renderSumQuestions(); }
  if (refs?.items?.length) { S.refs = refs; S.refMap = new Map(refs.items.map((x) => [String(x.n), x.text])); }
  buildRefLinks();
  renderRefsPane();
  Object.entries(tr?.pages || {}).forEach(([k, v]) => { S.trans.pages[+k] = v; });
  Object.entries(al?.pages || {}).forEach(([k, v]) => { S.align.pages[+k] = v; });
  renderExportPane();
  reapplyAllHighlights();
  refreshZotAnnBadge(id);   // 논-블로킹 — Zotero 유래 논문이면 새 주석 수를 강조 탭 버튼에
  checkDupes();          // 같은 논문이 서재에 이미 있는지 — 막지 않고 배너로만 알린다
}

/* ---------------------------------------------------------------- init */

function initReaderChrome() {
  $("back-btn").innerHTML = icon("back", 17);
  $("back-btn").onclick = closePaper;
  $("zoom-in").innerHTML = icon("plus", 15);
  $("zoom-out").innerHTML = icon("minus", 15);
  $("zoom-in").onclick = () => setZoom(1.15);
  $("zoom-out").onclick = () => setZoom(1 / 1.15);
  $("trans-btn").innerHTML = icon("translate", 16);
  $("trans-btn").onclick = () => setView(S.view === "parallel" ? "pdf" : "parallel");
  $("key-btn").innerHTML = icon("key", 16);
  $("key-btn").onclick = toggleKeypoints;
  $("map-btn").innerHTML = icon("map", 16);
  $("map-btn").onclick = () => setView(S.view === "map" ? "pdf" : "map");
  $("cap-btn").innerHTML = icon("fig", 16);
  $("cap-btn").onclick = toggleCapture;
  $("rd-page").onclick = showPageJump;
  $("rd-page").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") showPageJump(); };
  paintStars(IDLE_PH);
  // 리사이즈 드래그 중 이벤트마다 전체 재계산(실측 ~15ms/회)이 돌면 잰크 → 멎은 뒤 1회만
  let resizeT = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(reapplyAllHighlights, 150);
  });
}

initTheme();
initUpload();
initLibSearch();
initLibAI();
initSelPop();
initChat();
initInspector();
initReaderChrome();
initCapture();
initSentenceLink();
initTermHover();
initFindBar();
initShortcuts();
initCmdPalette();
initWriter();
loadPapers();

/* 로컬 디버그 핸들 (콘솔·자동화 테스트용) */
window.__ml = { S, cmdk, renderPage, setTab, reapplyAllHighlights, runSelAction, openPaper, locate,
                toggleSentenceLink, runAlignment, highlightSourceByAnchor, fillTransCell, anchorRange,
                retranslatePage, toggleKeypoints, applyKeypoints, applyKpTransMarks, starDots, paintStars,
                runFind, stepFind, openFind, closeFind, gotoPage, currentPageNo,
                aiFigure, makeGlossary, buildOutline, checkScanned, runVisionExtract, pageImageBlob,
                runLibSearch, renderLibResults, placeGlossary, locateTerm, applyTermHots,
                ensureQuestions, renderChatChips,
                runLibraryAsk, runLibraryCompare, toggleCmpMode, toggleCmpSel, prepPaper, saveGlossKo,
                renderContinueCard, renderShelfFilter, buildRefLinks, toggleCapture, captureRegion,
                queuePrefetch, runPrefetch, cycleTheme,
                buildCmdList, filterCmds, cmdFuzzy, openCmdPalette, closeCmdPalette, filterCmd,
                runCmd, moveCmdSel, setCmdSel, renderCmdList,
                copyText, renderCiteBox, showCaptureChooser, captureFormula, cropRegionBlob,
                regionAnchorRect, ensureFormulas, invalidateFormulas, ensureMySummary,
                makeMySummary, renderMySummaryBox,
                downloadBlob, runLibraryTable, renderTableResult, csvCell, tableToCSV,
                mdCell, tableToMarkdown, runSavedTables, renderSavedTables,
                runRelated, renderRelated, relatedItem,
                runEvidence, renderEvidence, evRow, evLabel, evMatches, evKindMatch, evidenceToMarkdown,
                loadEvidence, evFilterHTML, wireEvFilter, confirmDestructive,
                setMode, openWriter, refreshWriterEvidence, renderWriterEv, renderWriterDraft, toggleSecEv, evChip,
                citeInline, insertAtCursor, runSectionOverlap, saveDraft, flushDraftSave,
                draftToMarkdown, exportDraft,
                getDraft: () => draft, getEvIndex: () => evIndex, getDraftSec: () => draftSec,
                runCitations, renderCitations, openOverlapPane, runOverlap, renderOverlap,
                runLibGlossary, renderLibGlossary, glRow, runQueue, renderQueue, queueAdd,
                wireOpenButtons,
                runLibraryGraph, renderGraphResult, buildGraphSVG, shortTitle, wireGraphInteractions,
                runExportBib };
