export type ShareItem =
  | { type: 'link'; id: string; title: string; url: string; note: string }
  | { type: 'quote'; id: string; text: string; author?: string };

// 占位示例:替换为真实收藏/语录。
export const shares: ShareItem[] = [
  {
    type: 'link',
    id: 'link-1',
    title: 'Astro 官方文档',
    url: 'https://astro.build/',
    note: '做这个博客用的框架,文档很全 ~',
  },
  {
    type: 'link',
    id: 'link-2',
    title: '一张值得收藏的壁纸站',
    url: 'https://example.com',
    note: '配色很治愈,常来逛 ₍ᐢ..ᐢ₎',
  },
  {
    type: 'quote',
    id: 'q-1',
    text: '把生活过成自己喜欢的样子,就是对世界最温柔的回应。',
    author: '清吾手记',
  },
  {
    type: 'quote',
    id: 'q-2',
    text: '去爱、去创造、去成为自己。',
    author: '某刻的摘录',
  },
];
