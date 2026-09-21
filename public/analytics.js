const $ = (selector) => document.querySelector(selector);

let adminToken = sessionStorage.getItem("jev_analytics_token") || "";

const metricDefinitions = [
  ["pv", "页面浏览 PV", "总打开次数", true],
  ["uv", "独立访客 UV", "匿名访客数"],
  ["dau", "今日活跃", "今天来过的人"],
  ["active7d", "7 日活跃", "近 7 天访客"],
  ["evaluations", "生成判断", "成功判断次数"],
  ["evaluationRate", "体验转化", "访客中生成过判断", false, "percent"],
  ["successRate", "判断成功率", "成功 / 全部请求", false, "percent"],
  ["avgLatencyMs", "平均响应", "成功判断耗时", false, "ms"],
  ["registrations", "注册用户", "成功注册次数"],
  ["logins", "登录次数", "成功登录事件"],
];

const labels = {
  noul: "是否判断",
  choice: "多选一",
  score: "等级评分",
  page_view: "页面浏览",
  cta_click: "首屏按钮点击",
  sample_select: "快速示例使用",
  primitive_select: "切换判断类型",
  auth_open: "打开登录 / 注册",
  playground: "立即体验",
  cases: "查看案例",
  ticket: "客户工单示例",
  review: "内容审核示例",
  priority: "事项优先级示例",
  login: "登录",
  register: "注册",
};

function formatMetric(value, format) {
  if (format === "percent") return `${Math.round((value || 0) * 100)}%`;
  if (format === "ms") return `${Math.round(value || 0)}ms`;
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function renderMetrics(overview) {
  const grid = $("#metric-grid");
  grid.replaceChildren();
  metricDefinitions.forEach(([key, title, note, primary, format]) => {
    const card = document.createElement("article");
    card.className = `metric-card${primary ? " primary" : ""}`;
    const label = document.createElement("span");
    label.textContent = title;
    const value = document.createElement("strong");
    value.textContent = formatMetric(overview[key], format);
    const help = document.createElement("small");
    help.textContent = note;
    card.append(label, value, help);
    grid.append(card);
  });
}

function renderTrend(daily) {
  const chart = $("#trend-chart");
  chart.replaceChildren();
  if (!daily.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "分享链接后，访问趋势会显示在这里。";
    chart.append(empty);
    return;
  }
  const maximum = Math.max(1, ...daily.flatMap((day) => [day.pv, day.evaluations]));
  daily.forEach((day) => {
    const column = document.createElement("div");
    column.className = "trend-day";
    column.title = `${day.date} · PV ${day.pv} · UV ${day.uv} · 判断 ${day.evaluations}`;
    const bars = document.createElement("div");
    bars.className = "trend-bars";
    const pv = document.createElement("i");
    pv.style.height = `${Math.max(2, day.pv / maximum * 100)}%`;
    const evaluation = document.createElement("i");
    evaluation.className = "eval";
    evaluation.style.height = `${Math.max(2, day.evaluations / maximum * 100)}%`;
    const date = document.createElement("small");
    date.textContent = day.date.slice(5);
    bars.append(pv, evaluation);
    column.append(bars, date);
    chart.append(column);
  });
}

function renderRanks(selector, items, emptyText) {
  const container = $(selector);
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  const maximum = Math.max(...items.map((item) => item.count), 1);
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    const name = document.createElement("strong");
    const detail = item.dimension ? ` · ${labels[item.dimension] || item.dimension}` : "";
    name.textContent = `${labels[item.name] || item.name}${detail}`;
    const count = document.createElement("span");
    count.textContent = `${item.count} 次`;
    const track = document.createElement("div");
    track.className = "rank-track";
    const bar = document.createElement("i");
    bar.style.width = `${item.count / maximum * 100}%`;
    track.append(bar);
    row.append(name, count, track);
    container.append(row);
  });
}

async function loadDashboard() {
  $("#dashboard-error").textContent = "";
  const response = await fetch(`/api/admin/analytics?days=${encodeURIComponent($("#days-select").value)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "统计读取失败");
  $("#range-label").textContent = `${data.range.since} 至 ${data.range.through} · 上海时区`;
  renderMetrics(data.overview);
  renderTrend(data.daily);
  renderRanks("#primitive-list", data.primitiveUsage, "还没有人生成判断。 ");
  renderRanks("#interaction-list", data.interactions, "还没有可展示的互动。 ");
}

async function unlock(token) {
  adminToken = token;
  await loadDashboard();
  sessionStorage.setItem("jev_analytics_token", adminToken);
  $("#unlock-card").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#dashboard-actions").classList.remove("hidden");
}

$("#unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#unlock-error").textContent = "";
  try {
    await unlock($("#admin-token").value.trim());
    $("#admin-token").value = "";
  } catch (error) {
    $("#unlock-error").textContent = error.message;
  }
});

$("#days-select").addEventListener("change", () => loadDashboard().catch((error) => {
  $("#dashboard-error").textContent = error.message;
}));
$("#refresh-button").addEventListener("click", () => loadDashboard().catch((error) => {
  $("#dashboard-error").textContent = error.message;
}));
$("#logout-button").addEventListener("click", () => {
  sessionStorage.removeItem("jev_analytics_token");
  window.location.reload();
});

if (adminToken) {
  unlock(adminToken).catch(() => {
    sessionStorage.removeItem("jev_analytics_token");
    adminToken = "";
  });
}
