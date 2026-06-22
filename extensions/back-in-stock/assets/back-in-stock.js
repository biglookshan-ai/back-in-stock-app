// 到货提醒：库存状态判定 + 按钮渲染 + 弹窗订阅
(function () {
  "use strict";

  function currentVariantId() {
    var input = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (input && input.value) return Number(input.value);
    var p = new URLSearchParams(location.search).get("variant");
    return p ? Number(p) : null;
  }

  function pickVariant(product) {
    const vid = currentVariantId();
    if (vid) {
      const found = product.variants.find((v) => v.id === vid);
      if (found) return found;
    }
    return product.variants.find((v) => v.available) || product.variants[0];
  }

  // 显示按钮的两种状态：A 缺货可预订(受 showPreorder 控制)；B 缺货不可预订。
  // 优先用后端按所选库存地点算好的 __BIS_AVAIL__，否则回退 Liquid 总库存 __BIS_INV__。
  function shouldShow(productId, variant, showPreorder) {
    if (!variant) return false;
    var avail = window.__BIS_AVAIL__ && window.__BIS_AVAIL__[productId];
    if (avail) {
      var entry = avail[String(variant.id)];
      return !!(entry && entry.show);
    }
    var inv = (window.__BIS_INV__[productId] || {})[String(variant.id)];
    if (!inv) return false;
    if (!inv.available) return true;
    if (showPreorder && inv.managed && inv.policy === "continue" && inv.qty <= 0) return true;
    return false;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => {
      if (k === "style") node.setAttribute("style", attrs[k]);
      else if (k.startsWith("on")) node[k.toLowerCase()] = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) =>
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c),
    );
    return node;
  }

  // 把 block 设置写成 CSS 变量
  function applyStyles(target, d) {
    var s = target.style;
    var set = function (k, v) { if (v !== undefined && v !== null && v !== "") s.setProperty(k, v); };
    set("--bis-btn-bg", d.buttonColor);
    set("--bis-btn-color", d.btnTextColor);
    set("--bis-btn-font", d.btnFont && d.btnFont + "px");
    set("--bis-btn-pad", d.btnPad && d.btnPad + "px");
    set("--bis-btn-radius", d.btnRadius && d.btnRadius + "px");
    s.setProperty("--bis-btn-width", d.btnFull === "false" ? "auto" : "100%");
    set("--bis-modal-w", d.modalW && d.modalW + "px");
    set("--bis-modal-bg", d.modalBg);
    set("--bis-modal-text", d.modalText);
    set("--bis-modal-radius", d.modalRadius && d.modalRadius + "px");
    set("--bis-modal-pad", d.modalPad && d.modalPad + "px");
    set("--bis-title-size", d.titleSize && d.titleSize + "px");
    if (d.overlayOp !== undefined && d.overlayOp !== "")
      s.setProperty("--bis-overlay-op", String(Number(d.overlayOp) / 100));
  }

  function buildModal(root, product, variant) {
    const proxy = root.dataset.proxy;
    const d = root.dataset;
    const overlay = el("div", { class: "bis-overlay" });
    applyStyles(overlay, d);
    const close = () => overlay.remove();

    let selected = variant;
    const showPreorder = d.showPreorder === "true";
    // 只允许订阅「需订阅」状态的变体，有货变体不进下拉
    const eligible = product.variants.filter((v) => shouldShow(d.productId, v, showPreorder));

    const children = [];
    children.push(el("h3", { class: "bis-title" }, [d.modalTitle || "Get notified when it's back"]));
    children.push(el("p", { class: "bis-product" }, [product.title]));

    if (eligible.length > 1) {
      const select = el("select", { class: "bis-input bis-select" });
      eligible.forEach((v) => {
        const opt = el("option", { value: String(v.id) }, [v.title]);
        if (v.id === selected.id) opt.setAttribute("selected", "selected");
        select.appendChild(opt);
      });
      select.onchange = () => {
        const v = eligible.find((x) => String(x.id) === select.value);
        if (v) selected = v;
      };
      children.push(select);
    }

    let nameInput = null;
    if (d.collectName === "true") {
      nameInput = el("input", { type: "text", class: "bis-input", placeholder: d.namePlaceholder || "Your name", autocomplete: "name" });
      children.push(nameInput);
    }

    const emailInput = el("input", { type: "email", class: "bis-input", placeholder: d.emailPlaceholder || "Email address...", required: "true" });
    children.push(emailInput);

    let marketingInput = null;
    if (d.showMarketing === "true") {
      marketingInput = el("input", { type: "checkbox", class: "bis-check" });
      if (d.marketingDefault === "true") marketingInput.checked = true;
      children.push(el("label", { class: "bis-check-row" }, [
        marketingInput,
        el("span", {}, [d.marketingLabel || "Be first to know about restocks and special offers."]),
      ]));
    }

    const hp = el("input", { type: "text", name: "hp", class: "bis-hp", tabindex: "-1", autocomplete: "off" });
    children.push(hp);

    const submitBtn = el("button", { class: "bis-submit", type: "submit" }, [d.submitText || "Notify me"]);
    children.push(submitBtn);
    const msg = el("div", { class: "bis-msg" });
    children.push(msg);
    if (d.footerText) children.push(el("p", { class: "bis-footer" }, [d.footerText]));

    const form = el("form", { class: "bis-form" }, children);
    form.onsubmit = function (e) {
      e.preventDefault();
      msg.textContent = "";
      submitBtn.disabled = true;
      fetch(proxy + "/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.value,
          name: nameInput ? nameInput.value : null,
          marketing: marketingInput ? marketingInput.checked : false,
          variantId: String(selected.id),
          source: "product_page",
          locale: document.documentElement.lang || null,
          hp: hp.value,
        }),
      })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (ok && data.ok) {
            var title = data.already ? d.alreadyTitle || "You're already on the list ✓" : d.successTitle || "You're on the list ✓";
            var message = data.already ? d.alreadyMessage : d.successMessage;
            form.innerHTML = "";
            form.appendChild(el("h3", { class: "bis-title" }, [title]));
            if (message) form.appendChild(el("p", { class: "bis-product" }, [message]));
            setTimeout(close, 2600);
          } else {
            msg.textContent = data.error === "invalid_email" ? d.errorInvalidEmail || "Please enter a valid email." : d.errorGeneric || "Something went wrong. Please try again.";
            submitBtn.disabled = false;
          }
        })
        .catch(() => {
          msg.textContent = d.errorNetwork || "Network error. Please try again.";
          submitBtn.disabled = false;
        });
    };

    const dialog = el("div", { class: "bis-dialog" }, [
      el("button", { class: "bis-close", type: "button", "aria-label": "Close", onClick: close }, ["×"]),
      form,
    ]);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    (nameInput || emailInput).focus();
  }

  function render(root) {
    const product = window.__BIS_DATA__[root.dataset.productId];
    if (!product) return;
    const showPreorder = root.dataset.showPreorder === "true";
    const variant = pickVariant(product);

    root.innerHTML = "";
    if (!shouldShow(root.dataset.productId, variant, showPreorder)) return;

    applyStyles(root, root.dataset);
    const btn = el("button", { type: "button", class: "bis-button" }, [root.dataset.buttonText || "Email me when Available"]);
    btn.onclick = () => buildModal(root, product, variant);
    root.appendChild(btn);
  }

  // 按所选库存地点拉每个变体是否该显示按钮（每个产品只拉一次，缓存）
  function fetchAvail(root) {
    var pid = root.dataset.productId;
    window.__BIS_AVAIL__ = window.__BIS_AVAIL__ || {};
    if (window.__BIS_AVAIL__[pid] || root.__bisFetching) return Promise.resolve();
    root.__bisFetching = true;
    return fetch(root.dataset.proxy + "/availability?productId=" + encodeURIComponent(pid), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.variants) window.__BIS_AVAIL__[pid] = d.variants; })
      .catch(function () {})
      .then(function () { root.__bisFetching = false; });
  }

  function init() {
    document.querySelectorAll("[data-bis]").forEach(function (root) {
      fetchAvail(root).then(function () { render(root); });
    });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  // 变体切换：重新判定 + 锁定新变体
  let lastVariant = currentVariantId();
  function onVariantMaybeChanged() {
    const v = currentVariantId();
    if (v !== lastVariant) { lastVariant = v; init(); }
  }
  window.addEventListener("popstate", onVariantMaybeChanged);
  setInterval(onVariantMaybeChanged, 500);
  document.addEventListener("change", function () { setTimeout(onVariantMaybeChanged, 80); });
  document.addEventListener("variant:change", onVariantMaybeChanged);
  document.addEventListener("variantChange", onVariantMaybeChanged);
})();
