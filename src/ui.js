/**
 * HUD:时刻标签、进度线、提示、可选调试读数。
 * 全部可被 h 键隐藏 —— 截图时不想要文字就按一下。
 */
export function createUI() {
  const root = document.getElementById('hud');
  const label = document.getElementById('hud-phase');
  const clock = document.getElementById('hud-clock');
  const bar = document.getElementById('hud-bar-fill');
  const stats = document.getElementById('hud-stats');
  const veil = document.getElementById('veil');

  let visible = true;
  let lastStats = '';
  let lastBar = -1;

  return {
    setPhase(labelText, t, hour) {
      if (label && label.textContent !== labelText) label.textContent = labelText;
      if (bar) {
        const v = Math.round(t * 500) / 500;   // 0.2% 一档,避免每帧都写 style
        if (v !== lastBar) { bar.style.transform = `scaleX(${v.toFixed(3)})`; lastBar = v; }
      }
      if (clock && hour !== undefined) {
        const hh = Math.floor(hour) % 24;
        const mm = Math.floor((hour % 1) * 60);
        const txt = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        // 每帧写 DOM 没必要,变了才写
        if (clock.textContent !== txt) clock.textContent = txt;
      }
    },
    setStats(text) {
      if (!stats) return;
      if (text !== lastStats) {
        stats.textContent = text;
        lastStats = text;
      }
    },
    hideStats() {
      if (stats) stats.style.display = 'none';
    },
    toggle() {
      visible = !visible;
      if (root) root.style.opacity = visible ? '1' : '0';
      return visible;
    },
    ready() {
      if (veil) {
        veil.classList.add('gone');
        setTimeout(() => { if (veil.parentNode) veil.parentNode.removeChild(veil); }, 1400);
      }
    },
    fail(msg) {
      if (veil) {
        veil.classList.remove('gone');
        veil.innerHTML = `<div class="veil-inner"><div class="veil-title">无法渲染</div><div class="veil-sub">${msg}</div></div>`;
      }
    },
  };
}
