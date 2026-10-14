import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// 旧暖色样式（19 个页面还在用）。迁移完成后会整体删掉。
import './styles/theme.css';
import './styles/app.css';

// 珍珠玻璃七层 —— 从 scaffold 逐字搬来，见 scripts/sync-pearl-css.mjs。
// 引入顺序 = 层叠顺序：令牌 → 基线 → 材质 → 控件 → 仪器 → 布局 → 页面差异。
// ⚠️ 那 25 个与 app.css 重名的类名已统一加 `p-` 前缀（组件里通过 pearl/cls.js 生成），
//    所以两套样式可以同时存在、互不覆盖。
import './styles/pearl/tokens.css';
import './styles/pearl/base.css';
import './styles/pearl/materials.css';
import './styles/pearl/components.css';
import './styles/pearl/instruments.css';
import './styles/pearl/layout.css';
import './styles/pearl/pages.css';

// 本后台自己的补充层（React 版需要的过渡、对比度修正、状态灯），必须最后引入
import './styles/pearl-local.css';

// 旧页面兼容皮肤：把 8 个还没重写的页面仍在用的暖色类名（.card/.panel/.table/.btn/.tag…）
// 整体映射到珍珠玻璃令牌上，先让全站视觉统一；等这些页面按 pearl/PORTING.md 升级完就删掉。
import './styles/pearl-legacy-bridge.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
