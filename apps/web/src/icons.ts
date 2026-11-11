/**
 * Ícones Lucide (traço de 2 px, definido no CSS por --icon-stroke).
 * Importados um a um: só entram no bundle os que a página usa.
 */
import {
  CalendarClock,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  ClockAlert,
  Coins,
  Gift,
  House,
  Info,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  PackageCheck,
  PackageX,
  RefreshCw,
  Repeat,
  Sun,
  Ticket,
  TriangleAlert,
  Undo2,
  Utensils,
  WifiOff,
  Wrench,
  type IconNode,
} from "lucide";
import type { CodigoBloqueio } from "@ecoponto/contracts";
import type { NomeIcone as NomeIconeFormat } from "@ecoponto/format";

export type NomeIcone =
  | NomeIconeFormat
  | "calendar-clock"
  | "chevron-left"
  | "chevron-right"
  | "clock"
  | "info"
  | "map-pin"
  | "message-circle"
  | "package"
  | "refresh-cw"
  | "sun"
  | "triangle-alert"
  | "wifi-off";

const ICONES: Record<NomeIcone, IconNode> = {
  "calendar-clock": CalendarClock,
  "calendar-x": CalendarX,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  clock: Clock,
  "clock-alert": ClockAlert,
  coins: Coins,
  gift: Gift,
  house: House,
  info: Info,
  lock: Lock,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  package: Package,
  "package-check": PackageCheck,
  "package-x": PackageX,
  "refresh-cw": RefreshCw,
  repeat: Repeat,
  sun: Sun,
  ticket: Ticket,
  "triangle-alert": TriangleAlert,
  "undo-2": Undo2,
  utensils: Utensils,
  "wifi-off": WifiOff,
  wrench: Wrench,
};

/** Ícone de cada motivo de bloqueio: o motivo nunca depende só de cor. */
export const ICONE_BLOQUEIO: Readonly<Record<CodigoBloqueio, NomeIcone>> = {
  esgotado: "package-x",
  oferta_encerrada: "calendar-x",
  nivel_insuficiente: "lock",
  limite_mensal: "repeat",
  saldo_insuficiente: "coins",
};

const SVG = "http://www.w3.org/2000/svg";

/** Ícone decorativo (aria-hidden). O significado vai sempre em texto ao lado. */
export function icone(nome: NomeIcone, classe = ""): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", `icon ${classe}`.trim());
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.icone = nome;
  for (const [tag, attrs] of ICONES[nome]) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && k !== "key") el.setAttribute(k, String(v));
    }
    svg.append(el);
  }
  return svg;
}
