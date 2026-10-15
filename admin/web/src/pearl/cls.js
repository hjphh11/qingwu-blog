// 珍珠玻璃类名契约。
//
// scaffold 的样式里，有 25 个类名与本后台原有暖色 app.css 重名（.btn/.panel/.table/
// .topbar/.content/.nav-item/.tag/.kbd/.field/.pager/.empty/.spacer/.mono/.md/.stage/
// .preview/.brand-mark/.form-grid/.panel-head/.table-wrap/.btn-ghost/.btn-block/
// .login-brand/.login-card）。搬运时这些类在 pearl/*.css 里统一加了 `p-` 前缀，
// 所以**组件里凡是要用这几个名字，必须走 cls()**，否则拿不到珍珠玻璃的样式。
//
// 规则与 admin/web/scripts/sync-pearl-css.mjs 的 CLASS_RENAMES 一一对应 ——
// 改一边就要改另一边，两处都写了这条注释提醒。
const PREFIXED = new Set([
  'btn-block', 'btn-ghost', 'login-brand', 'login-card', 'panel-head', 'table-wrap',
  'brand-mark', 'form-grid', 'nav-item',
  'btn', 'content', 'empty', 'field', 'kbd', 'md', 'mono', 'pager', 'panel', 'preview',
  'spacer', 'spin', 'stage', 'table', 'tag', 'topbar',
]);

/** 把类名拼成 className 字符串；重名的自动加 `p-` 前缀，假值自动跳过 */
export function cls(...names) {
  return names
    .flat()
    .filter(Boolean)
    .map((name) => (PREFIXED.has(name) ? `p-${name}` : name))
    .join(' ');
}

export default cls;
