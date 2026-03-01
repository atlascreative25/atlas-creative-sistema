const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");

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

// ===== HELPERS =====
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

function parseMoneyBR(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return NaN;

  let s = raw.replace(/\s/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const lastSep = Math.max(lastComma, lastDot);

  if (lastSep >= 0) {
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, "");
    const decPart = s.slice(lastSep + 1).replace(/[.,]/g, "");
    s = `${intPart}.${decPart}`;
  } else {
    s = s.replace(/[.,]/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function money(n) {
  const v = Number(n || 0);
  return v.toFixed(2).replace(".", ",");
}

function saldoPedido(valor, sinal) {
  const v = Number(valor || 0);
  const s = Number(sinal || 0);
  return Math.max(0, v - s);
}

function fmtDateBR(date) {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function parseDateBR(s) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseMonthKey(key) {
  const m = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function monthRangeFromKey(key) {
  const parsed = parseMonthKey(key);
  const now = new Date();
  const fallback = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const { year, month } = parsed || fallback;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end, key: `${year}-${String(month).padStart(2, "0")}` };
}

function monthLabelPT(key) {
  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  const names = [
    "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
  ];
  return `${names[parsed.month - 1]} ${parsed.year}`;
}

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function waLinkBR(whatsapp) {
  const digits = onlyDigits(whatsapp);
  if (!digits) return "";
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${phone}`;
}

function statusOptions(list, selected) {
  return list
    .map((s) => `<option ${s === selected ? "selected" : ""}>${esc(s)}</option>`)
    .join("");
}

function entregaOptions(list, selected) {
  return list
    .map((t) => `<option ${t === selected ? "selected" : ""}>${esc(t)}</option>`)
    .join("");
}

function entregaResumo(entrega) {
  const e = entrega || {};
  if (e.data) {
    const q = e.quemRetirou ? ` — ${e.quemRetirou}` : "";
    return `${e.tipo || "-"} em ${fmtDateBR(e.data)}${q}`;
  }
  return e.tipo || "-";
}

function buildWhatsTemplates({ clienteNome, pedidoNumero, produtoDesc, tipoProduto, valor, sinal, saldo, status }) {
  const num = String(pedidoNumero || 0).padStart(4, "0");
  const tipo = tipoProduto ? `${tipoProduto} — ` : "";
  const baseInfo =
    `Pedido #${num}\n` +
    `${tipo}${produtoDesc}\n` +
    `Status: ${status}\n` +
    `Valor: R$ ${money(valor)}\n` +
    `Sinal: R$ ${money(sinal || 0)}\n` +
    `Saldo: R$ ${money(saldo)}`;

  return [
    { key: "bomdia", label: "Bom dia, cliente especial!", text: `Bom dia, ${clienteNome}! 😊\n\n${baseInfo}` },
    { key: "pagamento", label: "Pagamento confirmado", text: `Pagamento confirmado ✅\n\n${baseInfo}\n\nObrigad@ pela preferência!` },
    { key: "aguardando", label: "Aguardando pagamento", text: `Oi, ${clienteNome}! 😊\n\nSeu pedido #${num} está aguardando pagamento.\nSaldo: R$ ${money(saldo)}\n\nAssim que confirmar, eu coloco em produção ✅` },
    { key: "producao", label: "Pedido em produção", text: `Seu pedido está em produção 🛠️✅\n\n${baseInfo}` },
    { key: "pronto", label: "Pedido pronto", text: `Seu pedido ficou pronto ✅🎉\n\n${baseInfo}\n\nMe avisa como vai ser a retirada/entrega.` },
    { key: "caminho", label: "Pedido a caminho", text: `Pedido a caminho! 🚚✅\n\nPedido #${num}\n${tipo}${produtoDesc}\n\nSe precisar, me chama por aqui.` },
    { key: "atendimento", label: "Atendimento finalizado", text: `Atendimento finalizado ✅\n\nObrigad@, ${clienteNome}! Qualquer coisa é só chamar 🙌` },
    { key: "desconto", label: "Desconto exclusivo", text: `Desconto exclusivo pra você! 🏷️✨\n\nMe diz o que você quer fazer que eu monto o orçamento rapidinho.` },
  ];
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

// ===== LAYOUT NOVO =====
function layout(titulo, conteudo) {
  return `
  <html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${esc(titulo)}</title>
    <style>
      :root{
        --bg:#070707;
        --panel:#0f0f10;
        --panel2:#121214;
        --text:#ffffff;
        --muted:rgba(255,255,255,.72);
        --border:rgba(255,255,255,.12);
        --gold:#d7b25a;
        --gold2:#f5d36a;
        --shadow: 0 10px 30px rgba(0,0,0,.45);
        --radius:16px;
      }
      *{box-sizing:border-box}
      body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,system-ui,-apple-system,Segoe UI,Roboto}
      a{color:var(--gold);text-decoration:none}
      a:hover{opacity:.9}
      .topbar{
        position:sticky;top:0;z-index:9;
        background:rgba(7,7,7,.85);backdrop-filter: blur(10px);
        border-bottom:1px solid var(--border);
      }
      .topbar-inner{
        max-width:1200px;margin:auto;padding:14px 18px;
        display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;
      }
      .brand{display:flex;flex-direction:column;gap:2px}
      .brand .title{color:var(--gold2);font-weight:900;font-size:20px;letter-spacing:.3px}
      .brand .sub{font-size:12px;color:var(--muted)}
      .nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .nav a{
        padding:8px 10px;border-radius:12px;
        border:1px solid transparent;
        color:var(--gold2);font-weight:800;font-size:13px;
      }
      .nav a:hover{border-color:rgba(215,178,90,.35);background:rgba(215,178,90,.08)}
      .nav .danger{color:rgba(255,255,255,.85)}
      .container{max-width:1200px;margin:auto;padding:18px}
      .h1{margin:0 0 10px;color:var(--gold2);font-size:22px}
      .card{
        background:linear-gradient(180deg,var(--panel),var(--panel2));
        border:1px solid rgba(215,178,90,.18);
        border-radius:var(--radius);
        box-shadow:var(--shadow);
        padding:14px;
      }
      .grid{display:grid;gap:12px}
      .grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
      .grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
      @media(max-width:900px){.grid-2,.grid-3{grid-template-columns:1fr}}
      .muted{color:var(--muted)}
      .kpi{display:flex;flex-direction:column;gap:6px}
      .kpi .label{font-size:12px;color:var(--muted)}
      .kpi .value{font-size:22px;font-weight:900;color:var(--gold2)}
      .btn{
        display:inline-flex;align-items:center;justify-content:center;gap:8px;
        padding:10px 12px;border-radius:12px;
        border:1px solid rgba(215,178,90,.25);
        background:#151516;color:#fff;font-weight:900;cursor:pointer;
      }
      .btn:hover{background:#1a1a1c}
      .btn-gold{
        background:linear-gradient(180deg,var(--gold2),var(--gold));
        color:#000;border:none;
      }
      .btn-gold:hover{filter:brightness(.98)}
      .input, select, textarea{
        width:100%;
        padding:10px;border-radius:12px;
        border:1px solid var(--border);
        background:#0b0b0c;color:#fff;
        outline:none;
      }
      textarea{resize:vertical}
      .tablewrap{overflow:auto;border:1px solid rgba(215,178,90,.18);border-radius:var(--radius)}
      table{width:100%;border-collapse:collapse;min-width:900px}
      thead tr{background:rgba(215,178,90,.10)}
      th,td{padding:10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top}
      .pill{
        display:inline-flex;align-items:center;gap:6px;
        padding:3px 8px;border-radius:999px;
        border:1px solid rgba(215,178,90,.25);
        background:rgba(215,178,90,.08);
        font-size:11px;color:rgba(255,255,255,.85);font-weight:900;
      }
      .warn{border-color:rgba(245,211,106,.35);background:rgba(245,211,106,.10)}
      .dangerpill{border-color:rgba(255,80,80,.35);background:rgba(255,80,80,.10)}
      .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
      .spacer{height:10px}
      .mini{font-size:12px;color:var(--muted)}
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="title">Atlas Creative</div>
          <div class="sub">Sistema de Gestão</div>
        </div>
        <div class="nav">
          <a href="/dashboard">Dashboard</a>
          <a href="/clientes">Clientes</a>
          <a href="/novo">Novo Pedido</a>
          <a href="/produtos">Produtos</a>
          <a href="/estoque">Estoque</a>
          <a href="/financeiro">Financeiro</a>
          <a class="danger" href="/logout">Sair</a>
        </div>
      </div>
    </div>
    <div class="container">
      ${conteudo}
    </div>
  </body>
  </html>
  `;
}

// ===== CONSTANTES =====
const STATUS_LIST = [
  "Orçamento",
  "Aguardando pagamento",
  "Aguardando saldo",
  "Pago",
  "Em produção",
  "Pronto",
  "Entregue",
  "Cancelado",
];

const STATUS_PENDENTES = new Set(["Orçamento", "Aguardando pagamento", "Aguardando saldo", "Em produção"]);
const STATUS_PAGOS = new Set(["Pago", "Pronto", "Entregue"]);

const ENTREGA_TIPOS = ["Retirada", "Motoboy", "Correios", "Entrega própria"];

// ===== MODELS =====
const CounterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", CounterSchema);

async function getNextNumero() {
  const counter = await Counter.findOneAndUpdate(
    { _id: "pedido" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

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

const ProdutoTipoSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, unique: true },
    precoSugerido: { type: Number, default: 0 },
    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
const ProdutoTipo = mongoose.model("ProdutoTipo", ProdutoTipoSchema);

const ChecklistSchema = new mongoose.Schema(
  {
    arteRecebida: { type: Boolean, default: false },
    arteAprovada: { type: Boolean, default: false },
    impresso: { type: Boolean, default: false },
    cortado: { type: Boolean, default: false },
    entregue: { type: Boolean, default: false },
  },
  { _id: false }
);

const EntregaSchema = new mongoose.Schema(
  {
    tipo: { type: String, default: "Retirada" },
    data: { type: Date, default: null },
    quemRetirou: { type: String, default: "" },
    observacao: { type: String, default: "" },
  },
  { _id: false }
);

const PedidoSchema = new mongoose.Schema(
  {
    numero: { type: Number, required: true, unique: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Cliente", default: null },

    tipoProduto: { type: String, default: "" },
    produto: { type: String, required: true },

    valor: { type: Number, required: true },
    sinal: { type: Number, default: 0 },

    status: { type: String, required: true },
    anotacoes: { type: String, default: "" },

    arquivado: { type: Boolean, default: false },
    checklist: { type: ChecklistSchema, default: () => ({}) },
    entrega: { type: EntregaSchema, default: () => ({}) },

    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
const Pedido = mongoose.model("Pedido", PedidoSchema);

const DespesaSchema = new mongoose.Schema(
  {
    descricao: { type: String, required: true },
    categoria: { type: String, default: "Geral" },
    valor: { type: Number, required: true },
    data: { type: Date, default: Date.now },
    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
const Despesa = mongoose.model("Despesa", DespesaSchema);

// ===== ESTOQUE =====
const EstoqueItemSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true },
    categoria: { type: String, default: "Geral" },
    unidade: { type: String, default: "un" },
    quantidade: { type: Number, default: 0 },
    minimo: { type: Number, default: 0 },
    custo: { type: Number, default: 0 },
    fornecedor: { type: String, default: "" },
    local: { type: String, default: "" },
    observacao: { type: String, default: "" },
    criadoEm: { type: Date, default: Date.now },
    atualizadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const EstoqueMovSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "EstoqueItem", required: true },
    tipo: { type: String, required: true }, // Entrada / Saída / Ajuste
    quantidade: { type: Number, required: true },
    motivo: { type: String, default: "" },
    pedidoNumero: { type: Number, default: null },
    custoUnitario: { type: Number, default: null },
    criadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const EstoqueItem = mongoose.model("EstoqueItem", EstoqueItemSchema);
const EstoqueMov = mongoose.model("EstoqueMov", EstoqueMovSchema);

// ===== AUTH =====
app.get("/", (req, res) => {
  if (req.session.logado) return res.redirect("/dashboard");
  res.send(`
  <body style="background:black;color:white;text-align:center;padding-top:100px;font-family:Arial">
    <h1 style="color:#f5d36a">Atlas Creative</h1>
    <form method="POST" action="/login">
      <input name="email" placeholder="Email" required style="padding:10px;border-radius:10px;border:1px solid #333;background:#0b0b0b;color:#fff"><br><br>
      <input name="senha" type="password" placeholder="Senha" required style="padding:10px;border-radius:10px;border:1px solid #333;background:#0b0b0b;color:#fff"><br><br>
      <button style="background:#f5d36a;color:black;padding:10px 20px;border:none;border-radius:10px;font-weight:800;cursor:pointer">Entrar</button>
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
  res.send(layout("Login inválido", `<div class="card">Login inválido. <a href="/">Voltar</a></div>`));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ===== PRODUTOS =====
app.get("/produtos", requireLogin, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const query = q ? { nome: { $regex: q, $options: "i" } } : {};
  const itens = await ProdutoTipo.find(query).sort({ nome: 1 });

  const busca = `
    <form method="GET" action="/produtos" class="row" style="margin:0 0 12px;">
      <input class="input" name="q" value="${esc(q)}" placeholder="Buscar tipo de produto..." style="flex:1;min-width:260px;">
      <button class="btn btn-gold" type="submit">Buscar</button>
      ${q ? `<a class="btn" href="/produtos">Limpar</a>` : ""}
    </form>
  `;

  const linhas = itens
    .map((p) => `
      <tr>
        <td>${esc(p.nome)}</td>
        <td>R$ ${money(p.precoSugerido)}</td>
        <td>
          <form method="POST" action="/produtos/${p._id}/delete" onsubmit="return confirm('Excluir este tipo de produto?');" style="margin:0;">
            <button class="btn" type="submit">Excluir</button>
          </form>
        </td>
      </tr>
    `)
    .join("");

  const conteudo = `
    <h2 class="h1">Produtos (tipos + preço sugerido)</h2>
    ${busca}

    <div class="grid grid-2">
      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Cadastrar tipo</div>
        <form method="POST" action="/produtos">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Nome do tipo</div>
              <input class="input" name="nome" placeholder="Ex: Banner / Cartão / Adesivo" required>
            </div>
            <div>
              <div class="mini">Preço sugerido</div>
              <input class="input" name="precoSugerido" placeholder="Ex: 35,00" required>
            </div>
          </div>
          <div class="spacer"></div>
          <button class="btn btn-gold" type="submit">Salvar tipo</button>
        </form>
      </div>

      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Dica</div>
        <div class="muted">
          O tipo serve pra puxar o preço sugerido no “Novo Pedido”. Você ainda pode editar o valor depois no pedido.
        </div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Tipos cadastrados</div>
      <div class="tablewrap">
        <table style="min-width:780px;">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Preço sugerido</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${linhas || `<tr><td colspan="3" class="muted" style="padding:12px;">Nenhum tipo cadastrado.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  res.send(layout("Produtos", conteudo));
});

app.post("/produtos", requireLogin, async (req, res) => {
  const nome = String(req.body.nome || "").trim();
  const preco = parseMoneyBR(req.body.precoSugerido);
  if (!nome) return res.send(layout("Erro", `<div class="card">Nome inválido. <a href="/produtos">Voltar</a></div>`));
  if (!Number.isFinite(preco)) return res.send(layout("Erro", `<div class="card">Preço inválido. <a href="/produtos">Voltar</a></div>`));

  try {
    await ProdutoTipo.create({ nome, precoSugerido: preco });
  } catch (e) {
    return res.send(layout("Erro", `<div class="card">Esse tipo já existe. <a href="/produtos">Voltar</a></div>`));
  }
  res.redirect("/produtos");
});

app.post("/produtos/:id/delete", requireLogin, async (req, res) => {
  await ProdutoTipo.findByIdAndDelete(req.params.id);
  res.redirect("/produtos");
});

// ===== CLIENTES =====
app.get("/clientes", requireLogin, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const query = q
    ? {
        $or: [
          { nome: { $regex: q, $options: "i" } },
          { whatsapp: { $regex: q, $options: "i" } },
          { observacoes: { $regex: q, $options: "i" } },
        ],
      }
    : {};

  const clientes = await Cliente.find(query).sort({ criadoEm: -1 });

  const busca = `
    <form method="GET" action="/clientes" class="row" style="margin:0 0 12px;">
      <input class="input" name="q" value="${esc(q)}" placeholder="Buscar cliente/whatsapp/obs..." style="flex:1;min-width:260px;">
      <button class="btn btn-gold" type="submit">Buscar</button>
      ${q ? `<a class="btn" href="/clientes">Limpar</a>` : ""}
    </form>
  `;

  const linhas = clientes
    .map((c) => {
      const wa = waLinkBR(c.whatsapp);
      return `
        <tr>
          <td>
            <a href="/clientes/${c._id}" style="font-weight:900;color:var(--gold2)">${esc(c.nome)}</a>
          </td>
          <td>${esc(c.whatsapp)}</td>
          <td>${esc(c.observacoes)}</td>
          <td>
            ${
              wa
                ? `<a class="btn btn-gold" href="${esc(wa)}" target="_blank">WhatsApp</a>`
                : `<span class="muted">Sem número</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <h2 class="h1">Clientes</h2>
    ${busca}

    <div class="grid grid-2">
      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Cadastrar cliente</div>
        <form method="POST" action="/clientes">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Nome</div>
              <input class="input" name="nome" required>
            </div>
            <div>
              <div class="mini">WhatsApp</div>
              <input class="input" name="whatsapp" placeholder="(21) 9xxxx-xxxx">
            </div>
          </div>
          <div class="spacer"></div>
          <div>
            <div class="mini">Observações</div>
            <input class="input" name="observacoes" placeholder="Ex: prefere retirada / cliente fixo">
          </div>
          <div class="spacer"></div>
          <button class="btn btn-gold" type="submit">Salvar cliente</button>
        </form>
      </div>

      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Resumo</div>
        <div class="muted">Total de clientes: <b style="color:#fff">${clientes.length}</b></div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Lista</div>
      <div class="tablewrap">
        <table style="min-width:900px;">
          <thead>
            <tr>
              <th>Nome</th>
              <th>WhatsApp</th>
              <th>Observações</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${linhas || `<tr><td colspan="4" class="muted" style="padding:12px;">Nenhum cliente encontrado.</td></tr>`}
          </tbody>
        </table>
      </div>
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

// ===== TELA DO CLIENTE =====
app.get("/clientes/:id", requireLogin, async (req, res) => {
  const cliente = await Cliente.findById(req.params.id);
  if (!cliente) return res.send(layout("Cliente", `<div class="card">Cliente não encontrado. <a href="/clientes">Voltar</a></div>`));

  const pedidos = await Pedido.find({ clienteId: cliente._id }).sort({ criadoEm: -1 });

  const totalValor = pedidos.filter((p) => p.status !== "Cancelado").reduce((t, p) => t + Number(p.valor || 0), 0);
  const totalSinal = pedidos.filter((p) => p.status !== "Cancelado").reduce((t, p) => t + Number(p.sinal || 0), 0);
  const totalSaldo = pedidos
    .filter((p) => p.status !== "Cancelado")
    .reduce((t, p) => t + saldoPedido(p.valor, p.sinal), 0);

  const wa = waLinkBR(cliente.whatsapp);

  const linhas = pedidos
    .map((p) => {
      const num = String(p.numero).padStart(4, "0");
      const badge = p.arquivado ? `<span class="pill">Arquivado</span>` : "";
      const tipo = p.tipoProduto ? `${p.tipoProduto} — ` : "";
      return `
        <tr>
          <td><a href="/pedido/${p._id}" style="font-weight:900;color:var(--gold2)">#${esc(num)}</a> ${badge}</td>
          <td>${esc(tipo + p.produto)}</td>
          <td>R$ ${money(p.valor)}</td>
          <td>R$ ${money(p.sinal || 0)}</td>
          <td>R$ ${money(saldoPedido(p.valor, p.sinal))}</td>
          <td>${esc(p.status)}</td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <div class="row" style="justify-content:space-between;margin-bottom:10px;">
      <div>
        <h2 class="h1">${esc(cliente.nome)}</h2>
        <div class="muted">WhatsApp: ${esc(cliente.whatsapp || "-")} • Obs: ${esc(cliente.observacoes || "-")}</div>
      </div>
      <div class="row">
        <a class="btn" href="/clientes">← Voltar</a>
        ${wa ? `<a class="btn btn-gold" href="${esc(wa)}" target="_blank">Abrir WhatsApp</a>` : ""}
        <a class="btn" href="/clientes/${cliente._id}/relatorio.pdf">PDF do Cliente</a>
        <a class="btn" href="/clientes/${cliente._id}/pedidos.csv">CSV do Cliente</a>
      </div>
    </div>

    <div class="grid grid-3">
      <div class="card kpi">
        <div class="label">Total (valor)</div>
        <div class="value">R$ ${money(totalValor)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Total (sinal)</div>
        <div class="value">R$ ${money(totalSinal)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Total (saldo)</div>
        <div class="value">R$ ${money(totalSaldo)}</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Pedidos do cliente</div>
      <div class="tablewrap">
        <table style="min-width:980px;">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Produto</th>
              <th>Valor</th>
              <th>Sinal</th>
              <th>Saldo</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${linhas || `<tr><td colspan="6" class="muted" style="padding:12px;">Nenhum pedido para este cliente ainda.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(layout("Cliente", conteudo));
});

// CSV cliente
app.get("/clientes/:id/pedidos.csv", requireLogin, async (req, res) => {
  const cliente = await Cliente.findById(req.params.id);
  if (!cliente) return res.status(404).send("Cliente não encontrado");

  const pedidos = await Pedido.find({ clienteId: cliente._id }).sort({ criadoEm: 1 });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cliente-${cliente._id}-pedidos.csv"`);

  const header = [
    "numero","data","cliente","whatsapp","tipoProduto","produto",
    "valor","sinal","saldo","status","arquivado",
    "entrega_tipo","entrega_data","entrega_quem","entrega_observacao",
    "arteRecebida","arteAprovada","impresso","cortado","entregue",
    "anotacoes"
  ];
  const lines = [header.join(",")];

  pedidos.forEach((p) => {
    const ck = p.checklist || {};
    const e = p.entrega || {};
    lines.push(
      [
        p.numero,
        fmtDateBR(p.criadoEm),
        cliente.nome,
        cliente.whatsapp || "",
        p.tipoProduto || "",
        p.produto || "",
        String(p.valor).replace(".", ","),
        String(p.sinal || 0).replace(".", ","),
        String(saldoPedido(p.valor, p.sinal)).replace(".", ","),
        p.status,
        p.arquivado ? "Sim" : "Não",
        e.tipo || "",
        fmtDateBR(e.data),
        e.quemRetirou || "",
        (e.observacao || "").replace(/\r?\n/g, " "),
        ck.arteRecebida ? "1" : "0",
        ck.arteAprovada ? "1" : "0",
        ck.impresso ? "1" : "0",
        ck.cortado ? "1" : "0",
        ck.entregue ? "1" : "0",
        (p.anotacoes || "").replace(/\r?\n/g, " "),
      ].map(csvEscape).join(",")
    );
  });

  res.send(lines.join("\n"));
});

// PDF cliente
app.get("/clientes/:id/relatorio.pdf", requireLogin, async (req, res) => {
  const cliente = await Cliente.findById(req.params.id);
  if (!cliente) return res.status(404).send("Cliente não encontrado");

  const pedidos = await Pedido.find({ clienteId: cliente._id }).sort({ criadoEm: 1 });

  const totalValor = pedidos.filter((p) => p.status !== "Cancelado").reduce((t, p) => t + Number(p.valor || 0), 0);
  const totalSinal = pedidos.filter((p) => p.status !== "Cancelado").reduce((t, p) => t + Number(p.sinal || 0), 0);
  const totalSaldo = pedidos.filter((p) => p.status !== "Cancelado").reduce((t, p) => t + saldoPedido(p.valor, p.sinal), 0);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="cliente-${cliente._id}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text("Atlas Creative - Relatório do Cliente");
  doc.moveDown(0.5);

  doc.fontSize(12).text(`Cliente: ${cliente.nome}`);
  doc.text(`WhatsApp: ${cliente.whatsapp || "-"}`);
  doc.text(`Gerado em: ${fmtDateBR(new Date())}`);
  doc.moveDown();

  doc.fontSize(13).text("Resumo", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Total (valor): R$ ${money(totalValor)}`);
  doc.text(`Total (sinal): R$ ${money(totalSinal)}`);
  doc.text(`Total (saldo): R$ ${money(totalSaldo)}`);
  doc.moveDown();

  doc.fontSize(13).text("Pedidos", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).text("Pedido | Data | Tipo | Produto | Valor | Sinal | Saldo | Status | Entrega");
  doc.moveDown(0.3);

  pedidos.forEach((p) => {
    const num = String(p.numero).padStart(4, "0");
    doc.text(
      `#${num} | ${fmtDateBR(p.criadoEm)} | ${p.tipoProduto || "-"} | ${p.produto} | R$ ${money(p.valor)} | R$ ${money(
        p.sinal || 0
      )} | R$ ${money(saldoPedido(p.valor, p.sinal))} | ${p.status} | ${entregaResumo(p.entrega)}`
    );
  });

  doc.end();
});

// ===== NOVO PEDIDO =====
app.get("/novo", requireLogin, async (req, res) => {
  const clientes = await Cliente.find().sort({ nome: 1 });
  if (!clientes.length) {
    return res.send(layout("Novo Pedido", `<div class="card">Cadastre um cliente primeiro. <a href="/clientes">Ir para clientes</a></div>`));
  }

  const tipos = await ProdutoTipo.find().sort({ nome: 1 });

  const clientesOpt = clientes
    .map((c) => `<option value="${c._id}">${esc(c.nome)} ${c.whatsapp ? "— " + esc(c.whatsapp) : ""}</option>`)
    .join("");

  const tiposOpt = [
    `<option value="">(Selecionar tipo - opcional)</option>`,
    ...tipos.map((t) => `<option value="${esc(t.nome)}" data-preco="${String(t.precoSugerido || 0)}">${esc(t.nome)}</option>`)
  ].join("");

  const conteudo = `
    <h2 class="h1">Novo Pedido</h2>

    <div class="card" style="max-width:720px;">
      <form method="POST" action="/pedido">

        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div class="mini">Cliente</div>
            <select class="input" name="clienteId" required>${clientesOpt}</select>
          </div>
          <div>
            <div class="mini">Tipo de produto (puxa preço sugerido)</div>
            <select class="input" id="tipoProduto" name="tipoProduto">${tiposOpt}</select>
            <div class="mini" style="margin-top:6px;">Cadastre tipos em: <a href="/produtos">Produtos</a></div>
          </div>
        </div>

        <div class="spacer"></div>

        <div>
          <div class="mini">Descrição (detalhes)</div>
          <input class="input" name="produto" required placeholder="Ex: 1000 unid, papel couchê 300g, frente/verso...">
        </div>

        <div class="spacer"></div>

        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div class="mini">Valor total</div>
            <input class="input" id="valor" name="valor" required placeholder="Ex: 120,00">
          </div>
          <div>
            <div class="mini">Sinal / Entrada (opcional)</div>
            <input class="input" id="sinal" name="sinal" placeholder="Ex: 50,00">
          </div>
        </div>

        <div class="spacer"></div>

        <div>
          <div class="mini">Status</div>
          <select class="input" name="status">${statusOptions(STATUS_LIST, "Orçamento")}</select>
        </div>

        <div class="spacer"></div>

        <button class="btn btn-gold" type="submit">Salvar Pedido</button>
      </form>
    </div>

    <script>
      (function(){
        const sel = document.getElementById('tipoProduto');
        const valor = document.getElementById('valor');
        sel.addEventListener('change', function(){
          const opt = sel.options[sel.selectedIndex];
          const preco = opt && opt.dataset ? opt.dataset.preco : '';
          if (preco && String(preco) !== '0') {
            const n = Number(preco);
            if (!Number.isNaN(n)) valor.value = n.toFixed(2).replace('.', ',');
          }
        });
      })();
    </script>
  `;

  res.send(layout("Novo Pedido", conteudo));
});

app.post("/pedido", requireLogin, async (req, res) => {
  const { clienteId, tipoProduto, produto, valor, sinal, status } = req.body;

  const numero = await getNextNumero();

  const v = parseMoneyBR(valor);
  if (!Number.isFinite(v)) return res.send(layout("Erro", `<div class="card">Valor inválido. <a href="/novo">Voltar</a></div>`));

  const s = String(sinal || "").trim() ? parseMoneyBR(sinal) : 0;
  if (!Number.isFinite(s)) return res.send(layout("Erro", `<div class="card">Sinal inválido. <a href="/novo">Voltar</a></div>`));
  const sinalVal = Math.max(0, Math.min(v, s));

  const st = String(status || "").trim();
  if (!STATUS_LIST.includes(st)) return res.send(layout("Erro", `<div class="card">Status inválido. <a href="/novo">Voltar</a></div>`));

  await Pedido.create({
    numero,
    clienteId: clienteId || null,
    tipoProduto: String(tipoProduto || "").trim(),
    produto: String(produto || "").trim(),
    valor: v,
    sinal: sinalVal,
    status: st,
  });

  res.redirect("/dashboard");
});

// ===== DASHBOARD =====
app.get("/dashboard", requireLogin, async (req, res) => {
  const mesParam = String(req.query.mes || "").trim();
  const { start: ini, end: fim, key: mesKey } = monthRangeFromKey(mesParam || monthKeyFromDate(new Date()));
  const q = String(req.query.q || "").trim();
  const showArchived = String(req.query.show_archived || "") === "1";

  const pedidosMes = await Pedido.find({ criadoEm: { $gte: ini, $lt: fim } });
  const despesasMes = await Despesa.find({ data: { $gte: ini, $lt: fim } });

  const faturamentoMes = pedidosMes.filter((p) => p.status === "Pago").reduce((t, p) => t + Number(p.valor || 0), 0);
  const totalDespesas = despesasMes.reduce((t, d) => t + Number(d.valor || 0), 0);
  const lucro = faturamentoMes - totalDespesas;

  let pedidosLista = await Pedido.find(showArchived ? {} : { arquivado: { $ne: true } })
    .populate("clienteId")
    .sort({ criadoEm: -1 })
    .limit(250);

  if (q) {
    const qlow = q.toLowerCase();
    pedidosLista = pedidosLista
      .filter((p) => {
        const num = String(p.numero || "");
        const cli = (p.clienteId?.nome || "").toLowerCase();
        const prod = (p.produto || "").toLowerCase();
        const tipo = (p.tipoProduto || "").toLowerCase();
        const st = (p.status || "").toLowerCase();
        return num.includes(qlow) || cli.includes(qlow) || prod.includes(qlow) || tipo.includes(qlow) || st.includes(qlow);
      })
      .slice(0, 90);
  } else {
    pedidosLista = pedidosLista.slice(0, 90);
  }

  const pendentes = pedidosLista.filter((p) => !p.arquivado && STATUS_PENDENTES.has(p.status));
  const pagos = pedidosLista.filter((p) => !p.arquivado && STATUS_PAGOS.has(p.status));

  const itensBaixo = (await EstoqueItem.find().sort({ atualizadoEm: -1 }))
    .filter((i) => Number(i.quantidade || 0) <= Number(i.minimo || 0))
    .slice(0, 6);

  const busca = `
    <form method="GET" action="/dashboard" class="row" style="margin:10px 0 12px;">
      <input type="hidden" name="mes" value="${esc(mesKey)}">
      ${showArchived ? `<input type="hidden" name="show_archived" value="1">` : ""}
      <input class="input" name="q" value="${esc(q)}" placeholder="Buscar pedido, cliente, produto, status..." style="flex:1;min-width:260px;">
      <button class="btn btn-gold" type="submit">Buscar</button>
      ${q ? `<a class="btn" href="/dashboard?mes=${encodeURIComponent(mesKey)}${showArchived ? "&show_archived=1" : ""}">Limpar</a>` : ""}
    </form>
  `;

  const toggleLink = showArchived
    ? `/dashboard?mes=${encodeURIComponent(mesKey)}${q ? `&q=${encodeURIComponent(q)}` : ""}`
    : `/dashboard?mes=${encodeURIComponent(mesKey)}${q ? `&q=${encodeURIComponent(q)}` : ""}&show_archived=1`;

  const toggleText = showArchived ? "Ocultar arquivados" : "Mostrar arquivados";

  const cardList = (arr) =>
    arr
      .map((p) => {
        const num = String(p.numero).padStart(4, "0");
        const clienteNome = p.clienteId?.nome || "-";
        const tipo = p.tipoProduto ? `${p.tipoProduto} — ` : "";
        const sal = saldoPedido(p.valor, p.sinal);
        return `
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;margin-bottom:8px;">
            <div class="row" style="justify-content:space-between;">
              <a href="/pedido/${p._id}" style="color:var(--gold2);font-weight:900;">#${esc(num)}</a>
              <span class="pill">${esc(p.status)}</span>
            </div>
            <div style="margin-top:6px;"><b>${esc(clienteNome)}</b> — ${esc(tipo + p.produto)}</div>
            <div class="mini" style="margin-top:4px;">Valor: R$ ${money(p.valor)} | Sinal: R$ ${money(p.sinal || 0)} | Saldo: R$ ${money(sal)}</div>
            <div class="mini" style="margin-top:4px;">Entrega: ${esc(entregaResumo(p.entrega))}</div>
          </div>
        `;
      })
      .join("") || `<div class="muted">Nada aqui.</div>`;

  const linhasTabela = pedidosLista
    .map((p) => {
      const num = String(p.numero).padStart(4, "0");
      const clienteNome = p.clienteId?.nome ? p.clienteId.nome : "-";
      const badge = p.arquivado ? `<span class="pill">Arquivado</span>` : "";
      const tipo = p.tipoProduto ? `${p.tipoProduto} — ` : "";
      return `
        <tr>
          <td><a href="/pedido/${p._id}" style="font-weight:900;color:var(--gold2)">#${esc(num)}</a> ${badge}</td>
          <td>${esc(clienteNome)}</td>
          <td>${esc(tipo + p.produto)}</td>
          <td>R$ ${money(p.valor)}</td>
          <td>R$ ${money(p.sinal || 0)}</td>
          <td>R$ ${money(saldoPedido(p.valor, p.sinal))}</td>
          <td>${esc(p.status)}</td>
          <td>${esc(entregaResumo(p.entrega))}</td>
          <td>
            <form method="POST" action="/pedido/${p._id}/toggle-archive?mes=${encodeURIComponent(mesKey)}&q=${encodeURIComponent(q)}&show_archived=${showArchived ? "1" : ""}" style="margin:0;">
              <button class="btn" type="submit">${p.arquivado ? "Desarquivar" : "Arquivar"}</button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  const blocoBaixoEstoque = `
    <div class="card" style="margin-top:12px;">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Baixo estoque</div>
      ${
        itensBaixo.length
          ? itensBaixo
              .map(
                (i) => `
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;margin-bottom:8px;">
            <a href="/estoque/${i._id}" style="font-weight:900;color:var(--gold2)">${esc(i.nome)}</a>
            <div class="mini" style="margin-top:4px;">${esc(String(i.quantidade || 0))} ${esc(i.unidade || "un")} (mín: ${esc(String(i.minimo || 0))})</div>
          </div>
        `
              )
              .join("")
          : `<div class="muted">Tudo ok no estoque 👌</div>`
      }
    </div>
  `;

  const conteudo = `
    <div class="row" style="justify-content:space-between;margin-bottom:10px;">
      <h2 class="h1">Dashboard</h2>
      <div class="row">
        <a class="btn" href="${esc(toggleLink)}">${esc(toggleText)}</a>
        <a class="btn" href="/relatorio?mes=${encodeURIComponent(mesKey)}">Baixar PDF (mês)</a>
        <a class="btn" href="/export/pedidos.csv?mes=${encodeURIComponent(mesKey)}">Exportar Pedidos (CSV)</a>
      </div>
    </div>

    <div class="muted" style="margin-bottom:8px;">Mês: <b style="color:#fff">${esc(monthLabelPT(mesKey))}</b></div>

    ${busca}

    <div class="grid grid-3" style="max-width:920px;">
      <div class="card kpi">
        <div class="label">Faturamento (Pago) — ${esc(monthLabelPT(mesKey))}</div>
        <div class="value">R$ ${money(faturamentoMes)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Despesas — ${esc(monthLabelPT(mesKey))}</div>
        <div class="value" style="color:#fff">R$ ${money(totalDespesas)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Lucro líquido — ${esc(monthLabelPT(mesKey))}</div>
        <div class="value">R$ ${money(lucro)}</div>
      </div>
    </div>

    ${blocoBaixoEstoque}

    <div class="spacer"></div>

    <div class="grid grid-2">
      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Pendentes</div>
        ${cardList(pendentes)}
      </div>
      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Pagos / Finalizados</div>
        ${cardList(pagos)}
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">
        Pedidos (últimos) ${q ? `— buscando: "${esc(q)}"` : ""}
      </div>
      <div class="tablewrap">
        <table style="min-width:1400px;">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Produto</th>
              <th>Valor</th>
              <th>Sinal</th>
              <th>Saldo</th>
              <th>Status</th>
              <th>Entrega</th>
              <th>Arquivar</th>
            </tr>
          </thead>
          <tbody>
            ${linhasTabela || `<tr><td colspan="9" class="muted" style="padding:12px;">Nenhum pedido encontrado.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  res.send(layout("Dashboard", conteudo));
});

app.post("/pedido/:id/toggle-archive", requireLogin, async (req, res) => {
  const p = await Pedido.findById(req.params.id);
  if (p) {
    p.arquivado = !Boolean(p.arquivado);
    await p.save();
  }

  const mes = String(req.query.mes || "").trim();
  const q = String(req.query.q || "").trim();
  const showArchived = String(req.query.show_archived || "") === "1";

  const qs = new URLSearchParams();
  if (mes) qs.set("mes", mes);
  if (q) qs.set("q", q);
  if (showArchived) qs.set("show_archived", "1");

  return res.redirect(`/dashboard${qs.toString() ? "?" + qs.toString() : ""}`);
});

// ===== TELA DO PEDIDO =====
function checklistCheckbox(label, name, checked) {
  const chk = checked ? "checked" : "";
  return `
    <label style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;">
      <input type="checkbox" name="${esc(name)}" ${chk} style="transform:scale(1.2);">
      <span>${esc(label)}</span>
    </label>
  `;
}

app.get("/pedido/:id", requireLogin, async (req, res) => {
  const pedido = await Pedido.findById(req.params.id).populate("clienteId");
  if (!pedido) return res.send(layout("Pedido", `<div class="card">Pedido não encontrado. <a href="/dashboard">Voltar</a></div>`));

  const num = String(pedido.numero || 0).padStart(4, "0");
  const clienteNome = pedido.clienteId?.nome || "Cliente";
  const whatsapp = pedido.clienteId?.whatsapp || "";
  const wa = waLinkBR(whatsapp);

  const tipo = pedido.tipoProduto ? `${pedido.tipoProduto} — ` : "";
  const saldo = saldoPedido(pedido.valor, pedido.sinal);

  const e = pedido.entrega || {};
  const templates = buildWhatsTemplates({
    clienteNome,
    pedidoNumero: pedido.numero,
    produtoDesc: pedido.produto,
    tipoProduto: pedido.tipoProduto,
    valor: pedido.valor,
    sinal: pedido.sinal,
    saldo,
    status: pedido.status,
  });
  const templatesJSON = JSON.stringify(templates);

  const conteudo = `
    <div class="row" style="justify-content:space-between;margin-bottom:10px;">
      <h2 class="h1">Pedido #${esc(num)}</h2>
      <div class="row">
        <a class="btn" href="/dashboard">← Voltar</a>
        ${wa ? `<a class="btn btn-gold" href="${esc(wa)}" target="_blank">WhatsApp</a>` : ""}
        <a class="btn" href="/pedido/${pedido._id}/recibo.pdf">Baixar recibo (PDF)</a>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="muted">Criado em: ${esc(fmtDateBR(pedido.criadoEm))}</div>
        <div style="margin-top:10px;"><b>Cliente:</b> ${esc(clienteNome)}</div>
        <div style="margin-top:6px;"><b>Produto:</b> ${esc(tipo + pedido.produto)}</div>

        <div class="spacer"></div>

        <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
            <div class="mini">Valor</div>
            <div style="font-weight:900;">R$ ${money(pedido.valor)}</div>
          </div>
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
            <div class="mini">Sinal</div>
            <div style="font-weight:900;">R$ ${money(pedido.sinal || 0)}</div>
          </div>
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
            <div class="mini">Saldo</div>
            <div style="font-weight:900;">R$ ${money(saldo)}</div>
          </div>
        </div>

        <div class="spacer"></div>

        <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
          <div class="mini">Entrega/Retirada</div>
          <div style="font-weight:900;">${esc(entregaResumo(e))}</div>
        </div>

        <div class="spacer"></div>

        <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px;">
          <div style="color:var(--gold2);font-weight:900;margin-bottom:8px;">Mensagens prontas (WhatsApp)</div>

          <div class="row">
            <select class="input" id="tplSel" style="flex:1;min-width:240px;">
              ${templates.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join("")}
            </select>

            <button class="btn btn-gold" type="button" onclick="openWA()">Enviar no WhatsApp</button>
          </div>

          <div class="spacer"></div>

          <textarea class="input" id="tplText" rows="6"></textarea>
          <div class="mini" style="margin-top:6px;">Você pode editar o texto antes de enviar.</div>

          <script>
            (function(){
              const templates = ${templatesJSON};
              const sel = document.getElementById('tplSel');
              const ta = document.getElementById('tplText');
              function getTpl(){
                const key = sel.value;
                return templates.find(t => t.key === key) || templates[0];
              }
              function refresh(){
                const t = getTpl();
                ta.value = t ? t.text : '';
              }
              sel.addEventListener('change', refresh);
              refresh();

              window.openWA = function(){
                const phone = "${esc(onlyDigits(whatsapp))}";
                if (!phone) { alert("Cliente sem WhatsApp."); return; }
                const base = phone.startsWith("55") ? ("https://wa.me/" + phone) : ("https://wa.me/55" + phone);
                const text = encodeURIComponent(ta.value || "");
                window.open(base + "?text=" + text, "_blank");
              };
            })();
          </script>
        </div>
      </div>

      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Atualizações</div>

        <form method="POST" action="/pedido/${pedido._id}/status" class="row" style="margin:0 0 10px;">
          <select class="input" name="status" style="flex:1;min-width:240px;">${statusOptions(STATUS_LIST, pedido.status)}</select>
          <button class="btn btn-gold" type="submit">Salvar status</button>
        </form>

        <form method="POST" action="/pedido/${pedido._id}/valores" style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px;">
          <div class="mini" style="margin-bottom:6px;">Editar valor/sinal</div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <input class="input" name="valor" value="${esc(money(pedido.valor))}">
            <input class="input" name="sinal" value="${esc(money(pedido.sinal || 0))}">
          </div>
          <div class="spacer"></div>
          <button class="btn btn-gold" type="submit">Salvar valores</button>
        </form>

        <form method="POST" action="/pedido/${pedido._id}/entrega" style="margin-top:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:12px;">
          <div style="color:var(--gold2);font-weight:900;margin-bottom:8px;">Entrega / Retirada</div>

          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Tipo</div>
              <select class="input" name="tipo">${entregaOptions(ENTREGA_TIPOS, e.tipo || "Retirada")}</select>
            </div>
            <div>
              <div class="mini">Data (dd/mm/aaaa)</div>
              <input class="input" name="data" value="${esc(e.data ? fmtDateBR(e.data) : "")}" placeholder="Ex: 01/03/2026">
            </div>
          </div>

          <div class="spacer"></div>

          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Quem retirou</div>
              <input class="input" name="quemRetirou" value="${esc(e.quemRetirou || "")}" placeholder="Ex: Cliente / João / Motoboy">
            </div>
            <div>
              <div class="mini">Observação</div>
              <input class="input" name="observacao" value="${esc(e.observacao || "")}" placeholder="Ex: deixou na portaria / rastreio...">
            </div>
          </div>

          <div class="spacer"></div>
          <button class="btn btn-gold" type="submit">Salvar entrega</button>
        </form>

        <form method="POST" action="/pedido/${pedido._id}/toggle-archive?from=pedido" style="margin-top:12px;">
          <button class="btn" type="submit">${pedido.arquivado ? "Desarquivar" : "Arquivar"}</button>
        </form>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Checklist</div>
      <form method="POST" action="/pedido/${pedido._id}/checklist" class="grid grid-2">
        ${checklistCheckbox("Arte recebida", "arteRecebida", Boolean(pedido.checklist?.arteRecebida))}
        ${checklistCheckbox("Arte aprovada", "arteAprovada", Boolean(pedido.checklist?.arteAprovada))}
        ${checklistCheckbox("Impresso", "impresso", Boolean(pedido.checklist?.impresso))}
        ${checklistCheckbox("Cortado", "cortado", Boolean(pedido.checklist?.cortado))}
        ${checklistCheckbox("Entregue", "entregue", Boolean(pedido.checklist?.entregue))}
        <div style="grid-column:1/-1;">
          <div class="spacer"></div>
          <button class="btn btn-gold" type="submit">Salvar checklist</button>
        </div>
      </form>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Anotações</div>
      <form method="POST" action="/pedido/${pedido._id}/anotacoes">
        <textarea class="input" name="anotacoes" rows="6">${esc(pedido.anotacoes || "")}</textarea>
        <div class="spacer"></div>
        <button class="btn btn-gold" type="submit">Salvar anotações</button>
      </form>
    </div>
  `;

  res.send(layout(`Pedido #${num}`, conteudo));
});

app.post("/pedido/:id/valores", requireLogin, async (req, res) => {
  const v = parseMoneyBR(req.body.valor);
  const s = parseMoneyBR(req.body.sinal);
  if (!Number.isFinite(v) || v < 0) return res.send(layout("Erro", `<div class="card">Valor inválido. <a href="/pedido/${req.params.id}">Voltar</a></div>`));
  if (!Number.isFinite(s) || s < 0) return res.send(layout("Erro", `<div class="card">Sinal inválido. <a href="/pedido/${req.params.id}">Voltar</a></div>`));

  const sinalVal = Math.max(0, Math.min(v, s));
  await Pedido.findByIdAndUpdate(req.params.id, { valor: v, sinal: sinalVal });
  res.redirect(`/pedido/${req.params.id}`);
});

app.post("/pedido/:id/anotacoes", requireLogin, async (req, res) => {
  const anotacoes = String(req.body.anotacoes || "");
  await Pedido.findByIdAndUpdate(req.params.id, { anotacoes });
  res.redirect(`/pedido/${req.params.id}`);
});

app.post("/pedido/:id/checklist", requireLogin, async (req, res) => {
  const nextChecklist = {
    arteRecebida: !!req.body.arteRecebida,
    arteAprovada: !!req.body.arteAprovada,
    impresso: !!req.body.impresso,
    cortado: !!req.body.cortado,
    entregue: !!req.body.entregue,
  };
  await Pedido.findByIdAndUpdate(req.params.id, { checklist: nextChecklist });
  res.redirect(`/pedido/${req.params.id}`);
});

app.post("/pedido/:id/status", requireLogin, async (req, res) => {
  const novoStatus = String(req.body.status || "").trim();
  if (!STATUS_LIST.includes(novoStatus)) return res.send(layout("Erro", `<div class="card">Status inválido. <a href="/pedido/${req.params.id}">Voltar</a></div>`));

  await Pedido.findByIdAndUpdate(req.params.id, { status: novoStatus });
  return res.redirect(`/pedido/${req.params.id}`);
});

app.post("/pedido/:id/entrega", requireLogin, async (req, res) => {
  const tipo = String(req.body.tipo || "Retirada").trim();
  const data = parseDateBR(req.body.data);
  const quemRetirou = String(req.body.quemRetirou || "").trim();
  const observacao = String(req.body.observacao || "").trim();

  await Pedido.findByIdAndUpdate(req.params.id, {
    entrega: {
      tipo: ENTREGA_TIPOS.includes(tipo) ? tipo : "Retirada",
      data: data || null,
      quemRetirou,
      observacao,
    },
  });

  res.redirect(`/pedido/${req.params.id}`);
});

app.post("/pedido/:id/toggle-archive", requireLogin, async (req, res) => {
  const p = await Pedido.findById(req.params.id);
  if (p) {
    p.arquivado = !Boolean(p.arquivado);
    await p.save();
  }
  const from = String(req.query.from || "");
  if (from === "pedido") return res.redirect(`/pedido/${req.params.id}`);
  return res.redirect("/dashboard");
});

// ===== RECIBO PDF =====
app.get("/pedido/:id/recibo.pdf", requireLogin, async (req, res) => {
  const pedido = await Pedido.findById(req.params.id).populate("clienteId");
  if (!pedido) return res.status(404).send("Pedido não encontrado");

  const num = String(pedido.numero || 0).padStart(4, "0");
  const saldo = saldoPedido(pedido.valor, pedido.sinal);
  const e = pedido.entrega || {};

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="recibo-pedido-${num}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text("Atlas Creative - Comprovante de Pedido");
  doc.moveDown(0.5);

  doc.fontSize(12).text(`Pedido: #${num}`);
  doc.text(`Data: ${fmtDateBR(pedido.criadoEm)}`);
  doc.text(`Cliente: ${pedido.clienteId?.nome || "-"}`);
  doc.text(`WhatsApp: ${pedido.clienteId?.whatsapp || "-"}`);
  doc.moveDown();

  doc.fontSize(12).text(`Tipo: ${pedido.tipoProduto || "-"}`);
  doc.text(`Produto: ${pedido.produto}`);
  doc.text(`Valor: R$ ${money(pedido.valor)}`);
  doc.text(`Sinal: R$ ${money(pedido.sinal || 0)}`);
  doc.text(`Saldo: R$ ${money(saldo)}`);
  doc.text(`Status: ${pedido.status}`);
  doc.text(`Entrega: ${entregaResumo(e)}`);
  doc.moveDown();

  doc.fontSize(12).text("Checklist:", { underline: true });
  doc.moveDown(0.3);
  const ck = pedido.checklist || {};
  const items = [
    ["Arte recebida", !!ck.arteRecebida],
    ["Arte aprovada", !!ck.arteAprovada],
    ["Impresso", !!ck.impresso],
    ["Cortado", !!ck.cortado],
    ["Entregue", !!ck.entregue],
  ];
  items.forEach(([label, ok]) => doc.text(`${ok ? "✅" : "⬜"} ${label}`));

  if (pedido.anotacoes) {
    doc.moveDown();
    doc.fontSize(12).text("Observações:", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(11).text(pedido.anotacoes);
  }

  doc.end();
});

// ===== FINANCEIRO =====
app.get("/financeiro", requireLogin, async (req, res) => {
  const mesParam = String(req.query.mes || "").trim();
  const { start: ini, end: fim, key: mesKey } = monthRangeFromKey(mesParam || monthKeyFromDate(new Date()));

  const despesas = await Despesa.find({ data: { $gte: ini, $lt: fim } }).sort({ data: -1 });
  const totalDespesas = despesas.reduce((t, d) => t + Number(d.valor || 0), 0);

  const pedidosMes = await Pedido.find({ criadoEm: { $gte: ini, $lt: fim } });
  const faturamentoMes = pedidosMes.filter((p) => p.status === "Pago").reduce((t, p) => t + Number(p.valor || 0), 0);
  const lucro = faturamentoMes - totalDespesas;

  const linhas = despesas
    .map((d) => `
      <tr>
        <td>${esc(fmtDateBR(d.data))}</td>
        <td>${esc(d.categoria || "Geral")}</td>
        <td>${esc(d.descricao)}</td>
        <td>R$ ${money(d.valor)}</td>
        <td>
          <form method="POST" action="/despesa/${d._id}/delete?mes=${encodeURIComponent(mesKey)}" onsubmit="return confirm('Excluir esta despesa?');" style="margin:0;">
            <button class="btn" type="submit">Excluir</button>
          </form>
        </td>
      </tr>
    `)
    .join("");

  const conteudo = `
    <div class="row" style="justify-content:space-between;margin-bottom:10px;">
      <h2 class="h1">Financeiro</h2>
      <div class="row">
        <a class="btn" href="/relatorio?mes=${encodeURIComponent(mesKey)}">Baixar PDF (mês)</a>
        <a class="btn" href="/export/pedidos.csv?mes=${encodeURIComponent(mesKey)}">Exportar Pedidos (CSV)</a>
        <a class="btn" href="/export/despesas.csv?mes=${encodeURIComponent(mesKey)}">Exportar Despesas (CSV)</a>
      </div>
    </div>

    <div class="muted" style="margin-bottom:8px;">Mês: <b style="color:#fff">${esc(monthLabelPT(mesKey))}</b></div>

    <div class="grid grid-3" style="max-width:920px;">
      <div class="card kpi">
        <div class="label">Faturamento (Pago)</div>
        <div class="value">R$ ${money(faturamentoMes)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Despesas</div>
        <div class="value" style="color:#fff">R$ ${money(totalDespesas)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Lucro líquido</div>
        <div class="value">R$ ${money(lucro)}</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="grid grid-2">
      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Adicionar despesa</div>
        <form method="POST" action="/financeiro/despesa?mes=${encodeURIComponent(mesKey)}">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Descrição</div>
              <input class="input" name="descricao" required>
            </div>
            <div>
              <div class="mini">Categoria</div>
              <select class="input" name="categoria">
                <option>Geral</option><option>Papel</option><option>Tinta</option><option>Material</option>
                <option>Energia</option><option>Terceiros</option><option>Frete</option>
              </select>
            </div>
          </div>

          <div class="spacer"></div>

          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Valor</div>
              <input class="input" name="valor" required>
            </div>
            <div>
              <div class="mini">Data (dd/mm/aaaa opcional)</div>
              <input class="input" name="data" placeholder="Ex: 01/03/2026">
            </div>
          </div>

          <div class="spacer"></div>

          <button class="btn btn-gold" type="submit">Salvar despesa</button>
        </form>
      </div>

      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Dica</div>
        <div class="muted">O lucro líquido aqui é: faturamento (status “Pago”) - despesas do mês.</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Despesas do mês</div>
      <div class="tablewrap">
        <table style="min-width:980px;">
          <thead>
            <tr>
              <th>Data</th>
              <th>Categoria</th>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${linhas || `<tr><td colspan="5" class="muted" style="padding:12px;">Nenhuma despesa cadastrada neste mês.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  res.send(layout("Financeiro", conteudo));
});

app.post("/financeiro/despesa", requireLogin, async (req, res) => {
  const { descricao, categoria, valor, data } = req.body;
  const v = parseMoneyBR(valor);
  if (!Number.isFinite(v)) return res.send(layout("Erro", `<div class="card">Valor inválido. <a href="/financeiro">Voltar</a></div>`));

  let d = new Date();
  const rawDate = String(data || "").trim();
  if (rawDate) {
    const parsed = parseDateBR(rawDate);
    if (parsed) d = parsed;
  }

  await Despesa.create({
    descricao: String(descricao || "").trim(),
    categoria: String(categoria || "Geral").trim(),
    valor: v,
    data: d,
  });

  const mes = String(req.query.mes || "").trim();
  return res.redirect(mes ? `/financeiro?mes=${encodeURIComponent(mes)}` : "/financeiro");
});

app.post("/despesa/:id/delete", requireLogin, async (req, res) => {
  await Despesa.findByIdAndDelete(req.params.id);
  const mes = String(req.query.mes || "").trim();
  return res.redirect(mes ? `/financeiro?mes=${encodeURIComponent(mes)}` : "/financeiro");
});

// ===== RELATÓRIO MENSAL PDF =====
app.get("/relatorio", requireLogin, async (req, res) => {
  const mesParam = String(req.query.mes || "").trim();
  const { start: ini, end: fim, key: mesKey } = monthRangeFromKey(mesParam || monthKeyFromDate(new Date()));

  const pedidosMes = await Pedido.find({ criadoEm: { $gte: ini, $lt: fim } }).populate("clienteId").sort({ criadoEm: 1 });
  const despesasMes = await Despesa.find({ data: { $gte: ini, $lt: fim } }).sort({ data: 1 });

  const faturamento = pedidosMes.filter((p) => p.status === "Pago").reduce((t, p) => t + Number(p.valor || 0), 0);
  const despesas = despesasMes.reduce((t, d) => t + Number(d.valor || 0), 0);
  const lucro = faturamento - despesas;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="relatorio-${mesKey}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).text("Atlas Creative - Relatório Mensal");
  doc.moveDown(0.2);
  doc.fontSize(12).text(`Mês: ${monthLabelPT(mesKey)}`);
  doc.text(`Gerado em: ${fmtDateBR(new Date())}`);
  doc.moveDown();

  doc.fontSize(14).text("Resumo", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Faturamento (Pago): R$ ${money(faturamento)}`);
  doc.text(`Despesas: R$ ${money(despesas)}`);
  doc.text(`Lucro líquido: R$ ${money(lucro)}`);
  doc.moveDown();

  doc.fontSize(14).text("Pedidos do mês", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).text("Pedido | Data | Cliente | Tipo | Produto | Valor | Sinal | Saldo | Status | Entrega");
  doc.moveDown(0.3);

  pedidosMes.forEach((p) => {
    const num = String(p.numero).padStart(4, "0");
    const cli = p.clienteId?.nome ? p.clienteId.nome : "-";
    doc.text(
      `#${num} | ${fmtDateBR(p.criadoEm)} | ${cli} | ${p.tipoProduto || "-"} | ${p.produto} | R$ ${money(p.valor)} | R$ ${money(
        p.sinal || 0
      )} | R$ ${money(saldoPedido(p.valor, p.sinal))} | ${p.status} | ${entregaResumo(p.entrega)}`
    );
  });

  doc.moveDown();
  doc.fontSize(14).text("Despesas do mês", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).text("Data | Categoria | Descrição | Valor");
  doc.moveDown(0.3);

  despesasMes.forEach((d) => {
    doc.text(`${fmtDateBR(d.data)} | ${d.categoria} | ${d.descricao} | R$ ${money(d.valor)}`);
  });

  doc.end();
});

// ===== EXPORT CSV (mês) =====
app.get("/export/pedidos.csv", requireLogin, async (req, res) => {
  const mesParam = String(req.query.mes || "").trim();
  const { start: ini, end: fim, key: mesKey } = monthRangeFromKey(mesParam || monthKeyFromDate(new Date()));

  const pedidosMes = await Pedido.find({ criadoEm: { $gte: ini, $lt: fim } }).populate("clienteId").sort({ criadoEm: 1 });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pedidos-${mesKey}.csv"`);

  const header = [
    "numero","data","cliente","whatsapp","tipoProduto","produto","valor","sinal","saldo","status","arquivado",
    "entrega_tipo","entrega_data","entrega_quem","entrega_observacao",
    "arteRecebida","arteAprovada","impresso","cortado","entregue","anotacoes"
  ];
  const lines = [header.join(",")];

  pedidosMes.forEach((p) => {
    const ck = p.checklist || {};
    const e = p.entrega || {};
    lines.push(
      [
        p.numero,
        fmtDateBR(p.criadoEm),
        p.clienteId?.nome || "",
        p.clienteId?.whatsapp || "",
        p.tipoProduto || "",
        p.produto || "",
        String(p.valor).replace(".", ","),
        String(p.sinal || 0).replace(".", ","),
        String(saldoPedido(p.valor, p.sinal)).replace(".", ","),
        p.status,
        p.arquivado ? "Sim" : "Não",
        e.tipo || "",
        fmtDateBR(e.data),
        e.quemRetirou || "",
        (e.observacao || "").replace(/\r?\n/g, " "),
        ck.arteRecebida ? "1" : "0",
        ck.arteAprovada ? "1" : "0",
        ck.impresso ? "1" : "0",
        ck.cortado ? "1" : "0",
        ck.entregue ? "1" : "0",
        (p.anotacoes || "").replace(/\r?\n/g, " "),
      ].map(csvEscape).join(",")
    );
  });

  res.send(lines.join("\n"));
});

app.get("/export/despesas.csv", requireLogin, async (req, res) => {
  const mesParam = String(req.query.mes || "").trim();
  const { start: ini, end: fim, key: mesKey } = monthRangeFromKey(mesParam || monthKeyFromDate(new Date()));

  const despesasMes = await Despesa.find({ data: { $gte: ini, $lt: fim } }).sort({ data: 1 });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="despesas-${mesKey}.csv"`);

  const header = ["data", "categoria", "descricao", "valor"];
  const lines = [header.join(",")];

  despesasMes.forEach((d) => {
    lines.push(
      [
        fmtDateBR(d.data),
        d.categoria || "",
        d.descricao,
        String(d.valor).replace(".", ","),
      ].map(csvEscape).join(",")
    );
  });

  res.send(lines.join("\n"));
});

// ===== ESTOQUE =====
app.get("/estoque", requireLogin, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const filtro = q
    ? {
        $or: [
          { nome: { $regex: q, $options: "i" } },
          { categoria: { $regex: q, $options: "i" } },
          { fornecedor: { $regex: q, $options: "i" } },
          { local: { $regex: q, $options: "i" } },
        ],
      }
    : {};

  const itens = await EstoqueItem.find(filtro).sort({ atualizadoEm: -1 });
  const baixo = itens.filter((i) => Number(i.quantidade || 0) <= Number(i.minimo || 0));

  const busca = `
    <form method="GET" action="/estoque" class="row" style="margin:0 0 12px;">
      <input class="input" name="q" value="${esc(q)}" placeholder="Buscar item, categoria, fornecedor, local..." style="flex:1;min-width:260px;">
      <button class="btn btn-gold" type="submit">Buscar</button>
      ${q ? `<a class="btn" href="/estoque">Limpar</a>` : ""}
    </form>
  `;

  const linhas = itens
    .map((i) => {
      const qtd = Number(i.quantidade || 0);
      const min = Number(i.minimo || 0);
      const estado =
        qtd <= 0 ? `<span class="pill dangerpill">ZERADO</span>` :
        qtd <= min ? `<span class="pill warn">BAIXO</span>` :
        `<span class="pill">OK</span>`;

      return `
        <tr>
          <td>
            <a href="/estoque/${i._id}" style="font-weight:900;color:var(--gold2)">${esc(i.nome)}</a>
            <div class="mini">${esc(i.categoria || "Geral")}</div>
          </td>
          <td>${estado}</td>
          <td>${esc(String(qtd))} ${esc(i.unidade || "un")}</td>
          <td>${esc(String(min))}</td>
          <td>R$ ${money(i.custo || 0)}</td>
          <td>${esc(i.fornecedor || "-")}</td>
          <td>${esc(i.local || "-")}</td>
          <td>
            <form method="POST" action="/estoque/${i._id}/delete" onsubmit="return confirm('Excluir item do estoque?');" style="margin:0;">
              <button class="btn" type="submit">Excluir</button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <div class="row" style="justify-content:space-between;margin-bottom:10px;">
      <h2 class="h1">Estoque</h2>
      ${baixo.length ? `<span class="pill dangerpill">Baixo estoque: ${baixo.length}</span>` : `<span class="pill">OK</span>`}
    </div>

    ${busca}

    <div class="grid grid-2">
      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:8px;">Cadastrar item</div>
        <form method="POST" action="/estoque">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Nome</div>
              <input class="input" name="nome" required placeholder="Ex: Papel couchê 300g A4">
            </div>
            <div>
              <div class="mini">Categoria</div>
              <input class="input" name="categoria" placeholder="Papel / Tinta / Vinil / Embalagem...">
            </div>
            <div>
              <div class="mini">Unidade</div>
              <input class="input" name="unidade" placeholder="un / folha / metro / litro">
            </div>
            <div>
              <div class="mini">Estoque mínimo</div>
              <input class="input" name="minimo" placeholder="Ex: 10">
            </div>
          </div>

          <div class="spacer"></div>

          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Fornecedor</div>
              <input class="input" name="fornecedor" placeholder="Ex: Kalunga / Mercado Livre">
            </div>
            <div>
              <div class="mini">Local</div>
              <input class="input" name="local" placeholder="Ex: Prateleira 1 / Gaveta A">
            </div>
          </div>

          <div class="spacer"></div>

          <div>
            <div class="mini">Observação</div>
            <input class="input" name="observacao" placeholder="Ex: usar na L4260 / válido para tags...">
          </div>

          <div class="spacer"></div>

          <button class="btn btn-gold" type="submit">Salvar item</button>
        </form>
      </div>

      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:8px;">Itens com baixo estoque</div>
        ${
          baixo.slice(0, 8).map(i => `
            <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;margin-bottom:8px;">
              <a href="/estoque/${i._id}" style="font-weight:900;color:var(--gold2)">${esc(i.nome)}</a>
              <div class="mini" style="margin-top:4px;">${esc(i.categoria || "Geral")} — ${esc(String(i.quantidade || 0))} ${esc(i.unidade || "un")} (mín: ${esc(String(i.minimo || 0))})</div>
            </div>
          `).join("") || `<div class="muted">Nenhum item em baixo estoque 👌</div>`
        }
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Lista de itens</div>
      <div class="tablewrap">
        <table style="min-width:1000px;">
          <thead>
            <tr>
              <th>Item</th>
              <th>Status</th>
              <th>Qtd</th>
              <th>Mín</th>
              <th>Custo</th>
              <th>Fornecedor</th>
              <th>Local</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            ${linhas || `<tr><td colspan="8" class="muted" style="padding:12px;">Nenhum item cadastrado.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  res.send(layout("Estoque", conteudo));
});

app.post("/estoque", requireLogin, async (req, res) => {
  const nome = String(req.body.nome || "").trim();
  if (!nome) return res.send(layout("Erro", `<div class="card">Nome inválido. <a href="/estoque">Voltar</a></div>`));

  const minimo = Number(String(req.body.minimo || "0").replace(",", "."));
  const unidade = String(req.body.unidade || "un").trim() || "un";

  await EstoqueItem.create({
    nome,
    categoria: String(req.body.categoria || "Geral").trim() || "Geral",
    unidade,
    minimo: Number.isFinite(minimo) ? minimo : 0,
    fornecedor: String(req.body.fornecedor || "").trim(),
    local: String(req.body.local || "").trim(),
    observacao: String(req.body.observacao || "").trim(),
    atualizadoEm: new Date(),
  });

  res.redirect("/estoque");
});

app.post("/estoque/:id/delete", requireLogin, async (req, res) => {
  await EstoqueMov.deleteMany({ itemId: req.params.id });
  await EstoqueItem.findByIdAndDelete(req.params.id);
  res.redirect("/estoque");
});

app.get("/estoque/:id", requireLogin, async (req, res) => {
  const item = await EstoqueItem.findById(req.params.id);
  if (!item) return res.send(layout("Estoque", `<div class="card">Item não encontrado. <a href="/estoque">Voltar</a></div>`));

  const movs = await EstoqueMov.find({ itemId: item._id }).sort({ criadoEm: -1 }).limit(50);

  const qtd = Number(item.quantidade || 0);
  const min = Number(item.minimo || 0);
  const estado =
    qtd <= 0 ? `<span class="pill dangerpill">ZERADO</span>` :
    qtd <= min ? `<span class="pill warn">BAIXO</span>` :
    `<span class="pill">OK</span>`;

  const linhasMov = movs.map(m => `
    <tr>
      <td>${esc(fmtDateBR(m.criadoEm))}</td>
      <td>${esc(m.tipo)}</td>
      <td>${esc(String(m.quantidade))}</td>
      <td>${esc(m.motivo || "-")}</td>
      <td>${m.pedidoNumero ? `#${esc(String(m.pedidoNumero).padStart(4,"0"))}` : "-"}</td>
      <td>${m.custoUnitario != null ? `R$ ${money(m.custoUnitario)}` : "-"}</td>
    </tr>
  `).join("");

  const conteudo = `
    <div class="row" style="justify-content:space-between;margin-bottom:10px;">
      <div>
        <h2 class="h1">${esc(item.nome)}</h2>
        <div class="muted">${esc(item.categoria || "Geral")} • ${estado}</div>
      </div>
      <div class="row">
        <a class="btn" href="/estoque">← Voltar</a>
      </div>
    </div>

    <div class="grid grid-3">
      <div class="card kpi">
        <div class="label">Quantidade</div>
        <div class="value">${esc(String(qtd))} ${esc(item.unidade || "un")}</div>
        <div class="muted">Mínimo: ${esc(String(min))}</div>
      </div>
      <div class="card kpi">
        <div class="label">Custo (referência)</div>
        <div class="value">R$ ${money(item.custo || 0)}</div>
        <div class="muted">Fornecedor: ${esc(item.fornecedor || "-")}</div>
      </div>
      <div class="card kpi">
        <div class="label">Local</div>
        <div class="value">${esc(item.local || "-")}</div>
        <div class="muted">Atualizado: ${esc(fmtDateBR(item.atualizadoEm))}</div>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="grid grid-2">
      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:8px;">Movimentar estoque</div>
        <form method="POST" action="/estoque/${item._id}/mov">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Tipo</div>
              <select class="input" name="tipo">
                <option>Entrada</option>
                <option>Saída</option>
                <option>Ajuste</option>
              </select>
            </div>
            <div>
              <div class="mini">Quantidade</div>
              <input class="input" name="quantidade" required placeholder="Ex: 10">
            </div>
          </div>

          <div class="spacer"></div>

          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Motivo (opcional)</div>
              <input class="input" name="motivo" placeholder="Ex: compra / uso em pedido / ajuste inventário">
            </div>
            <div>
              <div class="mini">Custo unit. (entrada, opcional)</div>
              <input class="input" name="custoUnitario" placeholder="Ex: 2,50">
            </div>
          </div>

          <div class="spacer"></div>

          <div>
            <div class="mini">Vincular ao pedido (nº opcional)</div>
            <input class="input" name="pedidoNumero" placeholder="Ex: 12">
          </div>

          <div class="spacer"></div>

          <button class="btn btn-gold" type="submit">Salvar movimentação</button>
        </form>
      </div>

      <div class="card">
        <div style="color:var(--gold2);font-weight:900;margin-bottom:8px;">Editar dados do item</div>
        <form method="POST" action="/estoque/${item._id}/edit">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Categoria</div>
              <input class="input" name="categoria" value="${esc(item.categoria || "Geral")}">
            </div>
            <div>
              <div class="mini">Unidade</div>
              <input class="input" name="unidade" value="${esc(item.unidade || "un")}">
            </div>
            <div>
              <div class="mini">Mínimo</div>
              <input class="input" name="minimo" value="${esc(String(item.minimo || 0))}">
            </div>
            <div>
              <div class="mini">Custo</div>
              <input class="input" name="custo" value="${esc(money(item.custo || 0))}">
            </div>
          </div>

          <div class="spacer"></div>

          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div class="mini">Fornecedor</div>
              <input class="input" name="fornecedor" value="${esc(item.fornecedor || "")}">
            </div>
            <div>
              <div class="mini">Local</div>
              <input class="input" name="local" value="${esc(item.local || "")}">
            </div>
          </div>

          <div class="spacer"></div>

          <div>
            <div class="mini">Observação</div>
            <input class="input" name="observacao" value="${esc(item.observacao || "")}">
          </div>

          <div class="spacer"></div>

          <button class="btn btn-gold" type="submit">Salvar dados</button>
        </form>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <div style="color:var(--gold2);font-weight:900;margin-bottom:10px;">Histórico (últimas 50)</div>
      <div class="tablewrap">
        <table style="min-width:900px;">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Qtd</th>
              <th>Motivo</th>
              <th>Pedido</th>
              <th>Custo unit.</th>
            </tr>
          </thead>
          <tbody>
            ${linhasMov || `<tr><td colspan="6" class="muted" style="padding:12px;">Sem movimentações ainda.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  res.send(layout("Item do estoque", conteudo));
});

app.post("/estoque/:id/edit", requireLogin, async (req, res) => {
  const minimo = Number(String(req.body.minimo || "0").replace(",", "."));
  const custo = parseMoneyBR(req.body.custo);

  await EstoqueItem.findByIdAndUpdate(req.params.id, {
    categoria: String(req.body.categoria || "Geral").trim() || "Geral",
    unidade: String(req.body.unidade || "un").trim() || "un",
    minimo: Number.isFinite(minimo) ? minimo : 0,
    custo: Number.isFinite(custo) ? custo : 0,
    fornecedor: String(req.body.fornecedor || "").trim(),
    local: String(req.body.local || "").trim(),
    observacao: String(req.body.observacao || "").trim(),
    atualizadoEm: new Date(),
  });

  res.redirect(`/estoque/${req.params.id}`);
});

app.post("/estoque/:id/mov", requireLogin, async (req, res) => {
  const item = await EstoqueItem.findById(req.params.id);
  if (!item) return res.redirect("/estoque");

  const tipo = String(req.body.tipo || "Entrada").trim();
  const qtd = Number(String(req.body.quantidade || "0").replace(",", "."));
  if (!Number.isFinite(qtd) || qtd <= 0) {
    return res.send(layout("Erro", `<div class="card">Quantidade inválida. <a href="/estoque/${item._id}">Voltar</a></div>`));
  }

  const motivo = String(req.body.motivo || "").trim();
  const pedidoNumeroRaw = String(req.body.pedidoNumero || "").trim();
  const pedidoNumero = pedidoNumeroRaw ? Number(pedidoNumeroRaw) : null;

  const custoUnitario = String(req.body.custoUnitario || "").trim()
    ? parseMoneyBR(req.body.custoUnitario)
    : null;

  let novaQtd = Number(item.quantidade || 0);

  if (tipo === "Entrada") {
    novaQtd += qtd;
    if (custoUnitario != null && Number.isFinite(custoUnitario)) item.custo = custoUnitario;
  } else if (tipo === "Saída") {
    novaQtd -= qtd;
    if (novaQtd < 0) novaQtd = 0;
  } else {
    novaQtd = qtd; // Ajuste = setar
  }

  await EstoqueMov.create({
    itemId: item._id,
    tipo,
    quantidade: qtd,
    motivo,
    pedidoNumero: Number.isFinite(pedidoNumero) ? pedidoNumero : null,
    custoUnitario: (custoUnitario != null && Number.isFinite(custoUnitario)) ? custoUnitario : null,
  });

  item.quantidade = novaQtd;
  item.atualizadoEm = new Date();
  await item.save();

  res.redirect(`/estoque/${item._id}`);
});

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando"));
