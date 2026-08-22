// Marca Kredius para la consola.
//
// El isotipo se dibuja 1:1 con el vector oficial (brand_kredius/logotipo/kredius-logotipo-azul.svg
// y su gemelo en la app, fa_design_system/src/brand/kredius_mark.dart). Geometría sobre un lienzo
// de 100×100, trazo 7.8 y remate recto (butt):
//   - astil vertical   x=33.1   y 23 → 77
//   - pierna inferior   32,48 → 71.8,77
//   - brazo superior    32,52 → 71.8,23   ← siempre verde: es el gesto de crecimiento de la marca
//
// Va como SVG en línea y no como <img>: cruza la frontera de Module Federation sin publicar un
// asset por remote, y el astil puede tomar el color del contenedor —que es lo que distingue las
// cuatro versiones de marca en vez de tener cuatro archivos.

const VIEWBOX = 100;
const STROKE = 7.8;
/** Radio del cuadro redondeado del isotipo, en unidades del lienzo. */
const TILE_RADIUS = 22;

/**
 * Los cuatro tratamientos oficiales (brand_kredius/README.md, «Cuándo usar cada versión»):
 * - `badge`    — cuadro azul + K blanca. Es el ícono de la app; se usa sobre superficie clara.
 * - `inverted` — cuadro blanco + K azul. Es el que va **sobre el azul de marca**: la barra lateral.
 * - `onDark`   — sólo trazos blancos, sin cuadro.
 * - `onLight`  — sólo trazos azules, sin cuadro.
 */
export type BrandVariant = 'badge' | 'inverted' | 'onDark' | 'onLight';

/** El isotipo «K». Cuadrado: [size] es el lado. */
export function BrandMark({ size = 30, variant = 'badge' }: { size?: number; variant?: BrandVariant }) {
  const tile = variant === 'badge' ? 'var(--bo-brand)' : variant === 'inverted' ? '#ffffff' : null;
  // Sobre el cuadro blanco el trazo es el azul fijo de marca; suelto sobre la interfaz sigue al
  // tema, porque #0D47A1 sobre fondo oscuro no se ve.
  const stroke =
    variant === 'badge' || variant === 'onDark' ? '#ffffff'
      : variant === 'inverted' ? 'var(--bo-brand)'
        : 'var(--bo-primary)';

  return (
    <svg
      className="bo-brand-mark"
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      role="img"
      aria-label="Kredius"
      focusable="false"
    >
      {tile && <rect width={VIEWBOX} height={VIEWBOX} rx={TILE_RADIUS} fill={tile} />}
      <g fill="none" strokeWidth={STROKE} strokeLinecap="butt">
        <path d="M33.1 23V77" stroke={stroke} />
        <path d="M32 48L71.8 77" stroke={stroke} />
        <path d="M32 52L71.8 23" stroke="var(--bo-accent)" />
      </g>
    </svg>
  );
}

/**
 * Isotipo + logotipo. Hereda el color del contenedor: en la barra lateral lo pone `.bo-brand`, en
 * la tarjeta de acceso `.bo-login-brand`. Nadie vuelve a escribir un color de marca desde el JSX.
 */
export function Brand({
  variant = 'badge', size = 30, subtitle, wordmark = true,
}: {
  variant?: BrandVariant;
  size?: number;
  /** Segunda línea bajo el logotipo — «Backoffice de crédito». */
  subtitle?: string;
  wordmark?: boolean;
}) {
  return (
    <>
      <BrandMark size={size} variant={variant} />
      {wordmark && (
        <div>
          <div className="bo-brand-name" style={{ fontSize: Math.round(size * 0.57) }}>Kredius</div>
          {subtitle && <div className="bo-brand-sub">{subtitle}</div>}
        </div>
      )}
    </>
  );
}
