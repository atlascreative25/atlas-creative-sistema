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

// ✅ Tipos de produto + preço sugerido
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

const PedidoSchema = new mongoose.Schema(
  {
    numero: { type: Number, required: true, unique: true },
    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Cliente", default: null },

    // ✅ tipo do produto cadastrado + descrição livre
    tipoProduto: { type: String, default: "" }, // ex: "Banner"
    produto: { type: String, required: true }, // ex: "Banner 1x2m - lona 440g"

    valor: { type: Number, required: true },
    // ✅ sinal/entrada
    sinal: { type: Number, default: 0 },

    status: { type: String, required: true },
    anotacoes: { type: String, default: "" },

    arquivado: { type: Boolean, default: false },
    checklist: { type: ChecklistSchema, default: () => ({}) },

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
  "Aguardando saldo", // ✅ novo
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
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
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

// ===== PRODUTOS (TIPOS + PREÇO SUGERIDO) =====
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
          <div style="opacity:.6;font-size:12px;margin-top:6px;">Use vírgula ou ponto.</div>
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

        <div style="opacity:.75;margin-top:10px;">Obs: ${esc(cliente.observacoes || "-")}</div>
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

// ✅ CSV do cliente
function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

app.get("/clientes/:id/pedidos.csv", requireLogin, async (req, res) => {
  const cliente = await Cliente.findById(req.params.id);
  if (!cliente) return res.status(404).send("Cliente não encontrado");

  const pedidos = await Pedido.find({ clienteId: cliente._id }).sort({ criadoEm: 1 });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cliente-${cliente._id}-pedidos.csv"`);

  const header = [
    "numero","data","cliente","whatsapp","tipoProduto","produto",
    "valor","sinal","saldo","status","arquivado",
    "arteRecebida","arteAprovada","impresso","cortado","entregue",
    "anotacoes"
  ];
  const lines = [header.join(",")];

  pedidos.forEach((p) => {
    const ck = p.checklist || {};
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

// ✅ PDF do cliente
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

  doc.fontSize(10).text("Pedido | Data | Tipo | Produto | Valor | Sinal | Saldo | Status");
  doc.moveDown(0.3);

  pedidos.forEach((p) => {
    const num = String(p.numero).padStart(4, "0");
    doc.text(
      `#${num} | ${fmtDateBR(p.criadoEm)} | ${p.tipoProduto || "-"} | ${p.produto} | R$ ${money(p.valor)} | R$ ${money(p.sinal || 0)} | R$ ${money(
        saldoPedido(p.valor, p.sinal)
      )} | ${p.status}`
    );
  });

  doc.end();
});

// ===== FINANCEIRO (igual ao seu, mantendo export e PDF mensal) =====
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
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(fmtDateBR(d.data))}</td>
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(d.categoria || "Geral")}</td>
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(d.descricao)}</td>
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(d.valor)}</td>
        <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
          <form method="POST" action="/despesa/${d._id}/delete?mes=${encodeURIComponent(mesKey)}"
            onsubmit="return confirm('Excluir esta despesa?');">
            <button style="background:#222;color:#fff;padding:8px 10px;border:1px solid rgba(255,215,0,.25);border-radius:10px;cursor:pointer;">
              Excluir
            </button>
          </form>
        </td>
      </tr>
    `)
    .join("");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 8px;">Financeiro</h2>
    ${monthControlsHTML({ selectedKey: mesKey, basePath: "/financeiro", showPdf: true, showCsvPedidos: true, showCsvDespesas: true })}

    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:920px;">
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Faturamento (Pago) — ${esc(monthLabelPT(mesKey))}</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${money(faturamentoMes)}</div>
      </div>
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Despesas — ${esc(monthLabelPT(mesKey))}</div>
        <div style="color:#fff;font-size:22px;font-weight:800;">R$ ${money(totalDespesas)}</div>
      </div>
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Lucro líquido — ${esc(monthLabelPT(mesKey))}</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${money(lucro)}</div>
      </div>
    </div>

    <div style="margin-top:16px;border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;max-width:560px;">
      <h3 style="margin:0 0 10px;color:gold;font-size:16px;">Adicionar despesa</h3>
      <form method="POST" action="/financeiro/despesa?mes=${encodeURIComponent(mesKey)}">
        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Descrição</div>
          <input name="descricao" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>
        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Categoria</div>
          <select name="categoria"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            <option>Geral</option><option>Papel</option><option>Tinta</option><option>Material</option>
            <option>Energia</option><option>Terceiros</option><option>Frete</option>
          </select>
        </div>
        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Valor</div>
          <input name="valor" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>
        <div style="margin-bottom:14px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Data</div>
          <input name="data" placeholder="dd/mm/aaaa (opcional)"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>
        <button style="background:gold;color:black;padding:10px 16px;border:none;border-radius:10px;font-weight:700;">Salvar despesa</button>
      </form>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Despesas — ${esc(monthLabelPT(mesKey))}</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:980px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Data</th>
            <th style="text-align:left;padding:10px;">Categoria</th>
            <th style="text-align:left;padding:10px;">Descrição</th>
            <th style="text-align:left;padding:10px;">Valor</th>
            <th style="text-align:left;padding:10px;">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="5">Nenhuma despesa cadastrada neste mês.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  res.send(layout("Financeiro", conteudo));
});

app.post("/financeiro/despesa", requireLogin, async (req, res) => {
  const { descricao, categoria, valor, data } = req.body;
  const v = parseMoneyBR(valor);
  if (!Number.isFinite(v)) return res.send(layout("Erro", `<p>Valor inválido. <a style="color:gold" href="/financeiro">Voltar</a></p>`));

  let d = new Date();
  const rawDate = String(data || "").trim();
  if (rawDate) {
    const m = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
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

// ===== DASHBOARD (mantém o seu básico + busca + arquivar) =====
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
    .limit(200);

  if (q) {
    const qlow = q.toLowerCase();
    pedidosLista = pedidosLista.filter((p) => {
      const num = String(p.numero || "");
      const cli = (p.clienteId?.nome || "").toLowerCase();
      const prod = (p.produto || "").toLowerCase();
      const tipo = (p.tipoProduto || "").toLowerCase();
      const st = (p.status || "").toLowerCase();
      return num.includes(qlow) || cli.includes(qlow) || prod.includes(qlow) || tipo.includes(qlow) || st.includes(qlow);
    }).slice(0, 80);
  } else {
    pedidosLista = pedidosLista.slice(0, 80);
  }

  const pendentes = pedidosLista.filter((p) => !p.arquivado && STATUS_PENDENTES.has(p.status));
  const pagos = pedidosLista.filter((p) => !p.arquivado && STATUS_PAGOS.has(p.status));

  const toggleLink = (() => {
    const qs = new URLSearchParams();
    qs.set("mes", mesKey);
    if (q) qs.set("q", q);
    if (!showArchived) qs.set("show_archived", "1");
    const text = showArchived ? "Ocultar arquivados" : "Mostrar arquivados";
    const href = showArchived
      ? `/dashboard?mes=${encodeURIComponent(mesKey)}${q ? `&q=${encodeURIComponent(q)}` : ""}`
      : `/dashboard?${qs.toString()}`;
    return `<a href="${esc(href)}" style="color:gold;text-decoration:none;font-weight:900;">${esc(text)}</a>`;
  })();

  const busca = searchBoxHTML({ basePath: "/dashboard", q, extraQuery: { mes: mesKey, show_archived: showArchived ? "1" : "" } });

  const rowsList = (arr) =>
    arr
      .map((p) => {
        const num = String(p.numero).padStart(4, "0");
        const clienteNome = p.clienteId?.nome || "-";
        const tipo = p.tipoProduto ? `${p.tipoProduto} — ` : "";
        const sal = saldoPedido(p.valor, p.sinal);
        return `
          <div style="border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <a href="/pedido/${p._id}" style="color:gold;text-decoration:none;font-weight:900;">#${esc(num)}</a>
              <div style="opacity:.85">${esc(p.status)}</div>
            </div>
            <div style="opacity:.9;margin-top:6px;"><b>${esc(clienteNome)}</b> — ${esc(tipo + p.produto)}</div>
            <div style="opacity:.85;margin-top:4px;">
              Valor: R$ ${money(p.valor)} | Sinal: R$ ${money(p.sinal || 0)} | Saldo: R$ ${money(sal)}
            </div>
          </div>
        `;
      })
      .join("") || `<div style="opacity:.7">Nada aqui.</div>`;

  const linhasTabela = pedidosLista
    .map((p) => {
      const num = String(p.numero).padStart(4, "0");
      const clienteNome = p.clienteId?.nome ? p.clienteId.nome : "-";
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
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(clienteNome)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(tipo + p.produto)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(p.valor)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(p.sinal || 0)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(saldoPedido(p.valor, p.sinal))}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.status)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
            <form method="POST" action="/pedido/${p._id}/toggle-archive?mes=${encodeURIComponent(mesKey)}&q=${encodeURIComponent(q)}&show_archived=${showArchived ? "1" : ""}"
              style="margin:0;">
              <button style="background:#222;color:#fff;padding:8px 10px;border:1px solid rgba(255,215,0,.25);border-radius:10px;cursor:pointer;">
                ${p.arquivado ? "Desarquivar" : "Arquivar"}
              </button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 8px;">Dashboard</h2>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 10px;">
      ${toggleLink}
    </div>

    ${monthControlsHTML({ selectedKey: mesKey, basePath: "/dashboard", q, showPdf: true, showCsvPedidos: true, showCsvDespesas: false, extraQS: { show_archived: showArchived ? "1" : "" } })}
    ${busca}

    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:920px;">
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Faturamento (Pago) — ${esc(monthLabelPT(mesKey))}</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${money(faturamentoMes)}</div>
      </div>
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Despesas — ${esc(monthLabelPT(mesKey))}</div>
        <div style="color:#fff;font-size:22px;font-weight:800;">R$ ${money(totalDespesas)}</div>
      </div>
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="opacity:.75;font-size:12px;">Lucro líquido — ${esc(monthLabelPT(mesKey))}</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${money(lucro)}</div>
      </div>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Quadro</h3>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="color:gold;font-weight:900;margin-bottom:10px;">Pendentes</div>
        ${rowsList(pendentes)}
      </div>
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;">
        <div style="color:gold;font-weight:900;margin-bottom:10px;">Pagos / Finalizados</div>
        ${rowsList(pagos)}
      </div>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Pedidos (últimos) ${q ? `— buscando: "${esc(q)}"` : ""}</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:1220px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Pedido</th>
            <th style="text-align:left;padding:10px;">Cliente</th>
            <th style="text-align:left;padding:10px;">Produto</th>
            <th style="text-align:left;padding:10px;">Valor</th>
            <th style="text-align:left;padding:10px;">Sinal</th>
            <th style="text-align:left;padding:10px;">Saldo</th>
            <th style="text-align:left;padding:10px;">Status</th>
            <th style="text-align:left;padding:10px;">Arquivar</th>
          </tr>
        </thead>
        <tbody>
          ${linhasTabela || `<tr><td style="padding:10px;" colspan="8">Nenhum pedido encontrado.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  res.send(layout("Dashboard", conteudo));
});

// Toggle arquivar
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

// ===== NOVO PEDIDO (TIPO + PREÇO SUGERIDO + SINAL) =====
app.get("/novo", requireLogin, async (req, res) => {
  const clientes = await Cliente.find().sort({ nome: 1 });
  if (!clientes.length) {
    return res.send(layout("Novo Pedido", `<p>Cadastre um cliente primeiro. <a style="color:gold" href="/clientes">Ir para clientes</a></p>`));
  }

  const tipos = await ProdutoTipo.find().sort({ nome: 1 });

  const clientesOpt = clientes
    .map((c) => `<option value="${c._id}">${esc(c.nome)} ${c.whatsapp ? "— " + esc(c.whatsapp) : ""}</option>`)
    .join("");

  // dataset com preço sugerido
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
          <div style="opacity:.6;font-size:12px;margin-top:6px;">Você cadastra os tipos em: <a href="/produtos" style="color:gold">Produtos</a></div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Descrição (detalhes)</div>
          <input name="produto" placeholder="Ex: 1000 unid, papel couchê 300g, frente/verso..."
            required
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
            // coloca como "xx,00" (padrão BR)
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
  const sinalVal = Math.max(0, Math.min(v, s)); // não deixa sinal maior que valor

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

// ===== TELA DO PEDIDO (mostra sinal/saldo + editar valores) =====
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
  if (!pedido) return res.send(layout("Pedido", `<p>Pedido não encontrado. <a style="color:gold" href="/dashboard">Voltar</a></p>`));

  const num = String(pedido.numero || 0).padStart(4, "0");
  const clienteNome = pedido.clienteId?.nome || "Cliente";
  const whatsapp = pedido.clienteId?.whatsapp || "";
  const wa = waLinkBR(whatsapp);
  const tipo = pedido.tipoProduto ? `${pedido.tipoProduto} — ` : "";
  const saldo = saldoPedido(pedido.valor, pedido.sinal);

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

app.post("/pedido/:id/valores", requireLogin, async (req, res) => {
  const v = parseMoneyBR(req.body.valor);
  const s = parseMoneyBR(req.body.sinal);
  if (!Number.isFinite(v) || v < 0) return res.send(layout("Erro", `<p>Valor inválido. <a style="color:gold" href="/pedido/${req.params.id}">Voltar</a></p>`));
  if (!Number.isFinite(s) || s < 0) return res.send(layout("Erro", `<p>Sinal inválido. <a style="color:gold" href="/pedido/${req.params.id}">Voltar</a></p>`));

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
  if (!STATUS_LIST.includes(novoStatus)) return res.send(layout("Erro", `<p>Status inválido. <a style="color:gold" href="/pedido/${req.params.id}">Voltar</a></p>`));

  await Pedido.findByIdAndUpdate(req.params.id, { status: novoStatus });

  const from = String(req.query.from || "");
  if (from === "pedido") return res.redirect(`/pedido/${req.params.id}`);
  return res.redirect("/dashboard");
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

// ===== RECIBO PDF (inclui sinal/saldo) =====
app.get("/pedido/:id/recibo.pdf", requireLogin, async (req, res) => {
  const pedido = await Pedido.findById(req.params.id).populate("clienteId");
  if (!pedido) return res.status(404).send("Pedido não encontrado");

  const num = String(pedido.numero || 0).padStart(4, "0");
  const saldo = saldoPedido(pedido.valor, pedido.sinal);

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
  doc.text(`Arquivado: ${pedido.arquivado ? "Sim" : "Não"}`);
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

  doc.moveDown(2);
  doc.fontSize(10).text("Obrigado pela preferência!", { align: "left" });

  doc.end();
});

// ===== RELATÓRIO MENSAL PDF (inclui sinal/saldo) =====
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

  doc.fontSize(18).text("Atlas Creative - Relatório Mensal", { align: "left" });
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
  doc.fontSize(10).text("Pedido | Data | Cliente | Tipo | Produto | Valor | Sinal | Saldo | Status");
  doc.moveDown(0.3);

  pedidosMes.forEach((p) => {
    const num = String(p.numero).padStart(4, "0");
    const cli = p.clienteId?.nome ? p.clienteId.nome : "-";
    doc.text(
      `#${num} | ${fmtDateBR(p.criadoEm)} | ${cli} | ${p.tipoProduto || "-"} | ${p.produto} | R$ ${money(p.valor)} | R$ ${money(
        p.sinal || 0
      )} | R$ ${money(saldoPedido(p.valor, p.sinal))} | ${p.status}`
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
    "arteRecebida","arteAprovada","impresso","cortado","entregue","anotacoes"
  ];
  const lines = [header.join(",")];

  pedidosMes.forEach((p) => {
    const ck = p.checklist || {};
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

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando"));
