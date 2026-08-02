import { create } from "zustand";
import { supabase } from "./supabaseClient";

export const PICKERS_DEFAULT = ["Ravi", "Sunil", "Amit"];

interface PickersState {
  pickers: string[]; // display names of people with role = 'picker'
  load: () => Promise<void>;
}

export const usePickers = create<PickersState>()((set) => ({
  pickers: [],
  load: async () => {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("display_name").eq("role", "picker").order("display_name");
    set({ pickers: (data ?? []).map((r) => (r as { display_name: string }).display_name) });
  },
}));
