// Markdown 实时预览（方案 §6：markdown-it + DOMPurify）
// html:false —— 现有文章都不含内联 HTML，关掉更安全；DOMPurify 再兜一层。
import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurifyFactory from 'dompurify';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

// dompurify 在浏览器里默认导出是「已绑定 window 的实例」，
// 但在某些打包/SSR 场景下会是工厂函数 —— 两种情况都兼容。
const purifier =
  typeof DOMPurifyFactory?.sanitize === 'function'
    ? DOMPurifyFactory
    : DOMPurifyFactory(typeof window !== 'undefined' ? window : undefined);

export default function MarkdownPreview({ source }) {
  const html = useMemo(() => {
    try {
      return purifier.sanitize(md.render(String(source ?? '')));
    } catch {
      return '<p>（预览渲染失败）</p>';
    }
  }, [source]);

  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
