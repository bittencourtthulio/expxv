// Gera build/icon.icns (iconutil, só macOS), build/icon.ico e build/icone-N.png a partir da geometria
// de build/simbolo.svg. Rasterizador próprio em Node puro (supersampling), sem dependências.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const build = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
mkdirSync(build, { recursive: true });

const A = [0x82, 0x50, 0xdf];
const B = [0xe6, 0x5c, 0xa8];

// Geometria idêntica à do simbolo.svg (viewBox 1024): quadrado arredondado + anel em losango.
function amostra(x, y) {
  const R = 230;
  const dx = Math.max(R - x, 0, x - (1024 - R));
  const dy = Math.max(R - y, 0, y - (1024 - R));
  if (dx * dx + dy * dy > R * R) return null;
  const t = (x + y) / 2048;
  let cor = A.map((c, i) => c + (B[i] - c) * t);
  const l1 = Math.abs(x - 512) + Math.abs(y - 512);
  if (l1 <= 300 && l1 >= 200) cor = cor.map((c) => c + (255 - c) * 0.92);
  return cor;
}

function rasterizar(tam) {
  const ss = tam >= 512 ? 2 : 4;
  const px = Buffer.alloc(tam * tam * 4);
  const passo = 1024 / (tam * ss);
  for (let j = 0; j < tam; j++) {
    for (let i = 0; i < tam; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let v = 0; v < ss; v++) {
        for (let u = 0; u < ss; u++) {
          const c = amostra((i * ss + u + 0.5) * passo, (j * ss + v + 0.5) * passo);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = (j * tam + i) * 4;
      if (a > 0) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = (255 * a) / (ss * ss); }
    }
  }
  return png(tam, px);
}

const tabela = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const x of buf) c = tabela[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function bloco(tipo, dados) {
  const cab = Buffer.alloc(4);
  cab.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo), dados]);
  const fim = Buffer.alloc(4);
  fim.writeUInt32BE(crc(corpo));
  return Buffer.concat([cab, corpo, fim]);
}
function png(tam, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const linhas = Buffer.alloc((tam * 4 + 1) * tam);
  for (let j = 0; j < tam; j++) rgba.copy(linhas, j * (tam * 4 + 1) + 1, j * tam * 4, (j + 1) * tam * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr), bloco("IDAT", deflateSync(linhas)), bloco("IEND", Buffer.alloc(0)),
  ]);
}

const cache = new Map();
const obter = (t) => { if (!cache.has(t)) cache.set(t, rasterizar(t)); return cache.get(t); };

const tamanhos = [16, 32, 48, 64, 128, 256];
for (const t of tamanhos) writeFileSync(join(build, `icone-${t}.png`), obter(t));

// .ico com PNGs embutidos (Vista+)
const ico = [16, 32, 48, 64, 128, 256].map(obter);
const cab = Buffer.alloc(6);
cab.writeUInt16LE(1, 2);
cab.writeUInt16LE(ico.length, 4);
let deslocamento = 6 + 16 * ico.length;
const dir = ico.map((dados, i) => {
  const t = tamanhos[i];
  const e = Buffer.alloc(16);
  e[0] = t === 256 ? 0 : t; e[1] = t === 256 ? 0 : t;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(dados.length, 8); e.writeUInt32LE(deslocamento, 12);
  deslocamento += dados.length;
  return e;
});
writeFileSync(join(build, "icon.ico"), Buffer.concat([cab, ...dir, ...ico]));

if (process.platform === "darwin") {
  const iconset = join(build, "icon.iconset");
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });
  const pares = [
    [16, "icon_16x16"], [32, "icon_16x16@2x"], [32, "icon_32x32"], [64, "icon_32x32@2x"],
    [128, "icon_128x128"], [256, "icon_128x128@2x"], [256, "icon_256x256"], [512, "icon_256x256@2x"],
    [512, "icon_512x512"], [1024, "icon_512x512@2x"],
  ];
  for (const [t, nome] of pares) writeFileSync(join(iconset, `${nome}.png`), obter(t));
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(build, "icon.icns")]);
  rmSync(iconset, { recursive: true, force: true });
}
console.log("ícones gerados em build/");
