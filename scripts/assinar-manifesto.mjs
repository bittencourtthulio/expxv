#!/usr/bin/env node
// `npm run assinar:manifesto -- --manifesto pasta/stable/manifesto.json [--chave arquivo-fora-do-repo] [--publicas k1,k2] [--exigir]`
// Assina com Ed25519 (destacada: manifesto.json.sig). A chave vem da variável do CI (nome derivado de produto.ts) ou de arquivo FORA do repositório.
// SEM chave: o manifesto é regravado marcado `nao_assinado: true`, nenhuma .sig é escrita e o app o RECUSA (D-348); com --exigir, sai com erro.
// Confere a própria assinatura com as chaves públicas aceitas (build/distribuicao.json ou --publicas). A chave privada nunca é impressa nem gravada.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assinarBytes, carregarChave, nomeDaVariavelDaChave, publicaBase64, verificarComPublicas } from "./lib/manifesto.mjs";

function args(argv) {
  const o = { exigir: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--exigir") o.exigir = true;
    else if (a.startsWith("--")) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`falta valor para ${a}`);
      o[a.slice(2)] = v;
    } else throw new Error(`argumento inesperado: ${a.slice(0, 30)}`);
  }
  return o;
}

try {
  const o = args(process.argv.slice(2));
  if (!o.manifesto) throw new Error("uso: --manifesto caminho/manifesto.json");
  const caminho = resolve(o.manifesto);
  const sig = `${caminho}.sig`;
  const carregada = carregarChave({ arquivo: o.chave });
  if (carregada === null) {
    const m = JSON.parse(readFileSync(caminho, "utf8"));
    writeFileSync(caminho, JSON.stringify({ ...m, nao_assinado: true }));
    if (existsSync(sig)) rmSync(sig);
    console.error(`sem chave de assinatura (variável ${nomeDaVariavelDaChave()} ou --chave): manifesto marcado nao_assinado; o app o recusa.`);
    process.exit(o.exigir ? 1 : 0);
  }
  const bytes = readFileSync(caminho);
  const m = JSON.parse(bytes.toString("utf8"));
  if (m.nao_assinado === true) throw new Error("o manifesto está marcado nao_assinado: gere-o de novo antes de assinar");
  const assinatura = assinarBytes(bytes, carregada.chave);
  let publicas = o.publicas ? o.publicas.split(",").filter(Boolean) : null;
  if (publicas === null) {
    const dist = JSON.parse(readFileSync(resolve("build/distribuicao.json"), "utf8"));
    publicas = dist.atualizacao?.chaves_aceitas ?? [];
  }
  if (publicas.length === 0) throw new Error("nenhuma chave pública aceita (build/distribuicao.json vazio e sem --publicas): não dá para conferir a assinatura");
  if (!verificarComPublicas(bytes, assinatura, publicas)) throw new Error(`a chave de ${carregada.origem} não corresponde a nenhuma chave pública aceita pelo build (${publicaBase64(carregada.chave).slice(0, 8)}…)`);
  writeFileSync(sig, `${assinatura}\n`);
  console.log(`manifesto assinado com a chave de ${carregada.origem}; conferido contra as chaves públicas do build.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : "falha ao assinar o manifesto");
  process.exit(1);
}
