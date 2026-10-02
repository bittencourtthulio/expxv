// Mini parser de XML para as saídas `--xml` do svn (sem dependências). Tolerante: XML truncado (saída
// cortada pelo teto de bytes) fecha os nós abertos em vez de lançar.

export interface NoXml {
  nome: string;
  attrs: Record<string, string>;
  filhos: NoXml[];
  texto: string;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function desescapar(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): NoXml {
  const raiz: NoXml = { nome: "#raiz", attrs: {}, filhos: [], texto: "" };
  const pilha: NoXml[] = [raiz];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(xml)) !== null) {
    const topo = pilha[pilha.length - 1] as NoXml;
    if (m[1] !== undefined) topo.texto += m[1];
    else if (m[2] !== undefined) {
      // fecha até o nó de mesmo nome (tolerante a desbalanceamento)
      for (let i = pilha.length - 1; i > 0; i--) {
        if ((pilha[i] as NoXml).nome === m[2]) {
          pilha.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const no: NoXml = { nome: m[3], attrs: {}, filhos: [], texto: "" };
      if (m[4]) {
        ATTR.lastIndex = 0;
        let a: RegExpExecArray | null;
        while ((a = ATTR.exec(m[4])) !== null) no.attrs[a[1] as string] = desescapar((a[2] ?? a[3]) as string);
      }
      topo.filhos.push(no);
      if (m[5] !== "/") pilha.push(no);
    } else if (m[6] !== undefined) {
      topo.texto += desescapar(m[6]);
    }
  }
  return raiz;
}

export const filho = (n: NoXml | undefined, nome: string): NoXml | undefined => n?.filhos.find((f) => f.nome === nome);
export const filhosDe = (n: NoXml | undefined, nome: string): NoXml[] => (n === undefined ? [] : n.filhos.filter((f) => f.nome === nome));
export const textoDe = (n: NoXml | undefined, nome: string): string | null => {
  const f = filho(n, nome);
  return f === undefined ? null : f.texto;
};
/** Primeiro nó com esse nome na raiz do documento (ex.: `info`, `status`, `log`). */
export const documento = (xml: string, nome: string): NoXml | undefined => filho(parseXml(xml), nome);
