import { create } from "zustand";
import type { ScreenId } from "../app/screens";

interface NavState {
  screen: ScreenId;
  go: (screen: ScreenId) => void;
}

// The last mode is persisted per profile from phase 3 (SPEC §4 defect 9).
export const useNavStore = create<NavState>()((set) => ({
  screen: "koch",
  go: (screen) => {
    set({ screen });
  },
}));
