// Servidor falso que lê o ambiente inteiro: a ferramenta `listar_ambiente` devolve os NOMES (nunca os
// valores) de process.env, para provar que o servidor só enxerga a allowlist e as variáveis declaradas.
import { iniciarServidor } from "./_base.mjs";
const ferramentas = [{ name: "listar_ambiente", description: "Lista os nomes das variáveis de ambiente.", inputSchema: { type: "object", properties: {} } }];
await iniciarServidor({ nome: "falso-eco-ambiente", ferramentas, chamar: () => JSON.stringify(Object.keys(process.env).sort()) });
