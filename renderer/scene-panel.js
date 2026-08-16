// 梨璃功能菜单 - "台词与场景"面板(内置场景编辑器 UI)
// 数据与序列化逻辑在 scene-editor.js(与独立交互编辑器同源);
// 保存经 menuAPI.saveLines 交给主进程写入台词文件,桌宠随即热重载生效。
'use strict';
(() => {
  const ED = window.SceneEditor;
  const API = window.menuAPI;
  if (!ED || !API) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let model = null;   // { scenes, settings, unknownKeys }
  let loaded = false; // 本菜单窗口生命周期内只从文件加载一次(保留未保存修改)
  let scrollEl = null;
  let statusEl = null;
  let statusTimer = null;

  // 发言分组展示顺序
  const GROUPS = [
    { title: '💬 通用场景', keys: ['01_greeting', '02_random', '03_doubleClick', '04_wakeUp', '05_wakeGrumpy', '06_sleep'] },
    { title: '🎭 场景互动', keys: ['10_typing', '11_clicking', '12_mousemove', '13_highcpu', '14_media', '15_mediaMusic', '16_mediaStop'] },
    { title: '🖐 身体部位', keys: ['20_partHead', '21_partArmL', '22_partArmR', '23_partTorso', '24_partLegs'] },
  ];

  function status(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'scn-status' + (kind ? ' ' + kind : '');
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'scn-status'; }, 6000);
  }

  async function loadFromFile() {
    try {
      const buf = await API.readAsset('lines.jsonc');
      model = ED.parse(new TextDecoder().decode(buf));
    } catch (e) {
      model = ED.createDefault();
      status('⚠ 台词文件读取失败,已载入空白模板: ' + (e && e.message), 'err');
    }
    loaded = true;
  }

  // ---------- 控件 ----------
  function switchRow(label, desc, get, set) {
    const row = el('div', 'opt-row');
    const info = el('div', 'opt-info');
    info.appendChild(el('div', 'opt-label', label));
    info.appendChild(el('div', 'opt-desc', desc));
    const sw = el('div', 'switch' + (get() ? ' on' : ''));
    row.appendChild(info);
    row.appendChild(sw);
    row.onclick = () => {
      const next = !sw.classList.contains('on');
      sw.classList.toggle('on', next);
      set(next);
    };
    return row;
  }

  // 冷却时长行(毫秒)
  function cdRow(key) {
    const meta = ED.SCENE_META[key];
    const row = el('div', 'scn-cd-row');
    const lab = el('div', 'scn-cd-label', meta.name + (key === '14_media' ? '(含音乐)' : ''));
    lab.title = meta.desc + ' · ' + key;
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.step = '500';
    input.className = 'scn-cd-input';
    input.value = model.settings.cooldowns[key];
    input.title = '该场景事件的最小触发间隔(毫秒),0 = 不限制';
    input.onchange = () => {
      const v = Number(input.value);
      model.settings.cooldowns[key] = v > 0 && Number.isFinite(v) ? Math.round(v) : ED.DEFAULT_COOLDOWNS[key];
      input.value = model.settings.cooldowns[key];
    };
    const unit = el('span', 'scn-cd-unit', 'ms');
    row.append(lab, input, unit);
    return row;
  }

  // ---------- 场景卡片(可折叠发言编辑) ----------
  function sceneCard(key) {
    const sc = model.scenes[key];
    const card = el('div', 'scn-card');
    const head = el('div', 'scn-card-head');
    head.appendChild(el('span', 'scn-id', key));
    head.appendChild(el('span', 'scn-name', sc.meta.name));
    const cnt = el('span', 'scn-count');
    head.appendChild(cnt);
    head.appendChild(el('span', 'scn-chev', '▸'));
    const body = el('div', 'scn-card-body');
    body.hidden = true;

    const refreshCount = () => { cnt.textContent = sc.lines.length + ' 条'; };
    const refreshChev = () => {
      head.classList.toggle('open', !body.hidden);
      const chev = head.querySelector('.scn-chev');
      if (chev) chev.textContent = body.hidden ? '▸' : '▾';
    };

    const renderBody = () => {
      body.innerHTML = '';
      if (!sc.lines.length) {
        body.appendChild(el('div', 'scn-empty', '⚠ 暂无发言:桌宠将使用内置默认台词'));
      }
      sc.lines.forEach((ln, i) => {
        const item = el('div', 'scn-line-row');
        const idx = el('span', 'scn-idx', (i + 1) + '.');
        const input = el('input');
        input.type = 'text';
        input.className = 'scn-line-input';
        input.value = ln;
        input.placeholder = '输入发言内容…';
        const cnt2 = el('span', 'scn-cnt');
        const refreshCnt = () => {
          const n = ED.displayWidth(input.value);
          cnt2.textContent = n + '/' + ED.MAX_LINE_WIDTH;
          cnt2.classList.toggle('over', n >= ED.MAX_LINE_WIDTH);
        };
        input.oninput = () => {
          input.value = ED.truncateByWidth(input.value, ED.MAX_LINE_WIDTH);
          sc.lines[i] = input.value;
          refreshCnt();
        };
        refreshCnt();
        const up = el('button', 'scn-mini', '↑');
        up.title = '上移';
        up.disabled = i === 0;
        up.onclick = () => { swap(key, i, i - 1); renderBody(); };
        const down = el('button', 'scn-mini', '↓');
        down.title = '下移';
        down.disabled = i === sc.lines.length - 1;
        down.onclick = () => { swap(key, i, i + 1); renderBody(); };
        const del = el('button', 'scn-mini del', '✕');
        del.title = '删除这条发言';
        del.onclick = () => { sc.lines.splice(i, 1); renderBody(); };
        item.append(idx, input, cnt2, up, down, del);
        body.appendChild(item);
      });
      const add = el('button', 'scn-add', '＋ 添加发言');
      add.onclick = () => {
        sc.lines.push('');
        renderBody();
        const ins = body.querySelectorAll('input');
        if (ins.length) ins[ins.length - 1].focus();
      };
      body.appendChild(add);
      refreshCount();
    };

    head.onclick = () => {
      body.hidden = !body.hidden;
      refreshChev();
      if (window.__menuResize) window.__menuResize();
    };
    renderBody();
    refreshChev();
    card.append(head, body);
    return card;
  }

  function swap(key, a, b) {
    const arr = model.scenes[key].lines;
    if (a < 0 || b < 0 || a >= arr.length || b >= arr.length) return;
    const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
  }

  // ---------- 渲染 ----------
  function renderAll() {
    if (!scrollEl || !model) return;
    scrollEl.innerHTML = '';

    // 互动设置:允许打断 + 各场景/部位冷却
    const sec1 = el('div', 'scn-sec');
    sec1.appendChild(el('div', 'scn-sec-title', '🎛 互动设置'));
    sec1.appendChild(switchRow('🎭 允许打断', '场景互动可打断当前发言/动作', () => model.settings.allowInterrupt, (v) => { model.settings.allowInterrupt = v; }));
    const g1 = el('div', 'scn-cd-group');
    g1.appendChild(el('div', 'scn-cd-group-title', '场景互动冷却(10~16)'));
    ED.COOLDOWN_KEYS.slice(0, 6).forEach((k) => g1.appendChild(cdRow(k)));
    sec1.appendChild(g1);
    const g2 = el('div', 'scn-cd-group');
    g2.appendChild(el('div', 'scn-cd-group-title', '身体部位冷却(20~24)'));
    ED.COOLDOWN_KEYS.slice(6).forEach((k) => g2.appendChild(cdRow(k)));
    sec1.appendChild(g2);
    scrollEl.appendChild(sec1);

    // 场景发言(与交互编辑器同样的 18 个场景)
    const sec2 = el('div', 'scn-sec');
    sec2.appendChild(el('div', 'scn-sec-title', '💬 场景发言(桌宠随机挑选一句)'));
    GROUPS.forEach((g) => {
      const gp = el('div', 'scn-group');
      gp.appendChild(el('div', 'scn-group-title', g.title));
      g.keys.forEach((k) => gp.appendChild(sceneCard(k)));
      sec2.appendChild(gp);
    });
    scrollEl.appendChild(sec2);
  }

  // ---------- 保存 / 重新加载 ----------
  async function saveNow() {
    if (!model) return;
    // 保存兜底:先按硬编码上限截断,再清理空发言
    for (const key of ED.META_ORDER) {
      const sc = model.scenes[key];
      sc.lines = sc.lines.map((s) => ED.truncateByWidth(String(s).trim(), ED.MAX_LINE_WIDTH)).filter((s) => s.length > 0);
    }
    const text = ED.serialize(model);
    let r = null;
    try { r = await API.saveLines(text); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.ok) {
      status('✓ 已保存,桌宠立即生效', 'ok');
      renderAll(); // 清理空发言后刷新计数
      if (window.__menuResize) window.__menuResize();
    } else {
      status('✗ 保存失败: ' + ((r && r.error) || '未知错误'), 'err');
    }
  }

  async function reloadNow() {
    await loadFromFile();
    renderAll();
    status('↻ 已重新加载文件(未保存修改已丢弃)', 'ok');
    if (window.__menuResize) window.__menuResize();
  }

  // ---------- 面板入口 ----------
  async function build(wrap) {
    const head = el('div', 'panel-head');
    head.appendChild(el('span', '', '📝 台词与场景'));
    head.appendChild(el('span', 'ph-line'));
    wrap.appendChild(head);

    scrollEl = el('div', 'scn-scroll');
    wrap.appendChild(scrollEl);

    const footer = el('div', 'scn-footer');
    statusEl = el('div', 'scn-status', '');
    const reloadBtn = el('button', 'scn-btn', '↻ 重新加载');
    reloadBtn.title = '放弃未保存修改,从台词文件重新载入';
    reloadBtn.onclick = reloadNow;
    const saveBtn = el('button', 'scn-btn primary', '💾 保存');
    saveBtn.title = '写入台词文件并立即生效';
    saveBtn.onclick = saveNow;
    footer.append(statusEl, reloadBtn, saveBtn);
    wrap.appendChild(footer);
    wrap.appendChild(el('div', 'scn-tip', '💡 保存后立即生效,无需重启;与「梨璃交互编辑器」共用同一个台词文件,两处修改互通。'));

    if (!loaded) await loadFromFile();
    renderAll();
    if (window.__menuResize) window.__menuResize();
  }

  window.ScenePanel = { build };
})();
