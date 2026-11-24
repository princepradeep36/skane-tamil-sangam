// Quiz game: multiple-choice questions on everyone's phone.
//  - The admin prepares questions: text and/or one image, 2 to 4 options, the correct option and a time limit.
//  - On stage and on every phone the question and its options appear together and a timer runs.
//  - Each player taps one option. A correct answer earns 500 to 1000 points: the faster, the more
//    (1000 for an instant answer, 500 at the last second). Wrong or no answer: 0.
//  - The question ends when the time is up or everyone has answered. The stage then shows the correct
//    option and how many chose each one; "Next" shows the top 5, then the next question.
//
// Questions are stored in the database. The running game is kept in memory (phones poll it about once a
// second, so it must stay cheap); a backend restart ends the running game but keeps the questions.
const crypto = require("crypto");
const express = require("express");

const MAX_PLAYERS = 1000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const DEFAULT_SECONDS = 20;
const MIN_SECONDS = 5;
const MAX_SECONDS = 120;
// Phones learn about a new question on their next poll (about a second). Each player's clock starts when
// their phone first received the question, but never more than this after the question opened.
const MAX_LATE_START_MS = 2000;

const cleanText = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

module.exports = function registerQuizGame(app, { pool, requireAdmin, imageContentType }) {
  function emptyGame() {
    return {
      status: "IDLE", // IDLE → LOBBY → QUESTION → RESULT → BOARD → (QUESTION …) → ENDED
      showRules: false,
      players: new Map(), // token → { id, name, score, reachedAt, streak, last: { choice, correct, points } }
      questions: [],
      qIndex: -1,
      openedAt: 0, // when the current question opened
      endsAt: 0,
      answers: new Map(), // playerId → { choice, ms, correct, points }
      seenAt: new Map(), // playerId → when their phone first received the current question
      gained: new Map() // playerId → points from the current question (for the top 5 screen)
    };
  }
  let game = emptyGame();
  let nextPlayerId = 1;
  let timer = null;

  const currentQuestion = () => game.questions[game.qIndex] || null;
  // Highest score first; on equal scores, whoever reached that score first ranks higher.
  const byRank = (a, b) => b.score - a.score || a.reachedAt - b.reachedAt;
  const ranked = () => [...game.players.values()].sort(byRank);
  const rankOf = player => ranked().indexOf(player) + 1;
  const msLeft = () => Math.max(0, game.endsAt - Date.now());

  function openQuestion(index) {
    game.qIndex = index;
    game.status = "QUESTION";
    game.answers = new Map();
    game.seenAt = new Map();
    game.gained = new Map();
    game.openedAt = Date.now();
    game.endsAt = game.openedAt + currentQuestion().seconds * 1000;
    clearTimeout(timer);
    timer = setTimeout(() => closeQuestion(), currentQuestion().seconds * 1000 + 50);
  }

  // Time is up (or everyone answered, or the admin stopped the timer): count the points.
  function closeQuestion() {
    clearTimeout(timer);
    if (game.status !== "QUESTION") return;
    game.status = "RESULT";
    game.endsAt = Date.now();
    for (const player of game.players.values()) {
      const a = game.answers.get(player.id);
      if (a && a.correct) {
        player.score += a.points;
        player.reachedAt = a.at;
        player.streak = (player.streak || 0) + 1;
        game.gained.set(player.id, a.points);
      } else player.streak = 0;
      player.last = a ? { choice: a.choice, correct: a.correct, points: a.correct ? a.points : 0 } : { choice: null, correct: false, points: 0 };
    }
  }

  // Called on every request: closes the question once the time is up or everybody has answered.
  function tick() {
    if (game.status !== "QUESTION") return;
    if (Date.now() >= game.endsAt || (game.players.size > 0 && game.answers.size >= game.players.size)) closeQuestion();
  }

  const questionPayload = q => ({ text: q.text, image: q.hasImage ? q.id : null, options: q.options, seconds: q.seconds });

  function publicState() {
    tick();
    const q = currentQuestion();
    const inQuestion = q && ["QUESTION", "RESULT", "BOARD"].includes(game.status);
    const state = {
      status: game.status,
      showRules: game.status === "LOBBY" && game.showRules,
      playerCount: game.players.size,
      playerNames: [...game.players.values()].slice(-60).map(p => p.name),
      questionNumber: q ? game.qIndex + 1 : 0,
      questionTotal: game.questions.length,
      question: inQuestion ? questionPayload(q) : null,
      msLeft: game.status === "QUESTION" ? msLeft() : 0,
      answerCount: game.answers.size,
      isLast: game.qIndex + 1 >= game.questions.length
    };
    if (q && (game.status === "RESULT" || game.status === "BOARD")) {
      const counts = q.options.map(() => 0);
      for (const a of game.answers.values()) counts[a.choice]++;
      state.correct = q.correct;
      state.counts = counts;
      state.correctCount = counts[q.correct] || 0;
    }
    if (game.status === "BOARD" || game.status === "ENDED") {
      state.top = ranked().filter(p => p.score > 0).slice(0, 5).map(p => ({ name: p.name, score: p.score, gained: game.gained.get(p.id) || 0 }));
    }
    return state;
  }

  /* ---------- Players ---------- */

  app.post("/quiz/join", (req, res) => {
    if (!["LOBBY", "QUESTION", "RESULT", "BOARD"].includes(game.status)) return res.status(423).json({ error: "The quiz is not open for joining right now." });
    const wanted = cleanText(req.body?.name, 30);
    if (!wanted) return res.status(400).json({ error: "Please enter your name." });
    if (game.players.size >= MAX_PLAYERS) return res.status(423).json({ error: "The quiz is full." });
    const taken = new Set([...game.players.values()].map(p => p.name.toLowerCase()));
    let name = wanted;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} ${n}`;
    const token = crypto.randomBytes(16).toString("hex");
    game.players.set(token, { id: nextPlayerId++, name, score: 0, reachedAt: 0, streak: 0, last: null });
    res.json({ token, name });
  });

  function playerView(player) {
    tick();
    const q = currentQuestion();
    const view = { status: game.status, questionNumber: q ? game.qIndex + 1 : 0, questionTotal: game.questions.length };
    if (!player) return { ...view, needJoin: true };
    Object.assign(view, { name: player.name, score: player.score });
    if (game.status === "QUESTION") {
      if (!game.seenAt.has(player.id)) game.seenAt.set(player.id, Math.min(Date.now(), game.openedAt + MAX_LATE_START_MS));
      const mine = game.answers.get(player.id);
      return { ...view, question: questionPayload(q), msLeft: msLeft(), myChoice: mine ? mine.choice : null };
    }
    if (game.status === "RESULT" || game.status === "BOARD") {
      const last = player.last || { choice: null, correct: false, points: 0 };
      return { ...view, question: questionPayload(q), correct: q.correct, myChoice: last.choice, wasCorrect: last.correct,
        points: last.points, streak: player.streak, rank: rankOf(player), playerCount: game.players.size };
    }
    if (game.status === "ENDED") return { ...view, rank: rankOf(player), playerCount: game.players.size, winner: (ranked()[0] || {}).name || null };
    return view;
  }

  app.get("/quiz/me", (req, res) => {
    res.set("Cache-Control", "no-store").json(playerView(game.players.get(String(req.query.token || ""))));
  });

  app.post("/quiz/answer", (req, res) => {
    const player = game.players.get(String(req.body?.token || ""));
    if (!player) return res.status(404).json({ error: "Please join the quiz again.", needJoin: true });
    tick();
    const q = currentQuestion();
    if (game.status !== "QUESTION") return res.status(409).json({ error: "Time is up for this question.", ...playerView(player) });
    if (game.answers.has(player.id)) return res.status(409).json({ error: "You have already answered.", ...playerView(player) });
    const choice = Number(req.body?.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return res.status(400).json({ error: "Please tap one of the answers." });
    const now = Date.now();
    const start = game.seenAt.get(player.id) || game.openedAt;
    const limit = q.seconds * 1000;
    const ms = Math.max(0, Math.min(limit, now - start));
    const correct = choice === q.correct;
    // 1000 points for an instant answer, falling to 500 at the end of the time.
    const points = correct ? Math.round(1000 * (1 - ms / limit / 2)) : 0;
    game.answers.set(player.id, { choice, ms, at: now, correct, points });
    if (game.answers.size >= game.players.size) closeQuestion();
    res.json(playerView(player));
  });

  /* ---------- Stage screen ---------- */

  app.get("/quiz/screen", (req, res) => {
    res.set("Cache-Control", "no-store").json(publicState());
  });

  // Only the image of a question that has been shown: nobody can peek at what comes next.
  app.get("/quiz/image/:id", async (req, res) => {
    const id = Number(req.params.id);
    const shown = game.status !== "IDLE" && game.questions.slice(0, game.qIndex + 1).some(q => q.id === id);
    if (!shown) return res.status(404).json({ error: "Not available" });
    try {
      const q = await pool.query("SELECT content_type, image FROM quiz_questions WHERE id=$1 AND image IS NOT NULL", [id]);
      if (!q.rows.length) return res.status(404).json({ error: "Not found" });
      res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "private, max-age=300").send(Buffer.from(q.rows[0].image));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ---------- Admin: questions ---------- */

  const COLUMNS = "id, position, text, option_a, option_b, option_c, option_d, correct, seconds, (image IS NOT NULL) AS has_image";
  const toQuestion = r => {
    const options = [r.option_a, r.option_b, r.option_c, r.option_d].map(o => o || "");
    return { id: r.id, position: r.position, text: r.text || "", options, correct: r.correct, seconds: r.seconds, hasImage: r.has_image };
  };

  // Validates a question from the admin form; returns [values, error].
  function readQuestion(body) {
    const text = cleanText(body?.text, 500);
    const raw = Array.isArray(body?.options) ? body.options.slice(0, MAX_OPTIONS) : [];
    const options = [0, 1, 2, 3].map(i => cleanText(raw[i], 150));
    const correct = Number(body?.correct);
    let seconds = Math.round(Number(body?.seconds) || DEFAULT_SECONDS);
    seconds = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, seconds));
    // Options must be filled from A onwards (A and B at least), with no gaps.
    const filled = options.filter(Boolean).length;
    if (filled < MIN_OPTIONS) return [null, "Please fill in at least answers A and B."];
    if (options.slice(0, filled).some(o => !o)) return [null, "Please fill in the answers in order (A, B, C, D) without gaps."];
    if (!Number.isInteger(correct) || correct < 0 || correct >= filled) return [null, "Please choose which answer is correct."];
    return [[text, ...options.map(o => o || null), correct, seconds], null];
  }

  app.get("/admin/quiz/questions", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query(`SELECT ${COLUMNS} FROM quiz_questions ORDER BY position, id`);
      res.json(q.rows.map(toQuestion));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/admin/quiz/questions", requireAdmin, async (req, res) => {
    const [values, error] = readQuestion(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const q = await pool.query(`INSERT INTO quiz_questions(position, text, option_a, option_b, option_c, option_d, correct, seconds)
        VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM quiz_questions), $1, $2, $3, $4, $5, $6, $7) RETURNING id`, values);
      res.json({ id: q.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/admin/quiz/questions/:id", requireAdmin, async (req, res) => {
    const [values, error] = readQuestion(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const q = await pool.query(`UPDATE quiz_questions SET text=$1, option_a=$2, option_b=$3, option_c=$4, option_d=$5, correct=$6, seconds=$7
        WHERE id=$8 RETURNING id`, [...values, req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Question not found" });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/admin/quiz/questions/:id", requireAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM quiz_questions WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/admin/quiz/questions/:id/move", requireAdmin, async (req, res) => {
    try {
      const rows = (await pool.query("SELECT id FROM quiz_questions ORDER BY position, id")).rows.map(r => r.id);
      const from = rows.indexOf(Number(req.params.id));
      const to = from + (Number(req.body?.direction) < 0 ? -1 : 1);
      if (from >= 0 && to >= 0 && to < rows.length) {
        [rows[from], rows[to]] = [rows[to], rows[from]];
        for (const [i, rowId] of rows.entries()) await pool.query("UPDATE quiz_questions SET position=$1 WHERE id=$2", [i + 1, rowId]);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/admin/quiz/questions/:id/image", requireAdmin, express.raw({ type: "image/*", limit: "5mb" }), async (req, res) => {
    const image = Buffer.isBuffer(req.body) ? req.body : null;
    const contentType = image && imageContentType(image);
    if (!contentType) return res.status(400).json({ error: "Please choose a JPG, PNG or WebP image." });
    try {
      const q = await pool.query("UPDATE quiz_questions SET image=$1, content_type=$2 WHERE id=$3 RETURNING id", [image, contentType, req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Question not found" });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/admin/quiz/questions/:id/image", requireAdmin, async (req, res) => {
    try {
      await pool.query("UPDATE quiz_questions SET image=NULL, content_type=NULL WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/admin/quiz/images/:id", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query("SELECT content_type, image FROM quiz_questions WHERE id=$1 AND image IS NOT NULL", [req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Not found" });
      res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "no-store").send(Buffer.from(q.rows[0].image));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ---------- Admin: running the game ---------- */

  function adminState() {
    const state = publicState();
    const q = currentQuestion();
    return {
      ...state,
      correct: q ? q.correct : null, // the admin sees the right answer while the question runs
      players: ranked().map(p => ({ name: p.name, score: p.score }))
    };
  }

  app.get("/admin/quiz/state", requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store").json(adminState());
  });

  app.post("/admin/quiz/action", requireAdmin, async (req, res) => {
    const action = req.body?.action;
    try {
      tick();
      if (action === "open-lobby") {
        clearTimeout(timer);
        game = emptyGame();
        game.status = "LOBBY";
      } else if ((action === "show-rules" || action === "hide-rules") && game.status === "LOBBY") {
        game.showRules = action === "show-rules";
      } else if (action === "start") {
        if (game.status !== "LOBBY") return res.status(409).json({ error: "Open the quiz for joining first." });
        const rows = (await pool.query(`SELECT ${COLUMNS} FROM quiz_questions ORDER BY position, id`)).rows.map(toQuestion);
        const questions = rows.map(q => ({ ...q, options: q.options.filter(Boolean) }))
          .filter(q => q.options.length >= MIN_OPTIONS && q.correct < q.options.length && (q.text || q.hasImage));
        if (!questions.length) return res.status(400).json({ error: "Add at least one question with its answers first." });
        game.questions = questions;
        openQuestion(0);
      } else if (action === "stop-timer" && game.status === "QUESTION") {
        closeQuestion();
      } else if (action === "next") {
        // Result → top 5 → next question (or the final podium after the last one).
        if (game.status === "RESULT") game.status = "BOARD";
        else if (game.status === "BOARD") {
          if (game.qIndex + 1 < game.questions.length) openQuestion(game.qIndex + 1);
          else game.status = "ENDED";
        } else return res.status(409).json({ error: "That is not possible right now." });
      } else if (action === "end") {
        if (game.status === "QUESTION") closeQuestion();
        game.status = "ENDED";
      } else if (action === "reset") {
        clearTimeout(timer);
        game = emptyGame();
      } else {
        return res.status(400).json({ error: "That action is not possible right now." });
      }
      res.json(adminState());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Created on every backend start, like the other late additions.
  return async function ensureQuizTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS quiz_questions (
      id SERIAL PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      text VARCHAR(500),
      option_a VARCHAR(150) NOT NULL,
      option_b VARCHAR(150) NOT NULL,
      option_c VARCHAR(150),
      option_d VARCHAR(150),
      correct SMALLINT NOT NULL DEFAULT 0,
      seconds SMALLINT NOT NULL DEFAULT ${DEFAULT_SECONDS},
      content_type VARCHAR(50),
      image BYTEA)`);
  };
};
