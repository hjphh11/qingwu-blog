// 下载备份（阶段 K §4.15）。放在单独文件里，是为了让「概览页的按钮」和
// 「Cmd+K 搜索到的动作」走同一条路径 —— 两处行为必须一致。
export function downloadBackup(url = '/api/backup') {
  const a = document.createElement('a');
  a.href = url;
  a.download = ''; // 文件名由服务端 content-disposition 给
  document.body.appendChild(a);
  a.click();
  a.remove();
}
