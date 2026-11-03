// Connection game for the event stage. The admin shows a question's images one by one; players on their
// phones only have an "I want to answer" button and answer out loud on stage. Buzzes queue in the order the
// server receives them, each player can buzz once per question, and a wrong answer passes to the next in line.
//
// Questions and images are stored in the database. The running game is kept in memory: phones poll it about
// once a second, so it must stay cheap. A backend restart ends the running game (questions are not lost).
const crypto = require("crypto");
const express = require("express");

const MAX_PLAYERS = 1000;

module.exports = function registerConnectionGame(app, { pool, requireAdmin, imageContentType }) {
  function emptyGame() {
    return {
      status: "IDLE", // IDLE → LOBBY → PLAYING → ENDED
      players: new Map(), // token → { id, name, score }
      questions: [], // [{ id, answer, imageIds }], loaded when the game starts
      qIndex: -1,
      imageIndex: 0,
      shownImages: new Set(), // image ids the audience has seen, the only ones served publicly
      revealed: false,
      queue: [] // [{ playerId, name, result: null | 'WRONG' | 'CORRECT' }], in buzz order
    };
  }
  let game = emptyGame();
  let nextPlayerId = 1;

  const currentQuestion = () => game.questions[game.qIndex] || null;
  const answeringEntry = () => (game.status === "PLAYING" && !game.revealed ? game.queue.find(e => !e.result) || null : null);
  const leaderboard = () => [...game.players.values()].filter(p => p.score > 0).sort((a, b) => b.score - a.score).map(p => ({ name: p.name, score: p.score }));

  function showImage(index) {
    const q = currentQuestion();
    game.imageIndex = Math.max(0, Math.min(index, q.imageIds.length - 1));
    game.shownImages.add(q.imageIds[game.imageIndex]);
  }

  function beginQuestion(index) {
    game.qIndex = index;
    game.revealed = false;
    game.queue = [];
    showImage(0);
  }

  // What the stage screen and everyone else may see: never the answer before it is revealed.
  function publicState() {
    const q = currentQuestion();
    const answering = answeringEntry();
    return {
      status: game.status,
      playerCount: game.players.size,
      playerNames: [...game.players.values()].slice(-60).map(p => p.name),
      questionNumber: q ? game.qIndex + 1 : 0,
      questionTotal: game.questions.length,
      imageId: q && game.status === "PLAYING" ? q.imageIds[game.imageIndex] : null,
      imageNumber: q ? game.imageIndex + 1 : 0,
      imageCount: q ? q.imageIds.length : 0,
      answering: answering ? answering.name : null,
      waiting: game.queue.filter(e => !e.result && e !== answering).map(e => e.name),
      wrong: game.queue.filter(e => e.result === "WRONG").map(e => e.name),
      revealed: game.revealed,
      answer: game.revealed && q ? q.answer : null,
      winner: (game.queue.find(e => e.result === "CORRECT") || {}).name || null,
      leaderboard: leaderboard().slice(0, 10)
    };
  }

  /* ---------- Players ---------- */

  app.post("/connection/join", (req, res) => {
    if (!["LOBBY", "PLAYING"].includes(game.status)) return res.status(423).json({ error: "The game is not open for joining right now." });
    const wanted = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!wanted) return res.status(400).json({ error: "Please enter your name." });
    if (game.players.size >= MAX_PLAYERS) return res.status(423).json({ error: "The game is full." });
    const taken = new Set([...game.players.values()].map(p => p.name.toLowerCase()));
    let name = wanted;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} ${n}`;
    const token = crypto.randomBytes(16).toString("hex");
    const player = { id: nextPlayerId++, name, score: 0 };
    game.players.set(token, player);
    res.json({ token, name });
  });

  function playerView(player) {
    const view = { status: game.status, questionNumber: game.qIndex + 1, questionTotal: game.questions.length, revealed: game.revealed };
    if (!player) return { ...view, needJoin: true };
    const entry = game.queue.find(e => e.playerId === player.id);
    const answering = answeringEntry();
    const ahead = entry && !entry.result ? game.queue.filter(e => !e.result).indexOf(entry) : 0;
    return {
      ...view,
      name: player.name,
      score: player.score,
      canBuzz: game.status === "PLAYING" && !game.revealed && !entry,
      turn: !entry ? "NONE" : entry.result || (answering === entry ? "ANSWERING" : "WAITING"),
      ahead
    };
  }

  app.get("/connection/me", (req, res) => {
    res.set("Cache-Control", "no-store").json(playerView(game.players.get(String(req.query.token || ""))));
  });

  app.post("/connection/buzz", (req, res) => {
    const player = game.players.get(String(req.body?.token || ""));
    if (!player) return res.status(404).json({ error: "Please join the game again.", needJoin: true });
    // Single-threaded, so the order of these pushes is the order the buzzes reached the server.
    if (game.status === "PLAYING" && !game.revealed && !game.queue.some(e => e.playerId === player.id)) {
      game.queue.push({ playerId: player.id, name: player.name, result: null });
    }
    res.json(playerView(player));
  });

  /* ---------- Stage screen ---------- */

  app.get("/connection/screen", (req, res) => {
    res.set("Cache-Control", "no-store").json(publicState());
  });

  // Only images the admin has already shown: players cannot peek at what comes next.
  app.get("/connection/image/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!game.shownImages.has(id)) return res.status(404).json({ error: "Not available" });
    try {
      const q = await pool.query("SELECT content_type, image FROM connection_images WHERE id=$1", [id]);
      if (!q.rows.length) return res.status(404).json({ error: "Not found" });
      res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "no-store").send(Buffer.from(q.rows[0].image));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ---------- Admin: questions ---------- */

  app.get("/admin/connection/questions", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query(`SELECT q.id, q.position, q.answer,
          COALESCE((SELECT json_agg(i.id ORDER BY i.position, i.id) FROM connection_images i WHERE i.question_id = q.id), '[]') AS image_ids
        FROM connection_questions q ORDER BY q.position, q.id`);
      res.json(q.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/admin/connection/questions", requireAdmin, async (req, res) => {
    const answer = String(req.body?.answer || "").trim().slice(0, 300);
    if (!answer) return res.status(400).json({ error: "Please enter the answer." });
    try {
      const q = await pool.query(`INSERT INTO connection_questions(position, answer)
        VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM connection_questions), $1) RETURNING id`, [answer]);
      res.json({ id: q.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/admin/connection/questions/:id", requireAdmin, async (req, res) => {
    const answer = String(req.body?.answer || "").trim().slice(0, 300);
    if (!answer) return res.status(400).json({ error: "Please enter the answer." });
    try {
      const q = await pool.query("UPDATE connection_questions SET answer=$1 WHERE id=$2 RETURNING id", [answer, req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Question not found" });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/admin/connection/questions/:id", requireAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM connection_questions WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Moves a question up (-1) or down (+1) by swapping positions with its neighbour.
  app.post("/admin/connection/questions/:id/move", requireAdmin, async (req, res) => {
    try {
      const rows = (await pool.query("SELECT id FROM connection_questions ORDER BY position, id")).rows.map(r => r.id);
      const from = rows.indexOf(Number(req.params.id));
      const to = from + (Number(req.body?.direction) < 0 ? -1 : 1);
      if (from < 0 || to < 0 || to >= rows.length) return res.json({ success: true });
      [rows[from], rows[to]] = [rows[to], rows[from]];
      for (const [i, id] of rows.entries()) await pool.query("UPDATE connection_questions SET position=$1 WHERE id=$2", [i + 1, id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/admin/connection/questions/:id/images", requireAdmin, express.raw({ type: "image/*", limit: "5mb" }), async (req, res) => {
    const image = Buffer.isBuffer(req.body) ? req.body : null;
    const contentType = image && imageContentType(image);
    if (!contentType) return res.status(400).json({ error: "Please choose a JPG, PNG or WebP image." });
    try {
      const q = await pool.query(`INSERT INTO connection_images(question_id, position, content_type, image)
        VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM connection_images WHERE question_id=$1), $2, $3) RETURNING id`,
        [req.params.id, contentType, image]);
      res.json({ id: q.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/admin/connection/images/:id", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query("SELECT content_type, image FROM connection_images WHERE id=$1", [req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Not found" });
      res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "no-store").send(Buffer.from(q.rows[0].image));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/admin/connection/images/:id", requireAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM connection_images WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ---------- Admin: running the game ---------- */

  function adminState() {
    const q = currentQuestion();
    return {
      ...publicState(),
      secretAnswer: q ? q.answer : null,
      players: [...game.players.values()].map(p => ({ name: p.name, score: p.score })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
      hasMoreQuestions: game.qIndex + 1 < game.questions.length
    };
  }

  app.get("/admin/connection/state", requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store").json(adminState());
  });

  app.post("/admin/connection/action", requireAdmin, async (req, res) => {
    const action = req.body?.action;
    try {
      const q = currentQuestion();
      if (action === "open-lobby") {
        game = emptyGame();
        game.status = "LOBBY";
      } else if (action === "start") {
        if (game.status !== "LOBBY") return res.status(409).json({ error: "Open the game for joining first." });
        const rows = (await pool.query(`SELECT q.id, q.answer,
            COALESCE((SELECT json_agg(i.id ORDER BY i.position, i.id) FROM connection_images i WHERE i.question_id = q.id), '[]') AS image_ids
          FROM connection_questions q ORDER BY q.position, q.id`)).rows;
        const questions = rows.filter(r => r.image_ids.length).map(r => ({ id: r.id, answer: r.answer, imageIds: r.image_ids }));
        if (!questions.length) return res.status(400).json({ error: "Add at least one question with an image first." });
        game.questions = questions;
        game.status = "PLAYING";
        beginQuestion(0);
      } else if (game.status === "PLAYING" && q) {
        const answering = answeringEntry();
        if (action === "next-image") showImage(game.imageIndex + 1);
        else if (action === "prev-image") showImage(game.imageIndex - 1);
        else if (action === "wrong" && answering) answering.result = "WRONG";
        else if (action === "correct" && answering) {
          answering.result = "CORRECT";
          const player = [...game.players.values()].find(p => p.id === answering.playerId);
          if (player) player.score += 1;
          game.revealed = true;
        } else if (action === "reveal") game.revealed = true;
        else if (action === "next-question") {
          if (game.qIndex + 1 < game.questions.length) beginQuestion(game.qIndex + 1);
          else game.status = "ENDED";
        } else if (action === "end") game.status = "ENDED";
        else if (action !== "reset") return res.status(400).json({ error: "That action is not possible right now." });
      } else if (action !== "reset") {
        return res.status(400).json({ error: "That action is not possible right now." });
      }
      if (action === "reset") game = emptyGame();
      res.json(adminState());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Created on every backend start, like the other late additions.
  return async function ensureConnectionTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS connection_questions (
      id SERIAL PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      answer VARCHAR(300) NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS connection_images (
      id SERIAL PRIMARY KEY,
      question_id INTEGER NOT NULL REFERENCES connection_questions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      content_type VARCHAR(50) NOT NULL,
      image BYTEA NOT NULL)`);
  };
};
