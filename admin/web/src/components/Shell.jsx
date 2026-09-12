import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  ChartNoAxesColumn,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Music,
  Quote,
  ScrollText,
  Settings,
  Trash,
  User,
  X,
} from '../icons.js';
import Overview from '../pages/Overview.jsx';
import Soon from '../pages/Soon.jsx';

// 侧栏模块（与 docs/后台界面预览.html 的划分一致）。
// 阶段 D 只做「概览」；其余标注了各自归属的阶段，先占位。
const NAV = [
  { key: 'dash', label: '概览', icon: LayoutDashboard },
  { key: 'posts', label: '文章', icon: FileText, stage: '阶段 E' },
  { key: 'links', label: '友链', icon: Link2, stage: '阶段 G' },
  { key: 'share', label: '分享 · 语录', icon: Quote, stage: '阶段 G' },
  { key: 'about', label: '关于页', icon: User, stage: '阶段 G' },
  { key: 'music', label: '音乐', icon: Music, stage: '阶段 H' },
  { key: 'cats', label: '分类', icon: Settings, stage: '阶段 F' },
  { key: 'trash', label: '回收站', icon: Trash, stage: '阶段 E' },
  { key: 'logs', label: '操作日志', icon: ScrollText, stage: '阶段 I' },
  { key: 'stats', label: '访问统计', icon: ChartNoAxesColumn, stage: '阶段 M' },
];

const TITLES = Object.fromEntries(NAV.map((n) => [n.key, { title: n.label }]));

export default function Shell({ onLogout }) {
  const [view, setView] = useState('dash');
  const [navOpen, setNavOpen] = useState(false);

  const current = NAV.find((n) => n.key === view) ?? NAV[0];
  const meta = TITLES[view] ?? { title: current.label };

  const go = (key) => {
    setView(key);
    setNavOpen(false);
  };

  return (
    <div className="shell">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            清
          </span>
          <div>
            <b>清吾</b>
            <small>内容与发布</small>
          </div>
        </div>

        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            className={`nav-item${view === n.key ? ' on' : ''}`}
            onClick={() => go(n.key)}
          >
            <MorphIcon icon={n.icon} size={17} color="currentColor" />
            {n.label}
            {n.stage && <span className="soon">{n.stage}</span>}
          </button>
        ))}

        <div className="sidebar-foot">
          阶段 D：骨架 + 登录 + 数据总览
          <br />
          只读，不会改动仓库
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost menu-btn"
            aria-label="打开菜单"
            onClick={() => setNavOpen((v) => !v)}
          >
            <MorphIcon icon={navOpen ? X : Menu} size={18} color="currentColor" />
          </button>
          <div>
            <h1>{meta.title}</h1>
            <div className="crumb">清清的小屋 · 内容与发布</div>
          </div>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            <MorphIcon icon={LogOut} size={16} color="currentColor" />
            退出
          </button>
        </header>

        <main className="content">
          {view === 'dash' ? (
            <Overview />
          ) : (
            <Soon label={current.label} stage={current.stage} />
          )}
        </main>
      </div>
    </div>
  );
}
