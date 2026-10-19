/** Menu item photos: pick, shrink and upload (vendor and admin pages), and build photo URLs. */
const ItemPhoto = {
  url(item) {
    return item.image_updated_at ? `/food-api/menu-item/${item.id}/image?v=${encodeURIComponent(item.image_updated_at)}` : null;
  },

  // Phone photos are several MB; a 900px JPEG is plenty for a menu card.
  shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const src = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(src);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not read the photo.")), "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("That file is not a photo we can read. Please choose a JPG or PNG.")); };
      img.src = src;
    });
  },

  pick(itemId, onDone) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const blob = await ItemPhoto.shrink(file);
        const res = await authFetch(`/food-api/vendor/menu/${itemId}/image`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not upload the photo.");
        onDone && onDone();
      } catch (e) { alert(e.message); }
    };
    input.click();
  },

  async remove(itemId, onDone) {
    if (!confirm("Remove this item's photo?")) return;
    const res = await authFetch(`/food-api/vendor/menu/${itemId}/image`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || "Could not remove the photo.");
    onDone && onDone();
  },

  // Thumbnail plus Add/Change/Remove buttons for an item row.
  controls(item, reloadFn, editable = true) {
    const url = ItemPhoto.url(item);
    const thumb = url
      ? `<img src="${url}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid #eee;flex:0 0 56px">`
      : `<div style="width:56px;height:56px;border-radius:10px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:.7rem;flex:0 0 56px">No photo</div>`;
    if (!editable) return `<div style="display:flex;align-items:center;gap:8px">${thumb}</div>`;
    const btn = "border:1px solid #cfd6e0;background:#fff;color:#1f2937;width:auto;margin:0;border-radius:8px;padding:6px 10px;font-size:.8rem;font-weight:700;cursor:pointer";
    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${thumb}
      <button type="button" style="${btn}" onclick="ItemPhoto.pick(${item.id}, ${reloadFn})">${url ? "Change photo" : "Add photo"}</button>
      ${url ? `<button type="button" style="${btn};color:#b91c1c" onclick="ItemPhoto.remove(${item.id}, ${reloadFn})">Remove</button>` : ""}</div>`;
  }
};
