// api/agenda.js — agenda do Luan Auto Details (Vercel + Upstash Redis)
// GET  /api/agenda?data=AAAA-MM-DD  -> { ocupados: ["09:00", ...] }
// POST /api/agenda                  -> reserva o horário (SET NX = só uma pessoa consegue)
const HORAS = ["08:00","09:00","10:00","11:00","13:00","14:00","15:00","16:00","17:00"];
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}
const key = (d, h) => `ag:${d}:${h}`;
const limpa = (v, n) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const dataValida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + "T12:00:00Z").toISOString().slice(0, 10) === d;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ erro: "banco não configurado" });
  try {
    if (req.method === "GET") {
      const d = String(req.query.data || "");
      if (!dataValida(d)) return res.status(400).json({ erro: "data inválida" });
      const vals = await redis(["MGET", ...HORAS.map((h) => key(d, h))]);
      return res.status(200).json({ ocupados: HORAS.filter((h, i) => vals[i]) });
    }
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const data = String(b.data || ""), hora = String(b.hora || ""), nome = limpa(b.nome, 60);
      if (!dataValida(data) || !HORAS.includes(hora) || nome.length < 2) return res.status(400).json({ erro: "dados inválidos" });
      const agora = new Date(Date.now() - 3 * 36e5).toISOString(); // horário de Brasília
      const hoje = agora.slice(0, 10);
      if (data < hoje || (data === hoje && parseInt(hora) <= parseInt(agora.slice(11, 13))))
        return res.status(400).json({ erro: "horário já passou" });
      const reg = JSON.stringify({
        nome, servico: limpa(b.servico, 80), valor: Number(b.valor) || 0,
        veiculo: limpa(b.veiculo, 60), obs: limpa(b.obs, 200), criado: new Date().toISOString(),
      });
      const ok = await redis(["SET", key(data, hora), reg, "NX", "EX", String(60 * 60 * 24 * 120)]);
      return ok === "OK" ? res.status(200).json({ ok: true }) : res.status(409).json({ erro: "horário ocupado" });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "método não permitido" });
  } catch (e) {
    return res.status(500).json({ erro: "falha no servidor" });
  }
};
