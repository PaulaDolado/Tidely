import { ChangeEvent, FormEvent, ReactNode, useRef, useState } from "react";
import { DeleteButton, DialogShell } from "./DialogShell";
import { newId } from "../utils/id";
import {
  attachmentChars,
  buildTransportChains,
  formatDuration,
  formatTransportSchedule,
  isValidEmail,
  isValidPhone,
  layoverMinutes,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_CHARS,
  openAttachment,
  readFileAsDataUrl,
  TRANSPORT_TYPES,
  transferCandidates,
  transportMeta,
} from "../utils/travel";
import { PackingItem, TransportDetail, TransportType, Trip, TripAttachment, TripContact } from "../types";

// Las tres secciones de debajo de los paneles del planificador de viajes (ver TravelPlannerTemplate), todas
// DEL viaje seleccionado y guardadas dentro de `Trip` (packing / transport / contacts): lo que hay que
// empacar, los detalles del transporte (con salida, llegada, transbordos y archivos adjuntos como la tarjeta
// de embarque) y los contactos importantes. Puede haber varios contactos y varios trayectos. Componente
// controlado: lee del viaje y devuelve cambios con `onPatch`.

const plusButton =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-sm leading-none text-background transition-opacity hover:opacity-80";
const fieldLabel = "flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground";
const sectionTitle = "text-xs font-medium uppercase tracking-widest text-muted-foreground";

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

// Título de una sección con el destino del viaje debajo, para que se vea de qué viaje es lo que se enseña.
function SectionHeading({ title, destination, extra }: { title: string; destination: string; extra?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <h3 className={sectionTitle}>{title}</h3>
        {extra}
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{destination}</p>
    </div>
  );
}

type DialogState =
  // `afterId`: trayecto NUEVO que se crea como conexión (transbordo) del trayecto con ese id.
  | { kind: "transport"; id: string | null; afterId?: string }
  | { kind: "contact"; id: string | null }
  | null;

export function TravelExtras({ trip, allTrips, onPatch }: { trip: Trip; allTrips: Trip[]; onPatch: (patch: Partial<Trip>) => void }) {
  const packing = trip.packing ?? [];
  const transport = trip.transport ?? [];
  const contacts = trip.contacts ?? [];

  const [dialog, setDialog] = useState<DialogState>(null);

  const chains = buildTransportChains(transport);
  const openTransport = dialog?.kind === "transport" ? dialog.id : undefined; // undefined = cerrado, null = nuevo
  const openContact = dialog?.kind === "contact" ? dialog.id : undefined;
  const afterId = dialog?.kind === "transport" ? dialog.afterId : undefined;

  // `connect: "new"` = el trayecto necesita transbordo y se quiere crear ya el trayecto de conexión: se
  // guarda este y se abre el formulario de uno nuevo enlazado a él.
  const saveTransport = (id: string | null, values: Omit<TransportDetail, "id">, connect?: "new") => {
    const savedId = id ?? newId();
    let next = id === null ? [...transport, { id: savedId, ...values }] : transport.map((t) => (t.id === id ? { id, ...values } : t));
    // Si este trayecto se creó como conexión de otro, el otro pasa a apuntar a él.
    if (id === null && afterId) next = next.map((t) => (t.id === afterId ? { ...t, needsTransfer: true, nextId: savedId } : t));
    onPatch({ transport: next });
    if (connect === "new") setDialog({ kind: "transport", id: null, afterId: savedId });
    else setDialog(null);
  };
  const removeTransport = (id: string) => {
    // Los trayectos que apuntaban a este lo pierden como continuación (siguen necesitando transbordo).
    onPatch({ transport: transport.filter((t) => t.id !== id).map((t) => (t.nextId === id ? { ...t, nextId: undefined } : t)) });
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
  const connectingFrom = afterId ? transport.find((t) => t.id === afterId) : undefined;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <PackingSection destination={trip.destination} items={packing} onChange={(next) => onPatch({ packing: next })} />

        {/* Detalles del transporte */}
        <section className="card-soft flex flex-col">
          <div className="mb-4 flex items-start justify-between gap-2">
            <SectionHeading title="Detalles del transporte" destination={trip.destination} />
            <button type="button" onClick={() => setDialog({ kind: "transport", id: null })} aria-label="Añadir transporte" title="Añadir un trayecto" className={plusButton}>
              +
            </button>
          </div>
          {transport.length === 0 ? (
            <p className="text-sm text-muted-foreground">Vuelos, trenes, autobuses… con su hora de salida y de llegada, sus transbordos y la tarjeta de embarque adjunta.</p>
          ) : (
            <ul className="space-y-5">
              {chains.map((chain) => (
                <TransportChain key={chain[0].id} chain={chain} onEdit={(id) => setDialog({ kind: "transport", id })} />
              ))}
            </ul>
          )}
        </section>

        {/* Contactos importantes */}
        <section className="card-soft flex flex-col">
          <div className="mb-4 flex items-start justify-between gap-2">
            <SectionHeading title="Contactos importantes" destination={trip.destination} />
            <button type="button" onClick={() => setDialog({ kind: "contact", id: null })} aria-label="Añadir contacto" title="Añadir un contacto" className={plusButton}>
              +
            </button>
          </div>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Alojamiento, seguro, embajada… con su ubicación, teléfono o correo. Puedes añadir todos los que necesites.</p>
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
          key={`${openTransport ?? "new"}-${afterId ?? ""}`}
          item={editingTransport}
          trip={trip}
          // Para un trayecto nuevo creado como conexión: sale desde donde llega el anterior.
          defaults={connectingFrom ? { date: connectingFrom.arrivalDate ?? connectingFrom.date } : undefined}
          // Lo que ya ocupan los adjuntos de la página SIN contar los de este trayecto (se recuentan con los pendientes del diálogo).
          usedChars={attachmentChars(allTrips) - (editingTransport?.attachments ?? []).reduce((sum, a) => sum + a.dataUrl.length, 0)}
          others={transport}
          onSave={(values, connect) => saveTransport(openTransport, values, connect)}
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
      <div className="mb-4 flex items-start justify-between gap-2">
        <SectionHeading
          title="Qué empacar"
          destination={destination}
          extra={
            items.length > 0 ? (
              <span className="text-xs text-muted-foreground" aria-label={`${packed} de ${items.length} empacadas`}>
                {packed}/{items.length}
              </span>
            ) : undefined
          }
        />
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

// Un viaje de ida de A a B puede ser varios trayectos enlazados (transbordos): se enseñan juntos, el primero y
// debajo, con sangría, cada conexión con el sitio del transbordo y lo que se espera entre uno y otro.
function TransportChain({ chain, onEdit }: { chain: TransportDetail[]; onEdit: (id: string) => void }) {
  return (
    <li>
      <ul className="space-y-0">
        {chain.map((leg, i) => {
          const prev = i > 0 ? chain[i - 1] : undefined;
          const wait = prev ? layoverMinutes(prev, leg) : null;
          return (
            <li key={leg.id} className={i > 0 ? "ml-3 border-l-2 border-primary/30 pl-3" : ""}>
              {prev && (
                <p className="py-2 text-[11px] text-muted-foreground">
                  ↳ Transbordo{prev.transferPlace ? ` en ${prev.transferPlace}` : ""}
                  {wait !== null && wait >= 0 && ` · escala de ${formatDuration(wait)}`}
                  {wait !== null && wait < 0 && <span className="ml-1 font-medium text-destructive">⚠ La conexión no llega a tiempo</span>}
                </p>
              )}
              <TransportRow item={leg} onEdit={() => onEdit(leg.id)} />
            </li>
          );
        })}
      </ul>
    </li>
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
    <div className="group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">
            <span aria-hidden="true">{meta.icon} </span>
            {item.title || meta.label}
          </p>
          <p className="text-xs text-muted-foreground">{formatTransportSchedule(item)}</p>
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
          {item.needsTransfer && !item.nextId && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              ↳ Transbordo pendiente{item.transferPlace ? ` en ${item.transferPlace}` : ""}: añade el transporte de conexión.
            </p>
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
    </div>
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

const LINK_NONE = "";
const LINK_NEW = "__new__";

// Alta/edición de un trayecto: tipo, título opcional, salida (fecha y hora), llegada (hora y, si es otro día,
// fecha), datos, archivos adjuntos y, si hace falta, el transbordo: dónde y con qué otro trayecto del viaje
// continúa (uno ya existente o uno nuevo que se crea a continuación). Las fechas NO se limitan al rango del
// viaje (se puede salir el día antes y volver el siguiente).
function TransportDialog({
  item,
  trip,
  defaults,
  usedChars,
  others,
  onSave,
  onRemove,
  onClose,
}: {
  item?: TransportDetail; // undefined = nuevo
  trip: Trip;
  defaults?: { date: string }; // valores iniciales de un trayecto nuevo (p. ej. como conexión de otro)
  usedChars: number; // caracteres ya ocupados por los adjuntos de la página, sin los de este trayecto
  others: TransportDetail[]; // todos los trayectos del viaje (para elegir la conexión)
  onSave: (values: Omit<TransportDetail, "id">, connect?: "new") => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<TransportType>(item?.type ?? "flight");
  const [title, setTitle] = useState(item?.title ?? "");
  const [date, setDate] = useState(item?.date ?? defaults?.date ?? trip.startDate);
  const [departureTime, setDepartureTime] = useState(item?.departureTime ?? "");
  const [arrivalDate, setArrivalDate] = useState(item?.arrivalDate ?? "");
  const [arrivalTime, setArrivalTime] = useState(item?.arrivalTime ?? "");
  const [details, setDetails] = useState(item?.details ?? "");
  const [attachments, setAttachments] = useState<TripAttachment[]>(item?.attachments ?? []);
  const [needsTransfer, setNeedsTransfer] = useState(!!item?.needsTransfer);
  const [transferPlace, setTransferPlace] = useState(item?.transferPlace ?? "");
  const [link, setLink] = useState<string>(item?.nextId ?? LINK_NONE);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pendingChars = attachments.reduce((sum, a) => sum + a.dataUrl.length, 0);
  const candidates = transferCandidates(others, item?.id);

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
      setError("Elige la fecha de salida.");
      return;
    }
    if (arrivalDate && arrivalDate < date) {
      setError("La fecha de llegada no puede ser anterior a la de salida.");
      return;
    }
    const sameDay = !arrivalDate || arrivalDate === date;
    if (sameDay && departureTime && arrivalTime && arrivalTime < departureTime) {
      setError("La llegada no puede ser anterior a la salida (si llegas al día siguiente, pon la fecha de llegada).");
      return;
    }
    onSave(
      {
        type,
        title: title.trim() || undefined,
        date,
        departureTime: departureTime || undefined,
        arrivalDate: arrivalDate && arrivalDate !== date ? arrivalDate : undefined,
        arrivalTime: arrivalTime || undefined,
        details: details.trim() || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        needsTransfer: needsTransfer || undefined,
        transferPlace: needsTransfer ? transferPlace.trim() || undefined : undefined,
        nextId: needsTransfer && link && link !== LINK_NEW ? link : undefined,
      },
      needsTransfer && link === LINK_NEW ? "new" : undefined
    );
  };

  const optionLabel = (t: TransportDetail) => `${transportMeta(t.type).icon} ${t.title || transportMeta(t.type).label} · ${formatTransportSchedule(t)}`;

  return (
    <DialogShell title={item ? "Editar transporte" : defaults ? "Transporte de conexión" : "Añadir transporte"} onClose={onClose}>
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
            Fecha de salida
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field-input normal-case tracking-normal text-foreground" />
          </label>
          <label className={fieldLabel}>
            Hora de salida
            <input type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} className="field-input normal-case tracking-normal text-foreground" />
          </label>
          <label className={fieldLabel}>
            Fecha de llegada
            <input
              type="date"
              value={arrivalDate}
              min={date}
              onChange={(e) => setArrivalDate(e.target.value)}
              className="field-input normal-case tracking-normal text-foreground"
            />
            <span className="text-[10px] normal-case tracking-normal">Déjala vacía si llegas el mismo día.</span>
          </label>
          <label className={fieldLabel}>
            Hora de llegada
            <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="field-input normal-case tracking-normal text-foreground" />
          </label>
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Datos: compañía, nº de vuelo o tren, asiento, terminal, localizador…"
          maxLength={500}
          className="field-input min-h-[6rem] resize-y"
        />

        {/* Transbordo: este trayecto continúa con OTRO trayecto del viaje */}
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={needsTransfer}
              onChange={(e) => {
                setNeedsTransfer(e.target.checked);
                if (!e.target.checked) setLink(LINK_NONE);
              }}
              className="size-4 cursor-pointer accent-[var(--primary)]"
            />
            Necesita transbordo
          </label>
          {needsTransfer && (
            <>
              <label className={fieldLabel}>
                Transbordo en
                <input
                  value={transferPlace}
                  onChange={(e) => setTransferPlace(e.target.value)}
                  placeholder="Estación, aeropuerto…"
                  maxLength={120}
                  className="field-input normal-case tracking-normal text-foreground"
                />
              </label>
              <label className={fieldLabel}>
                Continúa con
                <select value={link} onChange={(e) => setLink(e.target.value)} className="field-input normal-case tracking-normal text-foreground">
                  <option value={LINK_NONE}>— Aún sin elegir —</option>
                  {candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {optionLabel(t)}
                    </option>
                  ))}
                  <option value={LINK_NEW}>+ Crear transporte de conexión</option>
                </select>
              </label>
              {link === LINK_NEW && <p className="text-[11px] text-muted-foreground">Al guardar se abrirá el formulario del siguiente trayecto, ya enlazado a este.</p>}
            </>
          )}
        </div>

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
            {needsTransfer && link === LINK_NEW ? "Guardar y añadir conexión" : "Guardar"}
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
