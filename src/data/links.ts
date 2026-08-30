export interface Friend {
  name: string;
  avatar: string;
  intro: string;
  url: string;
}

// 真实好友列表:把朋友加进来即可。头像放 public/images/,url 填真实链接。
export const friends: Friend[] = [];
