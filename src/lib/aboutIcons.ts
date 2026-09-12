// 关于页的图标名 → 图标节点（`info` 与 `contacts` 两处用）。
// 拆成单独文件，和 `categoryIcons.ts` 一个道理：让数据文件与构建配置不必拖进图标数据。
//
// ⚠️ 后台「关于页管理」的图标选择器用的就是这份名单，
//    两边要一起加（后台见 `admin/web/src/icons.js` 的 ABOUT_ICONS）。
import {
  BookOpen,
  Building,
  ChartNoAxesColumn,
  Clock,
  Compass,
  Flower2,
  GitBranch,
  Globe,
  GraduationCap,
  Headphones,
  Heart,
  House,
  ImageIcon,
  Info,
  Laptop,
  Link2,
  Mail,
  MapPin,
  MessageSquareText,
  Music,
  Send,
  Sparkles,
  Timer,
  Wrench,
} from './icons';

export const ABOUT_ICON_NAMES = [
  'map',
  'school',
  'code',
  'music',
  'mail',
  'github',
  'globe',
  'house',
  'building',
  'book',
  'heart',
  'flower',
  'sparkles',
  'link',
  'message',
  'send',
  'info',
  'clock',
  'compass',
  'wrench',
  'headphones',
  'image',
  'chart',
  'timer',
] as const;

const ICON_MAP: Record<string, unknown> = {
  map: MapPin,
  school: GraduationCap,
  code: Laptop,
  music: Music,
  mail: Mail,
  github: GitBranch,
  globe: Globe,
  house: House,
  building: Building,
  book: BookOpen,
  heart: Heart,
  flower: Flower2,
  sparkles: Sparkles,
  link: Link2,
  message: MessageSquareText,
  send: Send,
  info: Info,
  clock: Clock,
  compass: Compass,
  wrench: Wrench,
  headphones: Headphones,
  image: ImageIcon,
  chart: ChartNoAxesColumn,
  timer: Timer,
};

const DEFAULT_ICON = Info;

/** 取图标；名字认不出或没写，用默认图标（不让页面崩）*/
export function aboutIcon(name?: string): unknown {
  return (name && ICON_MAP[name]) || DEFAULT_ICON;
}
