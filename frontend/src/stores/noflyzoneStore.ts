import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { NoFlyZone, NoFlyZoneDraft } from '../types/noflyzone';

interface NoFlyZoneState {
  items: NoFlyZone[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: NoFlyZoneDraft) => Promise<NoFlyZone>;
  update: (id: string, patch: Partial<NoFlyZone>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeByMission: (missionId: string) => Promise<void>;
  byMission: (missionId: string) => NoFlyZone[];
}

/** 任务级禁飞区（临时管制）本地存储 */
export const useNoFlyZoneStore = create<NoFlyZoneState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.noflyzones.toArray();
    rows.sort((a, b) => a.createdAt - b.createdAt);
    set({ items: rows, loaded: true });
  },
  async add(draft) {
    const record: NoFlyZone = { ...draft, id: newId('nfz'), createdAt: Date.now() };
    await db.noflyzones.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async update(id, patch) {
    await db.noflyzones.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async remove(id) {
    await db.noflyzones.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  async removeByMission(missionId) {
    const ids = get().items.filter((it) => it.missionId === missionId).map((it) => it.id);
    await db.noflyzones.bulkDelete(ids);
    set({ items: get().items.filter((it) => it.missionId !== missionId) });
  },
  byMission(missionId) {
    return get()
      .items.filter((it) => it.missionId === missionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
}));
