const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "atlascreative",
    resave: false,
    saveUninitialized: true,
  })
);

// ===== LOGIN =====
const EMAIL = "atlascreative25@gmail.com";
const SENHA = "Atlas2145@";

// ===== MONGODB =====
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB conectado"))
  .catch((err) => console.log("Erro MongoDB:", err));

// ===== MODELS =====
const CounterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", CounterSchema);

const ClienteSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true },
    whatsapp: { type: String, default: "" },
    observacoes: { type: String, default: "" },
    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
const Cliente = mongoose.model("Cliente", ClienteSchema);

const PedidoSchema = new mongoose.Schema(
  {
    numero: { type: Number, required: true, unique: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Cliente", default: null },
    produto: { type: String, required: true },
    valor: { type: Number, required: true },
    status: { type: String, required: true },
    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
const Pedido = mongoose.model("Pedido", PedidoSchema);

// ===== FUNÇÕES =====
async function getNextNumero() {
  const counter = await Counter.findOneAndUpdate(
    { _id: "pedido" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

function requireLogin(req, res, next) {
  if (!req.session.logado) return res.redirect("/");
  next();
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function layout(titulo, conteudo) {
  return `
  <html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${esc(titulo)}</title>
  </head>
  <body style="margin:0;background:black;color:white;font-family:Arial">

    <div style="padding:15px;border-bottom:1px solid #333;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
      <div>
        <div style="color:gold;font-weight:bold;font-size:20px">Atlas Creative</div>
        <div style="font-size:12px;opacity:.7">Sistema de Gestão</div>
      </div>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
        <a href="/dashboard" style="color:gold;text-decoration:none">Dashboard</a>
        <a href="/clientes" style="color:gold;text-decoration:none">Clientes</a>
        <a href="/novo" style="color:gold;text-decoration:none">Novo Pedido</a>
        <a href="/logout" style="color:white;opacity:.85;text-decoration:none">Sair</a>
      </div>
    </div>

    <div style="max-width:980px;margin:auto;padding:20px">
      ${conteudo}
    </div>

  </body>
  </html>
  `;
}

// ===== ROTAS =====
app.get("/", (req, res) => {
  if (req.session.logado) return res.redirect("/dashboard");

  res.send(`
  <body style="background:black;color:white;text-align:center;padding-top:100px;font-family:Arial">
    <h1 style="color:gold">Atlas Creative</h1>
    <form method="POST" action="/login">
      <input name="email" placeholder="Email" required><br><br>
      <input name="senha" type="password" placeholder="Senha" required><br><br>
      <button style="background:gold;color:black;padding:10px 20px;border:none;border-radius:10px;font-weight:700">Entrar</button>
    </form>
  </body>
  `);
});

app.post("/login", (req, res) => {
  const { email, senha } = req.body;
  if (email === EMAIL && senha === SENHA) {
    req.session.logado = true;
    return res.redirect("/dashboard");
  }
  res.send(layout("Login inválido", `<p>Login inválido. <a style="color:gold" href="/">Voltar</a></p>`));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ===== CLIENTES =====
app.get("/clientes", requireLogin, async (req, res) => {
  const clientes = await Cliente.find().sort({ criadoEm: -1 });

  const linhas = clientes
    .map((c) => {
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(c.nome)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(c.whatsapp)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(c.observacoes)}</td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 12px;">Clientes</h2>

    <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;max-width:560px;">
      <h3 style="margin:0 0 10px;color:gold;font-size:16px;">Cadastrar cliente</h3>

      <form method="POST" action="/clientes">
        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Nome</div>
          <input name="nome" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">WhatsApp</div>
          <input name="whatsapp" placeholder="(21) 9xxxx-xxxx"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:12px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Observações</div>
          <input name="observacoes" placeholder="Ex: prefere retirada / cliente fixo"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <button style="background:gold;color:black;padding:10px 16px;border:none;border-radius:10px;font-weight:700;">
          Salvar cliente
        </button>
      </form>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Lista de clientes</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:740px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Nome</th>
            <th style="text-align:left;padding:10px;">WhatsApp</th>
            <th style="text-align:left;padding:10px;">Observações</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="3">Nenhum cliente cadastrado ainda.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout("Clientes", conteudo));
});

app.post("/clientes", requireLogin, async (req, res) => {
  const { nome, whatsapp, observacoes } = req.body;

  await Cliente.create({
    nome: String(nome || "").trim(),
    whatsapp: String(whatsapp || "").trim(),
    observacoes: String(observacoes || "").trim(),
  });

  res.redirect("/clientes");
});

// ===== DASHBOARD =====
app.get("/dashboard", requireLogin, async (req, res) => {
  const pedidos = await Pedido.find().populate("clienteId").sort({ criadoEm: -1 }).limit(80);

  const faturamento = pedidos
    .filter((p) => p.status === "Pago")
    .reduce((total, p) => total + Number(p.valor || 0), 0);

  const linhas = pedidos
    .map((p) => {
      const num = String(p.numero).padStart(4, "0");
      const clienteNome = p.clienteId?.nome ? p.clienteId.nome : "-";
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">#${esc(num)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(clienteNome)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.produto)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${Number(p.valor).toFixed(2)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.status)}</td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;max-width:360px;">
      <div style="opacity:.75;font-size:12px;">Faturamento (status Pago)</div>
      <div style="color:gold;font-size:22px;font-weight:800;">R$ ${faturamento.toFixed(2)}</div>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Últimos pedidos</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:860px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Pedido</th>
            <th style="text-align:left;padding:10px;">Cliente</th>
            <th style="text-align:left;padding:10px;">Produto</th>
            <th style="text-align:left;padding:10px;">Valor</th>
            <th style="text-align:left;padding:10px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="5">Nenhum pedido ainda.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout("Dashboard", conteudo));
});

// ===== NOVO PEDIDO =====
app.get("/novo", requireLogin, async (req, res) => {
  const clientes = await Cliente.find().sort({ nome: 1 });

  if (!clientes.length) {
    const conteudo = `
      <h2 style="color:gold;margin:0 0 10px;">Novo Pedido</h2>
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;max-width:560px;">
        <p style="margin:0 0 10px;">Você ainda não cadastrou nenhum cliente.</p>
        <a href="/clientes" style="color:gold;text-decoration:none;font-weight:700;">Cadastrar cliente agora</a>
      </div>
    `;
    return res.send(layout("Novo Pedido", conteudo));
  }

  const options = clientes
    .map((c) => `<option value="${c._id}">${esc(c.nome)} ${c.whatsapp ? "— " + esc(c.whatsapp) : ""}</option>`)
    .join("");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 12px;">Novo Pedido</h2>

    <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;max-width:560px;">
      <form method="POST" action="/pedido">

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Cliente</div>
          <select name="clienteId" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            ${options}
          </select>
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Produto</div>
          <input name="produto" placeholder="Ex: Cartão de visita" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Valor (use ponto: 35.00)</div>
          <input name="valor" placeholder="Ex: 35.00" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:14px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Status</div>
          <select name="status"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            <option>Orçamento</option>
            <option>Aguardando pagamento</option>
            <option>Pago</option>
            <option>Em produção</option>
            <option>Pronto</option>
            <option>Entregue</option>
            <option>Cancelado</option>
          </select>
        </div>

        <button style="background:gold;color:black;padding:10px 16px;border:none;border-radius:10px;font-weight:700;">
          Salvar Pedido
        </button>
      </form>
    </div>
  `;

  res.send(layout("Novo Pedido", conteudo));
});

app.post("/pedido", requireLogin, async (req, res) => {
  const { clienteId, produto, valor, status } = req.body;

  const numero = await getNextNumero();

  await Pedido.create({
    numero,
    clienteId: clienteId || null,
    produto: String(produto || "").trim(),
    valor: Number(valor),
    status: String(status || "").trim(),
  });

  res.redirect("/dashboard");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando"));
