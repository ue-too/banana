import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

type EconomyUIState = {
    resourceOverlayVisible: boolean;
    selectedZoneId: number | null;
    selectedIndustryId: number | null;
    selectedStationId: number | null;
    cityOverviewOpen: boolean;
};

type EconomyUIActions = {
    toggleResourceOverlay: () => void;
    selectZone: (id: number | null) => void;
    selectIndustry: (id: number | null) => void;
    selectStation: (id: number | null) => void;
    toggleCityOverview: () => void;
    clearSelection: () => void;
};

export type EconomyUIStore = EconomyUIState & EconomyUIActions;

export const useEconomyUIStore = create<EconomyUIStore>()(
    devtools(
        set => ({
            resourceOverlayVisible: false,
            selectedZoneId: null,
            selectedIndustryId: null,
            selectedStationId: null,
            cityOverviewOpen: false,

            toggleResourceOverlay: () =>
                set(state => ({
                    resourceOverlayVisible: !state.resourceOverlayVisible,
                })),

            selectZone: id =>
                set({ selectedZoneId: id, selectedIndustryId: null }),

            selectIndustry: id =>
                set({ selectedIndustryId: id, selectedZoneId: null }),

            selectStation: id => set({ selectedStationId: id }),

            toggleCityOverview: () =>
                set(state => ({
                    cityOverviewOpen: !state.cityOverviewOpen,
                })),

            clearSelection: () =>
                set({
                    selectedZoneId: null,
                    selectedIndustryId: null,
                    selectedStationId: null,
                }),
        }),
        { name: 'banana-economy-ui' }
    )
);
