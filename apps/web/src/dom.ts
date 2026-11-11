/**
 * Ajudante mínimo para montar DOM. Todo texto entra por textContent
 * (nunca innerHTML com dados), então não há injeção de HTML.
 */

export type Filho = Node | string | number | null | undefined | false;
type Valor = string | number | boolean | null | undefined | EventListener;
export type Attrs = Record<string, Valor>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...filhos: Array<Filho | Filho[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on:") && typeof v === "function") el.addEventListener(k.slice(3), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  anexar(el, filhos);
  return el;
}

export function anexar(el: Element, filhos: Array<Filho | Filho[]>): void {
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    el.append(typeof f === "number" ? String(f) : f);
  }
}

export function substituir(el: Element, ...filhos: Array<Filho | Filho[]>): void {
  el.replaceChildren();
  anexar(el, filhos);
}

/** Texto só para leitor de tela. */
export function oculto(texto: string): HTMLSpanElement {
  return h("span", { class: "visually-hidden" }, texto);
}
