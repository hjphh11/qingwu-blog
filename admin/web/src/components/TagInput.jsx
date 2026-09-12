// 标签输入：自由输入 + 历史标签自动补全（方案 §4.2）
import { useMemo, useRef, useState } from 'react';

export default function TagInput({ value = [], onChange, suggestions = [], placeholder = '输入后回车' }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return suggestions
      .filter((s) => !value.includes(s.name))
      .filter((s) => (q ? s.name.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [suggestions, value, text]);

  const add = (raw) => {
    const t = String(raw ?? '').trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setText('');
    setActive(0);
    inputRef.current?.focus();
  };

  const remove = (t) => onChange(value.filter((x) => x !== t));

  const onKeyDown = (e) => {
    // 逗号也当分隔符（中文逗号一起收）
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      if (open && filtered[active] && (e.key === 'Enter' || !text.trim())) add(filtered[active].name);
      else add(text);
      return;
    }
    if (e.key === 'Backspace' && !text && value.length > 0) {
      e.preventDefault();
      remove(value[value.length - 1]);
      return;
    }
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="taginput">
      {value.length > 0 && (
        <div className="tags">
          {value.map((t) => (
            <span className="tag tag-rose" key={t}>
              {t}
              <button type="button" onClick={() => remove(t)} aria-label={`删除标签 ${t}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && filtered.length > 0 && (
        <div className="suggest">
          {filtered.map((s, i) => (
            <button
              type="button"
              key={s.name}
              className={i === active ? 'on' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.name);
              }}
            >
              {s.name}
              <span className="n">用过 {s.count} 次</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
