const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const session = require('express-session');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@doce-sabor.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'doce-sabor-session-secret';

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password).trim()).digest('hex');
}

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'doce_sabor',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function ensureDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT || 3306),
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'doce_sabor'}`);
  await connection.end();

  await db.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cpf VARCHAR(14) NOT NULL UNIQUE,
      senha VARCHAR(255) NULL,
      nome VARCHAR(150) NOT NULL,
      telefone VARCHAR(20) NOT NULL,
      email VARCHAR(150) NULL,
      endereco VARCHAR(255) NULL,
      obs TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS senha VARCHAR(255) NULL AFTER cpf
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(150) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      senha VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const defaultAdminEmail = String(ADMIN_EMAIL).trim().toLowerCase();
  const defaultAdminPass = hashPassword(ADMIN_PASSWORD);

  await db.query(`
    INSERT INTO admin_usuarios (nome, email, senha)
    VALUES ('Administrador', ?, ?)
    ON DUPLICATE KEY UPDATE
      nome = VALUES(nome),
      senha = VALUES(senha)
  `, [defaultAdminEmail, defaultAdminPass]);

  await db.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(150) NOT NULL,
      descricao TEXT NULL,
      imagem VARCHAR(500) NULL,
      preco DECIMAL(10,2) NOT NULL,
      estoque INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'ativo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE produtos
    ADD COLUMN IF NOT EXISTS imagem VARCHAR(500) NULL AFTER descricao
  `);

  const produtosPadrao = [
    ['Bolo de Pote de Chocolate', 'Bolo de chocolate com ganache e cobertura crocante.', 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80', 18.90, 12],
    ['Bolo de Pote de Morango', 'Camadas de bolo, creme e morangos frescos.', 'https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?auto=format&fit=crop&w=900&q=80', 19.90, 10],
    ['Bolo de Cenoura', 'Bolo úmido com cobertura de chocolate.', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80', 29.90, 8],
    ['Bolo de Ninho', 'Clássico com leite em pó e coco.', 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?auto=format&fit=crop&w=900&q=80', 32.90, 6],
    ['Lanche Natural de Frango', 'Frango desfiado, alface, tomate e pão integral.', 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=900&q=80', 22.50, 15],
    ['Lanche Natural de Atum', 'Atum, cebola roxa, alface e maionese light.', 'https://images.unsplash.com/photo-1546793665-c74683f339c1?auto=format&fit=crop&w=900&q=80', 24.00, 12],
    ['Wrap Natural Vegano', 'Legumes frescos, hummus e quinoa em folha de alface.', 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80', 26.50, 9],
    ['Sanduíche Natural de Ricota', 'Ricota, tomate seco, rúcula e pão de grãos.', 'https://images.unsplash.com/photo-1553909489-cd47e0ef937f?auto=format&fit=crop&w=900&q=80', 23.90, 11],
  ];

  for (const produto of produtosPadrao) {
    const [nome, descricao, imagem, preco, estoque] = produto;
    await db.query(
      `INSERT INTO produtos (nome, descricao, imagem, preco, estoque, status)
       SELECT ?, ?, ?, ?, ?, 'ativo'
       WHERE NOT EXISTS (
         SELECT 1 FROM produtos WHERE nome = ?
       )`,
      [nome, descricao, imagem, preco, estoque, nome]
    );
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cliente_id INT NOT NULL,
      total DECIMAL(10,2) NOT NULL DEFAULT 0,
      pagamento VARCHAR(50) DEFAULT 'pix',
      status_entrega VARCHAR(30) DEFAULT 'pendente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS pedido_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pedido_id INT NOT NULL,
      produto_id INT NOT NULL,
      quantidade INT NOT NULL DEFAULT 1,
      valor_unitario DECIMAL(10,2) NOT NULL,
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    )
  `);
}

app.get('/', (req, res) => {
  res.json({ message: 'API Doce Sabor funcionando' });
});

function requireAdminSession(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }

  return res.status(401).json({ error: 'Sessão de administrador expirada ou inválida' });
}

app.get('/admin/session', (req, res) => {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ loggedIn: false });
  }

  return res.json({
    loggedIn: true,
    admin: {
      id: req.session.adminId,
      email: req.session.adminEmail,
      nome: req.session.adminNome,
    },
  });
});

app.post('/admin/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.json({ message: 'Logout realizado com sucesso' });
    });
    return;
  }

  res.json({ message: 'Logout realizado com sucesso' });
});

app.post('/admin/register', async (req, res) => {
  const { nome, email, senha } = req.body || {};

  if (!nome || !email || !senha) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
  }

  const nomeLimpo = String(nome).trim();
  const emailNormalizado = String(email).trim().toLowerCase();
  const senhaLimpa = String(senha).trim();

  if (!nomeLimpo || !emailNormalizado || !senhaLimpa) {
    return res.status(400).json({ error: 'Dados inválidos para cadastro do administrador' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM admin_usuarios WHERE email = ?', [emailNormalizado]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Já existe um administrador com este e-mail' });
    }

    const [result] = await db.query(
      'INSERT INTO admin_usuarios (nome, email, senha) VALUES (?, ?, ?)',
      [nomeLimpo, emailNormalizado, hashPassword(senhaLimpa)]
    );

    req.session.adminId = result.insertId;
    req.session.adminEmail = emailNormalizado;
    req.session.adminNome = nomeLimpo;

    return res.status(201).json({
      message: 'Administrador cadastrado com sucesso',
      admin: {
        id: result.insertId,
        nome: nomeLimpo,
        email: emailNormalizado,
      },
    });
  } catch (error) {
    console.error('Erro ao registrar administrador:', error);
    return res.status(500).json({ error: 'Erro ao cadastrar administrador' });
  }
});

app.post('/admin/login', async (req, res) => {
  const { email, senha } = req.body || {};

  if (!email || !senha) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }

  const emailNormalizado = String(email).trim().toLowerCase();
  const senhaNormalizada = String(senha).trim();

  try {
    const [rows] = await db.query(
      'SELECT id, nome, email, senha FROM admin_usuarios WHERE email = ?',
      [emailNormalizado]
    );

    const admin = rows[0];
    if (!admin || !admin.senha || admin.senha !== hashPassword(senhaNormalizada)) {
      return res.status(401).json({ error: 'E-mail ou senha do administrador inválidos' });
    }

    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    req.session.adminNome = admin.nome;

    return res.json({
      message: 'Login do administrador realizado com sucesso',
      admin: {
        id: admin.id,
        nome: admin.nome,
        email: admin.email,
      },
    });
  } catch (error) {
    console.error('Erro ao autenticar administrador:', error);
    return res.status(500).json({ error: 'Erro ao autenticar administrador' });
  }
});

app.get('/clientes', requireAdminSession, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM clientes ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

app.post('/clientes/register', async (req, res) => {
  const { cpf, nome, telefone, email, endereco, obs, senha } = req.body || {};

  if (!cpf || !nome || !telefone || !senha) {
    return res.status(400).json({ error: 'CPF, nome, telefone e senha são obrigatórios' });
  }

  const cpfLimpo = String(cpf).replace(/\D/g, '');
  const nomeLimpo = String(nome).trim();
  const telefoneLimpo = String(telefone).trim();
  const emailLimpo = email ? String(email).trim() : null;
  const enderecoLimpo = endereco ? String(endereco).trim() : null;
  const obsLimpa = obs ? String(obs).trim() : null;
  const senhaHash = hashPassword(String(senha).trim());

  if (!cpfLimpo || !nomeLimpo || !telefoneLimpo || !senhaHash) {
    return res.status(400).json({ error: 'Dados do cliente inválidos' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM clientes WHERE cpf = ?', [cpfLimpo]);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Já existe um cliente com este CPF' });
    }

    const [result] = await db.query(
      'INSERT INTO clientes (cpf, senha, nome, telefone, email, endereco, obs) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cpfLimpo, senhaHash, nomeLimpo, telefoneLimpo, emailLimpo, enderecoLimpo, obsLimpa]
    );

    res.status(201).json({
      message: 'Cliente cadastrado com sucesso',
      id: result.insertId,
      cliente: {
        id: result.insertId,
        cpf: cpfLimpo,
        nome: nomeLimpo,
        telefone: telefoneLimpo,
        email: emailLimpo,
        endereco: enderecoLimpo,
        obs: obsLimpa,
      },
    });
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro ao cadastrar cliente' });
  }
});

app.post('/clientes', requireAdminSession, async (req, res) => {
  const { cpf, nome, telefone, email, endereco, obs, senha } = req.body;

  if (!cpf || !nome || !telefone) {
    return res.status(400).json({ error: 'CPF, nome e telefone são obrigatórios' });
  }

  const cpfLimpo = String(cpf).replace(/\D/g, '');
  const nomeLimpo = String(nome).trim();
  const telefoneLimpo = String(telefone).trim();
  const emailLimpo = email ? String(email).trim() : null;
  const enderecoLimpo = endereco ? String(endereco).trim() : null;
  const obsLimpa = obs ? String(obs).trim() : null;
  const senhaHash = senha ? hashPassword(senha) : null;

  try {
    const [existing] = await db.query('SELECT id FROM clientes WHERE cpf = ?', [cpfLimpo]);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Já existe um cliente com este CPF' });
    }

    const [result] = await db.query(
      'INSERT INTO clientes (cpf, senha, nome, telefone, email, endereco, obs) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cpfLimpo, senhaHash, nomeLimpo, telefoneLimpo, emailLimpo, enderecoLimpo, obsLimpa]
    );

    res.status(201).json({
      message: 'Cliente cadastrado com sucesso',
      id: result.insertId,
    });
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro ao cadastrar cliente' });
  }
});

app.post('/clientes/login', async (req, res) => {
  const { cpf, senha } = req.body;

  if (!cpf || !senha) {
    return res.status(400).json({ error: 'CPF e senha são obrigatórios' });
  }

  const cpfLimpo = String(cpf).replace(/\D/g, '');

  try {
    const [rows] = await db.query(
      'SELECT id, cpf, nome, telefone, email, endereco, obs, senha FROM clientes WHERE cpf = ?',
      [cpfLimpo]
    );

    const cliente = rows[0];

    if (!cliente || !cliente.senha || cliente.senha !== hashPassword(senha)) {
      return res.status(401).json({ error: 'CPF ou senha inválidos' });
    }

    const { senha: _, ...clienteSemSenha } = cliente;

    return res.json({
      message: 'Login realizado com sucesso',
      cliente: clienteSemSenha,
    });
  } catch (error) {
    console.error('Erro ao autenticar cliente:', error);
    return res.status(500).json({ error: 'Erro ao autenticar cliente' });
  }
});

app.delete('/clientes/:id', requireAdminSession, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query('DELETE FROM clientes WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    res.json({ message: 'Cliente excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir cliente:', error);
    res.status(500).json({ error: 'Erro ao excluir cliente' });
  }
});

app.get('/produtos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

app.post('/produtos', requireAdminSession, async (req, res) => {
  const { nome, descricao, imagem, preco, estoque, status } = req.body;

  if (!nome || !preco || estoque === undefined) {
    return res.status(400).json({ error: 'Nome, preço e estoque são obrigatórios' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO produtos (nome, descricao, imagem, preco, estoque, status) VALUES (?, ?, ?, ?, ?, ?)',
      [
        String(nome).trim(),
        descricao ? String(descricao).trim() : null,
        imagem ? String(imagem).trim() : null,
        Number(preco),
        Number(estoque),
        status || 'ativo',
      ]
    );

    res.status(201).json({
      message: 'Produto cadastrado com sucesso',
      id: result.insertId,
    });
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro ao cadastrar produto' });
  }
});

app.delete('/produtos/:id', requireAdminSession, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query('DELETE FROM produtos WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    res.json({ message: 'Produto excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    res.status(500).json({ error: 'Erro ao excluir produto' });
  }
});

app.get('/pedidos', requireAdminSession, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*, c.nome AS cliente_nome
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      ORDER BY p.id DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar pedidos:', error);
    res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
});

app.post('/pedidos', async (req, res) => {
  const { cliente_id, total, pagamento, status_entrega, items } = req.body;

  const payloadItems = Array.isArray(items) && items.length > 0 ? items : [];
  const totalCalculado = payloadItems.length > 0
    ? payloadItems.reduce((acc, item) => acc + (Number(item.quantidade || 0) * Number(item.valor_unitario || 0)), 0)
    : Number(total || 0);

  if (!cliente_id && !payloadItems.length) {
    return res.status(400).json({ error: 'Cliente e itens do pedido são obrigatórios' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO pedidos (cliente_id, total, pagamento, status_entrega) VALUES (?, ?, ?, ?)',
      [cliente_id ? Number(cliente_id) : null, Number(totalCalculado), pagamento || 'pix', status_entrega || 'pendente']
    );

    if (payloadItems.length > 0) {
      const inserts = payloadItems.map(item => [
        result.insertId,
        Number(item.produto_id),
        Number(item.quantidade || 1),
        Number(item.valor_unitario || 0)
      ]);

      await db.query(
        'INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, valor_unitario) VALUES ?',
        [inserts]
      );
    }

    res.status(201).json({
      message: 'Pedido registrado com sucesso',
      id: result.insertId,
      total: Number(totalCalculado),
    });
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ error: 'Erro ao registrar pedido' });
  }
});

app.patch('/pedidos/:id/status', requireAdminSession, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const statusesValidos = ['pendente', 'em_preparo', 'a_caminho', 'entregue', 'cancelado'];

  if (!status || !statusesValidos.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  try {
    const [result] = await db.query(
      'UPDATE pedidos SET status_entrega = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const [rows] = await db.query(`
      SELECT p.*, c.nome AS cliente_nome
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.id = ?
    `, [id]);

    res.json({
      message: 'Status do pedido atualizado com sucesso',
      pedido: rows[0] || null
    });
  } catch (error) {
    console.error('Erro ao atualizar status do pedido:', error);
    res.status(500).json({ error: 'Erro ao atualizar status do pedido' });
  }
});

app.get('/pedidos/:clienteId', async (req, res) => {
  const { clienteId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT p.*, c.nome AS cliente_nome
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.cliente_id = ?
      ORDER BY p.id DESC
    `, [clienteId]);

    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar pedidos do cliente:', error);
    res.status(500).json({ error: 'Erro ao buscar pedidos do cliente' });
  }
});

app.get('/dashboard', requireAdminSession, async (req, res) => {
  try {
    const [clientes] = await db.query('SELECT COUNT(*) AS total FROM clientes');
    const [produtos] = await db.query('SELECT COUNT(*) AS total, SUM(estoque) AS estoque_total FROM produtos');
    const [pedidos] = await db.query('SELECT COUNT(*) AS total, COALESCE(SUM(total), 0) AS faturamento FROM pedidos');

    res.json({
      totalClientes: clientes[0].total,
      totalProdutos: produtos[0].total,
      estoqueTotal: produtos[0].estoque_total || 0,
      totalPedidos: pedidos[0].total,
      faturamento: Number(pedidos[0].faturamento || 0),
    });
  } catch (error) {
    console.error('Erro ao calcular resumo:', error);
    res.status(500).json({ error: 'Erro ao carregar resumo do dashboard' });
  }
});

async function startServer() {
  try {
    await ensureDatabase();
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  } catch (error) {
    const connectionRefused = Array.isArray(error?.errors)
      ? error.errors.some((item) => item && item.code === 'ECONNREFUSED')
      : error?.code === 'ECONNREFUSED';

    if (connectionRefused) {
      console.error('MySQL não está acessível. Verifique se o MySQL está instalado e em execução, e ajuste as credenciais do arquivo .env.');
    } else {
      console.error('Erro ao iniciar servidor:', error);
    }

    process.exit(1);
  }
}

startServer();
