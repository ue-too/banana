import { Button } from '@/components/ui/button';
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { IndustryType } from '@/economy/types';

type Props = {
    onSelect: (type: IndustryType) => void;
    onCancel: () => void;
};

const TYPES = [
    { type: IndustryType.FARM, label: 'Farm', color: '#8bc34a' },
    { type: IndustryType.LUMBER_MILL, label: 'Lumber Mill', color: '#795548' },
    { type: IndustryType.WORKSHOP, label: 'Workshop', color: '#607d8b' },
];

export function IndustryTypeSelector({ onSelect, onCancel }: Props) {
    return (
        <DraggablePanel
            title="Place Industry"
            onClose={onCancel}
            className="w-48"
        >
            <div className="flex flex-col gap-1">
                {TYPES.map(({ type, label, color }) => (
                    <Button
                        key={type}
                        variant="ghost"
                        size="sm"
                        className="justify-start gap-2 text-xs"
                        onClick={() => onSelect(type)}
                    >
                        <span
                            className="inline-block size-3 rounded"
                            style={{ backgroundColor: color }}
                        />
                        {label}
                    </Button>
                ))}
            </div>
        </DraggablePanel>
    );
}
