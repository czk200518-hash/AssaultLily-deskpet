// 独立记数窗口 - 渲染逻辑(纯展示:周期标签 + 击键数字,主进程实时推送)
// 主题系统:外观随当前主题换肤(主题仅作用于本窗口,由主进程随快照注入 theme)
'use strict';
(() => {
  const API = window.counterAPI;
  const $ = (id) => document.getElementById(id);

  const PERIOD_LABEL = { today: '今日', week: '本周', month: '本月', total: '总计' };
  const PERIOD_ORDER = ['today', 'week', 'month', 'total'];

  // 大数格式化:始终显示完整数字(千分位),不缩写为"万/亿"(用户要求只显示数字)
  function fmtCount(n) {
    n = Math.max(0, Math.round(n || 0));
    return n.toLocaleString('zh-CN');
  }

  // ---------- 主题皮肤:注入 themes/<id>.css(id 白名单防路径穿越) ----------
  let appliedTheme = null;
  async function applyTheme(id) {
    if (!id || !/^[a-z0-9-]+$/.test(id)) id = 'default';
    if (id === appliedTheme) return;
    let css = '';
    const load = async (tid) => new TextDecoder().decode(await API.readAsset('themes/' + tid + '.css'));
    try {
      css = await load(id);
      appliedTheme = id;
    } catch (e) {
      try { css = await load('default'); appliedTheme = 'default'; } catch (e2) { /* 忽略 */ }
    }
    let style = document.getElementById('counter-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'counter-theme';
      document.head.appendChild(style);
    }
    style.textContent = css;
    document.documentElement.dataset.theme = id;
  }

  function apply(s) {
    if (!s) return;
    if (s.theme) applyTheme(s.theme); // 主进程快照附带当前主题 → 即时换肤
    const period = PERIOD_ORDER.includes(s.period) ? s.period : 'today';
    $('label').textContent = PERIOD_LABEL[period] || '今日';
    $('value').textContent = fmtCount(s[period]);
    // 内容渲染后按卡片实际尺寸上报,窗口贴合内容并重新对齐
    requestAnimationFrame(() => {
      const card = document.getElementById('counter');
      API.resize(Math.max(60, card.offsetWidth), Math.max(28, card.offsetHeight));
    });
  }

  // 主进程实时推送(每次击键) + 冷启动主动拉取兜底
  API.onUpdate((s) => apply(s));
  API.getState().then((s) => { if (s) apply(s); }).catch(() => {});
})();
