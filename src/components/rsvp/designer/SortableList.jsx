import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * One sortable vertical list for the RSVP designer (blocks AND fields) —
 * dnd-kit with pointer + keyboard sensors, modelled on
 * GuidedReviewDesigner.jsx (the campaign designer that IS drag-and-drop).
 * Keyboard: focus a handle, Space to pick up, arrows to move, Space to drop.
 *
 * items: [{ id, label, meta?, locked?, tone? }] — `locked` hides the delete
 * control (the form block; name/email; frozen fields once responses exist).
 */

/** Pure reorder helper (unit-tested): move `activeId` to `overId`'s slot. */
export function reorderIds(ids, activeId, overId) {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  return arrayMove(ids, from, to);
}

function Row({ item, selected, onSelect, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 6px 6px 4px',
        borderRadius: 9,
        border: `1px solid ${selected ? 'var(--accent, #4059C8)' : 'var(--line, #E3E6EB)'}`,
        background: selected ? 'var(--accent-soft, #ECEFFA)' : 'var(--surface, #fff)',
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? '0 6px 18px rgba(0,0,0,.12)' : 'none',
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${item.label}`}
        title="Drag to reorder"
        style={{ flex: 'none', width: 22, height: 26, border: 'none', background: 'transparent', cursor: 'grab', color: 'var(--ink-3, #9BA0AB)', fontSize: 15, touchAction: 'none' }}
      >
        ⋮⋮
      </button>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        aria-pressed={selected}
        style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 0' }}
      >
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink, #171A20)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
        {item.meta ? <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.meta}</span> : null}
      </button>
      {item.locked ? (
        <span aria-label={`${item.label} cannot be removed`} title={item.lockedReason || 'Cannot be removed'} style={{ flex: 'none', fontSize: 11, color: 'var(--ink-3, #9BA0AB)', padding: '0 4px' }}>🔒</span>
      ) : (
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          aria-label={`Delete ${item.label}`}
          className="av2-btn av2-btn--ghost av2-btn--sm"
          style={{ flex: 'none' }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function SortableList({ items, selectedId, onSelect, onDelete, onReorder, ariaLabel = 'Reorderable list' }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const ids = items.map((i) => i.id);
  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    onReorder(reorderIds(ids, active.id, over.id));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div role="list" aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {items.map((item) => (
            <div key={item.id} role="listitem">
              <Row item={item} selected={item.id === selectedId} onSelect={onSelect} onDelete={onDelete} />
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
