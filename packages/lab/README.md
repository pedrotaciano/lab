# lab

O lab é a sala dos agentes da Orbi, feita dentro de um fork do omp. Cada **time** é uma pasta de projeto, e cada **chat** de um time é um omp do próprio fork trabalhando nela. A página mostra a sala pixel (uma mesa por time e um boneco por chat), o quadro de tarefas, os chats e a voz. A Carly, do Tern, organiza os agentes por um plugin.

## Rodar

```sh
lab                 # liga o servidor e abre http://127.0.0.1:4300 (ou só abre, se já estiver ligado)
lab --no-abrir      # só o servidor
lab --port 4400     # outra porta (ocupada: usa a próxima livre)
```

O estado fica em `~/.lab/` (`LAB_CASA` troca a pasta). Lá ficam `estado.json` (times e chats) e `servidor.json` (o servidor ligado). Fechar o lab encerra os omp dos chats; ao abrir o chat de novo, a conversa continua de onde parou (`--resume`).

Do código, sem o comando global: `bun packages/lab/src/cli.ts`. Para instalar o comando `lab`, rode `bun link` dentro de `packages/lab`.

## Laboratórios

Cada **laboratório** é um `lab` separado, com a casa, os omp e a máquina dele: nada se mistura. O lab que você abre (o de `~/.lab`, "Mac") é a entrada dos outros, listados em `~/.lab/laboratorios.json`:

```json
[
	{ "id": "sinco", "nome": "Sinco", "tipo": "local", "casa": "~/.lab-sinco", "porta": 4301 },
	{ "id": "ec2", "nome": "EC2", "tipo": "ssh", "host": "pedro@10.2.69.148", "chave": "~/.ssh/orbi-workstation", "portaRemota": 4300 }
]
```

- **`local`**: outro lab nesta máquina. O de entrada usa o que já está ligado (o pid de `<casa>/servidor.json`); senão liga um (`LAB_CASA=<casa> lab --port <porta> --no-abrir`, log em `<casa>/lab.log`) como processo próprio: ele continua ligado quando o de entrada reinicia, e ninguém o desliga. Se você o desligar, ele fica fora do ar até **Tentar de novo** ou o lab de entrada subir de novo.
- **`ssh`**: um lab em outra máquina, ouvindo em `127.0.0.1` lá. O de entrada lê a porta de verdade do `servidor.json` remoto (`casa`, padrão `~/.lab`; `portaRemota` só se não der) e mantém um túnel `ssh -N -L`, filho dele, que volta sozinho quando cai (espera de 1 s a 30 s) e fecha junto com ele.
- `maquina` (opcional) é o rótulo da máquina na lista: a desta máquina para os locais (`mac` no macOS), o `id` para os por ssh.

Sem o arquivo, o lab é um só, como sempre. Com ele, a página de cada laboratório é `/l/<id>/` (o de entrada é `/`), o mesmo código: o seletor no alto da coluna dos times (no celular, em cima da Sala e dos Times) troca tudo, e o endereço guarda a escolha. O lab de entrada passa adiante só os dados, `/l/<id>/api/*` e o WebSocket `/l/<id>/ws`, e lê o `/api/estado` de cada um a cada 3 s para a lista (`GET /api/laboratorios`, e o quadro `{t:"laboratorios"}` no WebSocket). Um laboratório fora do ar mostra os últimos times que este navegador viu, apagados, e **Tentar de novo** (`POST /api/laboratorios/<id>/tentar`) liga o lab ou reabre o túnel na hora.

Quem é você passa adiante pelos mesmos cabeçalhos que o lab já aceita só de `127.0.0.1` (`Tailscale-User-*`, `X-Lab-Autor: carly`); o dono do lab de entrada vai como `X-Lab-Autor: dono`, e é o dono no outro lab também.

## Caixa de prompt

O texto em cima; embaixo, o clipe e o quadro, e à direita Parar, o microfone e Enviar. **Enter** envia, **Shift+Enter** quebra a linha e **↑** na caixa vazia traz de volta o que você mandou.

- **Esforço e modelo:** no pé da caixa, num poço, como a linha de status do omp. O esforço sobe um nível por clique (ou **Ctrl+Shift+E**): padrão → baixo → médio → alto → máximo → padrão. Os quatro pixels esquentam do cinza ao laranja; no máximo, a caixa pega fogo (parado, com movimento reduzido). O nome do modelo abre a lista do omp (o Alt+P) com busca: ↑/↓, Enter usa, ←/→ mudam o esforço, Esc fecha. A escolha é do chat e fica na sessão do omp: ao retomar o chat, volta a mesma.
- **Contexto e Compactar:** cinco pixels mostram quanto da janela do modelo a conversa ocupa; a partir de 80% ficam laranja com a porcentagem. O clique mostra os tokens, o custo da sessão, a última compactação e **Compactar agora**, com "O que manter" para o resumo não perder. Só com o chat parado.
- **Arquivos:** pelo clipe, colando (Cmd+V) ou soltando no chat; até 10 por mensagem, 25 MB cada. Cada um sobe na hora para `~/.lab/anexos/<chat>/` e vai com a próxima mensagem: o modelo recebe o caminho de cada arquivo, e as imagens (PNG, JPEG, GIF, WebP até 5 MB) também como imagem.
- **Quadro:** um quadro de desenho estilo Excalidraw (V move, P caneta, R retângulo, O elipse, A seta, L linha, T texto, E borracha, ou 1–8; cinco cores, três espessuras, ⌘Z/⇧⌘Z). **Adicionar ao prompt** põe o desenho na caixa como um PNG. Fechar guarda o desenho para a próxima vez.
- **Microfone:** grava no navegador (no celular também, pelo HTTPS do Tailscale). Um clique grava e o segundo para; segurado (ou **Ctrl+M**), grava enquanto segura, e deslizar para a esquerda cancela. **Enter** ou **Revisar** param, **Esc** ou **Cancelar** descartam. O áudio vira um chip "transcrevendo…" e o texto entra no fim da caixa; enquanto isso a caixa fica livre.

A transcrição roda nesta máquina, sem rede: o `mlx-whisper` num Mac com Apple silicon e o `faster-whisper` nos outros, pelo `uvx --offline`, com o modelo do cache do Hugging Face. Precisa do [uv](https://docs.astral.sh/uv/), do ffmpeg (só no Mac) e de um modelo baixado uma vez, com internet:

```sh
brew install uv ffmpeg
uvx --from mlx-whisper mlx_whisper --model mlx-community/whisper-large-v3-turbo qualquer-audio.m4a
```

Fora do Mac: `uvx --python 3.12 --from faster-whisper python -c "from faster_whisper import WhisperModel; WhisperModel('Systran/faster-whisper-small', device='cpu', compute_type='int8')"`. `LAB_WHISPER=<repo do Hugging Face>` escolhe outro modelo já baixado. O modelo carrega quando você começa a gravar e sai da memória depois de 10 minutos sem uso. Sem isso, o microfone fica desligado e diz o que falta.

## Carly

O plugin do Tern fica em [`tern-plugin/`](tern-plugin/README.md): `tern plugin link packages/lab/tern-plugin`. Com ele, a Carly vê os times e os chats, abre um chat com o seu pedido ou aproveita um chat livre, espera o resultado e responde as perguntas dos agentes. As mensagens dela aparecem no chat com o nome dela.

## Celular e outras pessoas

O servidor só escuta em `127.0.0.1`. Para entrar pelo celular, ou para outra pessoa da Orbi entrar, use o Tailscale: `tailscale serve --bg 4300` publica o lab em HTTPS na sua rede (o microfone do navegador exige HTTPS). Cada pedido que chega pelo Tailscale diz quem é a pessoa, e as mensagens dela aparecem com o nome e a foto dela. Quem entra com a mesma conta do Tailscale deste Mac (o seu celular) é o dono, como no próprio Mac: o lab lê essa conta em `tailscale status --json`. Quem não está na sua rede do Tailscale não chega ao lab.

## Egregore

Um time cuja pasta é uma instância do [Egregore](https://github.com/egregore-labs/egregore) (tem `egregore.json` ou está em `~/.egregore/instances.json`) ganha a aba **Memória**: os handoffs, as decisões, as descobertas, os padrões, as perguntas, as quests, os wraps, as pessoas e a identidade do time, lidos de `memory/`, com o autor e a data do histórico git da memória. A página só lê. Sincronizar roda o sync do próprio Egregore (`bin/agent.sh sync`, o mesmo do `egregore runtime sync`).

Os chats desse time carregam a extensão do Egregore pelo [egregore-omp](https://github.com/pedrotaciano/egregore-omp): as ferramentas `egregore_*`, as instruções e o contexto do time a cada pedido. O cartão de boas-vindas do terminal não aparece no chat, porque o Egregore só o mostra com interface (`hasUI`), e o omp do lab roda sem ela (`--no-ui`).

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

## EC2

O laboratório **EC2** roda em `pedro@10.2.69.148` (Amazon Linux 2023, x86_64), separado do Mac: casa `~/.lab` de lá, código em `~/lab` (clone do `main`), escutando em `127.0.0.1:4300`. Usa um bun só dele, em `~/.lab-bun` (o `~/.local/bin/bun` e o `~/.local/bin/omp` da máquina são de outras coisas e ficam como estão), e o login do omp que já existe lá (`~/.omp`).

Instalação, uma vez:

```sh
curl -fsSL https://bun.sh/install | BUN_INSTALL=~/.lab-bun bash -s bun-v1.4.5
git clone https://github.com/pedrotaciano/lab ~/lab && cd ~/lab
~/.lab-bun/bin/bun install
~/.lab-bun/bin/bun packages/lab/scripts/nativos.ts   # pi_natives.linux-x64-{modern,baseline}.node
~/.lab-bun/bin/bun packages/coding-agent/src/cli.ts --smoke-test
```

Ele roda como serviço do usuário, `~/.config/systemd/user/lab.service` (`Restart=always`, `LAB_CASA=%h/.lab`, `bun packages/lab/src/cli.ts --no-abrir --port 4300`), habilitado com `systemctl --user enable --now lab`; o linger do usuário já está ligado, então ele sobe com a máquina e sobrevive ao logout.

```sh
systemctl --user status lab
journalctl --user -u lab -f          # logs
```

Para atualizar:

```sh
cd ~/lab && git pull
~/.lab-bun/bin/bun install
~/.lab-bun/bin/bun packages/lab/scripts/nativos.ts
systemctl --user restart lab
```

Do Mac, sem o registro de laboratórios: `ssh -i ~/.ssh/orbi-workstation -N -L 4302:127.0.0.1:4300 pedro@10.2.69.148` e abra `http://127.0.0.1:4302`.
