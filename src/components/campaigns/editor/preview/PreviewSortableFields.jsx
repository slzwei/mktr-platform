import { X, GripVertical } from"lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PreviewFieldRenderer from"@/components/campaigns/editor/preview/PreviewFieldRenderer";

function SortableItem(props) {
 const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });
 const style = {
 transform: CSS.Transform.toString(transform),
 transition,
 ...(isDragging && { zIndex: 50 }),
 };

 return (
 <div ref={setNodeRef} style={style} className={`relative group mb-3 rounded-lg transition-colors ${isDragging ? 'opacity-60 ring-2 ring-ring bg-primary/10' : ''}`}>
 <div {...attributes} {...listeners} className="absolute -left-8 top-1/2 -translate-y-1/2 p-2 cursor-grab opacity-30 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-muted-foreground">
 <GripVertical className="w-4 h-4"/>
 </div>
 {props.children}
 </div>
 );
}

export default function PreviewSortableFields({
 currentDesign,
 mergePreview,
 onDragStart,
 onDragOver,
 onDragEnd,
 onDragCancel,
 onSplitRow,
 fieldRendererProps,
}) {
 const sensors = useSensors(
 useSensor(PointerSensor),
 useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
 );

 return (
 <div className="space-y-0">
 <DndContext sensors={sensors} collisionDetection={closestCenter}
 onDragStart={onDragStart} onDragOver={onDragOver}
 onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
 <SortableContext items={currentDesign.fieldOrder.map(row => row.id)} strategy={verticalListSortingStrategy}>
 {currentDesign.fieldOrder.map((row) => {
 const visibleColumns = row.columns.filter(fieldId => {
 if (fieldId === 'name' || fieldId === 'email') return true;
 return currentDesign.visibleFields?.[fieldId] !== false;
 });
 if (visibleColumns.length === 0) return null;

 const isMergeTarget = mergePreview && (mergePreview.activeId === row.id || mergePreview.overId === row.id);

 return (
 <SortableItem key={row.id} id={row.id}>
 {row.columns.length === 2 && (
 <button
 type="button" onClick={() => onSplitRow(row.id)}
 aria-label="Split row"
 className="absolute -right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-destructive opacity-60 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded transition-opacity">
 <X className="w-4 h-4" aria-hidden="true" />
 </button>
 )}
 <div className={`grid gap-3 transition-colors duration-200 rounded-lg ${isMergeTarget ? 'ring-2 ring-success/30 bg-success/10 p-2' : ''} ${isMergeTarget || visibleColumns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
 {visibleColumns.map((fieldId) => (
 <div key={fieldId} className={isMergeTarget && row.columns.length === 1 ? 'col-span-1' : ''}>
 <PreviewFieldRenderer fieldId={fieldId} {...fieldRendererProps} />
 </div>
 ))}
 </div>
 </SortableItem>
 );
 })}
 </SortableContext>
 </DndContext>
 </div>
 );
}
