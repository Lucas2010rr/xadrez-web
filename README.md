# Xadrez Web — pronto para Render

Jogo de xadrez responsivo em português. O mesmo serviço Node.js entrega o site e o multiplayer Socket.IO, então não é necessário publicar o frontend em um serviço e o backend em outro.

## Recursos

- Tabuleiro responsivo para computador e celular.
- Seleção por clique/toque e movimentação por arrastar e soltar.
- Destaque dos movimentos legais.
- Regras de xadrez fornecidas por `chess.js`: roque, en passant, promoção, xeque, xeque-mate e empates.
- Modo local para duas pessoas no mesmo dispositivo.
- Modo contra IA local demonstrativa (minimax com poda alpha-beta).
- Salas multiplayer com código e link compartilhável.
- Validação das jogadas e relógios online no servidor.
- Reconexão automática quando a conexão de rede é restabelecida e a sala ainda existe.
- Endpoint de saúde em `/health`.

> A IA é simples e não tem a força do Stockfish. O estado das salas fica na memória do servidor; partidas em andamento são perdidas se o serviço reiniciar ou for redeployado.

## Publicar no Render

O arquivo `render.yaml` já define um Web Service Node, plano Free, instalação das dependências, inicialização e health check.

### Passo 1 — enviar o projeto ao GitHub

1. Baixe e extraia o ZIP.
2. Entre em <https://github.com/> e crie um repositório novo (pode ser privado).
3. Envie para a raiz do repositório os arquivos e pastas que estão dentro de `xadrez-web-render/`.
4. Confira se `package.json`, `render.yaml`, `server/` e `public/` aparecem diretamente na raiz do repositório — não deixe tudo dentro de uma segunda pasta.

### Passo 2 — criar o serviço pelo Blueprint

1. Entre em <https://dashboard.render.com/>.
2. Clique em **New +** e escolha **Blueprint**.
3. Conecte sua conta GitHub, selecione o repositório criado e avance.
4. O Render vai ler o `render.yaml`. Confira o serviço `xadrez-web` e clique para aplicar/criar.
5. Aguarde o primeiro deploy terminar. O Render instalará as dependências com `npm install` e iniciará o servidor com `npm start`.

### Alternativa — criar como Web Service manualmente

Se preferir não usar Blueprint:

1. No Render, clique em **New + → Web Service** e conecte o repositório.
2. Use a raiz do repositório como **Root Directory** (deixe em branco se o projeto estiver na raiz).
3. Selecione **Node** como Runtime.
4. Informe **Build Command**: `npm install`.
5. Informe **Start Command**: `npm start`.
6. Escolha **Free** para testar e configure **Health Check Path** como `/health`.
7. Crie o serviço.

### Passo 3 — abrir o jogo

Quando o deploy terminar, o Render mostrará um endereço parecido com:

`https://xadrez-web.onrender.com`

Abra esse endereço. O site e o Socket.IO já usam o mesmo domínio; não edite URL de API ou arquivo de configuração.

Para testar o multiplayer:

1. Abra o endereço do jogo em um navegador e clique em **Criar sala online**.
2. Copie o código da sala ou use **Copiar código/link da sala**.
3. Abra o link em outro navegador, computador ou celular.
4. O segundo jogador entra com o código; a partida começa quando os dois jogadores estiverem conectados.

O endereço `/health` deve retornar um JSON com `ok: true` quando o servidor estiver disponível.

## Executar no computador

Requer Node.js 20 ou superior.

```bash
npm install
npm start
```

Abra <http://localhost:3000>. Para desenvolvimento com reinicialização automática:

```bash
npm run dev
```

## Como o projeto está organizado

```text
xadrez-web-render/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server/
│   └── server.js
├── package.json
├── render.yaml
├── .gitignore
└── README.md
```

## Observações sobre o plano gratuito do Render

- Serviços web gratuitos podem entrar em suspensão após 15 minutos sem tráfego de entrada. A próxima visita pode levar aproximadamente um minuto para reativar o serviço.
- Um reinício/redeploy pode encerrar as salas que estavam em andamento, pois elas são armazenadas na memória do processo.
- O plano gratuito é indicado para testes e projetos pessoais; confira as limitações e cotas atuais do Render antes de usar o jogo com muitas pessoas.

Consulte a documentação oficial:

- <https://render.com/docs/deploy-node-express-app>
- <https://render.com/docs/free>
- <https://render.com/docs/websocket>

## Estrutura e funcionamento

- `public/` contém o frontend. `chess.js` é carregado como módulo ES do CDN `esm.sh`; é necessária conexão com a internet para carregar essa biblioteca.
- O cliente Socket.IO é servido pelo próprio servidor em `/socket.io/socket.io.js`, sem configurar um segundo endereço.
- `server/server.js` valida cada jogada antes de atualizar o estado compartilhado da partida.
- Os relógios multiplayer são calculados no servidor; os relógios local/IA são calculados no navegador.
