// Palette.jsx — left sidebar of draggable node chips, grouped by category.
// The canvas drop handler reads the 'application/reactflow' payload to know
// which node type to create (read by the canvas onDrop handler in App.jsx).

import { paletteGroups } from '../nodes/registry.jsx';

export function Palette() {
  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ nodeType }));
    event.dataTransfer.effectAllowed = 'move';
    event.target.style.cursor = 'grabbing';
  };

  const onDragEnd = (event) => {
    event.target.style.cursor = 'grab';
  };

  return (
    <aside className="ff-palette">
      {paletteGroups.map((group) => (
        <div className="ff-palette__group" key={group.category}>
          <div className="ff-palette__category">{group.category}</div>
          <div className="ff-palette__items">
            {group.items.map(({ type, label, icon: Icon }) => (
              <div
                key={type}
                className="ff-chip"
                draggable
                onDragStart={(event) => onDragStart(event, type)}
                onDragEnd={onDragEnd}
              >
                {Icon && <Icon size={15} strokeWidth={2} className="ff-chip__icon" />}
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="ff-palette__hint">Drag a node onto the canvas</div>
    </aside>
  );
}

