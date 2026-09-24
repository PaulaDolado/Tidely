// Cliente REST directo para "Proyectos" (cuaderno de proyectos) — mismo criterio que
// src/api/goals.ts, src/api/finance.ts y src/api/customPages.ts: Project/ProjectPage/ProjectTask
// no forman parte del contrato de sync offline del backend, así que esta sección no pasa por
// SQLite y necesita conexión, igual que dashboard/src/pages/ProyectosPage.tsx.
import { api } from "./client";

export type ProjectStatus = "idea" | "en_curso" | "pausado" | "completado";
export type ProjectPriority = "low" | "medium" | "high";

export interface ProjectTask {
  id: number;
  title: string;
  completed: boolean;
}

export interface Project {
  id: number;
  title: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  deadline: string | null;
  tasks?: ProjectTask[];
  progress?: { total: number; completed: number; percent: number };
}

// Página de la libreta: `content` es HTML enriquecido, editado con el mismo editor que la web
// (ver components/RichTextEditor.tsx — un WebView con contentEditable/execCommand dentro, ya que
// React Native no tiene nada parecido nativo).
export interface ProjectPage {
  id: number;
  projectId: number;
  title: string;
  content: string;
  order: number;
}

export interface RecentProjectEntry {
  id: number;
  projectId: number;
  projectTitle: string;
  pageTitle: string;
  preview: string;
  updatedAt: string;
}

export async function listProjects(): Promise<Project[]> {
  const res = await api.get<{ projects: Project[] }>("/projects");
  return res.projects;
}

export const getProject = (id: number) => api.get<Project>(`/projects/${id}`);

export const createProject = (title: string, description?: string | null) =>
  api.post<Project>("/projects", { title, description: description ?? null });

export const updateProjectStatus = (id: number, status: ProjectStatus) => api.put<Project>(`/projects/${id}`, { status });

export const deleteProject = (id: number) => api.delete<{ message: string }>(`/projects/${id}`);

export async function listRecentEntries(): Promise<RecentProjectEntry[]> {
  const res = await api.get<{ entries: RecentProjectEntry[] }>("/projects/recent-entries");
  return res.entries;
}

// --- Apuntes rápidos (tasks) ---

export const addProjectTask = (projectId: number, title: string) => api.post<ProjectTask>(`/projects/${projectId}/tasks`, { title });

export const updateProjectTask = (projectId: number, taskId: number, title: string) =>
  api.put<ProjectTask>(`/projects/${projectId}/tasks/${taskId}`, { title });

export const setProjectTaskCompleted = (projectId: number, taskId: number, completed: boolean) =>
  api.put<ProjectTask>(`/projects/${projectId}/tasks/${taskId}/complete`, { completed });

export const deleteProjectTask = (projectId: number, taskId: number) =>
  api.delete<{ message: string }>(`/projects/${projectId}/tasks/${taskId}`);

// --- Páginas de la libreta ---

export async function listProjectPages(projectId: number): Promise<ProjectPage[]> {
  const res = await api.get<{ pages: ProjectPage[] }>(`/projects/${projectId}/pages`);
  return res.pages;
}

export const addProjectPage = (projectId: number, title: string) => api.post<ProjectPage>(`/projects/${projectId}/pages`, { title });

export const updateProjectPage = (projectId: number, pageId: number, patch: { title?: string; content?: string }) =>
  api.put<ProjectPage>(`/projects/${projectId}/pages/${pageId}`, patch);

export const deleteProjectPage = (projectId: number, pageId: number) =>
  api.delete<{ message: string }>(`/projects/${projectId}/pages/${pageId}`);
