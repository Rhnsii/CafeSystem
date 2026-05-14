const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // HTML files

const pool = mysql.createPool({
  host:     'localhost',
  user:     'root',
  password: 'root', // 
  database: 'cafe_db',
  waitForConnections: true,
});

// ── ORDER NUMBER GENERATOR ────────────────────────────────────
async function nextOrderNum(conn) {
  const [rows] = await conn.query(
    'SELECT order_num FROM orders ORDER BY id DESC LIMIT 1'
  );
  if (!rows.length) return '#001';
  const last = parseInt(rows[0].order_num.replace('#','')) || 0;
  return '#' + String(last + 1).padStart(3, '0');
}

// ── GET ALL ORDERS ────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [orders] = await conn.query(
      'SELECT * FROM orders ORDER BY FIELD(status,"pending","preparing","ready","done"), timestamp ASC'
    );
    for (const o of orders) {
      const [items] = await conn.query(
        'SELECT * FROM order_items WHERE order_id=?', [o.id]
      );
      o.items = items;
    }
    res.json(orders);
  } finally { conn.release(); }
});

// ── PLACE ORDER ───────────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
  const { kiosk_id, items } = req.body;
  const total = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const conn  = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const orderNum = await nextOrderNum(conn);
    const [r] = await conn.query(
      'INSERT INTO orders (order_num,kiosk_id,status,total) VALUES (?,?,?,?)',
      [orderNum, kiosk_id, 'pending', total]
    );
    const orderId = r.insertId;
    for (const i of items) {
      await conn.query(
        'INSERT INTO order_items (order_id,name,emoji,size,sugar,addons,item_notes,qty,unit_price,subtotal) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [orderId, i.name, i.emoji, i.size||null, i.sugar??null,
         JSON.stringify(i.addons||[]), i.notes||null, i.qty,
         i.unit_price, i.unit_price * i.qty]
      );
    }
    await conn.commit();
    res.json({ order_num: orderNum });
  } catch(e) {
    await conn.rollback();
    res.status(500).send(e.message);
  } finally { conn.release(); }
});

// ── UPDATE ORDER STATUS ───────────────────────────────────────
app.patch('/api/orders/:num/status', async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE orders SET status=? WHERE order_num=?',
    [status, req.params.num]);
  res.json({ ok: true });
});

// ── CLEAR ALL DONE ORDERS ─────────────────────────────────────
// Must be defined BEFORE /:num or Express will match "done" as a param
app.delete('/api/orders/done/all', async (req, res) => {
  const [r] = await pool.query("DELETE FROM orders WHERE status='done'");
  res.json({ deleted: r.affectedRows });
});

// ── DELETE ONE ORDER ──────────────────────────────────────────
app.delete('/api/orders/:num', async (req, res) => {
  await pool.query('DELETE FROM orders WHERE order_num=?', [req.params.num]);
  res.json({ ok: true });
});

app.listen(3000, () => console.log('Server running at http://localhost:3000'));