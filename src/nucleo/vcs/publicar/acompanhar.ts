// Acompanhamento (D-636): compara a "fotografia" local do repositório de antes do clique com a de agora, SEM polling novo (quem chama alimenta com os
// resumos que o observador do Versionamento já emite) e sem rede. O PR só é consultado (`gh`) uma vez, depois que o push foi detectado.

export interface Fotografia {
  branch: string | null;
  oid: string | null;
  a_frente: number;
  tem_upstream: boolean;
  alteradas: number;
}

export type Marco = { tipo: "commit"; oid: string; branch: string | null } | { tipo: "push"; oid: string | null; branch: string };

/**
 * O que mudou desde `antes`: commit novo (o HEAD andou) e/ou publicação (o branch passou a ter upstream em dia, tendo commits a enviar antes ou
 * tendo acabado de nascer). `ramoAlvo` = o branch que o diálogo pediu (criado pelo agente): só ele conta como "publicado" se mudou de branch.
 */
export function detectarMarcos(antes: Fotografia, agora: Fotografia, ramoAlvo: string | null = null): Marco[] {
  const marcos: Marco[] = [];
  const headAndou = agora.oid !== null && agora.oid !== antes.oid;
  if (headAndou) marcos.push({ tipo: "commit", oid: agora.oid as string, branch: agora.branch });
  if (agora.branch === null || !agora.tem_upstream || agora.a_frente !== 0) return marcos;
  const mesmoBranch = antes.branch === agora.branch;
  const alvoOk = ramoAlvo === null || ramoAlvo === agora.branch;
  const publicou = mesmoBranch ? headAndou || !antes.tem_upstream || antes.a_frente > 0 : alvoOk && (headAndou || ramoAlvo !== null);
  if (publicou) marcos.push({ tipo: "push", oid: agora.oid, branch: agora.branch });
  return marcos;
}

export function textoDoMarco(m: Marco, remoto = "origin"): string {
  if (m.tipo === "commit") return `Commit ${m.oid} criado${m.branch === null ? "" : ` em ${m.branch}`}.`;
  return `Commit ${m.oid ?? ""} enviado para ${remoto}/${m.branch}`.replace("  ", " ");
}
