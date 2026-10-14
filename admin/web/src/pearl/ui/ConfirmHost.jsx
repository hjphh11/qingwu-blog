// 确认框宿主（端口自 scaffold 的 ui/ConfirmHost.vue）。
// 挂在应用最外层（PearlShell 里），把 confirm() 的请求渲染成珍珠玻璃的确认框。
//
// Vue 版用 shallowRef 记住上一份内容，避免退场动画期间文案先消失；
// React 版没有退场动画，但仍保留「记住上一份」的行为，切换确认内容时不会闪。
import { useRef, useSyncExternalStore } from 'react';
import { MorphIcon } from 'morphicons/react';
import { CircleAlert, Info } from '../../icons.js';
import { cls } from '../cls.js';
import { getConfirmState, resolveConfirm, subscribeConfirm } from './confirm.js';
import Button from './Button.jsx';
import Modal from './Modal.jsx';

export default function ConfirmHost() {
  const state = useSyncExternalStore(subscribeConfirm, getConfirmState, getConfirmState);
  const lastRef = useRef(null);
  if (state) lastRef.current = state;
  const shown = state ?? lastRef.current;

  if (!shown) return null;

  return (
    <Modal
      open={Boolean(state)}
      title={shown.title}
      width={440}
      closeOnOverlay
      onClose={() => resolveConfirm(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => resolveConfirm(false)}>
            取消
          </Button>
          {/* autoFocus：默认焦点落在「确定」上，回车即可确认（Vue 里是 autofocus） */}
          <Button
            variant={shown.danger ? 'danger' : 'primary'}
            autoFocus
            onClick={() => resolveConfirm(true)}
          >
            {shown.confirmText ?? '确定'}
          </Button>
        </>
      }
    >
      <div className={cls('confirm-body')}>
        <span className={cls('confirm-icon', shown.danger && 'is-danger')}>
          <MorphIcon icon={shown.danger ? CircleAlert : Info} size={18} color="currentColor" />
        </span>
        <p className={cls('confirm-text')}>{shown.message}</p>
      </div>
    </Modal>
  );
}
