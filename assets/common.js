/* 보름 근육검사 — 공통 로직 (트레이너 앱 + 고객 페이지가 함께 사용) */
(function () {
  const D = window.BOREUM_DATA;
  const MUSCLES = D.muscles;           // 순서 = 공유코드 인코딩 순서 (뒤에 추가만!)
  const PATHS = D.paths;
  const N = MUSCLES.length;

  // 리플렛 '근육움직임' 표 그대로
  const JOINTS = [
    ['어깨', ['굴곡', '신전', '외전', '내전', '외회전', '내회전', '수평외전', '수평내전']],
    ['날개뼈', ['상승', '하강', '후인', '전인', '상방회전', '하방회전']],
    ['팔꿈치', ['굴곡', '신전']],
    ['손목', ['굴곡', '신전', '척측편위', '요측편위']],
    ['몸통', ['굴곡', '신전', '회전', '외측굴곡']],
    ['목', ['굴곡', '신전', '회전', '외측굴곡']],
    ['고관절', ['굴곡', '신전', '외전', '내전', '내회전', '외회전']],
    ['무릎', ['굴곡', '신전', '내회전', '외회전']],
    ['발목', ['저측굴곡', '배측굴곡', '내번', '외번']],
    ['골반', ['전방경사', '후방경사', '좌측단축', '우측단축']],
  ];
  const JOINT_NAMES = JOINTS.map(j => j[0]);
  // 리플렛 '02 현재 내 상태'
  const STAGES = [
    { t: '수동적 움직임', s: '전문의료기관' },
    { t: '능동적 움직임', s: '기능개선' },
    { t: '취미스포츠', s: '' },
    { t: '전문가', s: '' },
  ];
  const AREAS = ['무릎', '발목', '목', '어깨', '팔꿈치'];            // 선택형 통증 부위 (비트 순서)
  const AREA_GROUP = { 어깨: 'shoulder', 목: 'neck', 팔꿈치: 'elbow', 무릎: 'knee', 발목: 'ankle' };
  const GROUP_LABEL = { base: '기본검사', shoulder: '어깨', neck: '목', elbow: '팔꿈치', knee: '무릎', ankle: '발목' };
  // 자가진단 관절 → 트레이너 통증부위
  const JOINT_TO_AREA = { 어깨: '어깨', 날개뼈: '어깨', 팔꿈치: '팔꿈치', 손목: '팔꿈치', 목: '목', 무릎: '무릎', 발목: '발목' };

  /* ---------- 기록 ---------- */
  function newRecord() {
    return { name: '', date: today(), areas: [], r1: new Array(N).fill(0), r2: null, pain: new Array(10).fill(null), stage: 0, memo: '', id: Date.now() };
  }
  function today() {
    const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function groupsOf(areas) { return new Set(['base', ...areas.map(a => AREA_GROUP[a])]); }
  function visibleIdx(areas) {
    const g = groupsOf(areas); return MUSCLES.map((m, i) => g.has(m.g) ? i : -1).filter(i => i >= 0);
  }
  // 비트: 1 = 왼쪽 꺼짐, 2 = 오른쪽 꺼짐
  function offList(bits) {
    const out = []; bits.forEach((b, i) => { if (b & 1) out.push([i, 'L']); if (b & 2) out.push([i, 'R']); }); return out;
  }
  function countOff(bits) { return offList(bits).length; }

  /* ---------- 공유 코드 (서버 없이 링크에 결과를 담음) ---------- */
  const EPOCH = Date.UTC(2026, 0, 1);
  function b64u(bytes) { let s = ''; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '=';
    const s = atob(str); return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  function packBits(bits) { const out = new Uint8Array(Math.ceil(N * 2 / 8)); bits.forEach((b, i) => { out[(i * 2) >> 3] |= (b & 3) << ((i * 2) & 7); }); return out; }
  function unpackBits(bytes, off) { const a = new Array(N).fill(0); for (let i = 0; i < N; i++) a[i] = (bytes[off + ((i * 2) >> 3)] >> ((i * 2) & 7)) & 3; return a; }
  function packPain(pain) { const out = new Uint8Array(5); pain.forEach((p, i) => { const v = (p == null ? 15 : p) & 15; out[i >> 1] |= v << ((i & 1) * 4); }); return out; }
  function unpackPain(bytes, off) { const a = []; for (let i = 0; i < 10; i++) { const v = (bytes[off + (i >> 1)] >> ((i & 1) * 4)) & 15; a.push(v === 15 ? null : v); } return a; }
  function areaMask(areas) { return AREAS.reduce((m, a, i) => areas.includes(a) ? m | (1 << i) : m, 0); }
  function maskAreas(m) { return AREAS.filter((a, i) => m & (1 << i)); }

  function encodeRecord(r) {
    const day = Math.max(0, Math.round((Date.UTC(...r.date.split('-').map((v, i) => i === 1 ? +v - 1 : +v)) - EPOCH) / 864e5));
    const head = [1, day >> 8, day & 255, areaMask(r.areas), (r.r2 ? 1 : 0) | ((r.stage & 7) << 1)];
    const parts = [Uint8Array.from(head), packPain(r.pain), packBits(r.r1)];
    if (r.r2) parts.push(packBits(r.r2));
    parts.push(new TextEncoder().encode((r.name || '').slice(0, 20)));
    const len = parts.reduce((s, p) => s + p.length, 0); const all = new Uint8Array(len); let o = 0;
    parts.forEach(p => { all.set(p, o); o += p.length; }); return b64u(all);
  }
  function decodeRecord(code) {
    const b = unb64u(code); if (b[0] !== 1) throw new Error('지원하지 않는 코드');
    const day = (b[1] << 8) | b[2]; const d = new Date(EPOCH + day * 864e5);
    const r = newRecord();
    r.date = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    r.areas = maskAreas(b[3]); r.stage = (b[4] >> 1) & 7; const has2 = b[4] & 1;
    r.pain = unpackPain(b, 5); let o = 10; const nb = Math.ceil(N * 2 / 8);
    r.r1 = unpackBits(b, o); o += nb;
    if (has2) { r.r2 = unpackBits(b, o); o += nb; }
    r.name = new TextDecoder().decode(b.slice(o)); return r;
  }
  // 고객 자가진단 코드: [0x81, 통증 10칸, 운동수준, 이름...]
  function encodeSelf(s) {
    const parts = [Uint8Array.from([0x81, s.level & 7]), packPain(s.pain), new TextEncoder().encode((s.name || '').slice(0, 20))];
    const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; parts.forEach(p => { all.set(p, o); o += p.length; });
    return b64u(all);
  }
  function decodeSelf(code) {
    const b = unb64u(code); if (b[0] !== 0x81) throw new Error('자가진단 코드가 아님');
    return { level: b[1], pain: unpackPain(b, 2), name: new TextDecoder().decode(b.slice(7)) };
  }
  // 붙여넣은 글/링크에서 코드 꺼내기
  function extractCode(text) {
    text = (text || '').trim();
    let m = text.match(/#([rs])=([A-Za-z0-9_-]+)/); if (m) return { type: m[1], code: m[2] };
    m = text.match(/코드\s*[:：]\s*([A-Za-z0-9_-]+)/); if (m) text = m[1];
    if (/^[A-Za-z0-9_-]{6,}$/.test(text)) {
      try { const b = unb64u(text); return { type: b[0] === 0x81 ? 's' : 'r', code: text }; } catch (e) { }
    }
    return null;
  }
  // 자가진단 결과 → 현재 상태 단계 (가안: 통증 상한 × 운동 수준 상한)
  function selfStage(pain, level) {
    const max = Math.max(0, ...pain.filter(p => p != null));
    const capPain = max >= 7 ? 1 : max >= 4 ? 2 : max >= 1 ? 3 : 4;
    const capLevel = [2, 3, 4][Math.max(0, Math.min(2, level))];
    return Math.min(capPain, capLevel);
  }

  /* ---------- 기능 이상 분석 ---------- */
  function analyze(bits) {
    const res = {}; JOINT_NAMES.forEach(j => res[j] = { mv: {}, stab: { L: 0, R: 0 }, hit: false });
    offList(bits).forEach(([i, side]) => {
      MUSCLES[i].f.forEach(fx => {
        const [j, mv] = fx.split(':'); const row = res[j]; if (!row) return; row.hit = true;
        if (mv === '안정화') { row.stab[side] = 1; return; }
        (row.mv[mv] = row.mv[mv] || { L: 0, R: 0, by: new Set() })[side] = 1; row.mv[mv].by.add(MUSCLES[i].n);
      });
    });
    return res;
  }
  function sideTag(o) { return (o.L ? '<span class="sd">좌</span>' : '') + (o.R ? '<span class="sd">우</span>' : ''); }

  /* ---------- 그리기 ---------- */
  const BASE = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^/]*$/, '') : 'assets/';
  function mapSVG(bits, opts = {}) {
    const fill = opts.fill || '#E3837A';
    let g = '';
    offList(bits).forEach(([i, side]) => {
      const key = MUSCLES[i].map; if (!key || !PATHS[key]) return;
      const d = PATHS[key][side]; if (d) g += `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
    });
    if (opts.ghost) offList(opts.ghost).forEach(([i, side]) => {
      if (bits[i] & (side === 'L' ? 1 : 2)) return; const key = MUSCLES[i].map; if (!key || !PATHS[key]) return;
      const d = PATHS[key][side]; if (d) g += `<path d="${d}" fill="#9FCFBF" fill-rule="evenodd"/>`;
    });
    return `<svg viewBox="55 100 1710 1660" role="img" aria-label="근육 활성도 신체 지도"><image href="${BASE}body.png" x="0" y="0" width="1819" height="1854"/>` +
      `<g style="mix-blend-mode:multiply">${g}</g></svg>`;
  }
  function jointTable(bits, pain, opts = {}) {
    const a = analyze(bits); let rows = '';
    JOINTS.forEach(([j, mvs], ji) => {
      const r = a[j]; const p = pain[ji];
      const mvHtml = mvs.map(mv => r.mv[mv] ? `<b>${mv}</b>${sideTag(r.mv[mv])}` : mv).join(' / ') +
        ((r.stab.L || r.stab.R) ? `<span class="stab">안정화${r.stab.L && r.stab.R ? '' : r.stab.L ? '·좌' : '·우'}</span>` : '');
      let painCell;
      if (opts.editable) {
        painCell = `<select class="pain${p != null ? ' has' : ''}" data-ji="${ji}" aria-label="${j} 통증 강도"><option value="">–</option>` +
          Array.from({ length: 11 }, (_, v) => `<option value="${v}"${p === v ? ' selected' : ''}>${v}</option>`).join('') + `</select>`;
      } else painCell = `<span class="pain${p != null ? ' has' : ''}">${p != null ? p : '–'}</span>`;
      if (opts.onlyHit && !r.hit && p == null) return;
      rows += `<tr class="${r.hit ? 'hit' : ''}"><td class="j"><span class="dot"></span>${j}</td><td class="mv">${mvHtml}</td><td>${painCell}</td></tr>`;
    });
    return `<table class="jt"><thead><tr><th>관절 / 부위</th><th>움직임 세부항목</th><th>통증 강도<br>(0-10)</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function stageBar(stage, editable) {
    const left = stage ? (stage - .5) * 25 : -50;
    return `<div class="stage">${stage ? `<div class="marker" style="left:${left}%">▼</div>` : ''}<div class="bar"><i></i><i></i><i></i><i></i></div>
      <div class="names">${STAGES.map((s, i) => `<button type="button" data-stage="${i + 1}" class="${stage === i + 1 ? 'sel' : ''}" ${editable ? '' : 'tabindex="-1" style="cursor:default"'}>${s.t}${s.s ? `<small>(${s.s})</small>` : ''}</button>`).join('')}</div>
      <div class="ends"><span><b>낮은 단계</b> (상태가 더 좋지 않음)</span><span><b>높은 단계</b> (가장 좋은 상태)</span></div></div>`;
  }
  function offChips(bits) {
    const by = {}; offList(bits).forEach(([i, s]) => (by[i] = by[i] || []).push(s));
    const items = Object.entries(by).map(([i, ss]) => `<span class="offchip">${MUSCLES[i].n} · ${ss.length === 2 ? '양쪽' : ss[0] === 'L' ? '왼쪽' : '오른쪽'}</span>`);
    return items.length ? `<div class="offchips">${items.join('')}</div>` : `<div class="note">꺼진 근육이 없어요. 모든 근육이 잘 쓰이고 있어요 👏</div>`;
  }
  function recoveredChips(r1, r2) {
    const items = []; r1.forEach((b, i) => { const rec = b & ~r2[i]; if (rec) items.push(`<span class="offchip ok">${MUSCLES[i].n} · ${rec === 3 ? '양쪽' : rec === 1 ? '왼쪽' : '오른쪽'}</span>`); });
    return items.join('');
  }

  // 회원용 결과 화면 (리플렛 01·02·03 구조) — 트레이너 앱 미리보기와 고객 페이지가 같이 씀
  function customerView(r, opts = {}) {
    const round = opts.round || (r.r2 ? 'r2' : 'r1'); const bits = round === 'r2' && r.r2 ? r.r2 : r.r1;
    const name = r.name ? `${esc(r.name)} 님의` : '나의';
    let html = '';
    html += `<div class="sec"><span class="n">01</span><span class="t">검사하기<span class="s">지금, 내 몸의 상태를 확인합니다. · ${r.date}</span></span></div>`;
    if (r.r2) {
      const before = countOff(r.r1), after = countOff(r.r2);
      html += `<div class="seg" data-round-seg><button type="button" data-round="r1" class="${round === 'r1' ? 'sel' : ''}">운동 전</button><button type="button" data-round="r2" class="${round === 'r2' ? 'sel' : ''}">운동 후 (재검사)</button></div>`;
      html += `<div class="card mt" style="background:var(--green-soft);border-color:transparent"><b style="color:var(--green)">${before - after > 0 ? `꺼졌던 ${before}곳 중 ${before - after}곳이 다시 켜졌어요!` : '운동 전후 결과를 비교해보세요'}</b>${recoveredChips(r.r1, r.r2) ? `<div class="offchips mt">${recoveredChips(r.r1, r.r2)}</div>` : ''}</div>`;
    }
    html += `<p class="label mt">● 근육활성도</p><div class="bodymap">${mapSVG(bits, round === 'r2' ? { ghost: r.r1 } : {})}</div>`;
    html += `<div class="card mt"><b style="font-size:14px">근육이 약한 곳</b><p class="note" style="margin:6px 0 10px">표시된 부위는 근육이 힘을 제대로 쓰지 못하는 상태입니다. 적절한 활성화가 필요합니다.${round === 'r2' ? ' 연한 초록은 운동 후 다시 켜진 곳이에요.' : ''}</p>${offChips(bits)}</div>`;
    html += `<p class="label mt2">● 근육움직임</p>${jointTable(bits, r.pain, { editable: !!opts.editable })}`;
    html += `<p class="note" style="margin-top:6px">색이 칠해진 움직임은 ${name} 검사에서 힘이 약하게 나온 근육과 관련된 움직임이에요.</p>`;
    html += `<div class="sec"><span class="n">02</span><span class="t">현재 내 상태<span class="s">지금의 움직임 상태를 4단계로 확인해보세요.</span></span></div>`;
    html += r.stage || opts.editable ? stageBar(r.stage, !!opts.editable) : `<p class="note">트레이너가 상담 후 표시해드려요.</p>`;
    html += `<div class="sec"><span class="n">03</span><span class="t">추천운동<span class="s">검사 → 운동 → 재검사, 기능이 달라집니다.</span></span></div>
      <div class="card"><b>1 · 움직일 수 있는 상태 만들기</b><p class="note" style="margin:4px 0 0">뻣뻣한 근육과 관절을 부드럽게! 마사지로 시작합니다.<br>· 부드럽게 지그시 압박하기 · 근육의 결을 따라 쓸어주기 · 30초~1분 정도 유지하기</p></div>
      <div class="card mt"><b>2 · 인지하는 단계</b><p class="note" style="margin:4px 0 0">내 몸을 이해하고, 정확한 자극을 느낍니다.<br>· 나에게 맞는 중립포인트 찾기 · 타겟근육 수축하기 · 보상작용 없이 힘풀기</p></div>
      <div class="card mt"><b>3 · 반복해서 익히는 단계</b><p class="note" style="margin:4px 0 0">꾸준한 반복이 변화를 만듭니다. 30일 중 15일 인증하면 소정의 사은품을 드립니다.</p></div>
      <p class="note mt2" style="text-align:center">기능회복운동센터 보름 · 당신의 건강한 움직임을 응원합니다</p>`;
    return html;
  }

  /* ---------- 공통 유틸 ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function toast(msg) {
    let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.querySelector('.app').appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
  }
  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { } ta.remove(); return ok;
    }
  }
  // 고정 캔버스 스케일
  function fitCanvas() {
    const app = document.querySelector('.app'); const pad = 16;
    const s = Math.min((innerWidth - pad) / 430, (innerHeight - pad) / 860);
    app.style.transform = `scale(${s})`;
  }
  addEventListener('resize', fitCanvas); addEventListener('orientationchange', fitCanvas);
  document.addEventListener('DOMContentLoaded', fitCanvas);

  window.Boreum = {
    MUSCLES, PATHS, N, JOINTS, JOINT_NAMES, STAGES, AREAS, AREA_GROUP, GROUP_LABEL, JOINT_TO_AREA,
    newRecord, today, visibleIdx, offList, countOff, encodeRecord, decodeRecord, encodeSelf, decodeSelf, extractCode, selfStage,
    analyze, mapSVG, jointTable, stageBar, offChips, customerView, esc, store, toast, copyText, fitCanvas,
  };
})();
