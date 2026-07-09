// js/image-lightbox.js
let lightboxEl = null;

function ensureLightbox() {
  if (lightboxEl) return lightboxEl;
  const el = document.createElement("div");
  el.id = "imgLightbox";
  el.className = "hidden fixed inset-0 z-[60] bg-slate-900/80 flex items-center justify-center p-4";
  el.innerHTML = `
    <button type="button" data-lightbox-close class="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
    </button>
    <div class="absolute top-4 left-4 flex items-center gap-2">
      <button type="button" data-lightbox-zoom-out class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg font-bold">−</button>
      <button type="button" data-lightbox-zoom-reset class="px-3 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold">Reset</button>
      <button type="button" data-lightbox-zoom-in class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg font-bold">+</button>
    </div>
    <p data-lightbox-label class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs font-semibold"></p>
    <div class="w-full h-full overflow-auto flex items-center justify-center cursor-grab">
      <img data-lightbox-img src="" alt="" class="max-w-none transition-transform duration-150 select-none" style="transform: scale(1)" draggable="false" />
    </div>`;
  document.body.appendChild(el);

  const img = el.querySelector("[data-lightbox-img]");
  let scale = 1;
  const applyScale = () => { img.style.transform = `scale(${scale})`; };

  el.querySelector("[data-lightbox-zoom-in]").addEventListener("click", () => { scale = Math.min(scale + 0.25, 4); applyScale(); });
  el.querySelector("[data-lightbox-zoom-out]").addEventListener("click", () => { scale = Math.max(scale - 0.25, 0.5); applyScale(); });
  el.querySelector("[data-lightbox-zoom-reset]").addEventListener("click", () => { scale = 1; applyScale(); });
  el.querySelector("[data-lightbox-close]").addEventListener("click", () => close());
  el.addEventListener("click", (e) => { if (e.target === el) close(); });
  img.addEventListener("wheel", (e) => {
    e.preventDefault();
    scale = Math.min(Math.max(scale + (e.deltaY < 0 ? 0.15 : -0.15), 0.5), 4);
    applyScale();
  }, { passive: false });
  img.addEventListener("dblclick", () => { scale = scale === 1 ? 2 : 1; applyScale(); });

  function close() { el.classList.add("hidden"); img.src = ""; scale = 1; applyScale(); }
  el._close = close;
  el._scaleReset = () => { scale = 1; applyScale(); };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.classList.contains("hidden")) close();
  });

  lightboxEl = el;
  return el;
}

export function openLightbox(url, label = "") {
  const el = ensureLightbox();
  el.querySelector("[data-lightbox-img]").src = url;
  el.querySelector("[data-lightbox-label]").textContent = label;
  el._scaleReset();
  el.classList.remove("hidden");
}

/**
 * @param {HTMLElement} container
 * @param {{url:string, label:string}[]} images
 */
export function renderImageGallery(container, images, emptyText = "No images attached.") {
  if (!container) return;
  const valid = images.filter((i) => i.url);
  container.innerHTML = "";
  if (!valid.length) {
    container.innerHTML = `<p class="text-sm text-slate-400">${emptyText}</p>`;
    return;
  }
  valid.forEach(({ url, label }) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "group relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 aspect-[4/3]";
    card.innerHTML = `
      <img src="${url}" alt="${label}" class="w-full h-full object-cover" loading="lazy" />
      <div class="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/40 transition flex items-center justify-center">
        <span class="opacity-0 group-hover:opacity-100 transition text-white text-xs font-bold px-3 py-1.5 rounded-full bg-white/15 backdrop-blur">🔍 View full size</span>
      </div>
      <span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/90 text-slate-700">${label}</span>`;
    card.addEventListener("click", () => openLightbox(url, label));
    container.appendChild(card);
  });
}