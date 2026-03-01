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
  "Pago",
  "Em produção",
  "Pronto",
  "Entregue",
  "Cancelado",
];

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
        <a href="/financeiro" style="color:gold;text-decoration:none">Financeiro</a>
        <a href="/logout" style="color:white;opacity:.85;text-decoration:none">Sair</a>
      </div>
    </div>

    <div style="max-width:1100px;margin:auto;padding:20px">
      ${conteudo}
    </div>

  </body>
  </html>
  `;
}

function statusOptions(selected) {
  return STATUS_LIST.map((s) => {
    const sel = s === selected ? "selected" : "";
    return `<option ${sel}>${esc(s)}</option>`;
  }).join("");
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
  // "YYYY-MM"
  const m = String(key || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1..12
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

function monthOptionsHTML(selectedKey, basePath) {
  // últimos 12 meses
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthKeyFromDate(d);
    const sel = k === selectedKey ? "selected" : "";
    opts.push(`<option value="${esc(k)}" ${sel}>${esc(monthLabelPT(k))}</option>`);
  }

  // select faz redirect via JS
  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px;">
      <div style="opacity:.8;font-size:12px;">Mês:</div>
      <select id="mesSel"
        style="padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        ${opts.join("")}
      </select>
      <script>
        (function(){
          const s = document.getElementById('mesSel');
          s.addEventListener('change', function(){
            const v = s.value;
            window.location.href = '${basePath}?mes=' + encodeURIComponent(v);
          });
        })();
      </script>
    </div>
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
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
            <a href="/clientes/${c._id}" style="color:gold;text-decoration:none;">
              ${esc(c.nome)}
            </a>
          </td>
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

app.get("/clientes/:id", requireLogin, async (req, res) => {
  const cliente = await Cliente.findById(req.params.id);
  if (!cliente) {
    return res.send(layout("Cliente", `<p>Cliente não encontrado. <a style="color:gold" href="/clientes">Voltar</a></p>`));
  }

  const pedidos = await Pedido.find({ clienteId: cliente._id }).sort({ criadoEm: -1 });

  const totalGasto = pedidos
    .filter((p) => p.status !== "Cancelado")
    .reduce((t, p) => t + Number(p.valor || 0), 0);

  const linhas = pedidos
    .map((p) => {
      const num = String(p.numero).padStart(4, "0");
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">#${esc(num)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.produto)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(p.valor)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.status)}</td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;min-width:280px;">
        <h2 style="color:gold;margin:0 0 8px;">${esc(cliente.nome)}</h2>
        <div style="opacity:.85;margin-bottom:6px;">WhatsApp: ${esc(cliente.whatsapp || "-")}</div>
        <div style="opacity:.75;">Obs: ${esc(cliente.observacoes || "-")}</div>
        <div style="margin-top:12px;">
          <a href="/clientes" style="color:gold;text-decoration:none;font-weight:700;">← Voltar</a>
        </div>
      </div>

      <div style="border:1px solid rgba(255,215,0,.18);border-radius:14px;padding:14px;min-width:280px;">
        <div style="opacity:.75;font-size:12px;">Total gasto (exceto cancelados)</div>
        <div style="color:gold;font-size:22px;font-weight:800;">R$ ${money(totalGasto)}</div>
      </div>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Pedidos do cliente</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:760px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Pedido</th>
            <th style="text-align:left;padding:10px;">Produto</th>
            <th style="text-align:left;padding:10px;">Valor</th>
            <th style="text-align:left;padding:10px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="4">Nenhum pedido para este cliente ainda.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout("Cliente", conteudo));
});

// ===== FINANCEIRO (COM FILTRO POR MÊS) =====
app.get("/financeiro", requireLogin, async (req, res) => {
  const mesParam = String(req.query.mes || "").trim();
  const { start: ini, end: fim, key: mesKey } = monthRangeFromKey(mesParam || monthKeyFromDate(new Date()));

  const despesas = await Despesa.find({ data: { $gte: ini, $lt: fim } }).sort({ data: -1 });
  const totalDespesas = despesas.reduce((t, d) => t + Number(d.valor || 0), 0);

  const pedidosMes = await Pedido.find({ criadoEm: { $gte: ini, $lt: fim } });
  const faturamentoMes = pedidosMes
    .filter((p) => p.status === "Pago")
    .reduce((t, p) => t + Number(p.valor || 0), 0);

  const lucro = faturamentoMes - totalDespesas;

  const linhas = despesas
    .map((d) => {
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(fmtDateBR(d.data))}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(d.categoria || "Geral")}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(d.descricao)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(d.valor)}</td>
        </tr>
      `;
    })
    .join("");

  const filtroMes = monthOptionsHTML(mesKey, "/financeiro");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 8px;">Financeiro</h2>
    ${filtroMes}

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
          <input name="descricao" placeholder="Ex: Papel couchê 170g" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Categoria</div>
          <select name="categoria"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
            <option>Geral</option>
            <option>Papel</option>
            <option>Tinta</option>
            <option>Material</option>
            <option>Energia</option>
            <option>Terceiros</option>
            <option>Frete</option>
          </select>
        </div>

        <div style="margin-bottom:10px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Valor (aceita 35,50 ou 35.50)</div>
          <input name="valor" placeholder="Ex: 120,00" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:14px;">
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Data</div>
          <input name="data" placeholder="dd/mm/aaaa (opcional)"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
          <div style="opacity:.6;font-size:12px;margin-top:6px;">Se deixar vazio, usa a data de hoje.</div>
        </div>

        <button style="background:gold;color:black;padding:10px 16px;border:none;border-radius:10px;font-weight:700;">
          Salvar despesa
        </button>
      </form>
    </div>

    <h3 style="color:gold;margin:18px 0 10px;">Despesas — ${esc(monthLabelPT(mesKey))}</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:860px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Data</th>
            <th style="text-align:left;padding:10px;">Categoria</th>
            <th style="text-align:left;padding:10px;">Descrição</th>
            <th style="text-align:left;padding:10px;">Valor</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="4">Nenhuma despesa cadastrada neste mês.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout("Financeiro", conteudo));
});

app.post("/financeiro/despesa", requireLogin, async (req, res) => {
  const { descricao, categoria, valor, data } = req.body;

  const v = parseMoneyBR(valor);
  if (!Number.isFinite(v)) {
    return res.send(layout("Erro", `<p>Valor inválido. <a style="color:gold" href="/financeiro">Voltar</a></p>`));
  }

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

// ===== DASHBOARD (COM FILTRO POR MÊS + AÇÕES STATUS) =====
app.get("/dashboard", requireLogin, async (req, res) => {
  const mesParam = String(req.query.mes || "").trim();
  const { start: ini, end: fim, key: mesKey } = monthRangeFromKey(mesParam || monthKeyFromDate(new Date()));

  const pedidosLista = await Pedido.find()
    .populate("clienteId")
    .sort({ criadoEm: -1 })
    .limit(80);

  const pedidosMes = await Pedido.find({ criadoEm: { $gte: ini, $lt: fim } });
  const despesasMes = await Despesa.find({ data: { $gte: ini, $lt: fim } });

  const faturamentoMes = pedidosMes
    .filter((p) => p.status === "Pago")
    .reduce((total, p) => total + Number(p.valor || 0), 0);

  const totalDespesas = despesasMes.reduce((t, d) => t + Number(d.valor || 0), 0);
  const lucro = faturamentoMes - totalDespesas;

  const filtroMes = monthOptionsHTML(mesKey, "/dashboard");

  const linhas = pedidosLista
    .map((p) => {
      const num = String(p.numero).padStart(4, "0");
      const clienteNome = p.clienteId?.nome ? p.clienteId.nome : "-";

      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">#${esc(num)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(clienteNome)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.produto)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">R$ ${money(p.valor)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">${esc(p.status)}</td>

          <td style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);">
            <form method="POST" action="/pedido/${p._id}/status?mes=${encodeURIComponent(mesKey)}"
              style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <select name="status"
                style="padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
                ${statusOptions(p.status)}
              </select>
              <button style="background:gold;color:black;padding:8px 10px;border:none;border-radius:10px;font-weight:700;">
                Atualizar
              </button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  const conteudo = `
    <h2 style="color:gold;margin:0 0 8px;">Dashboard</h2>
    ${filtroMes}

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

    <h3 style="color:gold;margin:18px 0 10px;">Últimos pedidos (lista geral)</h3>
    <div style="overflow:auto;border:1px solid rgba(255,215,0,.18);border-radius:14px;">
      <table style="width:100%;border-collapse:collapse;min-width:1040px;">
        <thead>
          <tr style="background:rgba(255,215,0,.08);">
            <th style="text-align:left;padding:10px;">Pedido</th>
            <th style="text-align:left;padding:10px;">Cliente</th>
            <th style="text-align:left;padding:10px;">Produto</th>
            <th style="text-align:left;padding:10px;">Valor</th>
            <th style="text-align:left;padding:10px;">Status</th>
            <th style="text-align:left;padding:10px;">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${linhas || `<tr><td style="padding:10px;" colspan="6">Nenhum pedido ainda.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div style="opacity:.65;font-size:12px;margin-top:8px;">
      Obs: o filtro de mês muda os números (cards). A lista mostra os últimos pedidos gerais.
    </div>
  `;

  res.send(layout("Dashboard", conteudo));
});

// ===== ATUALIZAR STATUS (SÓ STATUS) =====
app.post("/pedido/:id/status", requireLogin, async (req, res) => {
  const novoStatus = String(req.body.status || "").trim();
  if (!STATUS_LIST.includes(novoStatus)) {
    return res.send(layout("Erro", `<p>Status inválido. <a style="color:gold" href="/dashboard">Voltar</a></p>`));
  }

  await Pedido.findByIdAndUpdate(req.params.id, { status: novoStatus });

  const mes = String(req.query.mes || "").trim();
  return res.redirect(mes ? `/dashboard?mes=${encodeURIComponent(mes)}` : "/dashboard");
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
          <div style="opacity:.8;font-size:12px;margin-bottom:6px;">Valor (aceita 35,50 ou 35.50)</div>
          <input name="valor" placeholder="Ex: 35,00" required
            style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b0b0b;color:#fff;">
        </div>

        <div style="margin-bottom:14px;">
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
  `;

  res.send(layout("Novo Pedido", conteudo));
});

app.post("/pedido", requireLogin, async (req, res) => {
  const { clienteId, produto, valor, status } = req.body;

  const numero = await getNextNumero();

  const v = parseMoneyBR(valor);
  if (!Number.isFinite(v)) {
    return res.send(layout("Erro", `<p>Valor inválido. <a style="color:gold" href="/novo">Voltar</a></p>`));
  }

  const st = String(status || "").trim();
  if (!STATUS_LIST.includes(st)) {
    return res.send(layout("Erro", `<p>Status inválido. <a style="color:gold" href="/novo">Voltar</a></p>`));
  }

  await Pedido.create({
    numero,
    clienteId: clienteId || null,
    produto: String(produto || "").trim(),
    valor: v,
    status: st,
  });

  res.redirect("/dashboard");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando"));
