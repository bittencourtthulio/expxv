// Parser mínimo de `[mcp_servers.<nome>]` do config.toml do Codex (T-07.08). Sem dependência de TOML. Só lê tabelas `mcp_servers` e
// SÓ as chaves `command`, `args`, `url`, `bearer_token_env_var`, `env`; o resto é ignorado. Valores de `env` NUNCA são guardados (só os nomes).
// Nunca lança: linha que não entende é ignorada.

export interface McpToml {
  nome: string;
  bruto: { command?: string; args?: string[]; url?: string; bearer_token_env_var?: string; env?: Record<string, string | true> };
}

function desfazerAspas(s: string): string | null {
  const t = s.trim();
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(t) ?? /^'([^']*)'$/.exec(t);
  return m === null ? null : (m[1] ?? "").replace(/\\(["\\])/g, "$1");
}

function separarLista(corpo: string): string[] {
  const itens: string[] = [];
  let atual = "";
  let aspas: string | null = null;
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i] as string;
    if (aspas !== null) {
      atual += c;
      if (c === "\\" && aspas === '"') atual += corpo[++i] ?? "";
      else if (c === aspas) aspas = null;
    } else if (c === '"' || c === "'") {
      aspas = c;
      atual += c;
    } else if (c === ",") {
      itens.push(atual);
      atual = "";
    } else atual += c;
  }
  if (atual.trim() !== "") itens.push(atual);
  return itens;
}

const RE_TABELA = /^mcp_servers\.(?:"([^"]{1,64})"|([A-Za-z0-9_-]{1,64}))(\.env)?$/;

function nomeDaTabela(cab: string): { servidor: string; env: boolean } | null {
  const m = RE_TABELA.exec(cab.trim());
  if (m === null) return null;
  return { servidor: (m[1] ?? m[2]) as string, env: m[3] !== undefined };
}

/** `valores: true` (só para a verificação sob demanda, em memória) guarda também os valores de `env`; o scanner usa o padrão (só nomes). */
export function lerMcpToml(texto: string, opcoes: { valores?: boolean } = {}): McpToml[] {
  const servidores = new Map<string, McpToml["bruto"]>();
  let atual: { servidor: string; env: boolean } | null = null;
  const linhas = texto.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const l = (linhas[i] as string).trim();
    if (l === "" || l.startsWith("#")) continue;
    const cab = /^\[([^[\]]+)\]\s*(?:#.*)?$/.exec(l);
    if (cab !== null) {
      atual = nomeDaTabela(cab[1] as string);
      if (atual !== null && !servidores.has(atual.servidor)) servidores.set(atual.servidor, {});
      continue;
    }
    if (l.startsWith("[[")) {
      atual = null;
      continue;
    }
    if (atual === null) continue;
    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(l);
    if (kv === null) continue;
    const chave = (kv[1] as string).replace(/^"|"$/g, "");
    let valor = kv[2] as string;
    // lista/tabela multilinha: junta até fechar
    const ab = valor.trim()[0];
    if (ab === "[" || ab === "{") {
      const fecha = ab === "[" ? "]" : "}";
      let guarda = 0;
      while (!valor.includes(fecha) && i + 1 < linhas.length && guarda++ < 200) valor += " " + (linhas[++i] as string).trim();
    }
    const bruto = servidores.get(atual.servidor) as McpToml["bruto"];
    if (atual.env) {
      if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(chave)) (bruto.env ??= {})[chave] = opcoes.valores === true ? (desfazerAspas(valor.replace(/\s+#.*$/, "").trim()) ?? "") : true;
      continue;
    }
    const v = valor.replace(/\s+#.*$/, "").trim();
    if (chave === "command") {
      const s = desfazerAspas(v);
      if (s !== null) bruto.command = s;
    } else if (chave === "url") {
      const s = desfazerAspas(v);
      if (s !== null) bruto.url = s;
    } else if (chave === "bearer_token_env_var") {
      const s = desfazerAspas(v);
      if (s !== null) bruto.bearer_token_env_var = s;
    } else if (chave === "args") {
      const m = /^\[(.*)\]$/s.exec(v);
      if (m !== null) bruto.args = separarLista(m[1] as string).map((x) => desfazerAspas(x) ?? "").slice(0, 200);
    } else if (chave === "env") {
      const m = /^\{(.*)\}$/s.exec(v);
      if (m !== null) {
        const ambiente: Record<string, string | true> = bruto.env ?? {};
        for (const par of separarLista(m[1] as string)) {
          const k = /^\s*([A-Za-z_][A-Za-z0-9_]{0,63}|"[A-Za-z_][A-Za-z0-9_]{0,63}")\s*=/.exec(par);
          if (k !== null) ambiente[(k[1] as string).replace(/"/g, "")] = opcoes.valores === true ? (desfazerAspas(par.slice(par.indexOf("=") + 1)) ?? "") : true;
        }
        bruto.env = ambiente;
      }
    }
  }
  return [...servidores.entries()].slice(0, 200).map(([nome, bruto]) => ({ nome, bruto }));
}
