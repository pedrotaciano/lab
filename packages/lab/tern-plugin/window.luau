-- Lab: a Carly como secretária do lab. Fala com o servidor do lab pela API HTTP
-- (contrato do pacote packages/lab), mantém um resumo do estado no contexto dela
-- e avisa por toast quando um chat passa a esperar você ou termina um turno.

local DESLIGADO = "o lab não está ligado: rode lab"
local PORTA_PADRAO = 4321
local POLL_MS = 3000
local POLL_MAX_MS = 30000
local PEDIDO_MS = 8000
local RESULTADO_MS = 110000
local CARENCIA_MS = 3000

-- Corta s em até n caracteres (UTF-8), com reticências.
local function cortar(s: string?, n: number): string?
	if s == nil then
		return nil
	end
	local limpo = string.gsub(s, "%s+", " ")
	limpo = string.gsub(limpo, "^ ", "")
	local len = utf8.len(limpo)
	if len == nil or len <= n then
		return limpo
	end
	local fim = utf8.offset(limpo, n)
	return string.sub(limpo, 1, (fim or n) - 1) .. "…"
end

local function casa(): string
	local c = tern.getenv("LAB_CASA")
	if c and c ~= "" then
		return c
	end
	return (tern.getenv("HOME") or "") .. "/.lab"
end

-- O servidor escreve <casa>/servidor.json com {pid, port, host, url} ao subir.
local function base(): string
	local caminho = casa() .. "/servidor.json"
	if tern.fs.exists(caminho) then
		local ok, texto = pcall(tern.fs.read, caminho, 64 * 1024)
		if ok then
			local ok2, info = pcall(tern.json.decode, texto)
			if ok2 and type(info) == "table" and type(info.port) == "number" then
				local host = if type(info.host) == "string" then info.host else "127.0.0.1"
				if host == "" or host == "0.0.0.0" or host == "::" then
					host = "127.0.0.1"
				end
				if string.find(host, ":", 1, true) then
					host = "[" .. host .. "]"
				end
				return string.format("http://%s:%d", host, info.port)
			end
		end
	end
	return "http://127.0.0.1:" .. PORTA_PADRAO
end

local function esc(s: string): string
	return (string.gsub(s, "[^%w%-%._~]", function(c)
		return string.format("%%%02X", string.byte(c))
	end))
end

type Resposta = (erro: string?, dados: any, cx: any) -> ()

local function pedir(metodo: string, caminho: string, corpo: any, cb: Resposta)
	-- X-Lab-Autor: o lab mostra no chat que quem falou foi a Carly.
	local opts: any = { method = metodo, timeout_ms = PEDIDO_MS, headers = { ["X-Lab-Autor"] = "carly" } }
	if corpo ~= nil then
		opts.headers["Content-Type"] = "application/json"
		opts.body = tern.json.encode(corpo)
	end
	tern.fetch(base() .. caminho, opts, function(r, cx)
		if r.error then
			cb(if r.timed_out then "o lab não respondeu a tempo" else DESLIGADO, nil, cx)
			return
		end
		local dados = nil
		if r.body ~= "" then
			local ok, v = pcall(tern.json.decode, r.body)
			if ok then
				dados = v
			end
		end
		if r.status >= 300 then
			local msg = if type(dados) == "table" and type(dados.erro) == "string"
				then dados.erro
				else "HTTP " .. tostring(r.status)
			cb("lab: " .. msg, nil, cx)
			return
		end
		cb(nil, dados, cx)
	end)
end

local function texto_obrigatorio(nome: string, v: any): string
	if type(v) ~= "string" or string.match(v, "^%s*$") then
		error(nome .. " precisa ser um texto não vazio", 0)
	end
	return v
end

local function nome_time(estado: any, time_id: string): string
	for _, t in estado.times or {} do
		if t.id == time_id then
			return t.nome
		end
	end
	return "?"
end

local function achar_chat(estado: any, id: string): any
	for _, c in estado.chats or {} do
		if c.id == id then
			return c
		end
	end
	return nil
end

local function resumir_chat(c: any): any
	return {
		id = c.id,
		nome = c.nome,
		papel = c.papel,
		status = c.status,
		atividade = c.atividade,
		todo = c.todo,
		pergunta = c.pergunta,
		ultimaResposta = cortar(c.ultimaResposta, 160),
		erro = c.erro,
	}
end

local function resumir_estado(estado: any): any
	local times = tern.json.array()
	local por_time = {}
	for _, t in estado.times or {} do
		local item = { id = t.id, nome = t.nome, pasta = t.pasta, chats = tern.json.array() }
		por_time[t.id] = item
		table.insert(times, item)
	end
	for _, c in estado.chats or {} do
		local item = por_time[c.timeId]
		if item then
			table.insert(item.chats, resumir_chat(c))
		end
	end
	return times
end

-- Uma linha para o contexto da Carly (até 400 caracteres).
local function linha_de(estado: any): string
	local times = estado.times or {}
	local chats = estado.chats or {}
	local partes = { string.format("lab: %d %s", #times, if #times == 1 then "time" else "times") }
	if #chats == 0 then
		table.insert(partes, "nenhum chat")
		return table.concat(partes, " · ")
	end
	local trabalhando, esperando, erro = {}, {}, 0
	for _, c in chats do
		if c.status == "trabalhando" then
			table.insert(trabalhando, c)
		elseif c.status == "esperando" then
			table.insert(esperando, c)
		elseif c.status == "erro" then
			erro += 1
		end
	end
	table.insert(partes, string.format("%d %s", #chats, if #chats == 1 then "chat" else "chats"))
	if #trabalhando > 0 then
		local quem = {}
		for i, c in trabalhando do
			if i > 3 then
				break
			end
			local a = cortar(c.atividade, 40)
			table.insert(quem, c.nome .. " em #" .. nome_time(estado, c.timeId) .. (if a then ": " .. a else ""))
		end
		table.insert(partes, string.format("%d trabalhando (%s)", #trabalhando, table.concat(quem, "; ")))
	end
	if #esperando > 0 then
		local c = esperando[1]
		local p = if c.pergunta then cortar(c.pergunta.titulo, 80) else nil
		table.insert(
			partes,
			string.format(
				"%d esperando você (%s em #%s%s)",
				#esperando,
				c.nome,
				nome_time(estado, c.timeId),
				if p then ": " .. p else ""
			)
		)
	end
	if erro > 0 then
		table.insert(partes, string.format("%d com erro", erro))
	end
	return cortar(table.concat(partes, " · "), 400) :: string
end

local linha: string? = nil
local anteriores: { [string]: string }? = nil

local function toast(cx: any, nivel: string, texto: string, sub: string?)
	if cx then
		pcall(function()
			cx:toast(nivel, texto, sub)
		end)
	end
end

-- Atualiza o resumo e avisa das transições desde a última leitura.
local function observar(estado: any, cx: any)
	linha = linha_de(estado)
	local agora: { [string]: string } = {}
	for _, c in estado.chats or {} do
		agora[c.id] = c.status
		local antes = if anteriores then anteriores[c.id] else nil
		if anteriores and antes ~= c.status then
			local time = " em #" .. nome_time(estado, c.timeId)
			if c.status == "esperando" then
				toast(cx, "info", c.nome .. " espera você" .. time, if c.pergunta then cortar(c.pergunta.titulo, 100) else nil)
			elseif antes == "trabalhando" and c.status == "livre" then
				toast(cx, "success", c.nome .. " terminou" .. time, cortar(c.ultimaResposta, 100))
			end
		end
	end
	anteriores = agora
end

local intervalo = POLL_MS

local function poll(_cx: any)
	pedir("GET", "/api/estado", nil, function(err, dados, cx)
		if err then
			linha = if err == DESLIGADO then "lab: desligado (rode lab)" else err
			anteriores = nil
			intervalo = math.min(intervalo * 2, POLL_MAX_MS)
		else
			observar(dados, cx)
			intervalo = POLL_MS
		end
		tern.timer(intervalo, poll)
	end)
end

tern.timer(0, poll)

tern.carly.context(function(_cx)
	return linha
end)

-- Pede o estado e entrega à continuação; falhas viram call:fail.
local function com_estado(call: any, seguir: (estado: any, cx: any) -> ())
	pedir("GET", "/api/estado", nil, function(err, dados, cx)
		if call.cancelled then
			return
		end
		if err then
			call:fail(err)
			return
		end
		observar(dados, cx)
		-- Um erro aqui deixaria a Carly esperando até o fim do call:wait.
		local ok, falha = pcall(seguir, dados, cx)
		if not ok then
			call:fail(tostring(falha))
		end
	end)
end

-- Responde a call com o corpo da resposta (ou `padrao` se vier vazio).
local function responder_com(call: any, padrao: any): Resposta
	return function(err, dados, _cx)
		if err then
			call:fail(err)
		elseif dados == nil then
			call:reply(padrao)
		else
			call:reply(dados)
		end
	end
end

local function nomes_times(times: any): string
	local nomes = {}
	for _, t in times do
		table.insert(nomes, t.nome .. " (" .. t.pasta .. ")")
	end
	return table.concat(nomes, ", ")
end

local function achar_time(times: any, chave: string?): (any, string?)
	if chave == nil or string.match(chave, "^%s*$") then
		if #times == 1 then
			return times[1], nil
		end
		if #times == 0 then
			return nil, "não há times: crie um com criar_time(nome, pasta)"
		end
		return nil, "diga o time; há " .. nomes_times(times)
	end
	for _, t in times do
		if t.id == chave then
			return t, nil
		end
	end
	local k = string.lower((string.gsub(chave, "^%s*#?", "")))
	k = string.gsub(k, "%s+$", "")
	for _, t in times do
		if string.lower(t.nome) == k then
			return t, nil
		end
	end
	local achados = {}
	for _, t in times do
		if string.find(string.lower(t.nome), k, 1, true) or string.find(string.lower(t.pasta), k, 1, true) then
			table.insert(achados, t)
		end
	end
	if #achados == 1 then
		return achados[1], nil
	end
	if #achados > 1 then
		return nil, "mais de um time bate com \"" .. chave .. "\": " .. nomes_times(achados)
	end
	if #times == 0 then
		return nil, "não há times: crie um com criar_time(nome, pasta)"
	end
	return nil, "nenhum time bate com \"" .. chave .. "\"; há " .. nomes_times(times)
end

tern.carly.export("estado", {
	sig = "() -> {resumo: string, times: {{id: string, nome: string, pasta: string, chats: {{id: string, nome: string, papel: string?, status: \"parado\"|\"livre\"|\"trabalhando\"|\"esperando\"|\"erro\", atividade: string?, todo: {feitas: number, total: number, atual: string?}?, pergunta: {reqId: string, titulo: string}?, ultimaResposta: string?, erro: string?}}}}}",
	doc = "Lê o lab: cada time (um projeto = uma pasta) com seus chats (cada chat é um agente omp) e o status de cada um. Chame antes de delegar: se o time já tem um chat livre ou parado que serve, use mandar(chat_id, texto) nele em vez de abrir outro. Um chat esperando tem uma pergunta pendente: leia a pergunta, decida com o usuário e use responder. ultimaResposta vem cortada; chat(id) traz a resposta inteira. Falha com \"o lab não está ligado: rode lab\" se o servidor estiver desligado.",
}, function(cx, call)
	com_estado(call, function(estado)
		call:reply({ resumo = linha_de(estado), times = resumir_estado(estado) })
	end)
	return call:wait(PEDIDO_MS + 2000)
end)

tern.carly.export("chat", {
	sig = "(chat_id: string) -> {time: string, chat: ResumoChat, resposta: string?}",
	doc = "Um chat inteiro: o ResumoChat completo (status, atividade, todo, pergunta pendente, modelo, erro) mais o nome do time e o texto completo da última resposta final do agente. Use para trazer o resultado de um trabalho ao usuário.",
}, function(chat_id, cx, call)
	local id = texto_obrigatorio("chat_id", chat_id)
	com_estado(call, function(estado)
		local c = achar_chat(estado, id)
		if not c then
			call:fail("não há chat " .. id .. " no lab")
			return
		end
		pedir("GET", "/api/chats/" .. esc(id) .. "/ultima", nil, function(err, u)
			if err then
				call:fail(err)
				return
			end
			call:reply({ time = nome_time(estado, c.timeId), chat = c, resposta = if type(u) == "table" then u.texto else nil })
		end)
	end)
	return call:wait(2 * PEDIDO_MS + 2000)
end)

tern.carly.export("mandar", {
	sig = "(chat_id: string, texto: string) -> {ok: boolean}",
	doc = "Manda uma mensagem a um chat que já existe, como se fosse o usuário. Se o chat estiver trabalhando, a mensagem entra como continuação do turno. Prefira isto a abrir quando o time já tem um chat livre que conhece o assunto. Para saber o resultado, chame resultado(chat_id) em seguida.",
}, function(chat_id, texto, cx, call)
	local id = texto_obrigatorio("chat_id", chat_id)
	local t = texto_obrigatorio("texto", texto)
	pedir("POST", "/api/chats/" .. esc(id) .. "/mensagem", { texto = t }, responder_com(call, { ok = true }))
	return call:wait(PEDIDO_MS + 2000)
end)

tern.carly.export("abrir", {
	sig = "(time_id_ou_nome: string?, texto: string, papel: string?) -> ResumoChat",
	doc = "O jeito padrão de passar um trabalho a um agente: abre um chat novo no time e já manda texto como primeira mensagem. time_id_ou_nome aceita o id, o nome do time ou um trecho do nome ou da pasta; com nil ou \"\" usa o único time, se só houver um. Escolha o time pelo projeto que o pedido cita. papel (opcional) é a função do agente, ex. \"revisor\". Escreva texto como um pedido completo e autossuficiente. Devolve o chat criado (com o nome sorteado do agente); depois use resultado(id) para esperar a resposta.",
}, function(time_id_ou_nome, texto, papel, cx, call)
	local t = texto_obrigatorio("texto", texto)
	-- nil vindo da Carly chega como tern.json.null.
	if time_id_ou_nome == tern.json.null then
		time_id_ou_nome = nil
	end
	if papel == tern.json.null then
		papel = nil
	end
	if time_id_ou_nome ~= nil and type(time_id_ou_nome) ~= "string" then
		error("time_id_ou_nome precisa ser um texto", 0)
	end
	if papel ~= nil and type(papel) ~= "string" then
		error("papel precisa ser um texto", 0)
	end
	com_estado(call, function(estado)
		local time, err = achar_time(estado.times or {}, time_id_ou_nome)
		if not time then
			call:fail(err or "time não encontrado")
			return
		end
		local corpo: any = { timeId = time.id, mensagem = t }
		if papel and papel ~= "" then
			corpo.papel = papel
		end
		pedir("POST", "/api/chats", corpo, responder_com(call, nil))
	end)
	return call:wait(2 * PEDIDO_MS + 2000)
end)

tern.carly.export("resultado", {
	sig = "(chat_id: string) -> {pronto: boolean, status: string, chat: ResumoChat, resposta: string?}",
	doc = "Espera até ~110 s o chat sair de trabalhando e devolve a resposta final completa. Use logo depois de abrir ou mandar quando o trabalho for curto, para responder ao usuário na mesma conversa (\"pronto, a rosa fez X\"). pronto=false com status trabalhando: ainda não acabou; diga que um toast avisa quando terminar, sem ficar chamando de novo. status esperando: o agente fez uma pergunta (chat.pergunta); leve ao usuário e use responder.",
}, function(chat_id, cx, call)
	local id = texto_obrigatorio("chat_id", chat_id)
	local inicio = tern.now()
	local viu_trabalhando = false
	local function checar(_cx: any)
		if call.cancelled then
			return
		end
		com_estado(call, function(estado)
			local c = achar_chat(estado, id)
			if not c then
				call:fail("não há chat " .. id .. " no lab")
				return
			end
			local passou = tern.now() - inicio
			if c.status == "trabalhando" then
				viu_trabalhando = true
			end
			-- Logo depois de mandar, o turno pode ainda não ter começado.
			local acabou = c.status ~= "trabalhando"
				and (viu_trabalhando or c.status ~= "livre" or passou >= CARENCIA_MS)
			if acabou then
				pedir("GET", "/api/chats/" .. esc(id) .. "/ultima", nil, function(err, u)
					if err then
						call:fail(err)
						return
					end
					call:reply({
						pronto = c.status == "livre" or c.status == "parado",
						status = c.status,
						chat = c,
						resposta = if type(u) == "table" then u.texto else nil,
					})
				end)
			elseif passou >= RESULTADO_MS then
				call:reply({ pronto = false, status = c.status, chat = c })
			else
				tern.timer(1500, checar)
			end
		end)
	end
	checar(nil)
	return call:wait(RESULTADO_MS + 2 * PEDIDO_MS)
end)

tern.carly.export("parar", {
	sig = "(chat_id: string) -> {ok: boolean}",
	doc = "Interrompe o turno em curso do chat (abort). O chat continua aberto e pode receber outra mensagem.",
}, function(chat_id, cx, call)
	local id = texto_obrigatorio("chat_id", chat_id)
	pedir("POST", "/api/chats/" .. esc(id) .. "/parar", nil, responder_com(call, { ok = true }))
	return call:wait(PEDIDO_MS + 2000)
end)

tern.carly.export("responder", {
	sig = "(chat_id: string, req_id: string, valor: any) -> {ok: boolean}",
	doc = "Responde a pergunta pendente de um chat que está esperando: req_id é chat.pergunta.reqId (de estado ou chat) e valor é a resposta (texto, a opção escolhida ou o objeto que o formulário pede). Só responda com o que o usuário decidiu.",
}, function(chat_id, req_id, valor, cx, call)
	local id = texto_obrigatorio("chat_id", chat_id)
	local req = texto_obrigatorio("req_id", req_id)
	if valor == nil then
		error("valor é obrigatório", 0)
	end
	pedir("POST", "/api/chats/" .. esc(id) .. "/resposta", { reqId = req, valor = valor }, responder_com(call, { ok = true }))
	return call:wait(PEDIDO_MS + 2000)
end)

tern.carly.export("fechar", {
	sig = "(chat_id: string) -> {ok: boolean}",
	doc = "Encerra o agente do chat e o tira do lab. Só quando o usuário pedir; para reaproveitar, use mandar.",
}, function(chat_id, cx, call)
	local id = texto_obrigatorio("chat_id", chat_id)
	pedir("DELETE", "/api/chats/" .. esc(id), nil, responder_com(call, { ok = true }))
	return call:wait(PEDIDO_MS + 2000)
end)

tern.carly.export("criar_time", {
	sig = "(nome: string, pasta: string) -> {id: string, nome: string, pasta: string, criadoEm: number}",
	doc = "Cria um time para um projeto: nome curto e a pasta do projeto (precisa existir; ~ vale). A mesma pasta devolve o time que já existe.",
}, function(nome, pasta, cx, call)
	local n = texto_obrigatorio("nome", nome)
	local p = texto_obrigatorio("pasta", pasta)
	if string.sub(p, 1, 2) == "~/" or p == "~" then
		p = (tern.getenv("HOME") or "") .. string.sub(p, 2)
	end
	pedir("POST", "/api/times", { nome = n, pasta = p }, responder_com(call, nil))
	return call:wait(PEDIDO_MS + 2000)
end)
