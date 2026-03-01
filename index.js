const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: "atlascreative",
  resave: false,
  saveUninitialized: true
}));

let pedidos = [];
let numeroPedido = 1;

const EMAIL = "atlascreative25@gmail.com";
const SENHA = "Atlas2145@";

app.get("/", (req, res) => {
  if (req.session.logado) {
    res.redirect("/dashboard");
  } else {
    res.sendFile(__dirname + "/public/login.html");
  }
});

app.post("/login", (req, res) => {
  const { email, senha } = req.body;
  if (email === EMAIL && senha === SENHA) {
    req.session.logado = true;
    res.redirect("/dashboard");
  } else {
    res.send("Login inválido");
  }
});

app.get("/dashboard", (req, res) => {
  if (!req.session.logado) return res.redirect("/");

  let faturamento = pedidos
    .filter(p => p.status === "Pago")
    .reduce((total, p) => total + Number(p.valor), 0);

  res.send(`
    <body style="background:black;color:white;font-family:sans-serif">
    <h1 style="color:gold;">Atlas Creative - Sistema</h1>
    <h2>Faturamento: R$ ${faturamento}</h2>
    <a href="/novo" style="color:gold;">Novo Pedido</a>
    <h3>Pedidos:</h3>
    ${pedidos.map(p => `
      <div>
        #${String(p.numero).padStart(4, "0")} - ${p.produto} - R$${p.valor} - ${p.status}
      </div>
    `).join("")}
    </body>
  `);
});

app.get("/novo", (req, res) => {
  if (!req.session.logado) return res.redirect("/");
  res.sendFile(__dirname + "/public/novo.html");
});

app.post("/pedido", (req, res) => {
  const { produto, valor, status } = req.body;

  pedidos.push({
    numero: numeroPedido++,
    produto,
    valor,
    status
  });

  res.redirect("/dashboard");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando"));
