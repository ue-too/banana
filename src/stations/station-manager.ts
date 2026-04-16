import { GenericEntityManager } from '@/utils';
import type {
  Station,
  SerializedStation,
  SerializedStationData,
  TrackDirection,
} from './types';
import { nextStopPositionId } from './stop-position-utils';
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import type { ShiftTemplate } from '@/timetable/types';

export class StationManager {
  private _manager: GenericEntityManager<Station>;
  private _onDestroyStation: ((id: number) => void) | null = null;

  constructor(initialCount = 10) {
    this._manager = new GenericEntityManager<Station>(initialCount);
  }

  /**
   * Register a callback that runs before a station is destroyed.
   * Used to cascade-delete track-aligned platforms.
   */
  setOnDestroyStation(cb: (id: number) => void): void {
    this._onDestroyStation = cb;
  }

  createStation(station: Omit<Station, 'id'>): number {
    const id = this._manager.createEntity({ ...station, id: -1 } as Station);
    // Patch the id to match the entity number assigned by the manager.
    const entity = this._manager.getEntity(id);
    if (entity) entity.id = id;
    return id;
  }

  getStation(id: number): Station | null {
    return this._manager.getEntity(id);
  }

  getStations(): { id: number; station: Station }[] {
    return this._manager
      .getLivingEntitiesWithIndex()
      .map(({ index, entity }) => ({ id: index, station: entity }));
  }

  createStationWithId(id: number, station: Station): void {
    this._manager.createEntityWithId(id, { ...station, id });
  }

  destroyStation(id: number): void {
    this._onDestroyStation?.(id);
    this._manager.destroyEntity(id);
  }

  // -----------------------------------------------------------------------
  // Stop position CRUD (island platforms)
  // -----------------------------------------------------------------------

  /**
   * Append a new stop position to an island platform.
   *
   * @param stationId - Owner station.
   * @param platformId - Island platform id within the station.
   * @param input - The stop's track segment, direction, and tValue.
   * @returns The newly assigned stop position id.
   * @throws If the station/platform is missing, the segment doesn't match
   *   the platform's track, or the tValue is outside `[0, 1]`.
   */
  addStopPosition(
      stationId: number,
      platformId: number,
      input: { trackSegmentId: number; direction: TrackDirection; tValue: number },
  ): number {
      const platform = this._getPlatformOrThrow(stationId, platformId);
      this._validateStop(platform, input);
      const id = nextStopPositionId(platform.stopPositions);
      platform.stopPositions.push({ id, ...input });
      return id;
  }

  /**
   * Update an existing stop position. `tValue` and `direction` may change;
   * `trackSegmentId` is fixed because an island platform serves a single
   * track segment.
   */
  updateStopPosition(
      stationId: number,
      platformId: number,
      stopId: number,
      patch: { direction?: TrackDirection; tValue?: number },
  ): void {
      const platform = this._getPlatformOrThrow(stationId, platformId);
      const stop = platform.stopPositions.find((s) => s.id === stopId);
      if (!stop) {
          throw new Error(
              `StationManager.updateStopPosition: stop ${stopId} not found on platform ${platformId} of station ${stationId}`,
          );
      }
      const next = {
          trackSegmentId: stop.trackSegmentId,
          direction: patch.direction ?? stop.direction,
          tValue: patch.tValue ?? stop.tValue,
      };
      this._validateStop(platform, next);
      stop.direction = next.direction;
      stop.tValue = next.tValue;
  }

  /** Remove a stop position. No-op if the id is not present. */
  removeStopPosition(
      stationId: number,
      platformId: number,
      stopId: number,
  ): void {
      const platform = this._getPlatformOrThrow(stationId, platformId);
      platform.stopPositions = platform.stopPositions.filter((s) => s.id !== stopId);
  }

  private _getPlatformOrThrow(stationId: number, platformId: number) {
      const station = this._manager.getEntity(stationId);
      if (!station) {
          throw new Error(`StationManager: station ${stationId} not found`);
      }
      const platform = station.platforms.find((p) => p.id === platformId);
      if (!platform) {
          throw new Error(
              `StationManager: platform ${platformId} not found on station ${stationId}`,
          );
      }
      return platform;
  }

  private _validateStop(
      platform: { track: number },
      input: { trackSegmentId: number; tValue: number },
  ): void {
      if (input.trackSegmentId !== platform.track) {
          throw new Error(
              `StationManager: stop position trackSegmentId ${input.trackSegmentId} does not match platform.track ${platform.track}`,
          );
      }
      if (input.tValue < 0 || input.tValue > 1) {
          throw new Error(
              `StationManager: stop position tValue ${input.tValue} is out of range [0, 1]`,
          );
      }
  }

  /**
   * Return the list of shift templates whose scheduled stops reference the
   * given stop position on an island platform. Used by the editor panel to
   * surface a deletion guard before removing a referenced stop.
   */
  findShiftsReferencingStopPosition(
      stationId: number,
      platformId: number,
      stopPositionId: number,
      shiftTemplateManager: ShiftTemplateManager,
  ): ShiftTemplate[] {
      const result: ShiftTemplate[] = [];
      for (const template of shiftTemplateManager.getAllTemplates()) {
          for (const stop of template.stops) {
              if (
                  stop.platformKind === 'island' &&
                  stop.stationId === stationId &&
                  stop.platformId === platformId &&
                  stop.stopPositionId === stopPositionId
              ) {
                  result.push(template);
                  break;
              }
          }
      }
      return result;
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  serialize(): SerializedStationData {
    const stations: SerializedStation[] = this._manager
      .getLivingEntitiesWithIndex()
      .map(({ index, entity }) => ({
        id: index,
        name: entity.name,
        position: { x: entity.position.x, y: entity.position.y },
        elevation: entity.elevation,
        platforms: entity.platforms.map((p) => ({
          id: p.id,
          track: p.track,
          width: p.width,
          offset: p.offset,
          side: p.side,
          stopPositions: p.stopPositions.map((sp) => ({ ...sp })),
        })),
        trackSegments: [...entity.trackSegments],
        joints: [...entity.joints],
        trackAlignedPlatforms: [...entity.trackAlignedPlatforms],
      }));

    return { stations };
  }

  static deserialize(data: SerializedStationData): StationManager {
    const maxId = data.stations.reduce((max, s) => Math.max(max, s.id), -1);
    const manager = new StationManager(Math.max(maxId + 1, 10));
    for (const s of data.stations) {
      manager._manager.createEntityWithId(s.id, {
        id: s.id,
        name: s.name,
        position: { x: s.position.x, y: s.position.y },
        elevation: s.elevation,
        platforms: s.platforms.map((p) => ({
          id: p.id,
          track: p.track,
          width: p.width,
          offset: p.offset,
          side: p.side as 1 | -1,
          stopPositions: p.stopPositions.map((sp, i) => ({
              id: typeof sp.id === 'number' ? sp.id : i,
              trackSegmentId: sp.trackSegmentId,
              direction: sp.direction,
              tValue: sp.tValue,
          })),
        })),
        trackSegments: [...s.trackSegments],
        joints: [...s.joints],
        trackAlignedPlatforms: [...(s.trackAlignedPlatforms ?? [])],
      });
    }
    return manager;
  }
}
