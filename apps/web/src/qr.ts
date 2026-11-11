/**
 * QR do vale, gerado no próprio aparelho (funciona offline).
 * Preto sobre branco em qualquer tema (--qr-fg / --qr-bg), com margem de
 * 4 módulos (zona de silêncio) para o leitor da portaria.
 */
import qrcode from "qrcode-generator";

const SVG = "http://www.w3.org/2000/svg";

export function qrSvg(texto: string, rotulo: string): SVGSVGElement {
  const qr = qrcode(0, "M");
  // Código do vale: maiúsculas, dígitos e hífen → modo alfanumérico (QR menor).
  qr.addData(texto, /^[0-9A-Z $%*+\-./:]+$/.test(texto) ? "Alphanumeric" : "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const margem = 4;
  const lado = n + margem * 2;

  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) d += `M${x + margem} ${y + margem}h1v1h-1z`;
    }
  }

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "qr");
  svg.setAttribute("viewBox", `0 0 ${lado} ${lado}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", rotulo);
  svg.setAttribute("shape-rendering", "crispEdges");
  const fundo = document.createElementNS(SVG, "rect");
  fundo.setAttribute("class", "qr__fundo");
  fundo.setAttribute("width", String(lado));
  fundo.setAttribute("height", String(lado));
  const modulos = document.createElementNS(SVG, "path");
  modulos.setAttribute("class", "qr__modulos");
  modulos.setAttribute("d", d);
  svg.append(fundo, modulos);
  svg.dataset.modulos = String(n);
  return svg;
}
