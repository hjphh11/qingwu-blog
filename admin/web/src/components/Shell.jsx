import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  ChartNoAxesColumn,
  FileText,
  Inbox,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Music,
  Quote,
  ScrollText,
  Search,
  Send,
  Settings,
  Trash,
  User,
  X,
} from '../icons.js';
import AboutPage from '../pages/About.jsx';
import Applications from '../pages/Applications.jsx';
import ArticleEditor from '../pages/ArticleEditor.jsx';
import { downloadBackup } from '../backup.js';
import CommandPalette from './CommandPalette.jsx';
import Articles from '../pages/Articles.jsx';
import Categories from '../pages/Categories.jsx';
import Links from '../pages/Links.jsx';
import LogsPage from '../pages/Logs.jsx';
import MusicPage from '../pages/Music.jsx';
import Overview from '../pages/Overview.jsx';
import Publish from '../pages/Publish.jsx';
import Shares from '../pages/Shares.jsx';
import Soon from '../pages/Soon.jsx';
import TrashPage from '../pages/Trash.jsx';

// 侧栏模块（与 docs/后台界面预览.html 的划分一致）。
// 做完了的去掉 stage 标记；没做的仍标注归属阶段。发布在**顶栏**（方案预览稿就是这样）。
const NAV = [
  { key: 'dash', label: '概览', icon: LayoutDashboard },
  { key: 'posts', label: '文章', icon: FileText },
  { key: 'cats', label: '分类', icon: Settings },
  { key: 'links', label: '友链', icon: Link2 },
  { key: 'apply', label: '友链申请', icon: Inbox },
  { key: 'share', label: '分享 · 语录', icon: Quote },
  { key: 'about', label: '关于页', icon: User },
  { key: 'music', label: '音乐', icon: Music },
  { key: 'trash', label: '回收站', icon: Trash },
  { key: 'logs', label: '操作日志', icon: ScrollText },
  { key: 'stats', label: '访问统计', icon: ChartNoAxesColumn, stage: '阶段 M' },
];

// 顶栏标题（编辑页再按「新建 / 编辑」细分）
const TITLES = {
  dash: ['概览', '清清的小屋 · 内容与发布'],
  posts: ['文章', '管理文章'],
  edit: ['编辑文章', 'Markdown · 实时预览'],
  cats: ['分类', '前台筛选按钮跟着它变'],
  links: ['友链', '朋友列表'],
  apply: ['友链申请', '通过 → 自动写进友链（再去发布）'],
  share: ['分享 · 语录', '收藏与摘录'],
  about: ['关于页', '主页信息 / 信息条目 / 爱弥斯 / 联系方式'],
  music: ['音乐', '改歌曲信息与歌词时间轴 · 保存后自动重生成 music.ts'],
  publish: ['发布', '构建校验 → 提交 → 推送 → 触发重建'],
  trash: ['回收站', '可恢复的已删除内容'],
  logs: ['操作日志', '发布 / 回滚 / 审批记录'],
};

export default function Shell({ onLogout }) {
  const [route, setRoute] = useState({ name: 'dash', params: {} });
  const [navOpen, setNavOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [applyPending, setApplyPending] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // 全局搜索（阶段 K · 第 44 条）：Cmd/Ctrl + K 唤起、再按一次关掉；Esc 也能关
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 顶栏「发布」按钮上的待发布数量（切页面时刷新；发布页发完也会喊一声，见 Publish.jsx）
  useEffect(() => {
    const refresh = () =>
      api
        .get('/api/publish/status')
        .then((s) => setPending(s.count ?? 0))
        .catch(() => setPending(0));
    refresh();
    window.addEventListener('qingwu:pending', refresh);
    return () => window.removeEventListener('qingwu:pending', refresh);
  }, [route]);

  // 侧栏「友链申请」上的待审批数量（阶段 J）。走服务端缓存的轻接口，不会每次切页都打 GitHub。
  useEffect(() => {
    const refresh = () =>
      api
        .get('/api/applications/summary')
        .then((s) => setApplyPending(s.pending ?? 0))
        .catch(() => setApplyPending(0));
    refresh();
    window.addEventListener('qingwu:applications', refresh);
    return () => window.removeEventListener('qingwu:applications', refresh);
  }, [route]);

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
        return <Overview go={go} />;
      case 'posts':
        return <Articles go={go} />;
      case 'edit':
        return <ArticleEditor id={route.params.id ?? null} go={go} />;
      case 'cats':
        return <Categories />;
      case 'links':
        return <Links />;
      case 'apply':
        return <Applications />;
      case 'share':
        return <Shares />;
      case 'about':
        return <AboutPage />;
      case 'music':
        return <MusicPage />;
      case 'publish':
        return <Publish />;
      case 'logs':
        return <LogsPage />;
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
            {n.key === 'apply' && applyPending > 0 && <span className="nav-badge">{applyPending}</span>}
            {n.stage && <span className="soon">{n.stage}</span>}
          </button>
        ))}

        <div className="sidebar-foot">
          阶段 K：便捷功能
          <br />
          ⌘K 搜索 · 定时发布 · 一键备份
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
          <button
            type="button"
            className="btn btn-ghost search-btn"
            onClick={() => setPaletteOpen(true)}
            title="全局搜索（Cmd/Ctrl + K）"
            aria-label="全局搜索"
          >
            <MorphIcon icon={Search} size={16} color="currentColor" />
            <span className="search-btn-text">搜索</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
          <button
            type="button"
            className={`btn${pending > 0 ? '' : ' btn-ghost'}`}
            onClick={() => go('publish')}
            title={pending > 0 ? `${pending} 个文件待发布` : '没有待发布的改动'}
          >
            <MorphIcon icon={Send} size={16} color={pending > 0 ? '#fff' : 'currentColor'} />
            发布{pending > 0 ? ` ${pending}` : ''}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            <MorphIcon icon={LogOut} size={16} color="currentColor" />
            退出
          </button>
        </header>

        <main className="content">{content}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        go={go}
        onDownload={downloadBackup}
      />
    </div>
  );
}
