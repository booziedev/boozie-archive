/**
 * Theme engine.
 *
 * Every accent colour in the UI resolves through CSS custom properties, so a
 * change here repaints the whole app without a re-render: Tailwind's `accent-*`
 * and `glow` classes are defined as `rgb(var(--accent-500) / <alpha-value>)`,
 * and this module is the only thing that writes those variables.
 */

export interface ThemeSettings {
  /** Base accent as a hex string. The hue slider and the picker both write it. */
  accent: string;
  gradient: GradientId;
  /** The two colours the animated background is built from. */
  gradientFrom: string;
  gradientTo: string;
  /** Seconds for one full cycle; higher is calmer. */
  gradientSpeed: number;
  animate: boolean;
}

export type GradientId = 'none' | 'vault' | 'aurora' | 'nebula' | 'ember' | 'mesh';

export const GRADIENTS: { id: GradientId; name: string; description: string }[] = [
  { id: 'vault', name: 'Vault', description: 'Two soft corner glows' },
  { id: 'aurora', name: 'Aurora', description: 'Slow drifting curtains' },
  { id: 'nebula', name: 'Nebula', description: 'Deep rotating clouds' },
  { id: 'ember', name: 'Ember', description: 'A warm rising wash' },
  { id: 'mesh', name: 'Mesh', description: 'Blobs that breathe' },
  { id: 'none', name: 'None', description: 'Flat background' },
];

export const DEFAULT_THEME: ThemeSettings = {
  accent: '#7c5cff',
  gradient: 'vault',
  gradientFrom: '#7c5cff',
  gradientTo: '#22d3ee',
  gradientSpeed: 24,
  animate: true,
};

const STORAGE_KEY = 'boozie.theme.v1';

// --------------------------------------------------------------- colour maths

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!match) return null;
  let value = match[1]!;
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;

  if (sat === 0) {
    const value = Math.round(light * 255);
    return rgbToHex(value, value, value);
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;

  const channel = (t: number) => {
    let temp = t;
    if (temp < 0) temp += 1;
    if (temp > 1) temp -= 1;
    if (temp < 1 / 6) return p + (q - p) * 6 * temp;
    if (temp < 1 / 2) return q;
    if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
    return p;
  };

  return rgbToHex(channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255);
}

/** "124 92 255" — the form Tailwind's `rgb(var(--x) / <alpha>)` needs. */
function rgbChannels(hex: string): string {
  const rgb = hexToRgb(hex) ?? { r: 124, g: 92, b: 255 };
  return `${rgb.r} ${rgb.g} ${rgb.b}`;
}

/**
 * Lightness offsets that reproduce the original palette when the accent is the
 * default violet, so picking a new colour shifts the whole ramp rather than
 * flattening it.
 */
const RAMP: [string, number][] = [
  ['50', 28.5],
  ['200', 20.8],
  ['300', 13.8],
  ['400', 6.9],
  ['500', 0],
  ['600', -9.6],
  ['700', -21.1],
  ['900', -43.5],
];

/** Builds the full accent scale from one colour. */
export function accentRamp(accent: string): Record<string, string> {
  const base = hexToHsl(accent) ?? hexToHsl(DEFAULT_THEME.accent)!;
  const out: Record<string, string> = {};
  for (const [step, delta] of RAMP) {
    // The lightest steps lose saturation the way the hand-tuned palette did.
    const saturation = delta > 14 ? Math.min(100, base.s * 0.92) : base.s;
    out[step] = hslToHex({ h: base.h, s: saturation, l: base.l + delta });
  }
  return out;
}

/** A complementary highlight, offset from the accent the way cyan sat to violet. */
export function glowFor(accent: string): string {
  const base = hexToHsl(accent) ?? hexToHsl(DEFAULT_THEME.accent)!;
  return hslToHex({ h: base.h - 66, s: Math.max(60, Math.min(90, base.s)), l: 53 });
}

// ------------------------------------------------------------------- applying

/** Writes the theme to the document. The only place that touches CSS variables. */
export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement;
  const ramp = accentRamp(theme.accent);

  for (const [step, hex] of Object.entries(ramp)) {
    root.style.setProperty(`--accent-${step}`, rgbChannels(hex));
  }
  root.style.setProperty('--glow', rgbChannels(glowFor(theme.accent)));

  root.style.setProperty('--grad-a', theme.gradientFrom);
  root.style.setProperty('--grad-b', theme.gradientTo);
  root.style.setProperty('--grad-duration', `${theme.gradientSpeed}s`);
  root.dataset.gradient = theme.gradient;
  root.dataset.gradientAnimate = theme.animate ? 'on' : 'off';

  // Keeps the browser UI (iOS status bar, Android chrome) in step.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#06060a');
}

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      accent: typeof parsed.accent === 'string' && hexToRgb(parsed.accent) ? parsed.accent : DEFAULT_THEME.accent,
      gradient: GRADIENTS.some((g) => g.id === parsed.gradient)
        ? (parsed.gradient as GradientId)
        : DEFAULT_THEME.gradient,
      gradientFrom:
        typeof parsed.gradientFrom === 'string' && hexToRgb(parsed.gradientFrom)
          ? parsed.gradientFrom
          : DEFAULT_THEME.gradientFrom,
      gradientTo:
        typeof parsed.gradientTo === 'string' && hexToRgb(parsed.gradientTo)
          ? parsed.gradientTo
          : DEFAULT_THEME.gradientTo,
      gradientSpeed:
        Number.isFinite(parsed.gradientSpeed) && parsed.gradientSpeed! >= 4 && parsed.gradientSpeed! <= 120
          ? parsed.gradientSpeed!
          : DEFAULT_THEME.gradientSpeed,
      animate: typeof parsed.animate === 'boolean' ? parsed.animate : DEFAULT_THEME.animate,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Private mode: the theme just won't persist.
  }
}
