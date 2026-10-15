// Markdown 实时预览（方案 §6：markdown-it + DOMPurify）
// html:false —— 现有文章都不含内联 HTML，关掉更安全；DOMPurify 再兜一层。
//
// 渲染出来的容器类名由调用方给：编辑器（珍珠玻璃版）传 `md-preview`
// （排版写在 styles/pearl-local.css §14）。旧名 `md` 与 app.css 的暖色排版重名
// （14.5 / 22 / 19px + 玫瑰引用块 + 绯红链接），是 cls() 那 25 个重名类之一，
// 所以默认值也改成了珍珠那一份；目前只有文章编辑器在用这个组件。
import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurifyFactory from 'dompurify';
import { cls } from '../pearl/cls.js';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

// dompurify 在浏览器里默认导出是「已绑定 window 的实例」，
// 但在某些打包/SSR 场景下会是工厂函数 —— 两种情况都兼容。
const purifier =
  typeof DOMPurifyFactory?.sanitize === 'function'
    ? DOMPurifyFactory
    : DOMPurifyFactory(typeof window !== 'undefined' ? window : undefined);

export default function MarkdownPreview({ source, className = 'md-preview' }) {
  const html = useMemo(() => {
    try {
      return purifier.sanitize(md.render(String(source ?? '')));
    } catch {
      return '<p>（预览渲染失败）</p>';
    }
  }, [source]);

  return <div className={cls(className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
