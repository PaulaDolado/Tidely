import { useState } from "react";
import { api } from "../api/client";
import { Note } from "../types";

/** Notas rápidas de la Agenda — extraído a componente compartido porque también aparece en
 * la vista "Hoy" (mismo widget, dos sitios distintos). */
export function QuickNotesCard({ notes, onChanged }: { notes: Note[]; onChanged: () => void }) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggleNote = async (note: Note) => {
    await api.put(`/notes/${note.id}`, { checked: !note.checked });
    onChanged();
  };

  const removeNote = async (id: number) => {
    await api.delete(`/notes/${id}`);
    onChanged();
  };

  return (
    <div className="rounded-3xl border border-warning/30 bg-warning/10 p-6">
      <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-warning">📌 Notas rápidas</h2>

      {notes.length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">Sin notas todavía.</p>
      ) : (
        // Cada nota lleva una raya debajo, como el renglón de una hoja de libreta.
        <ul className="mb-4">
          {notes.map((note) => (
            <li key={note.id} className="group flex items-center gap-2.5 border-b border-warning/30 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={note.checked}
                onChange={() => toggleNote(note)}
                className="size-4 shrink-0 cursor-pointer accent-warning"
                aria-label={`Marcar "${note.content}" como hecha`}
              />
              <span
                // overflow-wrap:anywhere (no `break-words`): solo "anywhere" reduce el ancho mínimo del texto, y sin
                // eso una URL larga mantenía ensanchada la columna que contiene la tarjeta.
                className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${
                  note.checked ? "text-muted-foreground line-through decoration-warning" : "text-foreground"
                }`}
              >
                {note.content}
              </span>
              <button
                onClick={() => removeNote(note.id)}
                className="cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                aria-label="Eliminar nota"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!content.trim()) return;
          setSubmitting(true);
          try {
            await api.post("/notes", { content: content.trim() });
            setContent("");
            onChanged();
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="+ Añadir nota"
          disabled={submitting}
          className="field-input w-full bg-background text-sm"
        />
      </form>
    </div>
  );
}
