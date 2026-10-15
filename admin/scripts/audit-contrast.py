# 全站对比度审计脚本（可重复运行）
#
#   cd admin && python scripts/audit-contrast.py
#
# 前置：后台开发服务器在 http://127.0.0.1:5173（npm run dev）。
# 做法：真浏览器登录后逐个访问 11 个侧栏路由，对每个「含直接文字」的元素
#       把前景色与**合成后的实际底色**（沿祖先链叠加 background-color）比一遍，
#       按 WCAG 2.1 判定：正文 ≥4.5:1、大字号(≥24px 或 ≥18.66px 粗体) ≥3:1。
# 注意：本工具只合成 background-color，**读不到渐变/玻璃材质的实际像素**，
#       这类元素单独归到「渐变底」一类，需要时人工目视复核。
# 输出：每个页面的不达标条数 + 最差的几条（含选择器、文字、实测比值、字号）。
# 全站对比度审计：13 个路由，逐元素算 WCAG 对比度（只算实底，渐变底单列）
import json
import os
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:5173'
# 口令只从环境变量读，绝不写进仓库（本仓库公开）：
#   PowerShell: $env:SCAFFOLD_AUDIT_PASSWORD='***'; python scripts/audit-contrast.py
PASSWORD = os.environ.get('SCAFFOLD_AUDIT_PASSWORD', '')
if not PASSWORD:
    raise SystemExit('缺少口令：请先设置环境变量 SCAFFOLD_AUDIT_PASSWORD')
NAV = ['概览', '文章', '分类', '音乐', '友链', '友链申请', '分享 · 语录', '关于页', '回收站', '操作日志', '访问统计']

CONTRAST = r"""
() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: f.a + b.a * (1 - f.a) });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => ((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05));
  const bgOf = (el) => { let n = el, acc = null, grad = false;
    while (n && n !== document.documentElement) { const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) grad = true;
      const c = parse(cs.backgroundColor); if (c && c.a > 0) acc = acc ? over(acc, c) : c;
      if (acc && acc.a >= 0.99) break; n = n.parentElement; }
    const body = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    const base = acc ? over(acc, body) : body; base.a = 1; return { bg: base, grad }; };
  const solid = [], grad = [];
  document.querySelectorAll('main *').forEach((el) => {
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const fg = parse(cs.color); if (!fg) return;
    const { bg, grad: g } = bgOf(el);
    const cr = ratio(fg, bg);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const item = { sel: el.tagName.toLowerCase() + cls, text: el.textContent.trim().slice(0, 14),
        ratio: Math.round(cr * 100) / 100, need, size, fg: cs.color };
      (g ? grad : solid).push(item);
    }
  });
  return { solidCount: solid.length, gradCount: grad.length, solid: solid.slice(0, 6) };
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    page.goto(BASE, wait_until='domcontentloaded')
    page.evaluate("""async (pwd) => (await fetch('/api/auth/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pwd }) })).status""", PASSWORD)
    page.goto(BASE, wait_until='networkidle')
    page.wait_for_selector('.bento-grid', timeout=30000)
    page.wait_for_timeout(1200)
    total = 0
    for label in NAV:
        page.evaluate("""(l) => { const b=[...document.querySelectorAll('.p-nav-item')].find(x=>x.textContent.includes(l)); if (b) b.click(); }""", label)
        page.wait_for_timeout(1400)
        d = page.evaluate(CONTRAST)
        total += d['solidCount']
        flag = 'OK ' if d['solidCount'] == 0 else '不达标'
        print(f"{label:<10} {flag} 实底 {d['solidCount']:>2} 条 | 渐变底(工具测不准) {d['gradCount']:>2} 条")
        for s in d['solid']:
            print(f"      {s['ratio']:<5} 需{s['need']} {s['size']}px  {s['sel'][:30]:<32} 「{s['text']}」 {s['fg']}")
    print(f"\n合计实底不达标 {total} 条")
    browser.close()
