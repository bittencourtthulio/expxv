#!/usr/bin/env node
// `npm run gerar:manifesto -- --versao 1.2.0 --canal stable --artefato darwin:universal:caminho/App.dmg:stable/1.2.0/App.dmg [--artefato ...]
//   [--notas NOTAS.md] [--staging 100] [--valido-ate-dias 30] [--saida pasta]`
// Escreve <saida>/<canal>/manifesto.json (sem assinatura: use `npm run assinar:manifesto`). Só lê os artefatos; nada de rede.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { montarManifesto } from "./lib/manifesto.mjs";

function args(argv) {
  const o = { artefato: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`argumento inesperado: ${a.slice(0, 30)}`);
    const k = a.slice(2);
    const v = argv[++i];
    if (v === undefined) throw new Error(`falta valor para --${k}`);
    if (k === "artefato") o.artefato.push(v);
    else o[k] = v;
  }
  return o;
}

try {
  const o = args(process.argv.slice(2));
  if (!o.versao || !o.canal || o.artefato.length === 0) throw new Error("uso: --versao X.Y.Z --canal stable|beta --artefato plataforma:arquitetura:arquivo:url_relativa [...]");
  const artefatos = o.artefato.map((s) => {
    const [plataforma, arquitetura, arquivo, url_relativa] = s.split(":");
    if (!plataforma || !arquitetura || !arquivo || !url_relativa) throw new Error("--artefato precisa de plataforma:arquitetura:arquivo:url_relativa");
    return { plataforma, arquitetura, arquivo: resolve(arquivo), url_relativa };
  });
  const manifesto = await montarManifesto({
    versao: o.versao,
    canal: o.canal,
    artefatos,
    notas: o.notas ? readFileSync(resolve(o.notas), "utf8") : "",
    ...(o.staging !== undefined ? { staging: Number(o.staging) } : {}),
    ...(o["valido-ate-dias"] !== undefined ? { validoAteDias: Number(o["valido-ate-dias"]) } : {}),
  });
  const pasta = join(resolve(o.saida ?? "dist-manifesto"), o.canal);
  mkdirSync(pasta, { recursive: true });
  const destino = join(pasta, "manifesto.json");
  writeFileSync(destino, JSON.stringify(manifesto));
  console.log(`manifesto gerado (${manifesto.artefatos.length} artefato(s), versão ${manifesto.versao}, canal ${manifesto.canal}); falta assinar.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : "falha ao gerar o manifesto");
  process.exit(1);
}
