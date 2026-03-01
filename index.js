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

const PedidoSchema = new mongoose.Schema({
  numero: Number,
  produto: String,
  valor: Number,
  status: String,
  criadoEm: { type: Date, default: Date.now },
});
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

function layout(titulo, conteudo) {
  return `
  <html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${titulo}</title>
  </head>
  <body style="margin:0;background:black;color:white;font-family:Arial">

    <div style="padding:15px;border-bottom:1px solid #333;display:flex;justify-content:space-between">
      <div>
        <div style="color:gold;font-weight:bold;font-size:20px">
          Atlas Creative
        </div>
        <div style="font-size:12px;opacity:.7">
          Sistema de Gestão
        </div>
      </div>
      <div>
        <a href="/dashboard" style="color:gold;margin-right:15px;text-decoration:none">Dashboard</a>
        <a href="/novo" style="color:gold;margin-right:15px;text-decoration:none">Novo Pedido</a>
        <a href="/logout" style="color:white;text-decoration:none">Sair</a>
      </div>
    </div>

    <div style="max-width:900px;margin:auto;padding:20px">
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
      <button style="background:gold;color:black;padding:10px 20px;border:none">Entrar</button>
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
  res.send("Login inválido");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/dashboard", requireLogin, async (req, res) => {
  const pedidos = await Pedido.find().sort({ criadoEm: -1 });

  const faturamento = pedidos
    .filter(p => p.status === "Pago")
    .reduce((total, p) => total + p.valor, 0);

  const lista = pedidos.map(p => `
    <tr>
      <td>#${String(p.numero).padStart(4, "0")}</td>
      <td>${p.produto}</td>
      <td>R$ ${p.valor}</td>
      <td>${p.status}</td>
    </tr>
  `).join("");

  const conteudo = `
    <h2 style="color:gold">Faturamento: R$ ${faturamento}</h2>

    <table width="100%" border="1" cellpadding="8" style="border-collapse:collapse;margin-top:20px">
      <tr style="background:#111">
        <th>Pedido</th>
        <th>Produto</th>
        <th>Valor</th>
        <th>Status</th>
      </tr>
      ${lista}
    </table>
  `;

  res.send(layout("Dashboard", conteudo));
});

app.get("/novo", requireLogin, (req, res) => {
  const conteudo = `
    <h2 style="color:gold">Novo Pedido</h2>
    <form method="POST" action="/pedido">
      <input name="produto" placeholder="Produto" required><br><br>
      <input name="valor" placeholder="Valor" required><br><br>

      <select name="status">
        <option>Orçamento</option>
        <option>Aguardando pagamento</option>
        <option>Pago</option>
        <option>Em produção</option>
        <option>Pronto</option>
        <option>Entregue</option>
        <option>Cancelado</option>
      </select><br><br>

      <button style="background:gold;color:black;padding:10px 20px;border:none">
        Salvar Pedido
      </button>
    </form>
  `;

  res.send(layout("Novo Pedido", conteudo));
});

app.post("/pedido", requireLogin, async (req, res) => {
  const { produto, valor, status } = req.body;

  const numero = await getNextNumero();

  await Pedido.create({
    numero,
    produto,
    valor: Number(valor),
    status
  });

  res.redirect("/dashboard");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando"));
