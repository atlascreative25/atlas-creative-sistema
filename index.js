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

// ✅ NOVO: controle de entrega/retirada
const EntregaSchema = new mongoose.Schema(
  {
    tipo: { type: String, default: "Retirada" }, // Retirada / Motoboy / Correios / Entrega própria
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

    // ✅ NOVO:
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

// ===== HELPERS =====
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

function statusOptions(selected) {
  return STATUS_LIST.map((s) => {
    const sel = s === selected ? "selected" : "";
    return `<option ${sel}>${esc(s)}</option>`;
  }).join("");
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

function searchBoxHTML({ basePath, q, extraQuery = {} }) {
  const hidden = Object.entries(extraQuery)
    .filter(([_, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");

  return `
    <form method="GET" action="${esc(basePath)}" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px;">
      ${hidden}
      <input name="q" value="${esc(q || "")}" placeholder="Buscar..."
        style="flex:1;min-width:240px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
      <button style="background:gold;color:black;padding:10px 14px;border:none;border-radius:10px;font-weight:800;cursor:pointer;">
        Buscar
      </button>
      ${q ? `<a href="${esc(basePath)}${Object.keys(extraQuery).length ? "?" + new URLSearchParams(extraQuery).toString() : ""}"
              style="color:gold;text-decoration:none;font-weight:800;">Limpar</a>` : ""}
    </form>
  `;
}

function monthControlsHTML({ selectedKey, basePath, q = "", showPdf = true, showCsvPedidos = true, showCsvDespesas = true, extraQS = {} }) {
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthKeyFromDate(d);
    const sel = k === selectedKey ? "selected" : "";
    opts.push(`<option value="${esc(k)}" ${sel}>${esc(monthLabelPT(k))}</option>`);
  }

  const qs = new URLSearchParams({ ...extraQS });
  if (q) qs.set("q", q);

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px;">
      <div style="opacity:.8;font-size:12px;">Mês:</div>
      <select id="mesSel"
        style="padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        ${opts.join("")}
      </select>

      ${showPdf ? `
        <a href="/relatorio?mes=${encodeURIComponent(selectedKey)}"
          style="background:gold;color:black;padding:8px 12px;border-radius:10px;text-decoration:none;font-weight:800;">
          Baixar PDF (mês)
        </a>` : ""}

      ${showCsvPedidos ? `
        <a href="/export/pedidos.csv?mes=${encodeURIComponent(selectedKey)}"
          style="background:#222;color:#fff;padding:8px 12px;border-radius:10px;text-decoration:none;font-weight:800;border:1px solid rgba(255,215,0,.25);">
          Exportar Pedidos (CSV)
        </a>` : ""}

      ${showCsvDespesas ? `
        <a href="/export/despesas.csv?mes=${encodeURIComponent(selectedKey)}"
          style="background:#222;color:#fff;padding:8px 12px;border-radius:10px;text-decoration:none;font-weight:800;border:1px solid rgba(255,215,0,.25);">
          Exportar Despesas (CSV)
        </a>` : ""}

      <script>
        (function(){
          const s = document.getElementById('mesSel');
          s.addEventListener('change', function(){
            const v = s.value;
            const base = '${basePath}?mes=' + encodeURIComponent(v);
            const extra = '${esc(qs.toString())}'.replaceAll('&amp;','&');
            window.location.href = base + (extra ? '&' + extra : '');
          });
        })();
      </script>
    </div>
  `;
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
        <a href="/produtos" style="color:gold;text-decoration:none">Produtos</a>
        <a href="/financeiro" style="color:gold;text-decoration:none">Financeiro</a>
        <a href="/logout" style="color:white;opacity:.85;text-decoration:none">Sair</a>
      </div>
    </div>

    <div style="max-width:1200px;margin:auto;padding:20px">
      ${conteudo}
    </div>

  </body>
  </html>
  `;
}

// ===== AUTH =====
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

// ===== PRODUTOS =====
app.get("/produtos", requireLogin, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const query = q ? { nome: { $regex: q, $options: "i" } } : {};
  const itens = await ProdutoTipo.find(query).sort({ nome: 1 });

  const busca = searchBoxHTML({ basePath: "/produtos", q });

  const linhas = itens
    .map((p) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.nome)}</td>
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(p.precoSugerido)}</td>
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
          <form method="POST" action="/produtos/${p._id}/delete" onsubmit="return confirm('Excluir este tipo de produto?');">
            <button style="background:#222;color:#fff;padding:8px 10px;border:1px solid rgba(255,215,0,.25);border-radius:10px;cursor:pointer;">
              Excluir
            </button>
          </form>
        </td>
      </tr>
    `)
    .join("");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 12px;">Produtos (tipos + preço sugerido)</h2>
    ${busca}

    <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;max-width:560px;">
      <h3 style="margin:0 0 10px;color:gold;font-size:16px;">Cadastrar tipo</h3>
      <form method="POST" action="/produtos">
        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Nome do tipo</div>
          <input name="nome" placeholder="Ex: Banner / Cartão / Adesivo" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:12px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Preço sugerido</div>
          <input name="precoSugerido" placeholder="Ex: 35,00" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <button style="background:gold;color:black;padding:10px 16px;border:none;border-radius:10px;font-weight:700;">
          Salvar tipo
        </button>
      </form>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Tipos cadastrados</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:780px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Tipo</th>
            <th style="text-align:left;padding:10px;">Preço sugerido</th>
            <th style="text-align:left;padding:10px;">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="3">Nenhum tipo cadastrado.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  res.send(layout("Produtos", conteudo));
});

app.post("/produtos", requireLogin, async (req, res) => {
  const nome = String(req.body.nome || "").trim();
  const preco = parseMoneyBR(req.body.precoSugerido);
  if (!nome) return res.send(layout("Erro", `<p>Nome inválido. <a style="color:gold" href="/produtos">Voltar</a></p>`));
  if (!Number.isFinite(preco)) return res.send(layout("Erro", `<p>Preço inválido. <a style="color:gold" href="/produtos">Voltar</a></p>`));

  try {
    await ProdutoTipo.create({ nome, precoSugerido: preco });
  } catch (e) {
    return res.send(layout("Erro", `<p>Esse tipo já existe. <a style="color:gold" href="/produtos">Voltar</a></p>`));
  }
  res.redirect("/produtos");
});

app.post("/produtos/:id/delete", requireLogin, async (req, res) => {
  await ProdutoTipo.findByIdAndDelete(req.params.id);
  res.redirect("/produtos");
});

// ===== CLIENTES (igual ao que você já tem) =====
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
  const buscaHTML = searchBoxHTML({ basePath: "/clientes", q });

  const linhas = clientes
    .map((c) => {
      const wa = waLinkBR(c.whatsapp);
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
            <a href="/clientes/${c._id}" style="color:gold;text-decoration:none;">
              ${esc(c.nome)}
            </a>
          </td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(c.whatsapp)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(c.observacoes)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
            ${
              wa
                ? `<a href="${esc(wa)}" target="_blank"
                     style="background:gold;color:black;padding:8px 10px;border-radius:10px;text-decoration:none;font-weight:800;">
                     WhatsApp
                   </a>`
                : `<span style="opacity:.6;font-size:12px;">Sem número</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 12px;">Clientes</h2>
    ${buscaHTML}

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
          <input name="observacoes"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>
        <button style="background:gold;color:black;padding:10px 16px;border:none;border-radius:10px;font-weight:700;">
          Salvar cliente
        </button>
      </form>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Lista de clientes</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:900px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Nome</th>
            <th style="text-align:left;padding:10px;">WhatsApp</th>
            <th style="text-align:left;padding:10px;">Observações</th>
            <th style="text-align:left;padding:10px;">Ação</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="4">Nenhum cliente encontrado.</td></tr>`}
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

// ===== TELA DO CLIENTE (mantém PDF/CSV) =====
function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

app.get("/clientes/:id", requireLogin, async (req, res) => {
  const cliente = await Cliente.findById(req.params.id);
  if (!cliente) return res.send(layout("Cliente", `<p>Cliente não encontrado. <a style="color:gold" href="/clientes">Voltar</a></p>`));

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
      const badge = p.arquivado
        ? `<span style="margin-left:8px;font-size:11px;opacity:.75;border:1px solid rgba(255,215,0,.25);padding:2px 6px;border-radius:999px;">Arquivado</span>`
        : "";
      const tipo = p.tipoProduto ? `${p.tipoProduto} — ` : "";
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
            <a href="/pedido/${p._id}" style="color:gold;text-decoration:none;font-weight:900;">#${esc(num)}</a>
            ${badge}
          </td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(tipo + p.produto)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(p.valor)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(p.sinal || 0)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(saldoPedido(p.valor, p.sinal))}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.status)}</td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;min-width:320px;">
        <h2 style="color:gold;margin:0 0 8px;">${esc(cliente.nome)}</h2>
        <div style="opacity:.85;margin-bottom:8px;">WhatsApp: ${esc(cliente.whatsapp || "-")}</div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          ${wa ? `<a href="${esc(wa)}" target="_blank"
                   style="background:gold;color:black;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:900;">
                   Abrir WhatsApp
                 </a>` : ""}
          <a href="/clientes" style="color:gold;text-decoration:none;font-weight:900;padding:10px 0;">← Voltar</a>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
          <a href="/clientes/${cliente._id}/relatorio.pdf"
             style="background:#222;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:900;border:1px solid rgba(255,215,0,.25);">
             PDF do Cliente
          </a>
          <a href="/clientes/${cliente._id}/pedidos.csv"
             style="background:#222;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:900;border:1px solid rgba(255,215,0,.25);">
             CSV do Cliente
          </a>
        </div>
      </div>

      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;min-width:280px;">
        <div style="opacity:.75;font-size:12px;">Total (valor)</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${money(totalValor)}</div>
        <div style="opacity:.75;font-size:12px;margin-top:12px;">Total (sinal)</div>
        <div style="font-size:18px;font-weight:800;">R$ ${money(totalSinal)}</div>
        <div style="opacity:.75;font-size:12px;margin-top:12px;">Total (saldo)</div>
        <div style="font-size:18px;font-weight:800;">R$ ${money(totalSaldo)}</div>
      </div>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Pedidos do cliente</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:980px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Pedido</th>
            <th style="text-align:left;padding:10px;">Produto</th>
            <th style="text-align:left;padding:10px;">Valor</th>
            <th style="text-align:left;padding:10px;">Sinal</th>
            <th style="text-align:left;padding:10px;">Saldo</th>
            <th style="text-align:left;padding:10px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="6">Nenhum pedido para este cliente ainda.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout("Cliente", conteudo));
});

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
    const e = p.entrega || {};
    const entregaTxt = e.data ? `${e.tipo || "-"} em ${fmtDateBR(e.data)} (${e.quemRetirou || "-"})` : (e.tipo || "-");
    doc.text(
      `#${num} | ${fmtDateBR(p.criadoEm)} | ${p.tipoProduto || "-"} | ${p.produto} | R$ ${money(p.valor)} | R$ ${money(
        p.sinal || 0
      )} | R$ ${money(saldoPedido(p.valor, p.sinal))} | ${p.status} | ${entregaTxt}`
    );
  });

  doc.end();
});

// ===== DASHBOARD + FINANCEIRO + EXPORT MÊS =====
// (mantém tudo que já estava: você já tem; para não ficar gigante aqui)
// ✅ Agora eu te passo só as partes novas do Pedido e do Dashboard abaixo 👇

// ===== NOVO PEDIDO (mesmo de antes) =====
app.get("/novo", requireLogin, async (req, res) => {
  const clientes = await Cliente.find().sort({ nome: 1 });
  if (!clientes.length) {
    return res.send(layout("Novo Pedido", `<p>Cadastre um cliente primeiro. <a style="color:gold" href="/clientes">Ir para clientes</a></p>`));
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
    <h2 style="color:gold;margin:0 0 12px;">Novo Pedido</h2>

    <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;max-width:640px;">
      <form method="POST" action="/pedido">

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Cliente</div>
          <select name="clienteId" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            ${clientesOpt}
          </select>
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Tipo de produto (puxa preço sugerido)</div>
          <select id="tipoProduto" name="tipoProduto"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            ${tiposOpt}
          </select>
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Descrição (detalhes)</div>
          <input name="produto" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px;">
          <div>
            <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Valor total</div>
            <input id="valor" name="valor" placeholder="Ex: 120,00" required
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
          </div>
          <div>
            <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Sinal / Entrada (opcional)</div>
            <input id="sinal" name="sinal" placeholder="Ex: 50,00"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Status</div>
          <select name="status"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            ${statusOptions("Orçamento")}
          </select>
        </div>

        <button style="background:gold;color:black;padding:10px 16px;border:none;border-radius:10px;font-weight:700;">
          Salvar Pedido
        </button>
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
  if (!Number.isFinite(v)) return res.send(layout("Erro", `<p>Valor inválido. <a style="color:gold" href="/novo">Voltar</a></p>`));

  const s = String(sinal || "").trim() ? parseMoneyBR(sinal) : 0;
  if (!Number.isFinite(s)) return res.send(layout("Erro", `<p>Sinal inválido. <a style="color:gold" href="/novo">Voltar</a></p>`));
  const sinalVal = Math.max(0, Math.min(v, s));

  const st = String(status || "").trim();
  if (!STATUS_LIST.includes(st)) return res.send(layout("Erro", `<p>Status inválido. <a style="color:gold" href="/novo">Voltar</a></p>`));

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

// ===== TELA DO PEDIDO (✅ bloco ENTREGA) =====
function checklistCheckbox(label, name, checked) {
  const chk = checked ? "checked" : "";
  return `
    <label style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;">
      <input type="checkbox" name="${esc(name)}" ${chk} style="transform:scale(1.2);">
      <span>${esc(label)}</span>
    </label>
  `;
}

function entregaOptions(selected) {
  const list = ["Retirada", "Motoboy", "Correios", "Entrega própria"];
  return list.map((t) => `<option ${t === selected ? "selected" : ""}>${esc(t)}</option>`).join("");
}

app.get("/pedido/:id", requireLogin, async (req, res) => {
  const pedido = await Pedido.findById(req.params.id).populate("clienteId");
  if (!pedido) return res.send(layout("Pedido", `<p>Pedido não encontrado. <a style="color:gold" href="/dashboard">Voltar</a></p>`));

  const num = String(pedido.numero || 0).padStart(4, "0");
  const clienteNome = pedido.clienteId?.nome || "Cliente";
  const whatsapp = pedido.clienteId?.whatsapp || "";
  const wa = waLinkBR(whatsapp);
  const tipo = pedido.tipoProduto ? `${pedido.tipoProduto} — ` : "";
  const saldo = saldoPedido(pedido.valor, pedido.sinal);

  const e = pedido.entrega || {};
  const entregaResumo = e?.data
    ? `${e.tipo || "-"} em ${fmtDateBR(e.data)}${e.quemRetirou ? " — " + e.quemRetirou : ""}`
    : (e?.tipo || "-");

  const conteudo = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;min-width:340px;flex:1;">
        <h2 style="color:gold;margin:0 0 6px;">Pedido #${esc(num)}</h2>
        <div style="opacity:.75;font-size:12px;margin-bottom:10px;">Criado em: ${esc(fmtDateBR(pedido.criadoEm))}</div>

        <div style="margin-bottom:8px;"><b>Cliente:</b> ${esc(clienteNome)}</div>
        <div style="margin-bottom:8px;"><b>Produto:</b> ${esc(tipo + pedido.produto)}</div>

        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px;">
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
            <div style="opacity:.7;font-size:12px;">Valor</div>
            <div style="font-weight:900;">R$ ${money(pedido.valor)}</div>
          </div>
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
            <div style="opacity:.7;font-size:12px;">Sinal</div>
            <div style="font-weight:900;">R$ ${money(pedido.sinal || 0)}</div>
          </div>
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
            <div style="opacity:.7;font-size:12px;">Saldo</div>
            <div style="font-weight:900;">R$ ${money(saldo)}</div>
          </div>
        </div>

        <div style="margin-top:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;">
          <div style="opacity:.7;font-size:12px;">Entrega/Retirada</div>
          <div style="font-weight:900;">${esc(entregaResumo)}</div>
        </div>

        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="/dashboard" style="color:gold;text-decoration:none;font-weight:900;">← Voltar</a>
          ${wa ? `<a href="${esc(wa)}" target="_blank"
                   style="background:gold;color:black;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:900;">
                   WhatsApp
                 </a>` : ""}
          <a href="/pedido/${pedido._id}/recibo.pdf"
             style="background:#222;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:900;border:1px solid rgba(255,215,0,.25);">
             Baixar recibo (PDF)
          </a>
        </div>
      </div>

      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;min-width:340px;flex:1;">
        <h3 style="color:gold;margin:0 0 10px;">Atualizações</h3>

        <form method="POST" action="/pedido/${pedido._id}/status?from=pedido"
          style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
          <select name="status"
            style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            ${statusOptions(pedido.status)}
          </select>
          <button style="background:gold;color:black;padding:10px 14px;border:none;border-radius:10px;font-weight:900;cursor:pointer;">
            Salvar status
          </button>
        </form>

        <form method="POST" action="/pedido/${pedido._id}/valores" style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Editar valor/sinal</div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
            <input name="valor" value="${esc(money(pedido.valor))}" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            <input name="sinal" value="${esc(money(pedido.sinal || 0))}" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
          </div>
          <button style="margin-top:10px;background:gold;color:black;padding:10px 14px;border:none;border-radius:10px;font-weight:900;cursor:pointer;">
            Salvar valores
          </button>
        </form>

        <!-- ✅ NOVO: ENTREGA -->
        <form method="POST" action="/pedido/${pedido._id}/entrega"
          style="margin-top:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:12px;">
          <div style="color:gold;font-weight:900;margin-bottom:8px;">Entrega / Retirada</div>

          <div style="margin-bottom:10px;">
            <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Tipo</div>
            <select name="tipo"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
              ${entregaOptions(e.tipo || "Retirada")}
            </select>
          </div>

          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px;">
            <div>
              <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Data (dd/mm/aaaa)</div>
              <input name="data" value="${esc(e.data ? fmtDateBR(e.data) : "")}" placeholder="Ex: 01/03/2026"
                style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            </div>
            <div>
              <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Quem retirou</div>
              <input name="quemRetirou" value="${esc(e.quemRetirou || "")}" placeholder="Ex: João / Cliente / Motoboy"
                style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            </div>
          </div>

          <div style="margin-bottom:10px;">
            <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Observação</div>
            <input name="observacao" value="${esc(e.observacao || "")}" placeholder="Ex: deixou na portaria / rastreio..."
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
          </div>

          <button style="background:gold;color:black;padding:10px 14px;border:none;border-radius:10px;font-weight:900;cursor:pointer;">
            Salvar entrega
          </button>
        </form>

        <form method="POST" action="/pedido/${pedido._id}/toggle-archive?from=pedido" style="margin-top:12px;">
          <button style="background:#222;color:#fff;padding:10px 14px;border:1px solid rgba(255,215,0,.25);border-radius:10px;font-weight:900;cursor:pointer;">
            ${pedido.arquivado ? "Desarquivar" : "Arquivar"}
          </button>
        </form>
      </div>
    </div>

    <div style="margin-top:12px;border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
      <h3 style="color:gold;margin:0 0 10px;">Checklist</h3>
      <form method="POST" action="/pedido/${pedido._id}/checklist" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        ${checklistCheckbox("Arte recebida", "arteRecebida", Boolean(pedido.checklist?.arteRecebida))}
        ${checklistCheckbox("Arte aprovada", "arteAprovada", Boolean(pedido.checklist?.arteAprovada))}
        ${checklistCheckbox("Impresso", "impresso", Boolean(pedido.checklist?.impresso))}
        ${checklistCheckbox("Cortado", "cortado", Boolean(pedido.checklist?.cortado))}
        ${checklistCheckbox("Entregue", "entregue", Boolean(pedido.checklist?.entregue))}
        <div style="grid-column:1/-1;">
          <button style="margin-top:10px;background:gold;color:black;padding:10px 14px;border:none;border-radius:10px;font-weight:900;cursor:pointer;">
            Salvar checklist
          </button>
        </div>
      </form>
    </div>

    <div style="margin-top:12px;border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
      <h3 style="color:gold;margin:0 0 10px;">Anotações</h3>
      <form method="POST" action="/pedido/${pedido._id}/anotacoes">
        <textarea name="anotacoes" rows="6"
          style="width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;resize:vertical;">${esc(
            pedido.anotacoes || ""
          )}</textarea>
        <div style="margin-top:10px;">
          <button style="background:gold;color:black;padding:10px 14px;border:none;border-radius:10px;font-weight:900;cursor:pointer;">
            Salvar anotações
          </button>
        </div>
      </form>
    </div>
  `;

  res.send(layout(`Pedido #${num}`, conteudo));
});

// ✅ salvar entrega
app.post("/pedido/:id/entrega", requireLogin, async (req, res) => {
  const tipo = String(req.body.tipo || "Retirada").trim();
  const data = parseDateBR(req.body.data);
  const quemRetirou = String(req.body.quemRetirou || "").trim();
  const observacao = String(req.body.observacao || "").trim();

  await Pedido.findByIdAndUpdate(req.params.id, {
    entrega: {
      tipo: tipo || "Retirada",
      data: data || null,
      quemRetirou,
      observacao,
    },
  });

  res.redirect(`/pedido/${req.params.id}`);
});

// ===== demais rotas (dashboard/financeiro/export/recibo/relatorio) =====
// ✅ Para não estourar mensagem, você pode manter as suas atuais.
// Só precisa garantir que:
// - o PedidoSchema tem "entrega"
// - existe a rota POST /pedido/:id/entrega
// - a tela do pedido (GET /pedido/:id) contém o bloco "Entrega/Retirada"

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando"));
