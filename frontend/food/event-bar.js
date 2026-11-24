/* Event picker for admin pages (registrations, messages, orders, sales, feedback ...).
 * Shows which event the page is showing and lets the admin switch to an earlier event. The choice is
 * kept for this browser tab and sent to the server as X-Event-Id by authFetch (auth.js).
 * Elements with data-event="name" | "short" | "emoji" get the chosen event's text.
 * Include after auth.js. Pages can listen for the "admin-event" event (detail = the event). */
window.EVENT_PICKER = true;
(function () {
  const css = `.event-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;max-width:1200px;margin:0 auto 14px;padding:9px 14px;border-radius:12px;background:#eef2ff;border:1px solid #e0e7ff;color:#3730a3;font:600 .9rem/1.3 Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.event-bar select{font:inherit;font-weight:700;color:#1e1b4b;padding:6px 10px;border-radius:9px;border:1px solid #c7d2fe;background:#fff;max-width:100%}
.event-bar .past{color:#9a3412;background:#ffedd5;border:1px solid #fed7aa;border-radius:999px;padding:3px 10px;font-size:.8rem}
.event-bar .cur{color:#166534;background:#dcfce7;border-radius:999px;padding:3px 10px;font-size:.8rem}`;

  function fill(ev) {
    document.querySelectorAll("[data-event]").forEach(el => {
      const k = el.getAttribute("data-event");
      el.textContent = k === "short" ? ev.shortName : k === "emoji" ? ev.emoji : ev.name;
    });
    window.adminEvent = ev;
    document.dispatchEvent(new CustomEvent("admin-event", { detail: ev }));
  }

  async function init() {
    let list;
    try {
      const r = await authFetch("/food-api/admin/events", { headers: { "X-Event-Id": "" } });
      if (!r.ok) return;
      list = await r.json();
    } catch (e) { return; }
    if (!list.length) return;
    const saved = Number(sessionStorage.getItem("admin_event_id"));
    const current = list.find(e => e.isCurrent) || list[0];
    const chosen = list.find(e => e.id === saved) || current;
    if (chosen.id === current.id) sessionStorage.removeItem("admin_event_id");

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const bar = document.createElement("div");
    bar.className = "event-bar";
    bar.innerHTML = `<span>Event:</span><select aria-label="Event shown on this page"></select><span class="${chosen.id === current.id ? "cur" : "past"}">${chosen.id === current.id ? "Current event" : "Not the current event"}</span>`;
    const sel = bar.querySelector("select");
    list.forEach(ev => {
      const o = document.createElement("option");
      o.value = ev.id;
      o.textContent = `${ev.emoji || ""} ${ev.name}${ev.isCurrent ? " (current)" : ""}`.trim();
      if (ev.id === chosen.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      if (Number(sel.value) === current.id) sessionStorage.removeItem("admin_event_id");
      else sessionStorage.setItem("admin_event_id", sel.value);
      location.reload();
    });
    const host = document.querySelector("[data-event-bar]") || document.body;
    host.insertBefore(bar, host.firstChild);
    fill(chosen);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
