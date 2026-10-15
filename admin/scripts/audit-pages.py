# 全站排版与位置审计脚本（可重复运行）
#
#   cd admin && python scripts/audit-pages.py
#
# 前置：后台开发服务器在 http://127.0.0.1:5173 跑着（npm run dev），
#       本脚本用真浏览器登录后逐个访问 11 个侧栏路由，量：
#         · 每个页面的字号档位（目标阶梯 12 / 13 / 14 / 18 / 28，读数 30/40/56 属例外）
#         · 页头 / 面板 / 标题的左缘是否对齐（应全部相等）
#         · 表格行内每个单元格的内容是否垂直居中（偏差 > 2px 会列出）
#         · 行高 / 按钮高 / 输入框高、主要区块间距、横向溢出
# 输出：终端汇总 + JSON（写到系统临时目录），截图可选。
# 口令只从环境变量 SCAFFOLD_AUDIT_PASSWORD 读，绝不写进仓库（本仓库公开）：
#   PowerShell: $env:SCAFFOLD_AUDIT_PASSWORD='***'; python scripts/audit-pages.py
# 全站排版审计：每个页面的字号档位、间距、位置与对齐
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:5173'
PASSWORD = os.environ.get('SCAFFOLD_AUDIT_PASSWORD', '')
if not PASSWORD:
    raise SystemExit('缺少口令：请先设置环境变量 SCAFFOLD_AUDIT_PASSWORD')

# 目标阶梯（正文 14 / 次级 13 / 最小 12 / 区块标题 18 / 页面标题 28）+ 读数显示层
TARGET = {12, 13, 14, 18, 28, 30, 40, 56}

NAV = ['概览', '文章', '分类', '音乐', '友链', '友链申请', '分享 · 语录', '关于页', '回收站', '操作日志', '访问统计']

AUDIT = r"""
(target) => {
  const off = {};        // 不在目标阶梯上的字号 → 样本
  const sizes = new Set();
  const sel = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  document.querySelectorAll('body *').forEach((el) => {
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const size = Math.round(parseFloat(cs.fontSize) * 10) / 10;
    sizes.add(size);
    if (!target.includes(size)) {
      (off[size] ||= []).push({ sel: sel(el), text: el.textContent.trim().slice(0, 12), lh: cs.lineHeight });
    }
  });
  // 位置：页面头 / 面板头的左缘是否对齐到同一个基准；行内内容是否垂直居中
  const lefts = {};
  const ph = document.querySelector('.page-head, .p-page-head');
  const pn = document.querySelector('.p-panel, .legacy-slot .card, .legacy-slot .panel');
  if (ph) lefts['页头'] = Math.round(ph.getBoundingClientRect().left);
  if (pn) lefts['面板'] = Math.round(pn.getBoundingClientRect().left);
  const h2 = document.querySelector('.p-panel-head h2, .panel-head h2, .page-title');
  if (h2) lefts['标题'] = Math.round(h2.getBoundingClientRect().left);

  // 表格行内对齐：每个单元格首元素的中心与行中心之差
  const misaligned = [];
  const row = document.querySelector('.p-table tbody tr, .table tbody tr');
  if (row) {
    const rr = row.getBoundingClientRect();
    [...row.querySelectorAll('td')].forEach((td, i) => {
      const k = td.firstElementChild;
      if (!k) return;
      const kr = k.getBoundingClientRect();
      const delta = Math.round(kr.top + kr.height / 2 - (rr.top + rr.height / 2));
      if (Math.abs(delta) > 2) misaligned.push({ col: i, delta, sel: sel(k), h: Math.round(kr.height) });
    });
  }
  // 行高与控件高
  const rowH = row ? Math.round(row.getBoundingClientRect().height) : null;
  const btnH = (() => { const b = document.querySelector('.p-btn, .legacy-slot .btn'); return b ? Math.round(b.getBoundingClientRect().height) : null; })();
  const inputH = (() => { const i = document.querySelector('.input-shell, .legacy-slot .input'); return i ? Math.round(i.getBoundingClientRect().height) : null; })();
  // 主要区块之间的竖向间距
  const gap = (a, b) => { const x = document.querySelector(a), y = document.querySelector(b); if (!x || !y) return null;
    return Math.round(y.getBoundingClientRect().top - x.getBoundingClientRect().bottom); };
  return {
    sizes: [...sizes].sort((a, b) => a - b),
    off: Object.entries(off).map(([s, items]) => ({ size: Number(s), count: items.length, samples: items.slice(0, 3) })),
    lefts, misaligned, rowH, btnH, inputH,
    gapHeadContent: gap('.page-head, .p-page-head', '.p-panel, .legacy-slot .card'),
    gapHeadSearch: gap('.page-head, .p-page-head', '.search-form'),
    gapSearchPanel: gap('.search-form', '.p-panel, .legacy-slot .card'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}
"""

report = {}
console = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: console.append(f'pageerror: {str(e)[:120]}'))
    page.goto(BASE, wait_until='domcontentloaded')
    page.evaluate("""async (pwd) => (await fetch('/api/auth/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pwd }) })).status""", PASSWORD)
    page.goto(BASE, wait_until='networkidle')
    page.wait_for_selector('.bento-grid', timeout=30000)
    page.wait_for_timeout(1200)
    for label in NAV:
        page.evaluate("""(l) => { const b=[...document.querySelectorAll('.p-nav-item')].find(x=>x.textContent.includes(l)); if (b) b.click(); }""", label)
        page.wait_for_timeout(1400)
        report[label] = page.evaluate(AUDIT, list(TARGET))
    browser.close()

with open(r'C:\Users\hjiap\AppData\Local\Temp\pearl-check\audit-all.json', 'w', encoding='utf-8') as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)

for label in NAV:
    d = report[label]
    offkinds = len(d['off'])
    badalign = len(d['misaligned'])
    print(f"== {label} | 字号 {d['sizes']}")
    print(f"   档位外 {offkinds} 种 | 行内错位 {badalign} 处 | 行高 {d['rowH']} 按钮 {d['btnH']} 输入框 {d['inputH']} | 间距 头→内容 {d['gapHeadContent']} 头→查询 {d['gapHeadSearch']} 查询→面板 {d['gapSearchPanel']} | 左缘 {json.dumps(d['lefts'], ensure_ascii=False)} | 溢出 {d['overflow']}")
    for o in d['off']:
        s = o['samples'][0]
        print(f"      {o['size']}px ×{o['count']:<3} 例: {s['sel'][:34]:<36} 「{s['text']}」")
print('console:', console[:5])
