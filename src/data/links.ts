export interface Friend {
  name: string;
  avatar: string;
  intro: string;
  url: string;
}

// 好友列表:把朋友加进来即可。头像可用链接,url 填真实链接。
export const friends: Friend[] = [
  {
    name: '朝朝听雨',
    avatar: 'https://rainzt.cn/zzty.png',
    intro: '物物而不物于物，念念而不念于念',
    url: 'http://rainzt.cn',
  },
];
