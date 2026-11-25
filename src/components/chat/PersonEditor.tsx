import { useRef, useState } from 'react';
import { saveProfile, uploadAvatar, clearAvatar, type SessionAccount } from '../../lib/auth';
import { fileToAvatar } from '../../lib/avatarUpload';
import { avatarFromHash } from '../../lib/avatar';

/**
 * 长亭 · 编辑自己的资料（人卡里的「编辑资料」）
 *
 * 和 `/account/` 是同一套接口（`PATCH /auth/profile`、`POST /auth/avatar`），
 * 只是把入口搬到「你正看着的那个人」身上 —— 在老地方改资料，得先想起来它在哪儿。
 *
 * 三件事分开做：
 *   · 头像：选图 → 前端压 192×192 webp → 立刻上传，换完即时生效（不等「保存」）
 *   · 名字 / 简介 / 站点：一起提交，免得改一半漏一半
 *   · 「用回默认」只在自定义过头像时出现（否则按了也没变化，像一个坏按钮）
 */

/** 和 worker 的 BIO_MAX 对齐 */
const BIO_MAX = 120;
const NAME_MAX = 30;

export default function PersonEditor({
  account,
  onAccount,
  onDone,
}: {
  account: SessionAccount;
  /** 任一字段存成功：把新账号抛上去（页面同步会话 + 刷新成员名单） */
  onAccount: (a: SessionAccount | null) => void;
  /** 收起编辑态 */
  onDone: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [bio, setBio] = useState(account.bio || '');
  const [site, setSite] = useState(account.site || '');
  const [busy, setBusy] = useState<'avatar' | 'save' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * 头像来源有优先级：自己传的那张 > 按邮箱算的那张。
   *
   * `account.avatar` 本身是 `avatar_url || avatarFromEmail(email)`，后者对 QQ 邮箱
   * 走 `q.qlogo.cn`，和在线名单用的 cravatar 是两个域名 —— 同一账号会出现
   * 「人卡上有头像、编辑框里只有首字母」。自定义头像存的是站内短地址，永远可用。
   */
  const shownAvatar = account.avatarCustom
    ? account.avatar
    : avatarFromHash(account.emailHash || '') || account.avatar;

  async function pickAvatar(file: File) {
    setMsg(null);
    setBusy('avatar');
    const shrunk = await fileToAvatar(file);
    if (!shrunk.ok) {
      setBusy(null);
      setMsg({ kind: 'warn', text: shrunk.message });
      return;
    }
    const r = await uploadAvatar(shrunk.dataUrl);
    setBusy(null);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    onAccount(r.account);
    setMsg({ kind: 'ok', text: '头像换好了。' });
  }

  async function useDefault() {
    setMsg(null);
    setBusy('avatar');
    const r = await clearAvatar();
    setBusy(null);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    onAccount(r.account);
    setMsg({ kind: 'ok', text: '换回按邮箱算的那张了。' });
  }

  async function save() {
    setMsg(null);
    setBusy('save');
    const r = await saveProfile({
      display_name: name.trim(),
      site_url: site.trim(),
      bio: bio.trim(),
    });
    setBusy(null);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    onAccount(r.account);
    onDone();
  }

  return (
    <div className="q-pedit">
      <div className="q-pedit__av">
        <span className="q-pedit__avimg" aria-hidden="true">
          {account.name.slice(0, 1)}
          {shownAvatar && (
            <img
              src={shownAvatar}
              alt=""
              decoding="async"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </span>
        <div className="q-pedit__avacts">
          <button
            type="button"
            className="q-pedit__mini"
            disabled={busy === 'avatar'}
            onClick={() => fileRef.current?.click()}
          >
            {busy === 'avatar' ? '处理中…' : '换一张'}
          </button>
          {account.avatarCustom && (
            <button
              type="button"
              className="q-pedit__mini q-pedit__mini--ghost"
              disabled={busy === 'avatar'}
              onClick={() => void useDefault()}
            >
              用回默认
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = ''; // 同一张图连选两次也要触发
            if (f) void pickAvatar(f);
          }}
        />
      </div>

      <label className="q-pedit__field">
        <span>名字</span>
        <input
          type="text"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="别人看到的名字"
        />
      </label>

      <label className="q-pedit__field">
        <span>
          简介
          <em>
            {bio.length}/{BIO_MAX}
          </em>
        </span>
        <textarea
          value={bio}
          maxLength={BIO_MAX}
          rows={3}
          onChange={(e) => setBio(e.currentTarget.value)}
          placeholder="一句话介绍自己：在哪儿、做什么、常聊什么"
        />
      </label>

      <label className="q-pedit__field">
        <span>个人网站</span>
        <input
          type="text"
          value={site}
          onChange={(e) => setSite(e.currentTarget.value)}
          placeholder="qingwu.ink（可留空）"
        />
      </label>

      {msg && <p className={`q-pedit__msg is-${msg.kind}`}>{msg.text}</p>}

      <div className="q-pedit__acts">
        <button type="button" className="q-pedit__ghost" onClick={onDone} disabled={busy === 'save'}>
          取消
        </button>
        <button type="button" className="q-pedit__save" onClick={() => void save()} disabled={busy === 'save'}>
          {busy === 'save' ? '存…' : '保存'}
        </button>
      </div>
    </div>
  );
}
