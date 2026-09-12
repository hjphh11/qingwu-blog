// 后台用到的图标（lucide 的 IconNode 数据），统一从这里取，
// 交给 morphicons 的 MorphIcon 渲染 —— 与博客前台同一套图标方案（方案第 23 条）。
// 注意 lucide v1.37 没有 Trash2，回收站用 Trash。
import { BookOpen, Flower2, Laptop, Music, Sparkles } from 'lucide';

export {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  BookOpen,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Code,
  Eye,
  EyeOff,
  FileText,
  Flower2,
  Heading1,
  Heading2,
  Inbox,
  Italic,
  Laptop,
  LayoutDashboard,
  Link,
  Link2,
  List,
  ListOrdered,
  LogOut,
  Menu,
  Minus,
  Music,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Trash,
  User,
  X,
} from 'lucide';

/**
 * 分类图标名 → 图标节点。
 * **必须与博客前台 `src/lib/categoryIcons.ts` 的 ICON_MAP 保持一致**。
 * 前台认不出的名字会回落到默认图标，所以少一个不会崩，但两边要同步加。
 */
export const CATEGORY_ICONS = {
  sparkles: Sparkles,
  flower: Flower2,
  book: BookOpen,
  music: Music,
  laptop: Laptop,
};

export const DEFAULT_CATEGORY_ICON = Sparkles;
