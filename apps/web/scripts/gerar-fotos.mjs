/**
 * Gera as ilustrações provisórias dos 12 prêmios de exemplo (public/fotos).
 * Serão trocadas pelas fotos reais cadastradas no painel (T28).
 *
 * São arquivos de conteúdo (imagem), não interface: as cores vêm da paleta de
 * Boa Vista, mas ficam no SVG porque <img> não lê variáveis CSS.
 *
 *   node scripts/gerar-fotos.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as L from "lucide";

const FOTOS = {
  "sacola-retornavel": ["ShoppingBag", "#E3F1E6", "#1E7B34"],
  "cafe-regional": ["Coffee", "#F4ECE1", "#6B4423"],
  "kit-hortifruti": ["Carrot", "#E6F4E0", "#1E7B34"],
  "corte-de-cabelo": ["Scissors", "#E6F1F8", "#025790"],
  "garrafa-termica": ["CupSoda", "#E6F1F8", "#0A6E9E"],
  "ingresso-show": ["Music", "#FBF6D3", "#025790"],
  "lampadas-led": ["Lightbulb", "#FBF6D3", "#7A6A00"],
  "revisao-bicicleta": ["Bike", "#E6F1F8", "#0A6E9E"],
  cinema: ["Clapperboard", "#ECE8F4", "#3D2F73"],
  "bola-futebol": ["Volleyball", "#E3F1E6", "#1E7B34"],
  "cesta-basica": ["ShoppingBasket", "#F4ECE1", "#025790"],
  "jogo-panelas": ["CookingPot", "#ECEFF2", "#13212E"],
};

const pasta = fileURLToPath(new URL("../public/fotos/", import.meta.url));
mkdirSync(pasta, { recursive: true });

for (const [nome, [icone, fundo, traco]] of Object.entries(FOTOS)) {
  const no = L[icone];
  if (!no) throw new Error(`Ícone ${icone} não existe no Lucide`);
  const filhos = no
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
<rect width="400" height="300" fill="${fundo}"/>
<circle cx="200" cy="150" r="104" fill="#FFFFFF" opacity="0.7"/>
<g transform="translate(128 78) scale(6)" fill="none" stroke="${traco}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${filhos}</g>
</svg>
`;
  writeFileSync(`${pasta}${nome}.svg`, svg);
}
console.log(`${Object.keys(FOTOS).length} fotos em ${pasta}`);
