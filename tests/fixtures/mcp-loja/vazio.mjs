// Servidor falso saudável mas sem nenhuma ferramenta.
import { iniciarServidor } from "./_base.mjs";
await iniciarServidor({ nome: "falso-vazio", ferramentas: [] });
