export interface Friend {
  name: string;
  avatar: string;
  intro: string;
  url: string;
}

// 占位示例:替换为真实好友。头像放 public/images/,url 填真实链接。
export const friends: Friend[] = [
  {
    name: '朋友一号',
    avatar: '/images/default-avatar.svg',
    intro: '爱写代码也爱碎碎念的同好 ~',
    url: 'https://example.com',
  },
  {
    name: '朋友二号',
    avatar: '/images/default-avatar.svg',
    intro: '一个记录生活的温柔角落 ₍ᐢ..ᐢ₎',
    url: 'https://example.com',
  },
  {
    name: '朋友三号',
    avatar: '/images/default-avatar.svg',
    intro: '二次元浓度很高的宝藏小屋 ˶ᵔ ᵕ ᵔ˶',
    url: 'https://example.com',
  },
];
