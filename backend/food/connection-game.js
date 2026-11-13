// Stage games for the event.
//  - Connection game: a question's images are shown one by one. Players tap "I want to answer"; buzzes
//    queue in the order the server receives them, each player can buzz once per question, and a wrong
//    answer passes to the next in line.
//  - Clue game: a place's 3 clues are shown one by one and EVERYONE may answer: each player types one
//    answer per place on the phone. It is worth 3 points if sent while clue 1 is showing, 2 after clue 2
//    and 1 after clue 3. The server suggests which answers match (allowing for typos) and the admin ticks
//    the correct ones. The answer and the points are shown after clue 3.
//
// Each game is registered separately (kind "connection" or "clue") with its own routes, questions and
// players, so both can be prepared side by side. Questions are stored in the database. The running game is
// kept in memory: phones poll it about once a second, so it must stay cheap. A backend restart ends the
// running game (questions are not lost).
const crypto = require("crypto");
const express = require("express");

const MAX_PLAYERS = 1000;
// Clue game: a place has 3 to 5 clues. A correct answer is worth as many points as there are clues
// left to show, counting the one on screen: with 5 clues 5/4/3/2/1, with 4 clues 4/3/2/1, with 3 clues
// 3/2/1. The Connection game gives 1 point.
const MIN_CLUES = 3;
const MAX_CLUES = 5;

// Typed answers: compare letters only, ignoring case, accents, spaces and punctuation, and allow a few
// typos (one wrong letter, or about one in four for long names). The answer may list alternatives separated by "/".
const normalize = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\u0b80-\u0bff]+/g, "");
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Tamil names are written many ways in English: th/t, dh/d, zh/l, sh/s, w/v, doubled letters and
// long vowels (oo/u, ee/i, aa/a). soundKey folds those together; skeleton keeps only the consonants,
// so "tanjur", "thanjore" and "tanjore" sound alike.
function soundKey(s) {
  return s.replace(/zh/g, "l").replace(/([tdskpbgc])h/g, "$1").replace(/w/g, "v").replace(/ee/g, "i").replace(/oo/g, "u")
    .replace(/(.)+/g, "$1");
}
const skeleton = s => soundKey(s).replace(/[aeiouy]/g, "").replace(/(.)+/g, "$1");

function looksRight(text, question) {
  const typed = normalize(text);
  if (!typed) return false;
  const targets = [...String(question.answer || "").split("/"), question.details ? question.details.answerTamil : ""].map(normalize).filter(Boolean);
  return targets.some(t => {
    if (typed === t) return true;
    if (/^[a-z0-9]+$/.test(t)) {
      // Sounds alike (English spellings only; Tamil script is compared as typed).
      const a = soundKey(typed), b = soundKey(t);
      if (a === b || (b.length >= 5 && editDistance(a, b) <= Math.max(1, Math.floor(b.length / 4)))) return true;
      const sa = skeleton(typed), sb = skeleton(t);
      if (sb.length >= 3 && sa === sb) return true;
    }
    if (t.length <= 4) return editDistance(typed, t) <= 1;
    const allowed = Math.max(1, Math.floor(t.length / 4));
    if (editDistance(typed, t) <= allowed) return true;
    if (typed.length >= 5 && (t.includes(typed) || typed.includes(t))) return true; // "villiputhur", "srivilliputhur temple"
    // Extra words around a misspelt answer ("sri villiputtur temple"): compare each stretch of the answer's length.
    for (let len = t.length - 1; len <= t.length + 1; len++) {
      for (let i = 0; i + len <= typed.length && typed.length > t.length; i++) if (editDistance(typed.slice(i, i + len), t) <= Math.max(1, allowed - 1)) return true;
    }
    return false;
  });
}

module.exports = function registerConnectionGame(app, { pool, requireAdmin, imageContentType, kind = "connection" }) {
  const CLUES = kind === "clue";
  const QUESTIONS = `${kind}_questions`;
  const ITEMS = CLUES ? "clue_items" : "connection_images";
  // Clue questions also have a Tamil name, two short tags and a fact, shown with the answer.
  const DETAIL_COLUMNS = CLUES ? ", q.answer_tamil, q.tag1, q.tag2, q.fact" : "";
  const details = r => (CLUES ? { answerTamil: r.answer_tamil || "", tags: [r.tag1, r.tag2].filter(Boolean), fact: r.fact || "" } : null);
  // A clue is either text or an image (image clues are shown side by side on the stage).
  const itemsJson = CLUES
    ? `COALESCE((SELECT json_agg(json_build_object('id', i.id, 'text', i.text, 'image', i.image IS NOT NULL) ORDER BY i.position, i.id) FROM ${ITEMS} i WHERE i.question_id = q.id), '[]')`
    : `COALESCE((SELECT json_agg(i.id ORDER BY i.position, i.id) FROM ${ITEMS} i WHERE i.question_id = q.id), '[]')`;

  function emptyGame() {
    return {
      status: "IDLE", // IDLE → LOBBY → PLAYING → ENDED
      showRules: false, // in the lobby, the stage shows the rules instead of the QR code
      players: new Map(), // token → { id, name, score, reachedAt }
      scoreTick: 0, // counts correct answers, so equal scores can be ranked by who reached them first
      questions: [], // [{ id, answer, imageIds, clues }], loaded when the game starts
      qIndex: -1,
      imageIndex: 0, // the image or clue being shown
      shownImages: new Set(), // image ids the audience has seen, the only ones served publicly
      revealed: false,
      awarded: 0, // points given for the current question's correct answer
      queue: [], // [{ playerId, name, result: null | 'WRONG' | 'CORRECT' }], in buzz order
      // Clue game: this place's typed answers (playerId → { name, text, clue, at, suggested, correct }),
      // the points given per place (qIndex → Map playerId → { points, at }) and the scores screen.
      answers: new Map(),
      awards: new Map(),
      showScores: false
    };
  }
  let game = emptyGame();
  let nextPlayerId = 1;

  const currentQuestion = () => game.questions[game.qIndex] || null;
  const answeringEntry = () => (game.status === "PLAYING" && !game.revealed ? game.queue.find(e => !e.result) || null : null);
  const clueCount = () => (currentQuestion() ? currentQuestion().imageIds.length : MIN_CLUES);
  const worth = () => (CLUES ? Math.max(1, clueCount() - game.imageIndex) : 1);
  const pointsForClue = clue => Math.max(1, clueCount() - clue + 1);
  const playerById = id => [...game.players.values()].find(p => p.id === id);

  // Clue game: points for the current place come from the ticked answers; every player's score is the
  // sum of their places, and reachedAt is when they sent the answer that brought them to that score.
  function scoreCurrentPlace() {
    const awards = new Map();
    for (const [playerId, a] of game.answers) if (a.correct) awards.set(playerId, { points: pointsForClue(a.clue), at: a.at });
    game.awards.set(game.qIndex, awards);
    for (const player of game.players.values()) {
      player.score = 0; player.reachedAt = 0;
      for (const place of game.awards.values()) {
        const won = place.get(player.id);
        if (won) { player.score += won.points; player.reachedAt = Math.max(player.reachedAt, won.at); }
      }
    }
  }
  const placeAwards = () => game.awards.get(game.qIndex) || new Map();
  // Highest score first; on equal scores, whoever reached that score first ranks higher.
  const byRank = (a, b) => b.score - a.score || a.reachedAt - b.reachedAt;
  const ranked = () => [...game.players.values()].filter(p => p.score > 0).sort(byRank);
  const leaderboard = () => ranked().map(p => ({ name: p.name, score: p.score }));

  function showImage(index) {
    const q = currentQuestion();
    game.imageIndex = Math.max(0, Math.min(index, q.imageIds.length - 1));
    game.shownImages.add(q.imageIds[game.imageIndex]);
  }

  function beginQuestion(index) {
    game.qIndex = index;
    game.revealed = false;
    game.awarded = 0;
    game.queue = [];
    game.answers = new Map();
    game.showScores = false;
    showImage(0);
  }

  // What the stage screen and everyone else may see: never the answer, or clues not shown yet.
  function publicState() {
    const q = currentQuestion();
    const answering = answeringEntry();
    const playing = q && game.status === "PLAYING";
    return {
      kind,
      status: game.status,
      showRules: game.status === "LOBBY" && game.showRules,
      playerCount: game.players.size,
      playerNames: [...game.players.values()].slice(-60).map(p => p.name),
      questionNumber: q ? game.qIndex + 1 : 0,
      questionTotal: game.questions.length,
      imageId: playing && !CLUES ? q.imageIds[game.imageIndex] : null,
      clues: playing && CLUES ? q.clues.slice(0, game.imageIndex + 1).map(c => ({ text: c.image ? "" : c.text, image: c.image ? c.id : null })) : [],
      clueKinds: playing && CLUES ? q.clues.map(c => (c.image ? "image" : "text")) : [],
      imageNumber: q ? game.imageIndex + 1 : 0,
      imageCount: q ? q.imageIds.length : 0,
      answering: answering ? answering.name : null,
      answeringText: answering ? answering.typed || null : null, // what they typed on their phone, if anything
      waiting: game.queue.filter(e => !e.result && e !== answering).map(e => e.name),
      wrong: game.queue.filter(e => e.result === "WRONG").map(e => e.name),
      revealed: game.revealed,
      // Other accepted names after "/" are only for matching typed answers; the stage shows the first name.
      answer: game.revealed && q ? (CLUES ? q.answer.split("/")[0].trim() : q.answer) : null,
      answerDetails: game.revealed && q ? q.details : null,
      winner: (game.queue.find(e => e.result === "CORRECT") || {}).name || null,
      worth: playing ? worth() : 0,
      awarded: game.awarded,
      leaderboard: leaderboard().slice(0, 5), // the stage shows the top 5 winners
      ...(CLUES ? clueState() : {})
    };
  }

  // Clue game extras: how many answered (not who or what, until the reveal), then who got it right.
  function clueState() {
    const perClue = Array(clueCount()).fill(0);
    for (const a of game.answers.values()) perClue[a.clue - 1]++;
    const awards = placeAwards();
    return {
      answerCount: game.answers.size,
      answersPerClue: perClue,
      canReveal: game.status === "PLAYING" && game.imageIndex >= clueCount() - 1,
      clueTotal: clueCount(),
      showScores: game.revealed && game.showScores,
      correctPlayers: game.revealed
        ? [...awards.entries()].map(([id, w]) => ({ name: (playerById(id) || {}).name || "?", points: w.points, at: w.at }))
          .sort((a, b) => b.points - a.points || a.at - b.at).map(({ name, points }) => ({ name, points }))
        : [],
      // Scores after this place: top 10, with what each gained on this place.
      roundBoard: game.revealed ? ranked().slice(0, 10).map(p => ({ name: p.name, score: p.score, gained: (awards.get(p.id) || {}).points || 0 })) : []
    };
  }

  /* ---------- Players ---------- */

  app.post(`/${kind}/join`, (req, res) => {
    if (!["LOBBY", "PLAYING"].includes(game.status)) return res.status(423).json({ error: "The game is not open for joining right now." });
    const wanted = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!wanted) return res.status(400).json({ error: "Please enter your name." });
    if (game.players.size >= MAX_PLAYERS) return res.status(423).json({ error: "The game is full." });
    const taken = new Set([...game.players.values()].map(p => p.name.toLowerCase()));
    let name = wanted;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} ${n}`;
    const token = crypto.randomBytes(16).toString("hex");
    const player = { id: nextPlayerId++, name, score: 0, reachedAt: 0 };
    game.players.set(token, player);
    res.json({ token, name });
  });

  function playerView(player) {
    const view = { kind, status: game.status, questionNumber: game.qIndex + 1, questionTotal: game.questions.length, revealed: game.revealed,
      worth: game.status === "PLAYING" ? worth() : 0, awarded: game.awarded,
      step: game.imageIndex + 1, steps: currentQuestion() ? currentQuestion().imageIds.length : 0 };
    if (!player) return { ...view, needJoin: true };
    const entry = game.queue.find(e => e.playerId === player.id);
    const answering = answeringEntry();
    const ahead = entry && !entry.result ? game.queue.filter(e => !e.result).indexOf(entry) : 0;
    if (CLUES) {
      const mine = game.answers.get(player.id);
      const won = placeAwards().get(player.id);
      return {
        ...view,
        name: player.name,
        score: player.score,
        canAnswer: game.status === "PLAYING" && !game.revealed && !mine,
        myAnswer: mine ? { text: mine.text, clue: mine.clue, points: pointsForClue(mine.clue) } : null,
        result: game.revealed && mine ? { correct: !!won, points: won ? won.points : 0 } : null
      };
    }
    return {
      ...view,
      name: player.name,
      score: player.score,
      canBuzz: game.status === "PLAYING" && !game.revealed && !entry,
      turn: !entry ? "NONE" : entry.result || (answering === entry ? "ANSWERING" : "WAITING"),
      typed: entry ? entry.typed || "" : "",
      ahead
    };
  }

  app.get(`/${kind}/me`, (req, res) => {
    res.set("Cache-Control", "no-store").json(playerView(game.players.get(String(req.query.token || ""))));
  });

  app.post(`/${kind}/buzz`, (req, res) => {
    const player = game.players.get(String(req.body?.token || ""));
    if (!player) return res.status(404).json({ error: "Please join the game again.", needJoin: true });
    // Single-threaded, so the order of these pushes is the order the buzzes reached the server.
    if (game.status === "PLAYING" && !game.revealed && !game.queue.some(e => e.playerId === player.id)) {
      game.queue.push({ playerId: player.id, name: player.name, result: null, typed: "" });
    }
    res.json(playerView(player));
  });

  // A player in the queue types their answer on the phone. It is not checked: the admin sees it
  // (and the stage shows it when it is their turn) and marks it correct or wrong. One answer only.
  app.post(`/${kind}/answer`, (req, res) => {
    const player = game.players.get(String(req.body?.token || ""));
    if (!player) return res.status(404).json({ error: "Please join the game again.", needJoin: true });
    if (CLUES) {
      // Everyone may answer, once per place, until the answer is shown.
      if (game.status !== "PLAYING" || game.revealed) return res.status(409).json({ error: "You can't send an answer right now.", ...playerView(player) });
      if (game.answers.has(player.id)) return res.status(409).json({ error: "You have already sent your answer for this place.", ...playerView(player) });
      const text = String(req.body?.text || "").replace(/\s+/g, " ").trim().slice(0, 100);
      if (!text) return res.status(400).json({ error: "Please type your answer." });
      const suggested = looksRight(text, currentQuestion());
      game.answers.set(player.id, { name: player.name, text, clue: game.imageIndex + 1, at: Date.now(), suggested, correct: suggested });
      return res.json(playerView(player));
    }
    const entry = game.status === "PLAYING" && !game.revealed ? game.queue.find(e => e.playerId === player.id && !e.result) : null;
    if (!entry) return res.status(409).json({ error: "You can't send an answer right now.", ...playerView(player) });
    if (entry.typed) return res.status(409).json({ error: "You have already sent your answer.", ...playerView(player) });
    const text = String(req.body?.text || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!text) return res.status(400).json({ error: "Please type your answer." });
    entry.typed = text;
    res.json(playerView(player));
  });

  /* ---------- Stage screen ---------- */

  app.get(`/${kind}/screen`, (req, res) => {
    res.set("Cache-Control", "no-store").json(publicState());
  });

  // Only images the admin has already shown: players cannot peek at what comes next.
  app.get(`/${kind}/image/:id`, async (req, res) => {
    const id = Number(req.params.id);
    if (!game.shownImages.has(id)) return res.status(404).json({ error: "Not available" });
    try {
      const q = await pool.query(`SELECT content_type, image FROM ${ITEMS} WHERE id=$1 AND image IS NOT NULL`, [id]);
      if (!q.rows.length) return res.status(404).json({ error: "Not found" });
      res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "no-store").send(Buffer.from(q.rows[0].image));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  /* ---------- Admin: questions ---------- */

  app.get(`/admin/${kind}/questions`, requireAdmin, async (req, res) => {
    try {
      const q = await pool.query(`SELECT q.id, q.position, q.answer${DETAIL_COLUMNS}, ${itemsJson} AS ${CLUES ? "clues" : "image_ids"}
        FROM ${QUESTIONS} q ORDER BY q.position, q.id`);
      res.json(q.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post(`/admin/${kind}/questions`, requireAdmin, async (req, res) => {
    const answer = String(req.body?.answer || "").trim().slice(0, 300);
    if (!answer) return res.status(400).json({ error: "Please enter the answer." });
    try {
      const q = await pool.query(`INSERT INTO ${QUESTIONS}(position, answer)
        VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM ${QUESTIONS}), $1) RETURNING id`, [answer]);
      res.json({ id: q.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put(`/admin/${kind}/questions/:id`, requireAdmin, async (req, res) => {
    const answer = String(req.body?.answer || "").trim().slice(0, 300);
    if (!answer) return res.status(400).json({ error: "Please enter the answer." });
    const text = (key, max) => (req.body?.[key] === undefined ? null : String(req.body[key] || "").replace(/\s+/g, " ").trim().slice(0, max));
    try {
      const q = CLUES
        ? await pool.query(`UPDATE ${QUESTIONS} SET answer=$1, answer_tamil=COALESCE($3, answer_tamil), tag1=COALESCE($4, tag1),
            tag2=COALESCE($5, tag2), fact=COALESCE($6, fact) WHERE id=$2 RETURNING id`,
          [answer, req.params.id, text("answerTamil", 300), text("tag1", 100), text("tag2", 100), text("fact", 500)])
        : await pool.query(`UPDATE ${QUESTIONS} SET answer=$1 WHERE id=$2 RETURNING id`, [answer, req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Question not found" });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete(`/admin/${kind}/questions/:id`, requireAdmin, async (req, res) => {
    try {
      await pool.query(`DELETE FROM ${QUESTIONS} WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Moves a question (or a clue within its question) up (-1) or down (+1) by swapping with its neighbour.
  async function move(table, where, params, id, direction) {
    const rows = (await pool.query(`SELECT id FROM ${table} ${where} ORDER BY position, id`, params)).rows.map(r => r.id);
    const from = rows.indexOf(Number(id));
    const to = from + (Number(direction) < 0 ? -1 : 1);
    if (from < 0 || to < 0 || to >= rows.length) return;
    [rows[from], rows[to]] = [rows[to], rows[from]];
    for (const [i, rowId] of rows.entries()) await pool.query(`UPDATE ${table} SET position=$1 WHERE id=$2`, [i + 1, rowId]);
  }

  app.post(`/admin/${kind}/questions/:id/move`, requireAdmin, async (req, res) => {
    try {
      await move(QUESTIONS, "", [], req.params.id, req.body?.direction);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  if (CLUES) {
    const clueText = body => String(body?.text || "").replace(/\s+/g, " ").trim().slice(0, 500);

    app.post(`/admin/${kind}/questions/:id/clues`, requireAdmin, async (req, res) => {
      const text = clueText(req.body);
      if (!text) return res.status(400).json({ error: "Please type the clue." });
      try {
        const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${ITEMS} WHERE question_id=$1`, [req.params.id])).rows[0].n;
        if (count >= MAX_CLUES) return res.status(400).json({ error: `A place can have at most ${MAX_CLUES} clues. Edit or remove one first.` });
        const q = await pool.query(`INSERT INTO ${ITEMS}(question_id, position, text)
          VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM ${ITEMS} WHERE question_id=$1), $2) RETURNING id`, [req.params.id, text]);
        res.json({ id: q.rows[0].id });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // An image clue instead of text (counts towards the 3 clues).
    app.post(`/admin/${kind}/questions/:id/clue-image`, requireAdmin, express.raw({ type: "image/*", limit: "5mb" }), async (req, res) => {
      const image = Buffer.isBuffer(req.body) ? req.body : null;
      const contentType = image && imageContentType(image);
      if (!contentType) return res.status(400).json({ error: "Please choose a JPG, PNG or WebP image." });
      try {
        const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${ITEMS} WHERE question_id=$1`, [req.params.id])).rows[0].n;
        if (count >= MAX_CLUES) return res.status(400).json({ error: `A place can have at most ${MAX_CLUES} clues. Remove one first.` });
        const q = await pool.query(`INSERT INTO ${ITEMS}(question_id, position, text, content_type, image)
          VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM ${ITEMS} WHERE question_id=$1), '', $2, $3) RETURNING id`, [req.params.id, contentType, image]);
        res.json({ id: q.rows[0].id });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get(`/admin/${kind}/images/:id`, requireAdmin, async (req, res) => {
      try {
        const q = await pool.query(`SELECT content_type, image FROM ${ITEMS} WHERE id=$1 AND image IS NOT NULL`, [req.params.id]);
        if (!q.rows.length) return res.status(404).json({ error: "Not found" });
        res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "no-store").send(Buffer.from(q.rows[0].image));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.put(`/admin/${kind}/clues/:id`, requireAdmin, async (req, res) => {
      const text = clueText(req.body);
      if (!text) return res.status(400).json({ error: "Please type the clue." });
      try {
        const q = await pool.query(`UPDATE ${ITEMS} SET text=$1 WHERE id=$2 RETURNING id`, [text, req.params.id]);
        if (!q.rows.length) return res.status(404).json({ error: "Clue not found" });
        res.json({ success: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post(`/admin/${kind}/clues/:id/move`, requireAdmin, async (req, res) => {
      try {
        const clue = (await pool.query(`SELECT question_id FROM ${ITEMS} WHERE id=$1`, [req.params.id])).rows[0];
        if (clue) await move(ITEMS, "WHERE question_id=$1", [clue.question_id], req.params.id, req.body?.direction);
        res.json({ success: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.delete(`/admin/${kind}/clues/:id`, requireAdmin, async (req, res) => {
      try {
        await pool.query(`DELETE FROM ${ITEMS} WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });
  } else {
    app.post(`/admin/${kind}/questions/:id/images`, requireAdmin, express.raw({ type: "image/*", limit: "5mb" }), async (req, res) => {
      const image = Buffer.isBuffer(req.body) ? req.body : null;
      const contentType = image && imageContentType(image);
      if (!contentType) return res.status(400).json({ error: "Please choose a JPG, PNG or WebP image." });
      try {
        const q = await pool.query(`INSERT INTO ${ITEMS}(question_id, position, content_type, image)
          VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM ${ITEMS} WHERE question_id=$1), $2, $3) RETURNING id`,
          [req.params.id, contentType, image]);
        res.json({ id: q.rows[0].id });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get(`/admin/${kind}/images/:id`, requireAdmin, async (req, res) => {
      try {
        const q = await pool.query(`SELECT content_type, image FROM ${ITEMS} WHERE id=$1`, [req.params.id]);
        if (!q.rows.length) return res.status(404).json({ error: "Not found" });
        res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "no-store").send(Buffer.from(q.rows[0].image));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.delete(`/admin/${kind}/images/:id`, requireAdmin, async (req, res) => {
      try {
        await pool.query(`DELETE FROM ${ITEMS} WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });
  }

  /* ---------- Admin: running the game ---------- */

  function adminState() {
    const q = currentQuestion();
    return {
      ...publicState(),
      secretAnswer: q ? q.answer : null,
      secretTamil: q && q.details ? q.details.answerTamil : "",
      allClues: q && CLUES ? q.clues.map(c => ({ text: c.text, image: c.image ? c.id : null })) : [],
      players: [...ranked(), ...[...game.players.values()].filter(p => !p.score).sort((a, b) => a.name.localeCompare(b.name))]
        .map(p => ({ name: p.name, score: p.score })),
      hasMoreQuestions: game.qIndex + 1 < game.questions.length,
      // Clue game: every typed answer, grouped by clue, with the suggestion and the admin's tick.
      review: CLUES ? [...game.answers.entries()].map(([playerId, a]) => ({ playerId, name: a.name, text: a.text, clue: a.clue, points: pointsForClue(a.clue), suggested: a.suggested, correct: a.correct }))
        .sort((a, b) => a.clue - b.clue || b.suggested - a.suggested || a.name.localeCompare(b.name)) : []
    };
  }

  // Clue game: the admin ticks (or unticks) an answer as correct. After the reveal the points update too.
  if (CLUES) app.post(`/admin/${kind}/review`, requireAdmin, (req, res) => {
    const ids = Array.isArray(req.body?.playerIds) ? req.body.playerIds : [req.body?.playerId];
    for (const id of ids) { const a = game.answers.get(Number(id)); if (a) a.correct = !!req.body?.correct; }
    if (game.revealed) scoreCurrentPlace();
    res.json(adminState());
  });

  app.get(`/admin/${kind}/state`, requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store").json(adminState());
  });

  app.post(`/admin/${kind}/action`, requireAdmin, async (req, res) => {
    const action = req.body?.action;
    try {
      const q = currentQuestion();
      if (action === "open-lobby") {
        game = emptyGame();
        game.status = "LOBBY";
      } else if ((action === "show-rules" || action === "hide-rules") && game.status === "LOBBY") {
        game.showRules = action === "show-rules";
      } else if (action === "start") {
        if (game.status !== "LOBBY") return res.status(409).json({ error: "Open the game for joining first." });
        const rows = (await pool.query(`SELECT q.id, q.answer${DETAIL_COLUMNS}, ${itemsJson} AS items FROM ${QUESTIONS} q ORDER BY q.position, q.id`)).rows;
        // Clue questions are played only once they have all their clues.
        const questions = rows.filter(r => r.items.length >= (CLUES ? MIN_CLUES : 1)).map(r => {
          const items = CLUES ? r.items.slice(0, MAX_CLUES) : r.items;
          return { id: r.id, answer: r.answer, details: details(r), imageIds: CLUES ? items.map(c => c.id) : items, clues: CLUES ? items : [] };
        });
        if (!questions.length) return res.status(400).json({ error: CLUES ? `Add at least one place with ${MIN_CLUES} or more clues first.` : "Add at least one question with an image first." });
        game.questions = questions;
        game.status = "PLAYING";
        beginQuestion(0);
      } else if (game.status === "PLAYING" && q && CLUES && ["reveal", "show-scores", "hide-scores"].includes(action)) {
        // Clue game: the answer only after the last clue; then the points are counted.
        if (action === "reveal") {
          if (game.imageIndex < clueCount() - 1) return res.status(409).json({ error: `Show all ${clueCount()} clues before the answer.` });
          game.revealed = true;
          scoreCurrentPlace();
        } else if (game.revealed) game.showScores = action === "show-scores";
      } else if (game.status === "PLAYING" && q) {
        const answering = answeringEntry();
        if (action === "next-image") showImage(game.imageIndex + 1);
        else if (action === "prev-image") showImage(game.imageIndex - 1);
        else if (action === "wrong" && answering) answering.result = "WRONG";
        else if (action === "correct" && answering) {
          answering.result = "CORRECT";
          game.awarded = worth();
          const player = [...game.players.values()].find(p => p.id === answering.playerId);
          if (player) { player.score += game.awarded; player.reachedAt = ++game.scoreTick; }
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
  return async function ensureGameTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${QUESTIONS} (
      id SERIAL PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      answer VARCHAR(300) NOT NULL)`);
    if (CLUES) {
      for (const [column, type] of [["answer_tamil", "VARCHAR(300)"], ["tag1", "VARCHAR(100)"], ["tag2", "VARCHAR(100)"], ["fact", "VARCHAR(500)"]]) {
        await pool.query(`ALTER TABLE ${QUESTIONS} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
      }
    }
    await pool.query(CLUES
      ? `CREATE TABLE IF NOT EXISTS ${ITEMS} (
          id SERIAL PRIMARY KEY,
          question_id INTEGER NOT NULL REFERENCES ${QUESTIONS}(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          text VARCHAR(500) NOT NULL)`
      : `CREATE TABLE IF NOT EXISTS ${ITEMS} (
          id SERIAL PRIMARY KEY,
          question_id INTEGER NOT NULL REFERENCES ${QUESTIONS}(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          content_type VARCHAR(50) NOT NULL,
          image BYTEA NOT NULL)`);
    if (CLUES) {
      await pool.query(`ALTER TABLE ${ITEMS} ADD COLUMN IF NOT EXISTS content_type VARCHAR(50)`);
      await pool.query(`ALTER TABLE ${ITEMS} ADD COLUMN IF NOT EXISTS image BYTEA`);
    }
  };
};
