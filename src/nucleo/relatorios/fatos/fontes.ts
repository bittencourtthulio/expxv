// Texto canônico de cada fonte: é o universo contra o qual o verificador confere números/datas/SHAs de uma afirmação (regra V2).
import type { FatosSprint } from "../../../compartilhado/relatorios";
import { itemEntregue } from "./coletar";

const tipoCorrecao = (i: FatosSprint["itens"][number]): boolean => i.changelog_tipo === "fixed" || (i.changelog_tipo === null && i.categoria === "bug");
/** contagens agregadas da sprint (fonte `sprint:` e `metrica:`): o verificador aceita estes números em afirmações que as citam. */
export function agregados(f: FatosSprint): Record<string, number> {
  const entregues = f.itens.filter(itemEntregue);
  const visiveis = entregues.filter((i) => i.visivel_cliente);
  return {
    itens_total: f.itens.length,
    itens_entregues: entregues.length,
    visiveis: visiveis.length,
    novidades: visiveis.filter((i) => !tipoCorrecao(i)).length,
    correcoes: visiveis.filter(tipoCorrecao).length,
    carregados: f.itens.filter((i) => i.resultado === "carregado").length,
    commits: f.commits.length,
    prs: f.prs.length,
    modulos: f.mapa?.modulos.length ?? 0,
    risco_alto: f.itens.filter((i) => i.risco === "alto" || i.risco === "critico").length,
  };
}
export { tipoCorrecao };

export function textoDaFonte(f: FatosSprint, id: string): string | null {
  const [tipo, resto = ""] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  switch (tipo) {
    case "item": { const i = f.itens.find((x) => x.item_id === resto); return i ? JSON.stringify(i) : null; }
    case "commit": { const c = f.commits.find((x) => x.sha7 === resto); return c ? JSON.stringify(c) : null; }
    case "pr": { const p = f.prs.filter((x) => x.trabalho_id === resto); return p.length > 0 ? JSON.stringify(p) : null; }
    case "sprint": return resto === f.sprint.id ? JSON.stringify({ ...f.sprint, agregados: agregados(f) }) : null;
    case "metrica": return resto.startsWith(`${f.sprint.id}/`) ? JSON.stringify({ metricas: f.metricas, agregados: agregados(f) }) : null;
    case "custo": return resto === f.sprint.id ? JSON.stringify(f.custo) : null;
    case "mapa": return f.mapa ? JSON.stringify(f.mapa) : null;
    default: return null;
  }
}
export const fonteExiste = (f: FatosSprint, id: string): boolean => textoDaFonte(f, id) !== null;
