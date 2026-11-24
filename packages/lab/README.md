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
