import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { DraggablePanel } from '@/components/ui/draggable-panel';
import { ZoneType } from '@/economy/types';

type Props = {
    onSelect: (type: ZoneType) => void;
    onCancel: () => void;
};

const TYPES = [
    {
        type: ZoneType.RESIDENTIAL,
        key: 'economyZoneResidential',
        color: '#4caf50',
    },
    {
        type: ZoneType.COMMERCIAL,
        key: 'economyZoneCommercial',
        color: '#2196f3',
    },
    {
        type: ZoneType.INDUSTRIAL,
        key: 'economyZoneIndustrial',
        color: '#ff9800',
    },
];

export function ZoneTypeSelector({ onSelect, onCancel }: Props) {
    const { t } = useTranslation();

    return (
        <DraggablePanel
            title={t('economySelectZoneType')}
            onClose={onCancel}
            className="w-48"
        >
            <div className="flex flex-col gap-1">
                {TYPES.map(({ type, key, color }) => (
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
                        {t(key)}
                    </Button>
                ))}
            </div>
        </DraggablePanel>
    );
}
