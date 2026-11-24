# lab

O lab é a sala dos agentes da Orbi, feita dentro de um fork do omp. Cada **time** é uma pasta de projeto, e cada **chat** de um time é um omp do próprio fork trabalhando nela. A página mostra a sala pixel (uma mesa por time e um boneco por chat), o quadro de tarefas, os chats e a voz. A Carly, do Tern, organiza os agentes por um plugin.

## Rodar

```sh
lab                 # liga o servidor e abre http://127.0.0.1:4321 (ou só abre, se já estiver ligado)
lab --no-abrir      # só o servidor
lab --port 4400     # outra porta (ocupada: usa a próxima livre)
```

O estado fica em `~/.lab/` (`LAB_CASA` troca a pasta). Lá ficam `estado.json` (times e chats) e `servidor.json` (o servidor ligado). Fechar o lab encerra os omp dos chats; ao abrir o chat de novo, a conversa continua de onde parou (`--resume`).

Do código, sem o comando global: `bun packages/lab/src/cli.ts`. Para instalar o comando `lab`, rode `bun link` dentro de `packages/lab`.

## Carly

O plugin do Tern fica em [`tern-plugin/`](tern-plugin/README.md): `tern plugin link packages/lab/tern-plugin`. Com ele, a Carly vê os times e os chats, abre um chat com o seu pedido ou aproveita um chat livre, espera o resultado e responde as perguntas dos agentes. As mensagens dela aparecem no chat com o nome dela.

## Celular e outras pessoas

O servidor só escuta em `127.0.0.1`. Para entrar pelo celular, ou para outra pessoa da Orbi entrar, use o Tailscale: `tailscale serve --bg 4321` publica o lab em HTTPS na sua rede (o microfone do navegador exige HTTPS). Cada pedido que chega pelo Tailscale diz quem é a pessoa, e as mensagens dela aparecem com o nome e a foto dela. Quem não está na sua rede do Tailscale não chega ao lab.

## Fork

O `main` deste repositório fica sobre a última tag lançada do upstream ([can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)), não sobre o main dele. Cada tag tem a parte nativa (Rust) pronta no npm, e por isso o fork roda do código sem compilar Rust. Para trazer uma versão nova:

```sh
git fetch upstream --tags
git merge v19.2.0          # a tag nova
bun install
bun packages/lab/scripts/nativos.ts   # baixa o addon nativo da mesma versão
bun packages/coding-agent/src/cli.ts --smoke-test
```

As mudanças do fork fora de `packages/lab` são poucas, de propósito:

- O `prompt`, o `steer` e o `follow_up` do RPC aceitam `from`. A mensagem chega como a de um convidado do `/collab`, e o modelo sabe quem falou.
- O `Transcript` do collab-web aceita rótulos (`TranscriptLabelsContext`), para os rostos e os textos em português.
