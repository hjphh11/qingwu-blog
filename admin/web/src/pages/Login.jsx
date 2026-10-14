// 登录页 —— 珍珠玻璃版（第 9 页，也是逐页迁移的最后一页）。
//
// 这一页**在珍珠外壳之外**：App.jsx 在 `phase === 'out'` 时直接渲染它，没有侧栏与顶栏，
// 所以它和前面八页的做法不同：
//   · 不套 `.page`（那是外壳内容区的容器，会带上外壳页的内距与纵向节奏）；
//   · 页面自己就是一个整屏舞台 —— 用 scaffold 早就搬进来的 `.login` / `.login-side`
//     一整套（styles/pearl/pages.css 第 5 节），外层 `.login` 自带 `--stage` 底色 +
//     `100dvh`，里面的 `.login-side` 负责把卡片居中；
//   · 卡片材质用珍珠玻璃的 `.m-surface`（阅读面：卡片 / 表格容器 / 弹窗那一档）。
//     ⚠️ `.p-login-card` 在 scaffold 里只有「宽度 / 圆角 / 3D 容器」三件事，**没有材质**
//     （原版那块玻璃是 Vue 的组件自己画的），所以材质这一档由这里显式给 `.m-surface`。
//     唯一的例外：`max-width` 取 scaffold 的 420px 而不是新版 380px（不写内联宽度，
//     也不为了 40px 去改 scaffold 的样式）。
//
// 逻辑与旧暖色版**逐行一致**（一行没动）：
//   · POST /api/auth/login { password }（服务端逻辑一行没碰），成功后调 onSuccess()；
//   · 提交中 busy=true：按钮禁用 + 文案「登录中…」，表单不允许重复提交（submit 里有 busy 守卫）；
//   · 失败：错误文案 = err.message || '登录失败'，并把密码框清空；
//   · 空密码：旧版按钮 `disabled={busy || !password}`，这里照旧；
//   · Enter 提交：`<form onSubmit>` + 按钮 `type="submit"`，密码框回车即提交（与旧版同一个路径）；
//   · notice 非空时（会话过期 / 服务器换了密钥，由 App.jsx 传进来）显示那条提示，文案照旧。
//
// 呈现层全部走珍珠玻璃的现成件：Field / TextInput / Button + `.alert-calm`
// （与关于页、文章编辑器同一写法），类名一律走 cls()；
// 页内不再出现 .card / .panel / .panel-head / .btn / .btn-ghost / .hint / .tag /
// .alert / .field / .input / .form-grid / .spacer / .login-wrap / .login-card 这些旧暖色类名。
// 全页零内联字号、零内联 margin（只有错误提示那一处沿用关于页的令牌写法）。
import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { CircleAlert, Info, LogOut } from '../icons.js';
import { cls } from '../pearl/cls.js';
import { useEntrance } from '../pearl/useEntrance.js';
import Button from '../pearl/ui/Button.jsx';
import Field from '../pearl/ui/Field.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

/**
 * `notice` = 回到登录页的原因（会话过期、服务器换了密钥…）。
 * 阶段 N 加的：以前会话过期只会把「请先登录」当普通错误显示在坏掉的页面上，
 * 现在直接回登录页并说明为什么。
 */
export default function Login({ onSuccess, notice = '' }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // `.login:not(.is-entrance-ready) .p-login-brand / .p-login-card` 是 opacity:0，
  // 入场类必须由 state 拼（见 pearl/useEntrance.js：手写 classList 会被 React 抹掉）
  const ready = useEntrance();

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/login', { password });
      onSuccess();
    } catch (err) {
      setError(err.message || '登录失败');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cls('login', ready && 'is-entrance-ready')}>
      {/* 整屏舞台上的登录位：卡片的居中、`place-items: center` 与 100dvh 都在这条类里 */}
      <div className={cls('login-side')}>
        <form className={cls('m-surface', 'p-login-card')} onSubmit={submit}>
          <div className={cls('login-card-inner')}>
            {/* 品牌区（站点名 + 内容与发布）：`.p-login-brand` 是 scaffold 那条
                「深色画布上的品牌横排」，`.p-brand-mark` 复用导航轨顶上那枚深色方牌
                （里面一颗青柠点），与侧栏的标识完全一致。
                32px 的内距、竖排间距交给 `.stack`（pearl-local 里是 18px），不写内联 margin。 */}
            <div className={cls('stack')}>
              <div className={cls('p-login-brand')}>
                <span className={cls('brand-mark')} aria-hidden="true">
                  <span className="brand-dot" />
                </span>
                <div className="brand-text">
                  <div className="brand-name">清吾后台</div>
                  <div className="brand-sub">内容与发布</div>
                </div>
              </div>

              <h2 className={cls('section-mark-title')}>密码登录</h2>
            </div>

            {/* 说明：文案原文保留（旧版是卡片标题下那句 .login-sub） */}
            <p className={cls('login-card-sub')}>
              输入密码进入 —— 只有你自己的设备（Tailscale 私网）能打开这一页。
            </p>

            {notice && (
              <div className={cls('alert-calm')} role="status">
                <MorphIcon icon={Info} size={15} color="currentColor" />
                <span>登录已过期（{notice}）—— 重新登录一下就好</span>
              </div>
            )}

            {/* 表单：`.login-form` 是 scaffold 的「竖排 + 16px 间距」，输入框外壳 42px 也由它钉住。
                密码框回车即提交（form 的 onSubmit 收 submit 事件，与旧版 `onSubmit` 同一个路径）；
                autocomplete 落在真正的 <input> 上（TextInput 的 autocomplete 口子）。 */}
            <div className={cls('login-form')}>
              <Field label="密码">
                <TextInput
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autocomplete="current-password"
                  autoFocus
                />
              </Field>

              <Button
                type="submit"
                variant="primary"
                icon={LogOut}
                block
                disabled={busy || !password}
                className={cls('login-submit')}
              >
                {busy ? '登录中…' : '登录'}
              </Button>
            </div>

            {error && (
              // 错误提示：与关于页同一个写法（`.alert-calm` + 语义令牌，文案照旧）
              <div
                className={cls('alert-calm')}
                role="alert"
                style={{ background: 'var(--red-soft)', color: 'var(--red-text)' }}
              >
                <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
