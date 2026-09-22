import { api } from "./client";

// Mismo shape que SearchResults en dashboard/src/types.ts (backend: src/controllers/
// searchController.ts) — búsqueda de solo lectura entre eventos, tareas, notas y proyectos.
export interface SearchResults {
  query: string;
  events: { id: number; title: string; startTime: string; isRecurring: boolean }[];
  tasks: { id: number; title: string; status: string; plannerId: number }[];
  notes: { id: number; content: string }[];
  projects: { id: number; title: string; status: string }[];
}

export function search(query: string): Promise<SearchResults> {
  return api.get<SearchResults>(`/search?q=${encodeURIComponent(query)}`);
}
