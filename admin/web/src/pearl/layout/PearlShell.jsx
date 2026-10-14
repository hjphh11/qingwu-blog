// 珍珠玻璃外壳（React）：深色舞台 → 外框 → 232px 导航轨 + 64px 顶栏 + 内容区。
//
// 这是 scaffold 的 `layout/AppShell.vue` + `Sidebar.vue` + `Topbar.vue` 的 React 版，
// 但**导航与页面是清吾自己的**（内容 / 站点 / 运维 三组，11 个模块 + 顶栏发布）。
//
// 与原 Vue 版的差异（都是"没有 GSAP 之后怎么办"）：
//   1. 入场由 useEntrance() 加 `.is-entrance-ready`，淡入交给 styles/pearl-local.css；
//   2. 侧栏高亮胶囊自己量位置（原版用 GSAP slideThumb），过渡也在 pearl-local.css；
//   3. 外观设置 / 修改密码对话框不搬（本项目单用户、无深浅主题）——
//      用户菜单里放"下载内容备份"和"退出登录"，这是旧外壳本来就有的两个动作。
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../../api.js';
import { downloadBackup } from '../../backup.js';
import {
  ChartNoAxesColumn,
  ChevronRight,
  CircleCheck,
  FileText,
  Inbox,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Download,
  Menu,
  Music,
  Quote,
  ScrollText,
  Search,
  Send,
  Settings,
  Trash,
  TriangleAlert,
  User,
  X,
} from '../../icons.js';
import { cls } from '../cls.js';
import { useEntrance } from '../useEntrance.js';
import { pushToast, toastError } from '../toast.js';
import Avatar from '../ui/Avatar.jsx';
import Button from '../ui/Button.jsx';
import ConfirmHost from '../ui/ConfirmHost.jsx';
import IconButton from '../ui/IconButton.jsx';
import Segmented from '../ui/Segmented.jsx';
import ToastHost from '../ui/ToastHost.jsx';
import PearlCommandPalette from './PearlCommandPalette.jsx';
import AboutPage from '../../pages/About.jsx';
import Applications from '../../pages/Applications.jsx';
import ArticleEditor from '../../pages/ArticleEditor.jsx';
import Articles from '../../pages/Articles.jsx';
import Categories from '../../pages/Categories.jsx';
import Links from '../../pages/Links.jsx';
import LogsPage from '../../pages/Logs.jsx';
import MusicPage from '../../pages/Music.jsx';
import Overview from '../../pages/Overview.jsx';
import Publish from '../../pages/Publish.jsx';
import Shares from '../../pages/Shares.jsx';
import Soon from '../../pages/Soon.jsx';
import TrashPage from '../../pages/Trash.jsx';

// 访问统计带图表库（Recharts，约 400KB）：只在真点开时才下载
const Stats = lazy(() => import('../../pages/Stats.jsx'));

/** 侧栏分组（scaffold 的导航按组带小标题，这里沿用同一套信息架构） */
const NAV_GROUPS = [
  {
    key: 'content',
    label: '内容',
    items: [
      { key: 'dash', label: '概览', icon: LayoutDashboard },
      { key: 'posts', label: '文章', icon: FileText },
      { key: 'cats', label: '分类', icon: Settings },
      { key: 'music', label: '音乐', icon: Music },
    ],
  },
  {
    key: 'site',
    label: '站点',
    items: [
      { key: 'links', label: '友链', icon: Link2 },
      { key: 'apply', label: '友链申请', icon: Inbox },
      { key: 'share', label: '分享 · 语录', icon: Quote },
      { key: 'about', label: '关于页', icon: User },
    ],
  },
  {
    key: 'ops',
    label: '运维',
    items: [
      { key: 'trash', label: '回收站', icon: Trash },
      { key: 'logs', label: '操作日志', icon: ScrollText },
      { key: 'stats', label: '访问统计', icon: ChartNoAxesColumn },
    ],
  },
];

/** 路由名 → [面包屑分组, 页面标题, 页面说明] */
const TITLES = {
  dash: ['内容', '概览', '清清的小屋 · 内容规模、数据文件健康与发布状态。'],
  posts: ['内容', '文章', '管理文章 · 前台按置顶顺序与发布时间排'],
  edit: ['内容', '编辑文章', 'Markdown · 实时预览'],
  cats: ['内容', '分类', '前台筛选按钮跟着它变'],
  music: ['内容', '音乐', '改歌曲信息与歌词时间轴 · 保存后自动重生成 music.ts'],
  links: ['站点', '友链', '朋友列表 · 上下箭头调整前台顺序'],
  apply: ['站点', '友链申请', '通过 → 自动写进友链（再去发布）'],
  share: ['站点', '分享 · 语录', '收藏与摘录'],
  about: ['站点', '关于页', '主页信息 / 信息条目 / 爱弥斯 / 联系方式'],
  trash: ['运维', '回收站', '可恢复的已删除内容'],
  logs: ['运维', '操作日志', '发布 / 回滚 / 审批记录'],
  stats: ['运维', '访问统计', '访问量 · 阅读数 · 来源 · 地区 · 设备'],
  publish: ['运维', '发布', '构建校验 → 提交 → 推送 → 触发重建'],
};

/** 已经迁到珍珠玻璃的页面名。其它的暂时套一层暖色容器（下一轮再迁） */
const PEARL_PAGES = new Set(['dash', 'posts', 'edit', 'cats', 'links', 'apply', 'share', 'about', 'trash', 'logs', 'stats', 'publish']);

export default function PearlShell({ onLogout }) {
  const [route, setRoute] = useState({ name: 'dash', params: {} });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('qingwu.admin.rail') === '1');
  // 表格密度（scaffold 的三档：默认 48px 行高 / 宽松 56 / 紧凑 40，令牌在 pearl/tokens.css）
  const [density, setDensity] = useState(() => localStorage.getItem('qingwu.admin.density') ?? 'standard');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [pending, setPending] = useState(0);
  const [applyPending, setApplyPending] = useState(0);
  const [job, setJob] = useState(null);

  const frameRef = useRef(null);
  const contentRef = useRef(null);
  const navRef = useRef(null);
  const thumbRef = useRef(null);
  const chipRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  // 入场类必须由 state 驱动（见 useEntrance.js 的说明：手写 classList 会被 React 抹掉）
  const ready = useEntrance();

  // 窄屏判定：< 820px 时侧栏改成抽屉（与 layout.css 的断点一致）
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const sync = () => {
      setMobile(mq.matches);
      if (!mq.matches) setMobileOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // 导航轨收起状态记在本机（对应 scaffold 的外观偏好，但只留这一项）
  useEffect(() => {
    localStorage.setItem('qingwu.admin.rail', collapsed ? '1' : '0');
  }, [collapsed]);

  // 密度写进 <html data-density>，CSS 里 :root[data-density="comfy"|"compact"] 直接生效
  useEffect(() => {
    const root = document.documentElement;
    if (density === 'standard') delete root.dataset.density;
    else root.dataset.density = density;
    localStorage.setItem('qingwu.admin.density', density);
  }, [density]);

  // Cmd/Ctrl + K 唤起全局搜索；Esc 收抽屉
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (k === 'escape') {
        setMobileOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 顶栏「发布」按钮上的待发布数量 + 最近一次发布任务状态
  const refreshPublish = useCallback(() => {
    api
      .get('/api/publish/status')
      .then((s) => {
        setPending(s.count ?? 0);
        setJob(s.job ?? null);
      })
      .catch(() => setPending(0));
  }, []);

  useEffect(() => {
    refreshPublish();
    window.addEventListener('qingwu:pending', refreshPublish);
    return () => window.removeEventListener('qingwu:pending', refreshPublish);
  }, [refreshPublish, route]);

  // 侧栏「友链申请」上的待审批数量（走服务端缓存的轻接口）
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

  const go = useCallback((name, params = {}) => {
    setRoute({ name, params });
    setMobileOpen(false);
    setMenuOpen(false);
    contentRef.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, []);

  const navKey = route.name === 'edit' ? 'posts' : route.name;
  const activeItem = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === navKey);
  const [crumbGroup, title, desc] = TITLES[route.name] ?? ['', activeItem?.label ?? '', ''];
  const pageTitle = route.name === 'edit' && !route.params?.id ? '新建文章' : title;
  const pageKey = `${route.name}:${route.params?.id ?? ''}`;

  // 高亮胶囊：量当前项的位置（原版 GSAP slideThumb）。
  // ⚠️ 不能用 el.offsetTop —— 胶囊的定位祖先是 .rail（或 .rail-nav），而导航项的
  // offsetParent 是 .nav-list，两者基准不同，直接相减会**整体错一行**（真机验收抓到过）。
  // 用 getBoundingClientRect 相对胶囊自己的 offsetParent 算，基准就一定一致。
  useEffect(() => {
    const nav = navRef.current;
    const thumb = thumbRef.current;
    if (!nav || !thumb) return;
    const el = nav.querySelector('.p-nav-item.is-active');
    if (!el) {
      thumb.style.opacity = '0';
      return;
    }
    const host = thumb.offsetParent || nav;
    const itemRect = el.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    thumb.style.opacity = '1';
    thumb.style.transform = `translateY(${itemRect.top - hostRect.top + host.scrollTop}px)`;
    thumb.style.height = `${itemRect.height}px`;
  }, [navKey, collapsed, mobileOpen, route]);

  const onContentScroll = () => {
    const next = (contentRef.current?.scrollTop ?? 0) > 8;
    if (next !== scrolled) setScrolled(next);
  };

  const toggleRail = () => {
    if (mobile) setMobileOpen((v) => !v);
    else setCollapsed((v) => !v);
  };

  const openMenu = () => {
    const rect = chipRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    setMenuOpen((v) => !v);
  };

  const onBackup = () => {
    setMenuOpen(false);
    downloadBackup();
    pushToast('正在打包内容备份…', 'info');
  };

  // 发布按钮图标随任务状态形变：发送 → 转圈 → 打勾 / 感叹号
  const pubIcon = job?.running ? LoaderCircle : pending > 0 ? Send : job?.ok === false ? TriangleAlert : job?.ok === true ? CircleCheck : Send;

  const content = (() => {
    switch (route.name) {
      case 'dash':
        return <Overview go={go} />;
      case 'posts':
        return <Articles go={go} />;
      case 'edit':
        return <ArticleEditor id={route.params?.id ?? null} go={go} />;
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
      case 'stats':
        return (
          <Suspense fallback={<div className="legacy-slot"><div className={cls('panel', 'm-surface')}><div className={cls('empty')}>正在加载图表…</div></div></div>}>
            <Stats />
          </Suspense>
        );
      default:
        return <Soon label={activeItem?.label ?? ''} />;
    }
  })();

  return (
    <div className={cls('stage')}>
      <div
        ref={frameRef}
        className={cls(
          'app-frame',
          ready && 'is-entrance-ready',
          collapsed && !mobile && 'is-collapsed',
          mobile && mobileOpen && 'is-mobile-open',
        )}
      >
        <aside className={cls('rail', 'm-rail')} aria-label="主导航">
          <div className="rail-brand">
            <span className={cls('brand-mark')} aria-hidden="true">
              <span className="brand-dot" />
            </span>
            <div className="brand-text">
              <div className="brand-name">清吾</div>
              <div className="brand-sub">内容与发布</div>
            </div>
          </div>

          <nav className="rail-nav" ref={navRef}>
            <span ref={thumbRef} className={cls('nav-thumb', 'm-pill')} aria-hidden="true" style={{ opacity: 0 }} />
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.key}>
                <div className="nav-group-title">{group.label}</div>
                <div className="nav-list">
                  {group.items.map((item) => {
                    const Ico = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={cls('nav-item', navKey === item.key && 'is-active')}
                        aria-current={navKey === item.key ? 'page' : undefined}
                        title={collapsed && !mobile ? item.label : undefined}
                        onClick={() => go(item.key)}
                      >
                        <MorphIcon className="nav-ico" icon={Ico} size={18} color="currentColor" />
                        <span className="nav-label">{item.label}</span>
                        {item.key === 'apply' && applyPending > 0 && (
                          // 待审批数量：用珍珠玻璃的令牌手写一小颗，避免用到旧暖色 app.css 的 .nav-badge
                          <span
                            style={{
                              marginLeft: 'auto',
                              minWidth: 18,
                              height: 18,
                              padding: '0 5px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 999,
                              background: 'var(--red-soft)',
                              color: 'var(--red-text)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 10.5,
                              fontWeight: 700,
                            }}
                          >
                            {applyPending}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="rail-foot">
            {/* 字号交给 CSS（pearl-local.css 里 .rail-foot .nav-label 是 12px）；
                以前在这里写了内联 fontSize: 11，内联会压过样式表，成了全站唯一漏网的 11px */}
            <span className="nav-label faint" style={{ padding: '0 10px' }}>
              qingwu.ink
            </span>
          </div>
        </aside>

        {mobile && mobileOpen && <div className="rail-scrim" aria-hidden="true" onClick={() => setMobileOpen(false)} />}

        <div className={cls('workspace', scrolled && 'is-scrolled')}>
          <header className={cls('topbar')}>
            <IconButton icon={mobile && mobileOpen ? X : Menu} label="切换导航" onClick={toggleRail} />

            <div className="crumbs" aria-label="当前位置">
              {crumbGroup && (
                <>
                  <span>{crumbGroup}</span>
                  <MorphIcon className="crumb-sep" icon={ChevronRight} size={12} color="currentColor" />
                </>
              )}
              <span className="crumb-current">{pageTitle}</span>
            </div>

            <div className={cls('spacer')} />

            <button
              type="button"
              className={cls('cmd-trigger', 'm-pill')}
              aria-label="搜索菜单"
              onClick={() => setPaletteOpen(true)}
            >
              <MorphIcon icon={Search} size={15} color="currentColor" />
              <span className="cmd-text">搜索菜单</span>
              <span className={cls('kbd')}>⌘K</span>
            </button>

            <Button
              variant={pending > 0 ? 'primary' : 'secondary'}
              icon={pubIcon}
              onClick={() => go('publish')}
              title={pending > 0 ? `${pending} 个文件待发布` : '没有待发布的改动'}
            >
              发布
              {pending > 0 && (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,.24)',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {pending}
                </span>
              )}
            </Button>

            <button
              ref={chipRef}
              type="button"
              className="user-chip"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={openMenu}
            >
              <Avatar name="清" size={32} />
              <span className="user-meta">
                <span className="user-name">清吾</span>
                <span className="user-role">内容与发布</span>
              </span>
              <MorphIcon icon={ChevronRight} size={14} color="var(--ink-soft)" />
            </button>
          </header>

          <main
            ref={contentRef}
            className={cls('content')}
            tabIndex={-1}
            onScroll={onContentScroll}
          >
            {/* 已迁到珍珠玻璃的页面自己带页面头；还没迁的由外壳统一补一个，
                否则切页时标题会从 28px 突然变成面板里的 18px（实测过） */}
            {PEARL_PAGES.has(route.name) ? (
              <div key={pageKey}>{content}</div>
            ) : (
              <div key={pageKey} className="legacy-slot">
                <header className="page-head">
                  <div className="page-head-main">
                    <h1 className="page-title">{pageTitle}</h1>
                    {desc ? <p className="page-desc">{desc}</p> : null}
                  </div>
                </header>
                {content}
              </div>
            )}
          </main>
        </div>
      </div>

      {menuOpen && (
        <div className={cls('menu-pop', 'm-float')} role="menu" style={{ top: menuPos.top, right: menuPos.right }}>
          <div className="menu-head">
            <div style={{ fontWeight: 680 }}>清吾</div>
            <div className="soft" style={{ fontSize: 12 }}>单用户后台 · 内容与发布</div>
          </div>
          {/* 表格密度：三档走 scaffold 的 data-density 令牌（行高 48 / 56 / 40） */}
          <div style={{ padding: '4px 10px 10px' }}>
            <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
              表格密度
            </div>
            <Segmented
              label="表格密度"
              value={density}
              onChange={setDensity}
              options={[
                { label: '紧凑', value: 'compact' },
                { label: '标准', value: 'standard' },
                { label: '宽松', value: 'comfy' },
              ]}
            />
          </div>
          <button type="button" className="menu-item" role="menuitem" onClick={onBackup}>
            <MorphIcon icon={Download} size={16} color="currentColor" />
            下载内容备份（zip）
          </button>
          <button type="button" className="menu-item is-danger" role="menuitem" onClick={() => { setMenuOpen(false); onLogout?.(); }}>
            <MorphIcon icon={LogOut} size={16} color="currentColor" />
            退出登录
          </button>
        </div>
      )}

      <PearlCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        go={go}
        onDownload={downloadBackup}
      />

      <ToastHost />
      {/* 全局确认浮层：页面里 await confirm({...}) 就由它渲染，不用各页自己摆弹窗 */}
      <ConfirmHost />
    </div>
  );
}
