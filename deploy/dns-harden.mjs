#!/usr/bin/env node
/**
 * 清吾 · DNS 加固（SPF / DMARC / CAA）
 *
 * 为什么单独一个脚本：这三条记录是**唯一没法在仓库里改的东西** —— 它们在 Cloudflare
 * 的 DNS 面板上。手动点容易漏、容易拼错，而且换机器时没人记得当时加了几条。
 *
 * 用法：
 *   CF_DNS_TOKEN=xxxx node deploy/dns-harden.mjs            # 只打印差异，不改
 *   CF_DNS_TOKEN=xxxx node deploy/dns-harden.mjs --apply    # 真的写
 *
 * Token 需要 **Zone → DNS → Edit**（项目里那把 worker/.cf-token 只有
 * Zone:Read + Workers 权限，调 DNS 会返回 10000 Authentication error）。
 * 在 https://dash.cloudflare.com/profile/api-tokens 建一把临时 token，跑完删掉即可。
 *
 * 幂等：已存在同名同内容的记录会跳过；同名不同内容的会打印出来让你人工确认
 * （不自动覆盖 —— 覆盖 TXT 可能把 you 的 Resend 验证记录顶掉）。
 */

const ZONE_NAME = 'qingwu.ink';
const API = 'https://api.cloudflare.com/client/v4';

/**
 * 记录清单。
 *
 * SPF：本站自己**不直接发信**，发信走 Resend（SES 基础设施，DKIM 已签 qingwu.ink）。
 *   保留 include:amazonses.com 是为了「哪天信封域名也用 qingwu.ink 直发」时不用改；
 *   结尾 `-all` = 其余一律不认（这是防伪造的关键，别用 ~all）。
 *   若以后启用 .deploy/mail-relay（走上游 SMTP 例如 QQ/163），把那家的 SPF 域补进
 *   include 列表，否则那些通知信会被 DMARC 判失败。
 *
 * DMARC：先 p=quarantine 而不是 p=reject —— 个人站怕误伤转发；
 *   稳定两周、确认没有合法信被拦，再改成 p=reject。
 *   没有 rua：本域没有 MX，报告无处投递（要收报告得先有邮箱）。
 *
 * CAA：只允许 Let's Encrypt（www/emis 用 LE）与 Google Trust Services
 *   （Cloudflare 边缘给 api./img. 签的就是 GTS）。写 CAA 之前请确认
 *   `certbot certificates` 与 CF 的 Universal SSL 都还正常，否则会挡住续期。
 */
const RECORDS = [
  { type: 'TXT', name: ZONE_NAME, content: 'v=spf1 include:amazonses.com -all', comment: 'SPF' },
  {
    type: 'TXT',
    name: `_dmarc.${ZONE_NAME}`,
    content: 'v=DMARC1; p=quarantine; sp=quarantine; adkim=s; aspf=r; pct=100',
    comment: 'DMARC（稳定后改 p=reject）',
  },
  { type: 'CAA', name: ZONE_NAME, content: '0 issue "letsencrypt.org"', comment: 'CAA · LE' },
  { type: 'CAA', name: ZONE_NAME, content: '0 issue "pki.goog"', comment: 'CAA · Google Trust Services' },
  { type: 'CAA', name: ZONE_NAME, content: '0 iodef "mailto:security@qingwu.ink"', comment: 'CAA · 违规上报' },
];

const token = process.env.CF_DNS_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '';
const apply = process.argv.includes('--apply');

if (!token) {
  console.error('缺 token：CF_DNS_TOKEN=xxxx node deploy/dns-harden.mjs [--apply]');
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!body.success) {
    const msg = (body.errors || []).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`${path} → ${msg}`);
  }
  return body.result;
}

const zones = await api(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
if (!zones.length) {
  console.error(`没找到 zone：${ZONE_NAME}（token 需要有这个 zone 的权限）`);
  process.exit(1);
}
const zoneId = zones[0].id;
console.log(`zone: ${zones[0].name} (${zoneId})  mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

const existing = await api(`/zones/${zoneId}/dns_records?per_page=200`);
const key = (r) => `${r.type}|${r.name.toLowerCase()}|${String(r.content).replace(/\s+/g, ' ').trim().toLowerCase()}`;
const have = new Map(existing.map((r) => [key(r), r]));

let created = 0;
let skipped = 0;

for (const rec of RECORDS) {
  const probe = { type: rec.type, name: rec.name.toLowerCase(), content: rec.content };
  if (have.has(key(probe))) {
    console.log(`  = 已有  ${rec.type} ${rec.name}  ${rec.content}`);
    skipped++;
    continue;
  }

  // 同名同类型的其它记录：只提示，不覆盖（TXT 可能还有 Resend 的验证/SPF 合并在里面）
  const sameName = existing.filter(
    (r) => r.type === rec.type && r.name.toLowerCase() === rec.name.toLowerCase(),
  );
  if (sameName.length) {
    console.warn(`  ! ${rec.type} ${rec.name} 上已有其它记录，未自动改动：`);
    for (const r of sameName) console.warn(`      ${String(r.content).slice(0, 120)}`);
    console.warn(`    需要合并的话请人工处理（例如 SPF 只能有一条，多条目会全部失效）`);
    skipped++;
    continue;
  }

  if (!apply) {
    console.log(`  + 待创建 ${rec.type} ${rec.name}  ${rec.content}   # ${rec.comment}`);
    created++;
    continue;
  }

  await api(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: rec.type, name: rec.name, content: rec.content, ttl: 1 }),
  });
  console.log(`  + 已创建 ${rec.type} ${rec.name}  ${rec.content}`);
  created++;
}

console.log(`\n完成：新建 ${created} 条，跳过 ${skipped} 条。`);
if (!apply) console.log('这是演练。确认无误后加 --apply 再跑一次。');
