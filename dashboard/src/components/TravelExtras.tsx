import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { DeleteButton, DialogShell } from "./DialogShell";
import { newId } from "../utils/id";
import {
  attachmentChars,
  formatTransportWhen,
  isValidEmail,
  isValidPhone,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_CHARS,
  openAttachment,
  readFileAsDataUrl,
  TRANSPORT_TYPES,
  transportMeta,
} from "../utils/travel";
import { PackingItem, TransportDetail, TransportType, Trip, TripAttachment, TripContact } from "../types";

// Las tres secciones de debajo de los paneles del planificador de viajes (ver TravelPlannerTemplate), todas
// DEL viaje seleccionado y guardadas dentro de `Trip` (packing / transport / contacts): lo que hay que
// empacar, los detalles del transporte (con archivos adjuntos como la tarjeta de embarque) y los contactos
// importantes. Componente controlado: lee del viaje y devuelve cambios con `onPatch`.

const plusButton =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-sm leading-none text-background transition-opacity hover:opacity-80";
const fieldLabel = "flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground";
const sectionTitle = "text-xs font-medium uppercase tracking-widest text-muted-foreground";

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function TravelExtras({ trip, allTrips, onPatch }: { trip: Trip; allTrips: Trip[]; onPatch: (patch: Partial<Trip>) => void }) {
  const packing = trip.packing ?? [];
  const transport = trip.transport ?? [];
  const contacts = trip.contacts ?? [];

  const [dialog, setDialog] = useState<{ kind: "transport"; id: string | null } | { kind: "contact"; id: string | null } | null>(null);

  const sortedTransport = [...transport].sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
  const openTransport = dialog?.kind === "transport" ? dialog.id : undefined; // undefined = cerrado, null = nuevo
  const openContact = dialog?.kind === "contact" ? dialog.id : undefined;

  const saveTransport = (id: string | null, values: Omit<TransportDetail, "id">) => {
    onPatch({ transport: id === null ? [...transport, { id: newId(), ...values }] : transport.map((t) => (t.id === id ? { id, ...values } : t)) });
    setDialog(null);
  };
  const removeTransport = (id: string) => {
    onPatch({ transport: transport.filter((t) => t.id !== id) });
    setDialog(null);
  };
  const saveContact = (id: string | null, values: Omit<TripContact, "id">) => {
    onPatch({ contacts: id === null ? [...contacts, { id: newId(), ...values }] : contacts.map((c) => (c.id === id ? { id, ...values } : c)) });
    setDialog(null);
  };
  const removeContact = (id: string) => {
    onPatch({ contacts: contacts.filter((c) => c.id !== id) });
    setDialog(null);
  };

  const editingTransport = openTransport ? transport.find((t) => t.id === openTransport) : undefined;
  const editingContact = openContact ? contacts.find((c) => c.id === openContact) : undefined;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <PackingSection destination={trip.destination} items={packing} onChange={(next) => onPatch({ packing: next })} />

        {/* Detalles del transporte */}
        <section className="card-soft flex flex-col">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className={sectionTitle}>Detalles del transporte</h3>
            <button type="button" onClick={() => setDialog({ kind: "transport", id: null })} aria-label="Añadir transporte" title="Añadir un trayecto" className={plusButton}>
              +
            </button>
          </div>
          {sortedTransport.length === 0 ? (
            <p className="text-sm text-muted-foreground">Vuelos, trenes, autobuses… con su hora, sus datos y la tarjeta de embarque adjunta.</p>
          ) : (
            <ul className="space-y-4">
              {sortedTransport.map((t) => (
                <TransportRow key={t.id} item={t} onEdit={() => setDialog({ kind: "transport", id: t.id })} />
              ))}
            </ul>
          )}
        </section>

        {/* Contactos importantes */}
        <section className="card-soft flex flex-col">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className={sectionTitle}>Contactos importantes</h3>
            <button type="button" onClick={() => setDialog({ kind: "contact", id: null })} aria-label="Añadir contacto" title="Añadir un contacto" className={plusButton}>
              +
            </button>
          </div>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Alojamiento, seguro, embajada… con su ubicación, teléfono o correo.</p>
          ) : (
            <ul className="space-y-4">
              {contacts.map((c) => (
                <ContactRow key={c.id} contact={c} onEdit={() => setDialog({ kind: "contact", id: c.id })} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {openTransport !== undefined && (openTransport === null || editingTransport) && (
        <TransportDialog
          key={openTransport ?? "new"}
          item={editingTransport}
          trip={trip}
          // Lo que ya ocupan los adjuntos de la página SIN contar los de este trayecto (se recuentan con los pendientes del diálogo).
          usedChars={attachmentChars(allTrips) - (editingTransport?.attachments ?? []).reduce((sum, a) => sum + a.dataUrl.length, 0)}
          onSave={(values) => saveTransport(openTransport, values)}
          onRemove={editingTransport ? () => removeTransport(editingTransport.id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {openContact !== undefined && (openContact === null || editingContact) && (
        <ContactDialog
          key={openContact ?? "new"}
          contact={editingContact}
          onSave={(values) => saveContact(openContact, values)}
          onRemove={editingContact ? () => removeContact(editingContact.id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// "Qué empacar": casillas con contador "empacado/total". El "+" abre un campo al principio de la lista que se
// queda abierto tras cada cosa añadida, para apuntar varias seguidas.
function PackingSection({ destination, items, onChange }: { destination: string; items: PackingItem[]; onChange: (next: PackingItem[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const packed = items.filter((i) => i.packed).length;

  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) {
      setAdding(false);
      return;
    }
    onChange([...items, { id: newId(), text: value }]);
    setText("");
  };

  return (
    <section className="card-soft flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className={sectionTitle}>Qué empacar</h3>
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground" aria-label={`${packed} de ${items.length} empacadas`}>
              {packed}/{items.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-label={adding ? "Cerrar" : "Añadir a la lista"}
          title={adding ? "Cerrar" : "Añadir a la lista"}
          className={plusButton}
        >
          {adding ? "×" : "+"}
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="mb-3">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="Pasaporte, cargador… (Intro para añadir)"
            maxLength={80}
            className="field-input w-full px-3 py-2 text-sm"
          />
        </form>
      )}

      {items.length === 0 ? (
        !adding && <p className="text-sm text-muted-foreground">Anota aquí lo que no puedes olvidar para {destination}.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="group flex items-center gap-3 rounded-xl px-1.5 py-1 hover:bg-muted/60">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!item.packed}
                  onChange={() => onChange(items.map((i) => (i.id === item.id ? { ...i, packed: !i.packed } : i)))}
                  className="size-4 shrink-0 cursor-pointer accent-[var(--primary)]"
                />
                <span className={`min-w-0 text-sm [overflow-wrap:anywhere] ${item.packed ? "text-muted-foreground line-through" : ""}`}>{item.text}</span>
              </label>
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                aria-label={`Quitar ${item.text}`}
                title="Quitar"
                className="shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TransportRow({ item, onEdit }: { item: TransportDetail; onEdit: () => void }) {
  const meta = transportMeta(item.type);
  const [error, setError] = useState<string | null>(null);

  const open = async (att: TripAttachment) => {
    setError(null);
    try {
      await openAttachment(att);
    } catch {
      setError("No se pudo abrir el archivo.");
    }
  };

  return (
    <li className="group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">
            <span aria-hidden="true">{meta.icon} </span>
            {item.title || meta.label}
          </p>
          <p className="text-xs text-muted-foreground">{formatTransportWhen(item.date, item.time)}</p>
          {item.details && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.details}</p>}
          {(item.attachments?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.attachments?.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => open(a)}
                  title={`${a.name} · ${formatBytes(a.size)}`}
                  className="max-w-full cursor-pointer truncate rounded-full border border-border px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10"
                >
                  📎 {a.name}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${item.title || meta.label}`}
          title="Editar"
          className="shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          ✎
        </button>
      </div>
    </li>
  );
}

function ContactRow({ contact, onEdit }: { contact: TripContact; onEdit: () => void }) {
  return (
    <li className="group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{contact.name}</p>
          {contact.location && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">📍 {contact.location}</p>}
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/\s+/g, "")}`} className="block truncate text-xs text-primary hover:underline">
              📞 {contact.phone}
            </a>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="block truncate text-xs text-primary hover:underline">
              ✉️ {contact.email}
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${contact.name}`}
          title="Editar"
          className="shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          ✎
        </button>
      </div>
    </li>
  );
}

// Alta/edición de un trayecto: tipo, título opcional, fecha, hora, datos y archivos adjuntos. La fecha NO se
// limita al rango del viaje (se puede salir el día antes y volver el siguiente).
function TransportDialog({
  item,
  trip,
  usedChars,
  onSave,
  onRemove,
  onClose,
}: {
  item?: TransportDetail; // undefined = nuevo
  trip: Trip;
  usedChars: number; // caracteres ya ocupados por los adjuntos de la página, sin los de este trayecto
  onSave: (values: Omit<TransportDetail, "id">) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<TransportType>(item?.type ?? "flight");
  const [title, setTitle] = useState(item?.title ?? "");
  const [date, setDate] = useState(item?.date ?? trip.startDate);
  const [time, setTime] = useState(item?.time ?? "");
  const [details, setDetails] = useState(item?.details ?? "");
  const [attachments, setAttachments] = useState<TripAttachment[]>(item?.attachments ?? []);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pendingChars = attachments.reduce((sum, a) => sum + a.dataUrl.length, 0);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setReading(true);
    let chars = usedChars + pendingChars;
    const added: TripAttachment[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(`«${file.name}» pesa ${formatBytes(file.size)}: el máximo por archivo es ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (chars + dataUrl.length > MAX_TOTAL_ATTACHMENT_CHARS) {
          setError("Has llegado al límite de archivos adjuntos de esta página. Quita alguno para añadir más.");
          break;
        }
        chars += dataUrl.length;
        added.push({ id: newId(), name: file.name, mime: file.type || "application/octet-stream", size: file.size, dataUrl });
      }
      if (added.length > 0) setAttachments((prev) => [...prev, ...added]);
    } catch {
      setError("No se pudo leer el archivo.");
    } finally {
      setReading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) {
      setError("Elige la fecha.");
      return;
    }
    onSave({
      type,
      title: title.trim() || undefined,
      date,
      time: time || undefined,
      details: details.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  return (
    <DialogShell title={item ? "Editar transporte" : "Añadir transporte"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de transporte">
          {TRANSPORT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              aria-pressed={type === t.value}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors ${
                type === t.value ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Trayecto (p. ej. Madrid → Lisboa)" maxLength={120} className="field-input font-serif text-lg" />

        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field-input normal-case tracking-normal text-foreground" />
          </label>
          <label className={fieldLabel}>
            Hora
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field-input normal-case tracking-normal text-foreground" />
          </label>
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Datos: compañía, nº de vuelo o tren, asiento, terminal, localizador…"
          maxLength={500}
          className="field-input min-h-[6rem] resize-y"
        />

        <div className="space-y-2">
          <p className={fieldLabel}>Archivos adjuntos</p>
          {attachments.length > 0 && (
            <ul className="space-y-1.5">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-xs">
                  <button type="button" onClick={() => openAttachment(a).catch(() => setError("No se pudo abrir el archivo."))} className="min-w-0 flex-1 cursor-pointer truncate text-left text-primary hover:underline">
                    📎 {a.name}
                  </button>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(a.size)}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    aria-label={`Quitar ${a.name}`}
                    className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="w-full cursor-pointer rounded-2xl border-2 border-dashed border-primary/30 px-4 py-3 text-xs text-muted-foreground transition-colors hover:bg-primary/5 disabled:opacity-50"
          >
            {reading ? "Cargando…" : "Adjuntar tarjeta de embarque, billete… (PDF o imagen)"}
          </button>
          <p className="text-[11px] text-muted-foreground">Hasta {formatBytes(MAX_ATTACHMENT_BYTES)} por archivo.</p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/*,.pdf"
            className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={reading} className="btn-dark disabled:opacity-50">
            Guardar
          </button>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
          {onRemove && (
            <span className="ml-auto">
              <DeleteButton label="Eliminar" onConfirm={onRemove} />
            </span>
          )}
        </div>
      </form>
    </DialogShell>
  );
}

function ContactDialog({
  contact,
  onSave,
  onRemove,
  onClose,
}: {
  contact?: TripContact; // undefined = nuevo
  onSave: (values: Omit<TripContact, "id">) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [location, setLocation] = useState(contact?.location ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim();
    if (!name.trim()) {
      setError("Ponle un nombre al contacto.");
      return;
    }
    if (cleanPhone && !isValidPhone(cleanPhone)) {
      setError("El teléfono no es válido: solo números, espacios y + - ( ).");
      return;
    }
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      setError("El correo electrónico no es válido.");
      return;
    }
    onSave({ name: name.trim(), location: location.trim() || undefined, phone: cleanPhone || undefined, email: cleanEmail || undefined });
  };

  return (
    <DialogShell title={contact ? "Editar contacto" : "Añadir contacto"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (hotel, seguro, embajada…)" maxLength={100} className="field-input font-serif text-lg" />
        <label className={fieldLabel}>
          Ubicación
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Dirección o zona" maxLength={160} className="field-input normal-case tracking-normal text-foreground" />
        </label>
        <label className={fieldLabel}>
          Teléfono
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+351 21 000 00 00" className="field-input normal-case tracking-normal text-foreground" />
        </label>
        <label className={fieldLabel}>
          Correo electrónico
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="reservas@hotel.com" className="field-input normal-case tracking-normal text-foreground" />
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-dark">
            Guardar
          </button>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
          {onRemove && (
            <span className="ml-auto">
              <DeleteButton label="Eliminar" onConfirm={onRemove} />
            </span>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
