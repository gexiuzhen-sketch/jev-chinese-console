const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  primitive: "noul",
  session: null,
  authMode: "login",
  options: [
    { label: "需要处理", description: "内容明确需要采取行动" },
    { label: "暂不处理", description: "内容不需要当前采取行动" },
  ],
  levels: ["程度较低", "程度中等", "程度较高"],
};

const primitiveCopy = {
  noul: {
    placeholder: "例如：这条消息是否需要紧急处理？",
    note: "将返回“是”的概率",
  },
  choice: {
    placeholder: "例如：这条工单应该由哪个部门处理？",
    note: "将选择一个选项并给出概率分布",
  },
  score: {
    placeholder: "例如：这位客户的不满程度有多高？",
    note: "将按从低到高的等级评分",
  },
};

const samples = {
  ticket: {
    state: "客户说：我的银行卡被重复扣款了两次。我要求今天处理完，否则会向监管部门投诉。",
    type: "choice",
    instructions: "这条工单应该由哪个部门处理？",
    options: [
      { label: "账务", description: "扣款、支付、账单或退款问题" },
      { label: "技术", description: "软件故障、功能异常或系统集成问题" },
      { label: "客服", description: "一般咨询或账户操作帮助" },
    ],
  },
  review: {
    state: "这款药百分之百有效，任何人服用后都能在三天内彻底治愈，不需要咨询医生。现在下单还送一疗程。",
    type: "noul",
    instructions: "这段内容是否包含需要人工审核的高风险医疗宣传？",
  },
  priority: {
    state: "生产环境从上午 9 点开始无法登录，影响全部付费客户。工程团队尚未定位原因，客服工单持续增加。",
    type: "score",
    instructions: "这个事项的处理优先级有多高？",
    levels: ["可以排入常规计划", "需要本周处理", "需要今天处理", "需要立即响应"],
  },
};

function escapeText(value) {
  return String(value ?? "");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "请求失败，请稍后再试");
    error.code = data.code;
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function updateQuota(session) {
  state.session = session;
  const quota = session?.quota;
  const user = session?.user;
  if (quota) {
    $("#quota-text").textContent = `${user ? "登录用户" : "匿名体验"} · 剩余 ${quota.remaining}/${quota.limit}`;
    $("#quota-text-mobile").textContent = `剩余 ${quota.remaining}/${quota.limit}`;
  }
  $("#account-button").textContent = user ? `${user.displayName} · 退出` : "登录";
}

async function loadSession() {
  try {
    updateQuota(await requestJson("/api/session", { method: "GET" }));
  } catch {
    $("#quota-text").textContent = "额度读取失败";
    $("#quota-text-mobile").textContent = "读取失败";
  }
}

function setPrimitive(type) {
  state.primitive = type;
  $$(".primitive-tab").forEach((button) => {
    const active = button.dataset.type === type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#instructions-input").placeholder = primitiveCopy[type].placeholder;
  $("#run-note-text").textContent = primitiveCopy[type].note;
  renderDynamicFields();
}

function createInput(value, className, placeholder, onInput) {
  const input = document.createElement("input");
  input.className = `dark-input ${className}`;
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = className.includes("description") ? 240 : 160;
  input.addEventListener("input", (event) => onInput(event.target.value));
  return input;
}

function renderDynamicFields() {
  const container = $("#dynamic-fields");
  container.replaceChildren();
  if (state.primitive === "noul") return;

  const title = document.createElement("div");
  title.className = "dynamic-title";
  const label = document.createElement("span");
  label.textContent = state.primitive === "choice" ? "候选选项" : "等级（从低到高）";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "+ 添加";
  addButton.addEventListener("click", () => {
    const items = state.primitive === "choice" ? state.options : state.levels;
    if (items.length >= 6) return;
    if (state.primitive === "choice") state.options.push({ label: "", description: "" });
    else state.levels.push("");
    renderDynamicFields();
  });
  title.append(label, addButton);
  container.append(title);

  const items = state.primitive === "choice" ? state.options : state.levels;
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "option-row";
    const number = document.createElement("span");
    number.className = "option-index";
    number.textContent = String(index + 1).padStart(2, "0");
    row.append(number);

    if (state.primitive === "choice") {
      row.append(createInput(item.label, "option-label", "选项名称", (value) => {
        state.options[index].label = value;
      }));
      row.append(createInput(item.description, "option-description", "这个选项代表什么（选填）", (value) => {
        state.options[index].description = value;
      }));
    } else {
      const level = createInput(item, "option-description", `等级 ${index + 1} 的具体含义`, (value) => {
        state.levels[index] = value;
      });
      level.style.gridColumn = "2 / 4";
      row.append(level);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-option";
    remove.setAttribute("aria-label", `删除第 ${index + 1} 项`);
    remove.textContent = "×";
    remove.disabled = items.length <= 2;
    remove.addEventListener("click", () => {
      if (items.length <= 2) return;
      items.splice(index, 1);
      renderDynamicFields();
    });
    row.append(remove);
    container.append(row);
  });
}

function applySample(sampleName) {
  const sample = samples[sampleName];
  if (!sample) return;
  $("#state-input").value = sample.state;
  $("#state-count").textContent = String(sample.state.length);
  $("#instructions-input").value = sample.instructions;
  if (sample.options) state.options = sample.options.map((option) => ({ ...option }));
  if (sample.levels) state.levels = [...sample.levels];
  setPrimitive(sample.type);
  $("#form-error").textContent = "";
}

function buildPayload() {
  const payload = {
    type: state.primitive,
    state: $("#state-input").value.trim(),
    instructions: $("#instructions-input").value.trim(),
  };
  if (state.primitive === "choice") {
    payload.options = state.options.map((option) => ({
      label: option.label.trim(),
      description: option.description.trim(),
    }));
  }
  if (state.primitive === "score") {
    payload.levels = state.levels.map((level) => level.trim());
  }
  return payload;
}

function validatePayload(payload) {
  if (!payload.state) return "请先填写要判断的内容";
  if (payload.instructions.length < 3) return "请填写一个清楚的判断问题";
  if (payload.type === "choice") {
    if (payload.options.length < 2 || payload.options.some((option) => !option.label)) {
      return "请至少填写两个完整选项";
    }
    const labels = payload.options.map((option) => option.label.toLowerCase());
    if (new Set(labels).size !== labels.length) return "选项名称不能重复";
  }
  if (payload.type === "score" && (payload.levels.length < 2 || payload.levels.some((level) => !level))) {
    return "请至少填写两个完整等级";
  }
  return "";
}

function setResultState(mode, message = "") {
  $("#result-empty").classList.toggle("hidden", mode !== "empty");
  $("#result-loading").classList.toggle("hidden", mode !== "loading");
  $("#result-content").classList.toggle("hidden", mode !== "content");
  $("#result-error").classList.toggle("hidden", mode !== "error");
  if (mode === "error") $("#result-error").textContent = message;
}

function percentage(value) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function probabilityRows(probabilities) {
  const list = document.createElement("div");
  list.className = "probability-list";
  Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, probability]) => {
      const row = document.createElement("div");
      row.className = "probability-row";
      const labelWrap = document.createElement("div");
      labelWrap.className = "probability-label";
      const labelText = document.createElement("span");
      labelText.textContent = escapeText(label);
      const valueText = document.createElement("strong");
      valueText.className = "probability-value";
      valueText.textContent = percentage(probability);
      labelWrap.append(labelText, valueText);
      const track = document.createElement("div");
      track.className = "probability-track";
      const bar = document.createElement("i");
      bar.style.width = `${Math.max(0, Math.min(100, probability * 100))}%`;
      track.append(bar);
      row.append(labelWrap, track);
      list.append(row);
    });
  return list;
}

function metric(label, value) {
  const box = document.createElement("div");
  box.className = "metric";
  const name = document.createElement("span");
  name.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  box.append(name, content);
  return box;
}

function renderResult(result) {
  const container = $("#result-content");
  container.replaceChildren();
  const kicker = document.createElement("div");
  kicker.className = "answer-kicker";
  const main = document.createElement("h3");
  main.className = "answer-main";
  const caption = document.createElement("p");
  caption.className = "answer-caption";
  const metrics = document.createElement("div");
  metrics.className = "metric-row";

  if (result.type === "noul") {
    kicker.textContent = "成立概率";
    main.textContent = percentage(result.probability);
    caption.textContent = result.probability >= 0.5 ? "Jev 更倾向于：是" : "Jev 更倾向于：否";
    metrics.append(metric("否", percentage(1 - result.probability)), metric("是", percentage(result.probability)));
    container.append(kicker, main, caption, metrics, probabilityRows({ 否: 1 - result.probability, 是: result.probability }));
  } else if (result.type === "choice") {
    kicker.textContent = "Jev 选择";
    main.textContent = result.choice;
    caption.textContent = "各选项的相对概率如下";
    metrics.append(metric("置信度", percentage(result.confidence)), metric("选项数", String(Object.keys(result.probabilities).length)));
    container.append(kicker, main, caption, metrics, probabilityRows(result.probabilities));
  } else {
    const roundedIndex = Math.max(0, Math.min(result.levels.length - 1, Math.round(result.score)));
    kicker.textContent = "程度评分";
    main.textContent = `${result.score.toFixed(2)} / ${result.maxScore}`;
    caption.textContent = result.levels[roundedIndex];
    metrics.append(metric("置信度", percentage(result.confidence)), metric("等级数", String(result.levels.length)));
    container.append(kicker, main, caption, metrics, probabilityRows(result.probabilities));
  }

  const meta = document.createElement("p");
  meta.className = "field-help";
  meta.textContent = `${result.model || "jev-latest"} · ${result.latencyMs || 0}ms`;
  container.append(meta);
  setResultState("content");
}

async function evaluate() {
  const payload = buildPayload();
  const validationError = validatePayload(payload);
  $("#form-error").textContent = validationError;
  if (validationError) return;

  const button = $("#evaluate-button");
  button.disabled = true;
  $("#evaluate-label").textContent = "判断中…";
  setResultState("loading");
  try {
    const data = await requestJson("/api/evaluate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (state.session) updateQuota({ ...state.session, quota: data.quota });
    renderResult(data.result);
  } catch (error) {
    if (error.data?.quota && state.session) updateQuota({ ...state.session, quota: error.data.quota });
    setResultState("error", error.message);
    if (error.code === "SIGN_IN_REQUIRED") openAuthDialog("login");
  } finally {
    button.disabled = false;
    $("#evaluate-label").textContent = "开始判断";
  }
}

function openAuthDialog(mode = "login") {
  setAuthMode(mode);
  $("#auth-error").textContent = "";
  $("#auth-dialog").showModal();
}

function setAuthMode(mode) {
  state.authMode = mode;
  $$("[data-auth-mode]").forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
  $("#auth-name-wrap").classList.toggle("hidden", mode !== "register");
  $("#auth-name").required = mode === "register";
  $("#auth-password").autocomplete = mode === "register" ? "new-password" : "current-password";
  $("#auth-submit").textContent = mode === "register" ? "注册并获得 30 次额度" : "登录并继续";
}

async function submitAuth(event) {
  event.preventDefault();
  const button = $("#auth-submit");
  const payload = {
    email: $("#auth-email").value.trim(),
    password: $("#auth-password").value,
  };
  if (state.authMode === "register") payload.displayName = $("#auth-name").value.trim();
  button.disabled = true;
  $("#auth-error").textContent = "";
  try {
    const session = await requestJson(`/api/auth/${state.authMode}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    updateQuota(session);
    $("#auth-dialog").close();
    $("#auth-form").reset();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function accountAction() {
  if (!state.session?.user) {
    openAuthDialog("login");
    return;
  }
  try {
    await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
    await loadSession();
  } catch (error) {
    $("#form-error").textContent = error.message;
  }
}

$("#state-input").addEventListener("input", (event) => {
  $("#state-count").textContent = String(event.target.value.length);
});
$$(".primitive-tab").forEach((button) => button.addEventListener("click", () => setPrimitive(button.dataset.type)));
$$("[data-sample]").forEach((button) => button.addEventListener("click", () => applySample(button.dataset.sample)));
$$("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
$("#evaluate-button").addEventListener("click", evaluate);
$("#account-button").addEventListener("click", accountAction);
$("#dialog-close").addEventListener("click", () => $("#auth-dialog").close());
$("#auth-form").addEventListener("submit", submitAuth);
$("#auth-dialog").addEventListener("click", (event) => {
  if (event.target === $("#auth-dialog")) $("#auth-dialog").close();
});

setPrimitive("noul");
loadSession();
