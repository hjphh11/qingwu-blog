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
import AboutPage from '../pages/About.jsx';
import ArticleEditor from '../pages/ArticleEditor.jsx';
import Articles from '../pages/Articles.jsx';
import Categories from '../pages/Categories.jsx';
import Links from '../pages/Links.jsx';
import MusicPage from '../pages/Music.jsx';
import Overview from '../pages/Overview.jsx';
import Shares from '../pages/Shares.jsx';
import Soon from '../pages/Soon.jsx';
import TrashPage from '../pages/Trash.jsx';

// 侧栏模块（与 docs/后台界面预览.html 的划分一致）。
// 做完了的去掉 stage 标记；没做的仍标注归属阶段。
const NAV = [
  { key: 'dash', label: '概览', icon: LayoutDashboard },
  { key: 'posts', label: '文章', icon: FileText },
  { key: 'cats', label: '分类', icon: Settings },
  { key: 'links', label: '友链', icon: Link2 },
  { key: 'share', label: '分享 · 语录', icon: Quote },
  { key: 'about', label: '关于页', icon: User },
  { key: 'music', label: '音乐', icon: Music },
  { key: 'trash', label: '回收站', icon: Trash },
  { key: 'logs', label: '操作日志', icon: ScrollText, stage: '阶段 I' },
  { key: 'stats', label: '访问统计', icon: ChartNoAxesColumn, stage: '阶段 M' },
];

// 顶栏标题（编辑页再按「新建 / 编辑」细分）
const TITLES = {
  dash: ['概览', '清清的小屋 · 内容与发布'],
  posts: ['文章', '管理文章'],
  edit: ['编辑文章', 'Markdown · 实时预览'],
  cats: ['分类', '前台筛选按钮跟着它变'],
  links: ['友链', '朋友列表'],
  share: ['分享 · 语录', '收藏与摘录'],
  about: ['关于页', '主页信息 / 信息条目 / 爱弥斯 / 联系方式'],
  music: ['音乐', '改歌曲信息与歌词时间轴 · 保存后自动重生成 music.ts'],
  trash: ['回收站', '可恢复的已删除内容'],
};

export default function Shell({ onLogout }) {
  const [route, setRoute] = useState({ name: 'dash', params: {} });
  const [navOpen, setNavOpen] = useState(false);

  const go = (name, params = {}) => {
    setRoute({ name, params });
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  const current = NAV.find((n) => n.key === route.name) ?? NAV[0];
  // 编辑页在侧栏里仍高亮「文章」
  const navKey = route.name === 'edit' ? 'posts' : route.name;
  const [title, crumb] = TITLES[route.name] ?? [current.label, ''];

  const content = (() => {
    switch (route.name) {
      case 'dash':
        return <Overview />;
      case 'posts':
        return <Articles go={go} />;
      case 'edit':
        return <ArticleEditor id={route.params.id ?? null} go={go} />;
      case 'cats':
        return <Categories />;
      case 'links':
        return <Links />;
      case 'share':
        return <Shares />;
      case 'about':
        return <AboutPage />;
      case 'music':
        return <MusicPage />;
      case 'trash':
        return <TrashPage />;
      default:
        return <Soon label={current.label} stage={current.stage} />;
    }
  })();

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
            className={`nav-item${navKey === n.key ? ' on' : ''}`}
            onClick={() => go(n.key)}
          >
            <MorphIcon icon={n.icon} size={17} color="currentColor" />
            {n.label}
            {n.stage && <span className="soon">{n.stage}</span>}
          </button>
        ))}

        <div className="sidebar-foot">
          阶段 H：音乐管理（歌词时间轴）
          <br />
          保存只写进仓库，发布在阶段 I
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
            <h1>{route.name === 'edit' && !route.params.id ? '新建文章' : title}</h1>
            <div className="crumb">{crumb || '清清的小屋 · 内容与发布'}</div>
          </div>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            <MorphIcon icon={LogOut} size={16} color="currentColor" />
            退出
          </button>
        </header>

        <main className="content">{content}</main>
      </div>
    </div>
  );
}
