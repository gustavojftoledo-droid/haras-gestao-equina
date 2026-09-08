/**
 * Renderiza o relatório do dia como uma IMAGEM (PNG) — um "card" diagramado, pra mandar no
 * Telegram como foto (aparece direto na conversa, sem abrir arquivo).
 *
 * Caminho: monta um SVG na mão (layout controlado, altura dinâmica pelo conteúdo) e rasteriza
 * com @resvg/resvg-wasm. Sem emoji na imagem (são desenhados como quadradinhos/《pontos》) — o
 * renderizador não tem fonte de emoji embutida e ela pesaria megabytes.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
// @ts-expect-error — wrangler entrega o .wasm como WebAssembly.Module
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-expect-error — regra "Data" no wrangler.jsonc entrega .ttf como ArrayBuffer
import fonteRegular from "./assets/sans-regular.ttf";
// @ts-expect-error
import fonteBold from "./assets/sans-bold.ttf";

let wasmPronto = false;
async function garantirWasm(): Promise<void> {
  if (wasmPronto) return;
  await initWasm(resvgWasm as WebAssembly.Module);
  wasmPronto = true;
}

export interface GrupoCard {
  label: string;
  linhas: string[]; // linhas já formatadas (com "• ", emoji, "<i>" etc — a gente limpa aqui)
}

// ---- paleta (Haras Boutique) ----
const C = {
  ground: "#F7F5EF",
  ink: "#1E2A22",
  muted: "#6B7A6E",
  green: "#1F3D2E",
  headText: "#F3EEDF",
  gold: "#C99A46",
  alert: "#A6432F",
  line: "#E4DECE",
};

const W = 820;
const PAD = 36;
const HEADER_H = 78;

const RE_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function limpar(raw: string): { texto: string; atrasado: boolean } {
  const atrasado = /⚠/.test(raw) || /atrasad/i.test(raw);
  const texto = raw
    .replace(/<\/?i>/g, "")
    .replace(RE_EMOJI, "")
    .replace(/^[\s•·\-–—]+/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*·\s*atrasad[oa]/i, "")
    .trim();
  return { texto, atrasado };
}

// quebra grosseira por nº de caracteres (Roboto 15px ~ 7.3px/char; trilho ~ 720px ~ 96 chars)
function quebrar(texto: string, max = 96, maxLinhas = 2): string[] {
  if (texto.length <= max) return [texto];
  const palavras = texto.split(" ");
  const linhas: string[] = [];
  let atual = "";
  for (let i = 0; i < palavras.length; i++) {
    const cand = atual ? atual + " " + palavras[i] : palavras[i];
    if (cand.length > max && atual) {
      linhas.push(atual);
      atual = palavras[i];
      if (linhas.length === maxLinhas - 1) {
        atual = palavras.slice(i).join(" ");
        break;
      }
    } else {
      atual = cand;
    }
  }
  if (atual) linhas.push(atual);
  if (linhas.length > maxLinhas) linhas.length = maxLinhas;
  const ult = linhas[linhas.length - 1];
  if (ult && ult.length > max) linhas[linhas.length - 1] = ult.slice(0, max - 1).trimEnd() + "…";
  return linhas;
}

function montarSvg(titulo: string, dataBR: string, grupos: GrupoCard[]): string {
  const uteis = grupos.filter((g) => g.linhas && g.linhas.length);
  const partes: string[] = [];
  let y = HEADER_H + PAD;

  if (uteis.length === 0) {
    partes.push(
      `<text x="${PAD}" y="${y + 4}" font-size="17" fill="${C.muted}">Nada pendente. ✓</text>`,
    );
    y += 30;
  }

  for (const g of uteis) {
    y += 4;
    partes.push(
      `<text x="${PAD}" y="${y}" font-size="12.5" font-weight="700" letter-spacing="1.4" fill="${C.gold}">${esc(g.label.toUpperCase())}</text>`,
      `<line x1="${PAD + g.label.length * 8.6 + 14}" y1="${y - 4}" x2="${W - PAD}" y2="${y - 4}" stroke="${C.line}" stroke-width="1"/>`,
    );
    y += 22;
    for (const raw of g.linhas) {
      const { texto, atrasado } = limpar(raw);
      const linhasTxt = quebrar(texto);
      const cor = atrasado ? C.alert : C.ink;
      // marcador
      if (atrasado) partes.push(`<rect x="${PAD}" y="${y - 10}" width="8" height="8" rx="1.5" fill="${C.alert}"/>`);
      else partes.push(`<circle cx="${PAD + 4}" cy="${y - 6}" r="2.6" fill="${C.muted}"/>`);
      linhasTxt.forEach((lt, i) => {
        partes.push(
          `<text x="${PAD + 20}" y="${y}" font-size="15" fill="${i === 0 ? cor : C.muted}"${atrasado && i === 0 ? ' font-weight="600"' : ""}>${esc(lt)}</text>`,
        );
        y += 22;
      });
      y += 2;
    }
    y += 16;
  }

  const H = Math.max(HEADER_H + 90, y + PAD - 16);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Roboto, sans-serif">
  <rect width="${W}" height="${H}" fill="${C.ground}"/>
  <rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="${C.green}"/>
  <text x="${PAD}" y="47" font-size="24" font-weight="700" fill="${C.headText}">${esc(titulo)}</text>
  <text x="${W - PAD}" y="47" font-size="14" letter-spacing="1" text-anchor="end" fill="${C.gold}">${esc(dataBR)}</text>
  <rect x="0" y="${H - 5}" width="${W}" height="5" fill="${C.green}"/>
  ${partes.join("\n  ")}
</svg>`;
}

/** Monta o SVG e devolve o PNG. Pode lançar — quem chama trata com fallback pro texto. */
export async function renderCardPng(
  titulo: string,
  dataBR: string,
  grupos: GrupoCard[],
): Promise<Uint8Array> {
  await garantirWasm();
  const svg = montarSvg(titulo, dataBR, grupos);
  const r = new Resvg(svg, {
    background: C.ground,
    font: {
      fontBuffers: [new Uint8Array(fonteRegular as ArrayBuffer), new Uint8Array(fonteBold as ArrayBuffer)],
      defaultFontFamily: "Roboto",
      loadSystemFonts: false,
    },
    fitTo: { mode: "width", value: W * 2 }, // 2x pra ficar nítido no celular
  });
  return r.render().asPng();
}
