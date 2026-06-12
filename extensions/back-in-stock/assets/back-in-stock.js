// 到货提醒：库存状态判定 + 按钮渲染 + 弹窗订阅
(function () {
  "use strict";

  function currentVariantId() {
    const p = new URLSearchParams(location.search).get("variant");
    return p ? Number(p) : null;
  }

  function pickVariant(product) {
    const vid = currentVariantId();
    if (vid) {
      const found = product.variants.find((v) => v.id === vid);
      if (found) return found;
    }
    // 回退：第一个可售，否则第一个
    return product.variants.find((v) => v.available) || product.variants[0];
  }

  // 需要显示「到货提醒」的两种状态（用 Liquid 算好的 __BIS_INV__ 真实库存）：
  //   A. 缺货可预订：available && policy=continue && qty<=0（受 showPreorder 开关控制）
  //   B. 缺货不可预订：!available
  function shouldShow(productId, variant, showPreorder) {
    if (!variant) return false;
    // 优先用后端按「所选库存地点」算好的结果（准确，支持多仓）
    var avail = window.__BIS_AVAIL__ && window.__BIS_AVAIL__[productId];
    if (avail) {
      var entry = avail[String(variant.id)];
      return !!(entry && entry.show);
    }
    // 回退：Liquid 总库存（接口不可用时）
    var inv = (window.__BIS_INV__[productId] || {})[String(variant.id)];
    if (!inv) return false;
    if (!inv.available) return true; // 状态 B
    if (
      showPreorder &&
      inv.managed && // 有跟踪库存才谈得上"缺货"
      inv.policy === "continue" &&
      inv.qty <= 0
    ) {
      return true; // 状态 A：缺货但允许继续售卖（预订）
    }
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

  // 把 block 的样式设置写成 CSS 变量（按钮在 root 内、弹窗在 overlay 内）
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

    // 当前选中的变体（弹窗内可改）
    let selected = variant;

    // 只允许订阅「需要订阅」状态的变体（缺货/可预订）。有货的变体不进下拉，
    // 否则客人选错有货变体加入订阅，逻辑就错了。
    const showPreorder = d.showPreorder === "true";
    const eligible = product.variants.filter((v) =>
      shouldShow(d.productId, v, showPreorder),
    );

    const children = [];
    children.push(el("h3", { class: "bis-title" }, [d.modalTitle || "Get notified when it's back"]));
    children.push(el("p", { class: "bis-product" }, [product.title]));

    // 变体下拉（仅在有多个可订阅变体时显示）
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

    // 姓名（可选，由 block 设置控制）
    let nameInput = null;
    if (d.collectName === "true") {
      nameInput = el("input", {
        type: "text",
        class: "bis-input",
        placeholder: d.namePlaceholder || "Your name",
        autocomplete: "name",
      });
      children.push(nameInput);
    }

    const emailInput = el("input", {
      type: "email",
      class: "bis-input",
      placeholder: d.emailPlaceholder || "Email address...",
      required: "true",
    });
    children.push(emailInput);

    // 营销同意勾选框
    let marketingInput = null;
    if (d.showMarketing === "true") {
      marketingInput = el("input", { type: "checkbox", class: "bis-check" });
      if (d.marketingDefault === "true") marketingInput.checked = true;
      const label = el("label", { class: "bis-check-row" }, [
        marketingInput,
        el("span", {}, [d.marketingLabel || "Be first to know about restocks and special offers."]),
      ]);
      children.push(label);
    }

    // honeypot（隐藏）
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
            // 成功：用可自定义的标题/说明替换表单（用 DOM 文本，避免注入）
            // data.already=true 表示之前已订阅过 → 用「已订阅」文案
            var title = data.already
              ? d.alreadyTitle || "You're already on the list ✓"
              : d.successTitle || "You're on the list ✓";
            var message = data.already ? d.alreadyMessage : d.successMessage;
            form.innerHTML = "";
            form.appendChild(el("h3", { class: "bis-title" }, [title]));
            if (message) form.appendChild(el("p", { class: "bis-product" }, [message]));
            setTimeout(close, 2600);
          } else {
            msg.textContent =
              data.error === "invalid_email"
                ? d.errorInvalidEmail || "Please enter a valid email."
                : d.errorGeneric || "Something went wrong. Please try again.";
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
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
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
    const btn = el("button", { type: "button", class: "bis-button" }, [
      root.dataset.buttonText || "Email me when Available",
    ]);
    btn.onclick = () => buildModal(root, product, variant);
    root.appendChild(btn);
  }

  // 按所选库存地点拉取每个变体是否该显示按钮（每个产品只拉一次，缓存）
  function fetchAvail(root) {
    var pid = root.dataset.productId;
    window.__BIS_AVAIL__ = window.__BIS_AVAIL__ || {};
    if (window.__BIS_AVAIL__[pid] || root.__bisFetching) return Promise.resolve();
    root.__bisFetching = true;
    return fetch(root.dataset.proxy + "/availability?productId=" + encodeURIComponent(pid), {
      headers: { Accept: "application/json" },
    })
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

  // 初次渲染
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  // 变体切换：监听 URL（?variant=）变化与主题事件，重新判定 + 锁定新变体
  let lastVariant = currentVariantId();
  function onVariantMaybeChanged() {
    const v = currentVariantId();
    if (v !== lastVariant) {
      lastVariant = v;
      init();
    }
  }
  window.addEventListener("popstate", onVariantMaybeChanged);
  // 多数主题切换变体会更新 URL；轮询兜底（轻量）
  setInterval(onVariantMaybeChanged, 600);
  document.addEventListener("variant:change", init);
})();
