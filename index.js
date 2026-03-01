const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: "atlascreative",
    resave: false,
    saveUninitialized: true,
  })
);

// ====== LOGIN FIXO (v1) ======
const EMAIL = "atlascreative25@gmail.com";
const SENHA = "Atlas2145@";

// ====== MONGODB ======
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI não configurado nas variáveis do Render.");
}

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar MongoDB:", err.message));

// ====== MODELS ======
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", CounterSchema);

const PedidoSchema = new mongoose.Schema(
  {
    numero: { type: Number, required: true, unique: true },
    produto: { type: String, required: true },
    valor: { type: Number, required: true },
    status: { type: String, required: true },
    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const Pedido = mongoose.model("Pedido", PedidoSchema);

// ====== HELPERS ======
async function getNextPedidoNumber() {
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

function layout(title, content) {
  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
    </head>
    <body style="margin:0;background:#000;color:#fff;font-family:Arial,sans-serif;">
      <div style="padding:16px;border-bottom:1px solid rgba(255,215,0,.25);display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="color:gold;font-size:20px;font-weight:700;">Atlas Creative</div>
          <div style="opacity:.75;font-size:12px;">Sistema de Gestão</div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <a href="/dashboard" style="color:gold;text-decoration:none;">Dashboard</a>
          <a href="/novo" style="color:gold;text-decoration:none;">Novo pedido</a>
          <a href="/logout" style="color:#fff;opacity:.8;text-decoration:none;">Sair</a>
        </div>
      </div>

      <div style="max-width:900px;margin:0 auto;padding:16px;">
        ${content}
      </div>
    </body>
  </html>`;
}

// ====== ROUTES ======
app.get("/", (req, res) => {
  if (req.session.logado) return res.redirect("/dashboard");
  return res.sendFile(__dirname + "/public/login.html");
});

app.post("/login", (req, res) => {
  const { email, senha } = req.body;
  if (email === EMAIL && senha === SENHA) {
    req.session.logado = true;
    return res.redirect("/dashboard");
  }
  return res.send(
    layout(
      "Login inválido",
      `<p>Login inválido. <a style="color:gold;" href="/">Voltar</a></p>`
    )
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/dashboard", requireLogin, async (req, res) => {
  const pedidos = await Pedido.find().sort({ criadoEm: -1 }).limit(50);

  const faturamento = pedidos
    .filter((p) => p.status === "Pago")
    .reduce((t, p) => t + Number(p.valor || 0), 0);

  // (Despesas entram na v1.2; por enquanto zero)
  const despesas = 0;
  const lucro = faturamento - despesas;

  const cards = `
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px;">
      <div style="border:1px solid rgba(255,215,0,.25);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Faturamento</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${faturamento.toFixed(2)}</div>
      </div>
      <div style="border:1px solid rgba(255,215,0,.25);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Despesas</div>
        <div style="color:#fff;font-size:22px;font-weight:800;">R$ ${despesas.toFixed(2)}</div>
      </div>
      <div style="border:1px solid rgba(255,215,0,.25);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Lucro</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${lucro.toFixed(2)}</div>
      </div>
    </div>
  `;

  const rows = pedidos
    .map((p) => {
      const num = String(p.numero).padStart(4, "0");
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">#${num}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${p.produto}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${Number(p.valor).toFixed(2)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${p.status}</td>
        </tr>
      `;
    })
    .join("");

  const table = `
    <h2 style="margin:18px 0 10px;color:gold;">Últimos pedidos</h2>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:620px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Pedido</th>
            <th style="text-align:left;padding:10px;">Produto</th>
            <th style="text-align:left;padding:10px;">Valor</th>
            <th style="text-align:left;padding:10px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td style="padding:10px;" colspan="4">Nenhum pedido ainda.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout("Dashboard", cards + table));
});

app.get("/novo", requireLogin, (req, res) => {
  res.sendFile(__dirname + "/public/novo.html");
});

app.post("/pedido", requireLogin, async (req, res) => {
  const { produto, valor, status } = req.body;

  const numero = await getNextPedidoNumber();

  await Pedido.create({
    numero,
    produto,
    valor: Number(valor),
    status,
  });

  res.redirect("/dashboard");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
