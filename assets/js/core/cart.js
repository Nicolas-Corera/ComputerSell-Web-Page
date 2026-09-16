// Carrito de compras — compartido por todas las páginas.
// Vive en localStorage (funciona sin sesión); al pagar se valida contra la
// base de datos (precio y stock reales) con la RPC place_order.
// Expone window.CartStore (estado + persistencia) y monta el drawer lateral.
// Requiere utils.js (window.CS).
(function () {
  const { formatPrice, escapeHtml, loadList, saveList, productForButton, toast } =
    window.CS;
  const STORAGE_KEY = "computersell-cart";
  const CART_URL = "/carrito.html";

  const ICON_CLOSE =
    '<svg viewBox="0 -960 960 960"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
  const ICON_TRASH =
    '<svg viewBox="0 -960 960 960"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>';
  const ICON_MINUS =
    '<svg viewBox="0 -960 960 960"><path d="M200-440v-80h560v80H200Z"/></svg>';
  const ICON_BAG =
    '<svg viewBox="0 -960 960 960"><path d="M240-80q-33 0-56.5-23.5T160-160v-480q0-33 23.5-56.5T240-720h80q0-66 47-113t113-47q66 0 113 47t47 113h80q33 0 56.5 23.5T800-640v480q0 33-23.5 56.5T720-80H240Zm0-80h480v-480h-80v80q0 17-11.5 28.5T600-520q-17 0-28.5-11.5T560-560v-80H400v80q0 17-11.5 28.5T360-520q-17 0-28.5-11.5T320-560v-80h-80v480Zm160-560h160q0-33-23.5-56.5T480-800q-33 0-56.5 23.5T400-720ZM240-160v-480 480Z"/></svg>';

  // ---------- Store ----------
  let cart = loadList(STORAGE_KEY);
  const listeners = [];

  function commit() {
    saveList(STORAGE_KEY, cart);
    listeners.forEach((fn) => fn(CartStore));
  }

  const CartStore = {
    getItems: () => cart.map((it) => ({ ...it })),
    totalQty: () => cart.reduce((sum, it) => sum + it.qty, 0),
    totalPrice: () => cart.reduce((sum, it) => sum + it.price * it.qty, 0),
    // Devuelve false si no hay stock suficiente
    add(product) {
      const qty = Math.max(1, product.qty || 1);
      const existing = cart.find((it) => it.id === product.id);
      const wanted = (existing ? existing.qty : 0) + qty;
      if (typeof product.stock === "number" && wanted > product.stock) {
        toast(
          product.stock > 0
            ? `Solo quedan ${product.stock} unidad${product.stock === 1 ? "" : "es"} de este producto`
            : "Este producto no tiene stock",
          "bad",
        );
        return false;
      }
      if (existing) existing.qty = wanted;
      else
        cart.push({
          id: product.id,
          name: product.name,
          price: product.price,
          oldPrice: product.oldPrice || 0,
          cuotas: product.cuotas || "",
          image: product.image || "",
          stock: product.stock,
          freeShipping: !!product.freeShipping,
          qty,
        });
      commit();
      return true;
    },
    // Actualiza precio/stock/nombre desde la base (lo llaman las páginas al
    // cargar y en cada cambio realtime). Quita lo que ya no está publicado.
    refresh(products, validIds) {
      let changed = false;
      products.forEach((p) => {
        const it = cart.find((x) => x.id === p.id);
        if (!it) return;
        if (it.price !== p.price || it.stock !== p.stock || it.name !== p.name || it.image !== p.image) {
          Object.assign(it, { price: p.price, stock: p.stock, name: p.name, image: p.image, oldPrice: p.oldPrice || 0, cuotas: p.cuotas || "", freeShipping: !!p.freeShipping });
          if (typeof p.stock === "number" && it.qty > p.stock) it.qty = Math.max(0, p.stock);
          changed = true;
        }
      });
      const before = cart.length;
      cart = cart.filter((it) => it.qty > 0 && (!validIds || validIds.includes(it.id)));
      if (changed || cart.length !== before) commit();
    },
    setQty(id, qty) {
      const item = cart.find((it) => it.id === id);
      if (!item) return;
      let q = Math.max(1, qty | 0);
      if (typeof item.stock === "number" && q > item.stock) {
        q = Math.max(1, item.stock);
        toast(`Solo quedan ${item.stock} unidad${item.stock === 1 ? "" : "es"}`, "bad");
      }
      item.qty = q;
      commit();
    },
    remove(id) {
      cart = cart.filter((it) => it.id !== id);
      commit();
    },
    clear() {
      cart = [];
      commit();
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };
  window.CartStore = CartStore;

  // ---------- Badge del header ----------
  const badge = document.getElementById("cartBadge");

  function renderBadge() {
    if (!badge) return;
    const qty = CartStore.totalQty();
    // Al llegar a 0 no escribimos "0": el badge se achica mostrando el último número
    if (qty > 0) badge.textContent = qty > 99 ? "99+" : qty;
    badge.classList.toggle("is-visible", qty > 0);
  }

  function bumpBadge() {
    if (!badge) return;
    badge.classList.remove("is-bump");
    void badge.offsetWidth; // reinicia la animación
    badge.classList.add("is-bump");
  }

  if (badge) {
    badge.addEventListener("animationend", () => {
      badge.classList.remove("is-bump");
    });
  }

  // ---------- Drawer lateral ----------
  const overlay = document.createElement("div");
  overlay.className = "cartOverlay";

  const drawer = document.createElement("aside");
  drawer.className = "cartDrawer";
  drawer.setAttribute("aria-label", "Carrito de compras");
  drawer.innerHTML = `
    <div class="cartDrawer-head">
      <h2>Carrito<span id="cartDrawerCount"></span></h2>
      <button type="button" class="cartDrawer-close" aria-label="Cerrar carrito">${ICON_CLOSE}</button>
    </div>
    <ul class="cartDrawer-list" id="cartDrawerList"></ul>
    <div class="cartDrawer-foot">
      <div class="cartDrawer-total">
        <span>Total</span>
        <strong id="cartDrawerTotal">0</strong>
      </div>
      <button type="button" class="cartDrawer-buy" id="cartDrawerBuy">Comprar</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  // Arranca colapsado sin animar: se desactiva la transición hasta después del
  // primer render, así no "entra y sale" al cargar la página. El timeout cubre
  // pestañas en segundo plano (donde requestAnimationFrame no corre).
  drawer.style.transition = "none";
  drawer.style.visibility = "hidden";
  function unlockDrawer() {
    drawer.style.transition = "";
    drawer.style.visibility = "";
  }
  requestAnimationFrame(() => requestAnimationFrame(unlockDrawer));
  setTimeout(unlockDrawer, 500);

  const list = drawer.querySelector("#cartDrawerList");
  const countEl = drawer.querySelector("#cartDrawerCount");
  const totalEl = drawer.querySelector("#cartDrawerTotal");
  const buyBtn = drawer.querySelector("#cartDrawerBuy");
  const closeBtn = drawer.querySelector(".cartDrawer-close");

  function renderDrawer() {
    const qty = CartStore.totalQty();
    countEl.textContent = qty > 0 ? `(${qty})` : "";
    totalEl.textContent = formatPrice(CartStore.totalPrice());
    buyBtn.disabled = qty === 0;

    if (cart.length === 0) {
      list.innerHTML = `
        <li class="cartDrawer-empty">
          ${ICON_BAG}
          <span>Tu carrito está vacío</span>
        </li>`;
      return;
    }

    list.innerHTML = cart
      .map(
        (it) => `
        <li class="cartItem" data-id="${escapeHtml(it.id)}">
          <div class="cartItem-img">
            ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" />` : ""}
          </div>
          <div class="cartItem-body">
            <span class="cartItem-name">${escapeHtml(it.name)}</span>
            <div class="cartItem-meta">
              <span class="cartItem-price">${formatPrice(it.price)}</span>
              <span class="cartItem-qty">x${it.qty}</span>
            </div>
          </div>
          <div class="cartItem-actions">
            ${
              it.qty > 1
                ? `<button type="button" class="cartItem-minus" aria-label="Quitar una unidad">${ICON_MINUS}</button>`
                : ""
            }
            <button type="button" class="cartItem-remove" aria-label="Eliminar del carrito">${ICON_TRASH}</button>
          </div>
        </li>`,
      )
      .join("");
  }

  function openCart() {
    unlockDrawer();
    document.body.classList.remove("menu-open");
    document.body.classList.add("cart-open");
  }

  function closeCart() {
    document.body.classList.remove("cart-open");
  }

  const cartBtn = document.getElementById("cartBtn");
  if (cartBtn) cartBtn.addEventListener("click", openCart);
  closeBtn.addEventListener("click", closeCart);
  overlay.addEventListener("click", closeCart);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCart();
  });

  // "Comprar" del drawer -> página del carrito
  buyBtn.addEventListener("click", () => {
    window.location.href = CART_URL;
  });

  // Quitar una unidad / eliminar ítem (delegación: la lista se re-renderiza)
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".cartItem-minus, .cartItem-remove");
    if (!btn) return;
    const item = btn.closest(".cartItem");
    if (!item) return;
    const id = item.dataset.id;
    if (btn.classList.contains("cartItem-minus")) {
      const current = cart.find((it) => it.id === id);
      if (current) CartStore.setQty(id, current.qty - 1);
    } else {
      CartStore.remove(id);
    }
  });

  // ---------- Botones "agregar" / "comprar ahora" ----------
  // Delegación: funciona también con tarjetas agregadas/clonadas después de cargar.
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(
      ".itemDestacado .btn-secondary, .purchase-row .btn-secondary",
    );
    if (addBtn) {
      const product = productForButton(addBtn);
      if (product && CartStore.add(product)) {
        bumpBadge();
        toast("Agregado al carrito", "ok");
      }
      return;
    }

    // "Comprar ahora" (detail): agrega con la cantidad elegida y va al carrito
    const buyNow = e.target.closest("#buyNowBtn");
    if (buyNow) {
      const product = productForButton(buyNow);
      if (product && !CartStore.add(product)) return;
      window.location.href = CART_URL;
    }
  });

  CartStore.onChange(() => {
    renderBadge();
    renderDrawer();
  });
  renderBadge();
  renderDrawer();
})();
