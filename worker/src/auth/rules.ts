const reserved = new Set(
  'admin administrator root system synapse bot support help qingwu qingwuzf matrix guest api www mail chat null undefined true false'.split(
    ' ',
  ),
);

export function usernameError(name: string) {
  if (/[^a-z0-9._-]/.test(name))
    return ['bad_username_charset', '用户名只能用小写英文、数字和 . _ -，中文名请填在昵称'];
  if (!/^[a-z0-9][a-z0-9._-]{2,19}$/.test(name) || name.includes('..'))
    return ['bad_username', '用户名需为 3–20 位，以字母或数字开头，不能有连续的点'];
  if (reserved.has(name)) return ['username_reserved', '这个用户名是系统保留的'];
}

// Match one displayed emoji, including flags, keycaps and joined family sequences.
const emoji =
  /\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*/gu;

export function validNickname(name: string) {
  return (
    name === name.trim() &&
    [...name].length >= 1 &&
    [...name].length <= 20 &&
    !/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u.test(name) &&
    (name.match(emoji)?.length ?? 0) <= 3
  );
}

export function validPassword(password: string, username: string, email: string) {
  const length = [...password].length;
  return (
    length >= 8 &&
    length <= 72 &&
    !/^\d+$/.test(password) &&
    !password.includes('\0') &&
    ![username, email.split('@')[0]].includes(password.toLowerCase())
  );
}
