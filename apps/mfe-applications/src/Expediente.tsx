import { useEffect, useRef, useState } from 'react';
import { applicationsApi, type ExpedienteFile } from '@bo/api-client';
import { useAsync, Block, Badge, Button, Chip, Spinner, TextInput } from '@bo/design-system';

/** El dictamen del analista sobre un documento: sin revisar, aceptado o rechazado con motivo. */
export type Veredicto = { ok: true } | { ok: false; motivo: string };
export type Dictamen = Record<string, Veredicto | undefined>;

/** Cómo se lee un tipo de documento. El dominio los nombra en clave. */
const DOC_LABEL: Record<string, string> = {
  INE_FRONT: 'INE — frente',
  INE_BACK: 'INE — reverso',
  ADDRESS_PROOF: 'Comprobante de domicilio',
  INCOME_PROOF: 'Comprobante de ingresos',
  SELFIE: 'Selfie',
  PROOF_OF_LIFE: 'Prueba de vida',
  BANK_STATEMENT: 'Estado de cuenta',
  RFC_DOCUMENT: 'Constancia de situación fiscal',
};

export function docLabel(t: string): string {
  return DOC_LABEL[t] ?? t.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/**
 * El texto que se manda al cliente cuando se le vuelven a pedir documentos.
 *
 * Se compone del dictamen en vez de escribirse a mano: teclear «falta el comprobante de domicilio»
 * después de haber marcado cuál falla es transcribir, y transcribir es donde se cuela el documento
 * equivocado.
 */
export function notaDeRechazados(dictamen: Dictamen): string {
  const malos = Object.entries(dictamen)
    .filter(([, v]) => v && !v.ok) as Array<[string, { ok: false; motivo: string }]>;
  if (malos.length === 0) return '';
  return malos
    .map(([tipo, v]) => `${docLabel(tipo)}: ${v.motivo.trim() || 'no cumple'}`)
    .join('\n');
}

/**
 * Los documentos del solicitante, abiertos dentro de la ficha.
 *
 * Antes esta sección era una lista de nombres: «INE_FRONT · CAPTURED». El
 * analista veía que existía un documento y no podía verlo, que para decidir un
 * crédito es lo mismo que no tenerlo.
 *
 * Se abre **en el sitio**, expandiendo hacia abajo, en vez de en una ventana
 * aparte: comparar la INE con lo que el solicitante capturó —el nombre, la
 * CURP— es leer dos cosas a la vez, y una ventana encima tapa justamente la
 * otra mitad.
 */
export function Expediente({ applicationId, dictamen, onDictaminar }: {
  applicationId: string;
  /** El dictamen en curso. Sin él la sección es sólo el visor, como en una ficha de sólo lectura. */
  dictamen?: Dictamen;
  onDictaminar?: (tipo: string, v: Veredicto | undefined) => void;
}) {
  const state = useAsync(() => applicationsApi.expediente(applicationId), [applicationId]);

  return (
    <Block state={state} emptyLabel="El solicitante no ha subido documentos." isEmpty={(d) => d.length === 0}>
      {(docs) => (
        <VisorDocumentos
          docs={docs.map((d: ExpedienteFile) => ({ ...d, key: d.fileId }))}
          abrir={(tipo) => applicationsApi.documentUrl(applicationId, tipo)}
          dictamen={dictamen}
          onDictaminar={onDictaminar}
        />
      )}
    </Block>
  );
}

/** Lo mínimo que el visor necesita saber de un archivo para listarlo, sin su contenido. */
export interface DocumentoVisible {
  /** Identidad estable de la fila. Donde el dominio no da `fileId`, basta el tipo. */
  key: string;
  documentType: string;
  fileName?: string | null;
  contentType: string;
  sizeBytes: number;
}

/**
 * El visor, sin saber de dónde salen los archivos.
 *
 * Nació atado a solicitudes y se separó cuando cumplimiento y beneficiarios necesitaron lo mismo:
 * una INE y una selfie que comparar contra lo capturado. Quien lo usa le pasa la lista y cómo
 * bajar cada archivo (`abrir`); el resto —bajar al abrir, zoom, revocar el blob al cerrar— es
 * igual en las tres mesas, y tenerlo tres veces era tener tres formas de olvidar revocarlo.
 */
export function VisorDocumentos({ docs, abrir, dictamen, onDictaminar }: {
  docs: DocumentoVisible[];
  /** Devuelve una URL `blob:` lista para `<img>` o `<iframe>`. El visor la revoca al desmontar. */
  abrir: (documentType: string) => Promise<string>;
  dictamen?: Dictamen;
  onDictaminar?: (tipo: string, v: Veredicto | undefined) => void;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const revisados = docs.filter((d) => dictamen?.[d.documentType]).length;
  const rechazados = docs.filter((d) => { const v = dictamen?.[d.documentType]; return v && !v.ok; }).length;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {onDictaminar && (
        <div className="bo-scope" style={{ marginBottom: 2 }}>
          <Chip tone={rechazados > 0 ? 'bad' : revisados === docs.length ? 'ok' : undefined}>
            {revisados} de {docs.length} revisados
          </Chip>
          <span className="bo-page-sub" style={{ display: 'inline' }}>
            {/* Se dice qué es este dictamen, porque parece estado guardado y no lo es. El
                backend no tiene hoy dónde persistir un veredicto por documento: lo que queda
                registrado es la decisión de la solicitud o la petición de documentos, y este
                panel es lo que las redacta. */}
            El dictamen por documento es tu hoja de trabajo: <b>no se guarda por archivo</b>.
            Lo que queda en el expediente es la decisión o la petición de documentos que
            compone.
          </span>
        </div>
      )}
      {docs.map((doc) => (
        <DocumentoRow
          key={doc.key}
          doc={doc}
          abrir={abrir}
          abierto={abierto === doc.documentType}
          onToggle={() => setAbierto((a) => (a === doc.documentType ? null : doc.documentType))}
          veredicto={dictamen?.[doc.documentType]}
          onDictaminar={onDictaminar}
        />
      ))}
    </div>
  );
}

function DocumentoRow({ doc, abrir, abierto, onToggle, veredicto, onDictaminar }: {
  doc: DocumentoVisible;
  abrir: (documentType: string) => Promise<string>;
  abierto: boolean;
  onToggle: () => void;
  veredicto?: Veredicto;
  onDictaminar?: (tipo: string, v: Veredicto | undefined) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const urlRef = useRef<string | null>(null);
  // El cargador llega como prop y quien lo pasa suele crearlo en cada render. Leerlo de una ref
  // evita que un re-render a media descarga cancele la petición y la vuelva a lanzar.
  const abrirRef = useRef(abrir);
  abrirRef.current = abrir;

  // El archivo se baja al abrirlo, no al listar: un expediente son cuatro
  // imágenes y una ficha se abre para leer el score, no siempre para verlas.
  useEffect(() => {
    if (!abierto || urlRef.current) return;
    let vivo = true;
    abrirRef.current(doc.documentType)
      .then((u) => {
        if (!vivo) { URL.revokeObjectURL(u); return; }
        urlRef.current = u;
        setUrl(u);
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se pudo abrir'));
    return () => { vivo = false; };
  }, [abierto, doc.documentType]);

  // Cada blob abierto retiene memoria hasta que se revoca. Se hace al desmontar
  // —cerrar la ficha— y no al colapsar, para no volver a bajarlo si se reabre.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const esImagen = doc.contentType.startsWith('image/');

  return (
    <div className={`bo-doc${abierto ? ' open' : ''}`}>
      <button type="button" className="bo-doc-head" onClick={onToggle} aria-expanded={abierto}>
        <span className="bo-doc-caret">{abierto ? '▾' : '▸'}</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <b style={{ fontSize: 13 }}>{docLabel(doc.documentType)}</b>
          <span className="bo-tree-code"> {doc.fileName ?? doc.documentType} · {kb(doc.sizeBytes)}</span>
        </span>
        {veredicto && (
          <Badge tone={veredicto.ok ? 'ok' : 'bad'}>
            {veredicto.ok ? 'Aceptado' : 'Rechazado'}
          </Badge>
        )}
        <Badge tone="muted">{doc.contentType.split('/')[1]?.toUpperCase() ?? doc.contentType}</Badge>
      </button>

      {/* El dictamen vive **fuera** del cuerpo plegable: se marca al terminar de mirar el
          documento, y si sólo apareciera con el visor abierto habría que reabrir cada uno para
          corregir un veredicto. */}
      {onDictaminar && (
        <Dictaminar tipo={doc.documentType} veredicto={veredicto} onDictaminar={onDictaminar} />
      )}

      {abierto && (
        <div className="bo-doc-body">
          {error ? (
            <p style={{ color: 'var(--bo-bad)', fontSize: 13, margin: 0 }}>{error}</p>
          ) : !url ? (
            <Spinner />
          ) : (
            <>
              <div className="bo-doc-tools">
                <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5}>−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} disabled={zoom >= 3}>+</button>
                <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}>Ajustar</button>
                {/* Abrir aparte es para el caso en que hay que acercarse de verdad, o
                    imprimirlo. Dentro de la ficha se lee; fuera se examina. */}
                <a href={url} target="_blank" rel="noreferrer">Abrir en pestaña</a>
              </div>
              <div className="bo-doc-canvas">
                {esImagen ? (
                  <img
                    src={url}
                    alt={docLabel(doc.documentType)}
                    style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none' }}
                  />
                ) : (
                  // PDF y todo lo demás: el visor del navegador ya sabe pintarlo.
                  <iframe src={url} title={docLabel(doc.documentType)} style={{ width: '100%', height: 520, border: 0 }} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * El veredicto de un documento: aceptado, o rechazado con su motivo.
 *
 * El motivo es obligatorio para rechazar porque es lo que acaba llegándole al cliente cuando se le
 * vuelven a pedir los documentos. «Rechazado» a secas obliga a quien atiende el teléfono a inventar
 * la explicación, y cada quien inventa una distinta.
 */
function Dictaminar({ tipo, veredicto, onDictaminar }: {
  tipo: string;
  veredicto?: Veredicto;
  onDictaminar: (tipo: string, v: Veredicto | undefined) => void;
}) {
  const rechazado = veredicto && !veredicto.ok;
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      padding: '8px 12px', borderTop: '1px solid var(--bo-border)',
    }}>
      <Button
        selected={veredicto?.ok === true}
        title="El documento cumple"
        onClick={() => onDictaminar(tipo, veredicto?.ok ? undefined : { ok: true })}
      >
        ✓ Aceptar
      </Button>
      <Button
        variant={rechazado ? 'danger' : 'default'}
        title="El documento no cumple: hay que pedirlo de nuevo"
        onClick={() => onDictaminar(tipo, rechazado ? undefined : { ok: false, motivo: '' })}
      >
        ✕ Rechazar
      </Button>
      {rechazado && (
        <TextInput
          value={(veredicto as { ok: false; motivo: string }).motivo}
          onChange={(m) => onDictaminar(tipo, { ok: false, motivo: m })}
          grow
          placeholder="Por qué no cumple — esto es lo que va a leer el cliente"
          ariaLabel={`Motivo del rechazo de ${docLabel(tipo)}`}
        />
      )}
    </div>
  );
}
