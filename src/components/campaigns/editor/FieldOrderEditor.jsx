import { useState } from"react";
import { X, GripVertical } from"lucide-react";
import {
 DndContext,
 closestCenter,
 KeyboardSensor,
 PointerSensor,
 useSensor,
 useSensors,
} from '@dnd-kit/core';
import {
 SortableContext,
 sortableKeyboardCoordinates,
 useSortable,
 verticalListSortingStrategy,
 arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Label } from"@/components/ui/label";
import { COMBINABLE_FIELDS, genId } from './constants';

/**
 * Field-order editor.
 *
 * Relocated out of the (now read-only, faithful) preview. Operates directly on
 * `design_config.fieldOrder` — an array of rows `{ id, columns: [fieldId,...] }`.
 *
 * - Drag a row to reorder.
 * - Drag one combinable single-field row onto an adjacent combinable single-field
 *   row to merge them into a side-by-side two-column row.
 * - Split a two-column row back into two rows with the × button.
 *
 * Name / Email / Phone are always present and are not combinable. Phone cannot
 * be hidden (it is the pipeline's identity/dedup key).
 */

const FIELD_LABELS = {
 name: 'Full Name',
 phone: 'Phone Number',
 email: 'Email Address',
 dob: 'Date of Birth',
 postal_code: 'Postal Code',
 education_level: 'Highest Education',
 monthly_income: 'Last Drawn Salary',
};

function SortableRow({ id, children, isMergeTarget }) {
 const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
 const style = {
 transform: CSS.Transform.toString(transform),
 transition,
 ...(isDragging && { zIndex: 50 }),
 };
 return (
 <div
 ref={setNodeRef}
 style={style}
 className={`relative flex items-center gap-2 rounded-lg border px-2 py-2 bg-card transition-colors ${
 isDragging ? 'opacity-60 ring-2 ring-ring' : 'border-border'
 } ${isMergeTarget ? 'ring-2 ring-success/40 bg-success/10' : ''}`}
 >
 <button
 type="button"
 {...attributes}
 {...listeners}
 aria-label="Drag to reorder"
 className="shrink-0 p-1 cursor-grab text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
 >
 <GripVertical className="w-4 h-4" aria-hidden="true" />
 </button>
 {children}
 </div>
 );
}

function FieldChip({ fieldId, hidden }) {
 return (
 <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
 {FIELD_LABELS[fieldId] || fieldId}
 {hidden && <span className="text-[10px] font-normal text-muted-foreground">(hidden)</span>}
 </span>
 );
}

export default function FieldOrderEditor({ fieldOrder = [], visibleFields = {}, onChange }) {
 const [mergePreview, setMergePreview] = useState(null);

 const sensors = useSensors(
 useSensor(PointerSensor),
 useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
 );

 const isFieldHidden = (fieldId) => {
 if (fieldId === 'name' || fieldId === 'email' || fieldId === 'phone') return false;
 if (fieldId === 'education_level' || fieldId === 'monthly_income') return visibleFields[fieldId] !== true;
 return visibleFields[fieldId] === false;
 };

 const handleDragStart = () => setMergePreview(null);
 const handleDragCancel = () => setMergePreview(null);

 const handleDragOver = (event) => {
 const { active, over } = event;
 if (!over || active.id === over.id) {
 setMergePreview(null);
 return;
 }
 const activeIndex = fieldOrder.findIndex((row) => row.id === active.id);
 const overIndex = fieldOrder.findIndex((row) => row.id === over.id);
 if (activeIndex === -1 || overIndex === -1) return;
 const activeRow = fieldOrder[activeIndex];
 const overRow = fieldOrder[overIndex];
 if (activeRow.columns.length === 1 && overRow.columns.length === 1) {
 const activeField = activeRow.columns[0];
 const overField = overRow.columns[0];
 if (COMBINABLE_FIELDS.includes(activeField) && COMBINABLE_FIELDS.includes(overField)) {
 setMergePreview({ activeId: active.id, overId: over.id });
 return;
 }
 }
 setMergePreview(null);
 };

 const handleDragEnd = (event) => {
 const { active, over } = event;
 setMergePreview(null);
 if (!over || active.id === over.id) return;
 const order = [...fieldOrder];
 const activeIndex = order.findIndex((row) => row.id === active.id);
 const overIndex = order.findIndex((row) => row.id === over.id);
 if (activeIndex === -1 || overIndex === -1) return;
 const activeRow = order[activeIndex];
 const overRow = order[overIndex];
 const activeIsSingle = activeRow.columns.length === 1;
 const overIsSingle = overRow.columns.length === 1;
 const activeField = activeRow.columns[0];
 const overField = overRow.columns[0];

 if (
 activeIsSingle &&
 overIsSingle &&
 COMBINABLE_FIELDS.includes(activeField) &&
 COMBINABLE_FIELDS.includes(overField) &&
 Math.abs(activeIndex - overIndex) === 1
 ) {
 const mergedRow = {
 id: genId(),
 columns: activeIndex < overIndex ? [activeField, overField] : [overField, activeField],
 };
 const minIndex = Math.min(activeIndex, overIndex);
 const newOrder = order.filter((_, i) => i !== activeIndex && i !== overIndex);
 newOrder.splice(minIndex, 0, mergedRow);
 onChange(newOrder);
 } else {
 onChange(arrayMove(order, activeIndex, overIndex));
 }
 };

 const handleSplitRow = (rowId) => {
 const order = [...fieldOrder];
 const rowIndex = order.findIndex((row) => row.id === rowId);
 if (rowIndex === -1) return;
 const row = order[rowIndex];
 if (row.columns.length !== 2) return;
 order.splice(
 rowIndex,
 1,
 { id: genId(), columns: [row.columns[0]] },
 { id: genId(), columns: [row.columns[1]] }
 );
 onChange(order);
 };

 return (
 <div className="space-y-3">
 <Label className="text-sm font-semibold text-foreground">Field Order</Label>
 <p className="text-xs text-muted-foreground -mt-1">
 Drag to reorder. Drag two of Date of Birth, Postal Code, Highest Education, or Last Drawn Salary together
 to place them side by side.
 </p>
 <div className="space-y-2">
 <DndContext
 sensors={sensors}
 collisionDetection={closestCenter}
 onDragStart={handleDragStart}
 onDragOver={handleDragOver}
 onDragEnd={handleDragEnd}
 onDragCancel={handleDragCancel}
 >
 <SortableContext items={fieldOrder.map((row) => row.id)} strategy={verticalListSortingStrategy}>
 {fieldOrder.map((row) => {
 const isMergeTarget =
 mergePreview && (mergePreview.activeId === row.id || mergePreview.overId === row.id);
 return (
 <SortableRow key={row.id} id={row.id} isMergeTarget={isMergeTarget}>
 <div className="flex flex-1 flex-wrap items-center gap-1.5">
 {row.columns.map((fieldId) => (
 <FieldChip key={fieldId} fieldId={fieldId} hidden={isFieldHidden(fieldId)} />
 ))}
 </div>
 {row.columns.length === 2 && (
 <button
 type="button"
 onClick={() => handleSplitRow(row.id)}
 aria-label="Split row into two"
 className="shrink-0 p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
 >
 <X className="w-4 h-4" aria-hidden="true" />
 </button>
 )}
 </SortableRow>
 );
 })}
 </SortableContext>
 </DndContext>
 </div>
 </div>
 );
}
