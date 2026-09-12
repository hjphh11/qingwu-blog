// 尚未接入的模块占位页。
// 每个模块都标了它属于方案里的哪个阶段，方便对照 docs/后台管理方案.md。
export default function Soon({ label, stage }) {
  return (
    <div className="card panel soon-box">
      <div className="t">{label}　还没做</div>
      <div className="d">
        当前阶段（D）只做了骨架、登录和数据总览。
        <br />
        「{label}」会在 <b>{stage ?? '后续阶段'}</b> 接入 —— 到那时这里就能增删改并发布了。
      </div>
      {stage && <div className="stage">{stage}</div>}
    </div>
  );
}
