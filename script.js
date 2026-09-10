// ========================================
// Work Order Management System
// Main Application Script
// ========================================

// ========================================
// State
// ========================================
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
let useMockData = true;
let searchTimeout = null;
let currentDetailOrder = null;

// ========================================
// Initialization
// ========================================

document.addEventListener("DOMContentLoaded", () => {
  API.init();
  loadSavedConfig();
  lucide.createIcons();
  populateDepartments();
  setDefaultDate();

  if (CONFIG.API_URL && CONFIG.API_URL !== "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL") {
    useMockData = false;
    loadData();
  } else {
    loadMockData();
  }
});

function loadSavedConfig() {
  const saved = localStorage.getItem("wo_api_url");
  if (saved) {
    CONFIG.API_URL = saved;
    API.init();
    useMockData = false;
  }
  const input = document.getElementById("api-url-input");
  if (input) input.value = saved || "";
}

function setDefaultDate() {
  const dateInput = document.getElementById("form-date");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.value = today;
  }
}

// ========================================
// Data Loading
// ========================================

async function loadData() {
  try {
    showLoading();
    const [ordersRes, statsRes] = await Promise.all([
      API.getOrders(),
      API.getDashboardStats()
    ]);

    if (ordersRes.success) {
      allOrders = ordersRes.data;
      filteredOrders = [...allOrders];
      renderOrdersTable();
    }

    if (statsRes.success) {
      renderDashboardStats(statsRes.data);
      renderRecentOrders(statsRes.data.recentOrders);
    }

    hideLoading();
  } catch (err) {
    hideLoading();
    showToast("Failed to load data. Using mock data.", "error");
    loadMockData();
  }
}

function loadMockData() {
  useMockData = true;
  allOrders = MOCK_DATA.orders;
  filteredOrders = [...allOrders];
  renderDashboardStats(MOCK_DATA.dashboard);
  renderRecentOrders(MOCK_DATA.dashboard.recentOrders);
  renderOrdersTable();
  renderMasterItems(MOCK_DATA.masterItems);
}

// ========================================
// Navigation
// ========================================

function navigateTo(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  document.getElementById("page-" + page).classList.remove("hidden");
  document.getElementById("nav-" + page).classList.add("active");

  const titles = { dashboard: "Overview", orders: "Orders", settings: "Settings" };
  document.getElementById("page-title").textContent = titles[page] || "Overview";

  const newOrderBtn = document.getElementById("btn-new-order");
  newOrderBtn.style.display = page === "settings" ? "none" : "";

  closeSidebar();

  if (page === "dashboard" && useMockData) {
    // Already loaded
  } else if (page === "dashboard" && !useMockData) {
    loadDashboardData();
  } else if (page === "orders" && !useMockData) {
    loadOrdersData();
  } else if (page === "settings") {
    loadMasterItems();
  }
}

async function loadDashboardData() {
  const res = await API.getDashboardStats();
  if (res.success) {
    renderDashboardStats(res.data);
    renderRecentOrders(res.data.recentOrders);
  }
}

async function loadOrdersData() {
  const res = await API.getOrders();
  if (res.success) {
    allOrders = res.data;
    filteredOrders = [...allOrders];
    renderOrdersTable();
  }
}

// ========================================
// Sidebar
// ========================================

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  sidebar.classList.toggle("-translate-x-full");
  overlay.classList.toggle("hidden");
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  sidebar.classList.add("-translate-x-full");
  overlay.classList.add("hidden");
}

// ========================================
// Dashboard
// ========================================

function renderDashboardStats(stats) {
  document.getElementById("stat-total").textContent = stats.totalOrders;
  document.getElementById("stat-pending").textContent = stats.pendingOrders;
  document.getElementById("stat-completed").textContent = stats.completedOrders;
  document.getElementById("stat-month").textContent = stats.ordersThisMonth;
}

function renderRecentOrders(orders) {
  const container = document.getElementById("recent-orders-list");
  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div class="px-5 py-8 text-center text-sm text-surface-400">
        <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 text-surface-300"></i>
        No orders yet. Create your first work order!
      </div>`;
    lucide.createIcons();
    return;
  }

  container.innerHTML = orders.map(o => `
    <div class="flex items-center justify-between px-5 py-3 hover:bg-surface-50 cursor-pointer transition-colors" onclick="openOrderDetail('${o.OrderID}')">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 bg-surface-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <i data-lucide="file-text" class="w-4 h-4 text-surface-500"></i>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-surface-700 truncate">${o.OrderID}</p>
          <p class="text-xs text-surface-400 truncate">${o.RequesterName} - ${o.Department}</p>
        </div>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <span class="text-xs text-surface-400 hidden sm:inline">${formatDate(o.Date)}</span>
        ${statusBadge(o.Status)}
      </div>
    </div>
  `).join("");
  lucide.createIcons();
}

// ========================================
// Orders Table
// ========================================

function renderOrdersTable() {
  const tbody = document.getElementById("orders-tbody");
  const perPage = CONFIG.ITEMS_PER_PAGE;
  const start = (currentPage - 1) * perPage;
  const pageItems = filteredOrders.slice(start, start + perPage);

  if (filteredOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-5 py-12 text-center">
          <div class="flex flex-col items-center">
            <i data-lucide="search-x" class="w-10 h-10 text-surface-300 mb-2"></i>
            <p class="text-sm text-surface-500 font-medium">No orders found</p>
            <p class="text-xs text-surface-400 mt-1">Try adjusting your search or filters</p>
          </div>
        </td>
      </tr>`;
    lucide.createIcons();
    updatePagination();
    return;
  }

  tbody.innerHTML = pageItems.map(o => `
    <tr onclick="openOrderDetail('${o.OrderID}')">
      <td class="px-5 py-3">
        <span class="text-sm font-semibold text-primary-600">${o.OrderID}</span>
      </td>
      <td class="px-5 py-3 hidden sm:table-cell">
        <span class="text-sm text-surface-600">${formatDate(o.Date)}</span>
      </td>
      <td class="px-5 py-3">
        <div>
          <p class="text-sm font-medium text-surface-700">${o.RequesterName}</p>
        </div>
      </td>
      <td class="px-5 py-3 hidden md:table-cell">
        <span class="text-sm text-surface-600">${o.Department}</span>
      </td>
      <td class="px-5 py-3 text-center">
        <span class="inline-flex items-center justify-center w-7 h-7 bg-surface-100 rounded-lg text-xs font-semibold text-surface-600">${o.ItemCount || 0}</span>
      </td>
      <td class="px-5 py-3 text-center">
        ${statusBadge(o.Status)}
      </td>
      <td class="px-5 py-3 text-right">
        <button onclick="event.stopPropagation(); openOrderDetail('${o.OrderID}')" class="p-1.5 rounded-lg hover:bg-surface-100 transition-colors">
          <i data-lucide="eye" class="w-4 h-4 text-surface-400"></i>
        </button>
      </td>
    </tr>
  `).join("");

  lucide.createIcons();
  updatePagination();
}

function updatePagination() {
  const perPage = CONFIG.ITEMS_PER_PAGE;
  const total = filteredOrders.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (currentPage - 1) * perPage + 1;
  const end = Math.min(currentPage * perPage, total);

  document.getElementById("pagination-info").textContent =
    total > 0 ? `Showing ${start}-${end} of ${total} orders` : "";

  const btnContainer = document.getElementById("pagination-buttons");
  if (totalPages <= 1) {
    btnContainer.innerHTML = "";
    return;
  }

  let html = "";
  html += `<button onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""} class="px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-200 ${currentPage === 1 ? "text-surface-300 cursor-not-allowed" : "text-surface-600 hover:bg-surface-50"}">Prev</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button onclick="goToPage(${i})" class="px-3 py-1.5 text-xs font-medium rounded-lg border ${i === currentPage ? "bg-primary-500 text-white border-primary-500" : "border-surface-200 text-surface-600 hover:bg-surface-50"}">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<span class="px-1 text-surface-400">...</span>`;
    }
  }

  html += `<button onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""} class="px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-200 ${currentPage === totalPages ? "text-surface-300 cursor-not-allowed" : "text-surface-600 hover:bg-surface-50"}">Next</button>`;

  btnContainer.innerHTML = html;
}

function goToPage(page) {
  const totalPages = Math.ceil(filteredOrders.length / CONFIG.ITEMS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderOrdersTable();
}

// ========================================
// Search & Filter
// ========================================

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    applyFilters();
  }, 300);
}

async function applyFilters() {
  const search = document.getElementById("search-input").value.trim();
  const status = document.getElementById("filter-status").value;
  const department = document.getElementById("filter-department").value;
  const month = document.getElementById("filter-month").value;
  const sort = document.getElementById("filter-sort").value;

  if (useMockData) {
    let result = [...allOrders];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(o =>
        o.OrderID.toLowerCase().includes(q) ||
        o.RequesterName.toLowerCase().includes(q) ||
        (o.Items && o.Items.some(i => i.ItemName.toLowerCase().includes(q)))
      );
    }
    if (status) result = result.filter(o => o.Status === status);
    if (department) result = result.filter(o => o.Department === department);
    if (month) {
      result = result.filter(o => {
        const d = new Date(o.Date);
        return (d.getMonth() + 1) === parseInt(month);
      });
    }

    const [field, dir] = sort.split("-");
    result.sort((a, b) => {
      const mult = dir === "asc" ? 1 : -1;
      if (field === "date") return mult * (new Date(a.Date) - new Date(b.Date));
      if (field === "orderId") return mult * a.OrderID.localeCompare(b.OrderID);
      return 0;
    });

    filteredOrders = result;
    currentPage = 1;
    renderOrdersTable();
  } else {
    const params = {};
    if (search) { params.q = search; }
    if (status) params.status = status;
    if (department) params.department = department;
    if (month) {
      params.month = month;
      params.year = new Date().getFullYear();
    }
    if (sort) {
      const [field, dir] = sort.split("-");
      params.sort = field;
      params.dir = dir;
    }

    let res;
    if (search) {
      res = await API.searchOrders(search);
    } else if (status || department || month) {
      res = await API.filterOrders(params);
    } else {
      res = await API.getOrders();
    }

    if (res.success) {
      filteredOrders = res.data;
      currentPage = 1;
      renderOrdersTable();
    }
  }
}

function clearFilters() {
  document.getElementById("search-input").value = "";
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-department").value = "";
  document.getElementById("filter-month").value = "";
  document.getElementById("filter-sort").value = "date-desc";
  filteredOrders = [...allOrders];
  currentPage = 1;
  renderOrdersTable();
}

// ========================================
// Order Detail Drawer
// ========================================

async function openOrderDetail(orderId) {
  const drawer = document.getElementById("detail-drawer");
  const panel = document.getElementById("drawer-panel");

  if (useMockData) {
    currentDetailOrder = allOrders.find(o => o.OrderID === orderId);
  } else {
    const res = await API.getOrderDetail(orderId);
    if (!res.success) {
      showToast("Failed to load order details", "error");
      return;
    }
    currentDetailOrder = res.data;
  }

  if (!currentDetailOrder) {
    showToast("Order not found", "error");
    return;
  }

  renderDrawerContent();
  drawer.classList.remove("hidden");
  requestAnimationFrame(() => {
    drawer.classList.add("open");
  });
}

function renderDrawerContent() {
  const o = currentDetailOrder;
  const body = document.getElementById("drawer-body");
  const footer = document.getElementById("drawer-footer");

  body.innerHTML = `
    <div class="space-y-5">
      <!-- Order Header -->
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-lg font-bold text-primary-600">${o.OrderID}</span>
          ${statusBadge(o.Status)}
        </div>
        <p class="text-xs text-surface-400">Created: ${formatDateTime(o.CreatedAt)}</p>
        ${o.CompletedAt ? `<p class="text-xs text-emerald-600">Completed: ${formatDateTime(o.CompletedAt)}</p>` : ""}
      </div>

      <!-- Info Grid -->
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-surface-50 rounded-xl p-3">
          <p class="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1">Requester</p>
          <p class="text-sm font-medium text-surface-700">${o.RequesterName}</p>
        </div>
        <div class="bg-surface-50 rounded-xl p-3">
          <p class="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1">Department</p>
          <p class="text-sm font-medium text-surface-700">${o.Department}</p>
        </div>
        <div class="bg-surface-50 rounded-xl p-3">
          <p class="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1">Order Date</p>
          <p class="text-sm font-medium text-surface-700">${formatDate(o.Date)}</p>
        </div>
        <div class="bg-surface-50 rounded-xl p-3">
          <p class="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1">Items</p>
          <p class="text-sm font-medium text-surface-700">${(o.Items || []).length} item(s)</p>
        </div>
      </div>

      <!-- Purpose -->
      <div>
        <p class="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1.5">Purpose</p>
        <p class="text-sm text-surface-700 bg-surface-50 rounded-xl p-3">${o.Purpose || "-"}</p>
      </div>

      ${o.Notes ? `
      <div>
        <p class="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1.5">Notes</p>
        <p class="text-sm text-surface-700 bg-surface-50 rounded-xl p-3">${o.Notes}</p>
      </div>` : ""}

      <!-- Items Table -->
      <div>
        <p class="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-2">Items</p>
        <div class="bg-surface-50 rounded-xl overflow-hidden">
          <table class="w-full">
            <thead>
              <tr class="border-b border-surface-200">
                <th class="text-left px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase">Item</th>
                <th class="text-center px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase">Qty</th>
                <th class="text-center px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase">Unit</th>
                <th class="text-left px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase">Notes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-200">
              ${(o.Items || []).map(item => `
                <tr>
                  <td class="px-3 py-2 text-sm text-surface-700 font-medium">${item.ItemName}</td>
                  <td class="px-3 py-2 text-sm text-surface-600 text-center">${item.Quantity}</td>
                  <td class="px-3 py-2 text-sm text-surface-600 text-center">${item.Unit}</td>
                  <td class="px-3 py-2 text-sm text-surface-500">${item.Notes || "-"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Footer buttons
  let footerHtml = `<div class="flex flex-wrap gap-2">`;
  footerHtml += `<button onclick="editOrder('${o.OrderID}')" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-surface-600 bg-white border border-surface-200 rounded-xl hover:bg-surface-50 transition-colors"><i data-lucide="pencil" class="w-3.5 h-3.5"></i> Edit</button>`;

  if (o.Status !== "Completed" && o.Status !== "Cancelled") {
    footerHtml += `<button onclick="markCompleted('${o.OrderID}')" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors"><i data-lucide="check" class="w-3.5 h-3.5"></i> Mark Completed</button>`;
  }

  if (o.Status !== "Cancelled" && o.Status !== "Completed") {
    footerHtml += `<button onclick="cancelOrder('${o.OrderID}')" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"><i data-lucide="x-circle" class="w-3.5 h-3.5"></i> Cancel</button>`;
  }

  footerHtml += `<button onclick="exportWorkOrder('${o.OrderID}')" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-surface-600 bg-white border border-surface-200 rounded-xl hover:bg-surface-50 transition-colors ml-auto"><i data-lucide="download" class="w-3.5 h-3.5"></i> Export</button>`;
  footerHtml += `</div>`;

  footer.innerHTML = footerHtml;
  lucide.createIcons();
}

function closeDrawer() {
  const drawer = document.getElementById("detail-drawer");
  drawer.classList.remove("open");
  setTimeout(() => drawer.classList.add("hidden"), 300);
  currentDetailOrder = null;
}

// ========================================
// New / Edit Order Modal
// ========================================

function showNewOrderModal() {
  document.getElementById("modal-title").textContent = "New Work Order";
  document.getElementById("btn-submit-order").textContent = "Create Order";
  document.getElementById("form-order-id").value = "";
  document.getElementById("form-requester").value = "";
  document.getElementById("form-purpose").value = "";
  document.getElementById("form-notes").value = "";
  setDefaultDate();
  populateDepartments();
  document.getElementById("items-container").innerHTML = "";
  document.getElementById("items-error").classList.add("hidden");
  addItemRow();

  document.getElementById("order-modal").classList.remove("hidden");
}

async function editOrder(orderId) {
  closeDrawer();

  let order;
  if (useMockData) {
    order = allOrders.find(o => o.OrderID === orderId);
  } else {
    const res = await API.getOrderDetail(orderId);
    if (!res.success) { showToast("Failed to load order", "error"); return; }
    order = res.data;
  }

  if (!order) return;

  document.getElementById("modal-title").textContent = "Edit Work Order";
  document.getElementById("btn-submit-order").textContent = "Update Order";
  document.getElementById("form-order-id").value = order.OrderID;
  document.getElementById("form-date").value = order.Date;
  document.getElementById("form-requester").value = order.RequesterName;
  document.getElementById("form-purpose").value = order.Purpose || "";
  document.getElementById("form-notes").value = order.Notes || "";
  populateDepartments();
  document.getElementById("form-department").value = order.Department;

  const container = document.getElementById("items-container");
  container.innerHTML = "";
  (order.Items || []).forEach(item => addItemRow(item));
  if ((order.Items || []).length === 0) addItemRow();

  document.getElementById("items-error").classList.add("hidden");
  document.getElementById("order-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("order-modal").classList.add("hidden");
}

function populateDepartments() {
  const select = document.getElementById("form-department");
  const current = select.value;
  select.innerHTML = '<option value="">Select department</option>';
  CONFIG.DEPARTMENTS.forEach(dept => {
    select.innerHTML += `<option value="${dept}" ${dept === current ? "selected" : ""}>${dept}</option>`;
  });
}

function addItemRow(item = null) {
  const container = document.getElementById("items-container");
  const row = document.createElement("div");
  row.className = "item-row bg-surface-50 rounded-xl p-3 border border-surface-100";

  const items = useMockData ? MOCK_DATA.masterItems : [];
  const itemOptions = items.map(i => `<option value="${i.Name}" ${item && item.ItemName === i.Name ? "selected" : ""}>${i.Name}</option>`).join("");

  row.innerHTML = `
    <div>
      ${itemOptions ? `
        <select onchange="handleItemSelect(this)" class="w-full px-2.5 py-2 text-sm bg-white border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 item-name">
          <option value="">Select item</option>
          ${itemOptions}
          <option value="__custom__">Other (type below)</option>
        </select>
        <input type="text" class="w-full px-2.5 py-2 text-sm bg-white border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 mt-1.5 item-custom-name hidden" placeholder="Item name">
      ` : `
        <input type="text" value="${item ? item.ItemName : ""}" class="w-full px-2.5 py-2 text-sm bg-white border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 item-name" placeholder="Item name">
      `}
    </div>
    <input type="number" value="${item ? item.Quantity : ""}" min="1" class="w-full px-2.5 py-2 text-sm bg-white border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 item-qty" placeholder="Qty">
    <select class="w-full px-2.5 py-2 text-sm bg-white border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 item-unit">
      ${CONFIG.UNITS.map(u => `<option value="${u}" ${item && item.Unit === u ? "selected" : ""}>${u}</option>`).join("")}
    </select>
    <input type="text" value="${item ? item.Notes || "" : ""}" class="w-full px-2.5 py-2 text-sm bg-white border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 item-notes" placeholder="Notes (optional)">
    <button type="button" onclick="removeItemRow(this)" class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 transition-colors">
      <i data-lucide="trash-2" class="w-4 h-4"></i>
    </button>
  `;

  container.appendChild(row);
  lucide.createIcons();
}

function handleItemSelect(select) {
  const row = select.closest(".item-row");
  const customInput = row.querySelector(".item-custom-name");
  if (select.value === "__custom__") {
    customInput.classList.remove("hidden");
    customInput.focus();
  } else {
    customInput.classList.add("hidden");
    customInput.value = "";
  }
}

function removeItemRow(btn) {
  const container = document.getElementById("items-container");
  if (container.children.length > 1) {
    btn.closest(".item-row").remove();
  }
}

function getFormItems() {
  const rows = document.querySelectorAll("#items-container .item-row");
  const items = [];

  rows.forEach(row => {
    let name;
    const select = row.querySelector(".item-name");
    if (select && select.tagName === "SELECT") {
      if (select.value === "__custom__") {
        name = row.querySelector(".item-custom-name").value.trim();
      } else {
        name = select.value;
      }
    } else {
      name = (row.querySelector(".item-name") || {}).value || "";
      name = name.trim();
    }

    const qty = parseInt(row.querySelector(".item-qty").value) || 0;
    const unit = row.querySelector(".item-unit").value;
    const notes = row.querySelector(".item-notes").value.trim();

    if (name && qty > 0) {
      items.push({ itemName: name, quantity: qty, unit, notes });
    }
  });

  return items;
}

async function submitOrder() {
  const orderId = document.getElementById("form-order-id").value;
  const date = document.getElementById("form-date").value;
  const requester = document.getElementById("form-requester").value.trim();
  const department = document.getElementById("form-department").value;
  const purpose = document.getElementById("form-purpose").value.trim();
  const notes = document.getElementById("form-notes").value.trim();
  const items = getFormItems();

  // Validation
  if (!date || !requester || !department || !purpose) {
    showToast("Please fill in all required fields", "error");
    return;
  }
  if (items.length === 0) {
    document.getElementById("items-error").classList.remove("hidden");
    showToast("Please add at least one item", "error");
    return;
  }
  document.getElementById("items-error").classList.add("hidden");

  const orderData = { date, requesterName: requester, department, purpose, notes, items };

  if (useMockData) {
    if (orderId) {
      // Edit mock
      const idx = allOrders.findIndex(o => o.OrderID === orderId);
      if (idx !== -1) {
        allOrders[idx] = { ...allOrders[idx], ...orderData, Items: items, ItemCount: items.length };
        filteredOrders = [...allOrders];
        renderOrdersTable();
        showToast("Order updated successfully", "success");
      }
    } else {
      // Create mock
      const newId = generateMockOrderId();
      const newOrder = {
        OrderID: newId,
        ...orderData,
        Status: "Pending",
        CreatedAt: new Date().toISOString(),
        CompletedAt: "",
        ItemCount: items.length,
        Items: items
      };
      allOrders.unshift(newOrder);
      filteredOrders = [...allOrders];
      renderOrdersTable();
      showToast("Order created: " + newId, "success");
    }
    closeModal();
    return;
  }

  let res;
  if (orderId) {
    res = await API.updateOrder({ orderId, ...orderData });
  } else {
    res = await API.createOrder(orderData);
  }

  if (res.success) {
    showToast(orderId ? "Order updated successfully" : "Order created: " + res.data.orderId, "success");
    closeModal();
    loadData();
  } else {
    showToast(res.message || "Failed to save order", "error");
  }
}

function generateMockOrderId() {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
  const prefix = "WO-" + dateStr + "-";
  const existing = allOrders.filter(o => o.OrderID.startsWith(prefix));
  const num = existing.length + 1;
  return prefix + String(num).padStart(3, "0");
}

// ========================================
// Status Management
// ========================================

async function markCompleted(orderId) {
  showConfirm(
    "Mark as Completed",
    "This order will be marked as completed. Continue?",
    async () => {
      if (useMockData) {
        const order = allOrders.find(o => o.OrderID === orderId);
        if (order) {
          order.Status = "Completed";
          order.CompletedAt = new Date().toISOString();
          filteredOrders = [...allOrders];
          renderOrdersTable();
          currentDetailOrder = order;
          renderDrawerContent();
          showToast("Order marked as completed", "success");
        }
        return;
      }

      const res = await API.updateOrderStatus(orderId, "Completed");
      if (res.success) {
        showToast("Order marked as completed", "success");
        closeDrawer();
        loadData();
      } else {
        showToast(res.message || "Failed to update status", "error");
      }
    }
  );
}

async function cancelOrder(orderId) {
  showConfirm(
    "Cancel Order",
    "This order will be cancelled. This action cannot be undone.",
    async () => {
      if (useMockData) {
        const order = allOrders.find(o => o.OrderID === orderId);
        if (order) {
          order.Status = "Cancelled";
          filteredOrders = [...allOrders];
          renderOrdersTable();
          currentDetailOrder = order;
          renderDrawerContent();
          showToast("Order cancelled", "info");
        }
        return;
      }

      const res = await API.updateOrderStatus(orderId, "Cancelled");
      if (res.success) {
        showToast("Order cancelled", "info");
        closeDrawer();
        loadData();
      } else {
        showToast(res.message || "Failed to cancel order", "error");
      }
    }
  );
}

async function deleteOrder(orderId) {
  showConfirm(
    "Delete Order",
    "This order will be permanently deleted. This action cannot be undone.",
    async () => {
      if (useMockData) {
        allOrders = allOrders.filter(o => o.OrderID !== orderId);
        filteredOrders = [...allOrders];
        renderOrdersTable();
        closeDrawer();
        showToast("Order deleted", "info");
        return;
      }

      const res = await API.deleteOrder(orderId);
      if (res.success) {
        showToast("Order deleted", "info");
        closeDrawer();
        loadData();
      } else {
        showToast(res.message || "Failed to delete order", "error");
      }
    }
  );
}

// ========================================
// Master Items (Settings)
// ========================================

async function loadMasterItems() {
  if (useMockData) {
    renderMasterItems(MOCK_DATA.masterItems);
    return;
  }
  const res = await API.getMasterItems();
  if (res.success) renderMasterItems(res.data);
}

function renderMasterItems(items) {
  const container = document.getElementById("master-items-list");
  if (!items || items.length === 0) {
    container.innerHTML = `<p class="px-5 py-6 text-center text-sm text-surface-400">No items configured</p>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="flex items-center justify-between px-4 py-3 hover:bg-surface-50 transition-colors">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 bg-surface-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <i data-lucide="package" class="w-4 h-4 text-surface-500"></i>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-surface-700 truncate">${item.Name}</p>
          <p class="text-xs text-surface-400">${item.Unit} - ${item.Category}</p>
        </div>
      </div>
      <button onclick="deleteMasterItem('${item.ID}')" class="p-1.5 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 transition-colors flex-shrink-0">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `).join("");
  lucide.createIcons();
}

async function addMasterItem() {
  const name = document.getElementById("new-item-name").value.trim();
  const unit = document.getElementById("new-item-unit").value;
  const category = document.getElementById("new-item-category").value.trim() || "General";

  if (!name) {
    showToast("Please enter an item name", "error");
    return;
  }

  if (useMockData) {
    const newId = "MI-" + String(MOCK_DATA.masterItems.length + 1).padStart(3, "0");
    MOCK_DATA.masterItems.push({ ID: newId, Name: name, Unit: unit, Category: category });
    renderMasterItems(MOCK_DATA.masterItems);
    document.getElementById("new-item-name").value = "";
    document.getElementById("new-item-category").value = "";
    showToast("Item added successfully", "success");
    return;
  }

  const res = await API.addMasterItem({ name, unit, category });
  if (res.success) {
    showToast("Item added successfully", "success");
    document.getElementById("new-item-name").value = "";
    document.getElementById("new-item-category").value = "";
    loadMasterItems();
  } else {
    showToast(res.message || "Failed to add item", "error");
  }
}

async function deleteMasterItem(id) {
  showConfirm("Delete Item", "Remove this item from the master list?", async () => {
    if (useMockData) {
      MOCK_DATA.masterItems = MOCK_DATA.masterItems.filter(i => i.ID !== id);
      renderMasterItems(MOCK_DATA.masterItems);
      showToast("Item deleted", "info");
      return;
    }
    const res = await API.deleteMasterItem(id);
    if (res.success) {
      showToast("Item deleted", "info");
      loadMasterItems();
    }
  });
}

// ========================================
// Export Functions
// ========================================

function exportExcel() {
  const data = filteredOrders.length > 0 ? filteredOrders : allOrders;
  if (data.length === 0) {
    showToast("No data to export", "error");
    return;
  }

  if (typeof XLSX === "undefined") {
    showToast("XLSX library not loaded. Please refresh.", "error");
    return;
  }

  // Sheet 1: Orders summary
  const ordersRows = [];
  ordersRows.push(["Order ID", "Date", "Requester Name", "Department", "Purpose", "Notes", "Status", "Items Count", "Created At", "Completed At"]);

  data.forEach(o => {
    ordersRows.push([
      o.OrderID,
      o.Date,
      o.RequesterName,
      o.Department,
      o.Purpose || "",
      o.Notes || "",
      o.Status,
      (o.Items || []).length,
      formatDateTime(o.CreatedAt),
      o.CompletedAt ? formatDateTime(o.CompletedAt) : ""
    ]);
  });

  // Sheet 2: Items detail
  const itemsRows = [];
  itemsRows.push(["Order ID", "Item Name", "Quantity", "Unit", "Notes"]);

  data.forEach(o => {
    (o.Items || []).forEach(item => {
      itemsRows.push([
        o.OrderID,
        item.ItemName,
        item.Quantity,
        item.Unit,
        item.Notes || ""
      ]);
    });
  });

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(ordersRows);
  // Column widths
  ws1["!cols"] = [
    { wch: 22 }, // Order ID
    { wch: 12 }, // Date
    { wch: 20 }, // Requester
    { wch: 18 }, // Department
    { wch: 30 }, // Purpose
    { wch: 25 }, // Notes
    { wch: 14 }, // Status
    { wch: 10 }, // Items Count
    { wch: 20 }, // Created At
    { wch: 20 }  // Completed At
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Orders");

  const ws2 = XLSX.utils.aoa_to_sheet(itemsRows);
  ws2["!cols"] = [
    { wch: 22 }, // Order ID
    { wch: 25 }, // Item Name
    { wch: 10 }, // Quantity
    { wch: 10 }, // Unit
    { wch: 30 }  // Notes
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Order Items");

  const fileName = "work-orders-" + new Date().toISOString().split("T")[0] + ".xlsx";
  XLSX.writeFile(wb, fileName);
  showToast("Exported " + data.length + " orders to Excel", "success");
}

function exportWorkOrder(orderId) {
  let order;
  if (useMockData) {
    order = allOrders.find(o => o.OrderID === orderId);
  } else {
    order = currentDetailOrder;
  }

  if (!order) {
    showToast("Order not found", "error");
    return;
  }

  const items = order.Items || [];

  const statusColors = {
    "Pending": { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
    "In Progress": { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
    "Completed": { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
    "Cancelled": { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" }
  };
  const sc = statusColors[order.Status] || statusColors["Pending"];

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Work Order ${order.OrderID}</title>
      <style>
        @page { margin: 15mm; size: A4; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          color: #1e293b;
          background: #fff;
          padding: 32px 40px;
          font-size: 13px;
          line-height: 1.5;
        }

        /* Header */
        .doc-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 16px;
          border-bottom: 3px solid #0d9488;
          margin-bottom: 24px;
        }
        .doc-header-left .company-name {
          font-size: 22px;
          font-weight: 800;
          color: #0d9488;
          letter-spacing: -0.02em;
        }
        .doc-header-left .company-sub {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 2px;
        }
        .doc-header-right {
          text-align: right;
        }
        .doc-header-right .doc-type {
          font-size: 18px;
          font-weight: 700;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .doc-header-right .doc-id {
          font-size: 14px;
          font-weight: 700;
          color: #0d9488;
          margin-top: 4px;
        }

        /* Section */
        .section {
          margin-bottom: 20px;
        }
        .section-title {
          font-size: 11px;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 10px;
          padding-bottom: 4px;
          border-bottom: 1px solid #e2e8f0;
        }

        /* Info Grid - like a real form */
        .info-table {
          width: 100%;
          border-collapse: collapse;
        }
        .info-table td {
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          font-size: 12px;
        }
        .info-table .label-cell {
          background: #f8fafc;
          font-weight: 600;
          color: #64748b;
          width: 140px;
          text-transform: uppercase;
          font-size: 10px;
          letter-spacing: 0.04em;
        }
        .info-table .value-cell {
          color: #1e293b;
          font-weight: 500;
        }

        /* Status Badge */
        .status-badge {
          display: inline-block;
          padding: 3px 12px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
          background: ${sc.bg};
          color: ${sc.text};
          border: 1px solid ${sc.border};
        }

        /* Items Table */
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 2px;
        }
        .items-table thead th {
          background: #0d9488;
          color: #fff;
          padding: 8px 12px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          text-align: left;
          border: 1px solid #0b7a6e;
        }
        .items-table thead th.center { text-align: center; }
        .items-table tbody td {
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          font-size: 12px;
          color: #334155;
        }
        .items-table tbody td.center { text-align: center; }
        .items-table tbody tr:nth-child(even) {
          background: #f8fafc;
        }
        .items-table tbody tr:hover {
          background: #f0fdfa;
        }
        .items-table .row-num {
          width: 40px;
          text-align: center;
          font-weight: 600;
          color: #94a3b8;
        }
        .items-table .qty-col { width: 70px; }
        .items-table .unit-col { width: 80px; }

        /* Summary row */
        .items-table tfoot td {
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          font-weight: 700;
          font-size: 12px;
          background: #f1f5f9;
          color: #334155;
        }

        /* Purpose & Notes */
        .text-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 10px 14px;
          font-size: 12px;
          color: #334155;
          line-height: 1.6;
          white-space: pre-wrap;
        }

        /* Signatures */
        .sig-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 32px;
          margin-top: 40px;
          padding-top: 16px;
        }
        .sig-block {
          text-align: center;
        }
        .sig-line {
          border-top: 1px solid #94a3b8;
          margin-top: 50px;
          padding-top: 6px;
        }
        .sig-label {
          font-size: 10px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        /* Footer */
        .doc-footer {
          margin-top: 32px;
          padding-top: 12px;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #94a3b8;
        }

        @media print {
          body { padding: 0; }
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>

      <!-- Header -->
      <div class="doc-header">
        <div class="doc-header-left">
          <div class="company-name">${CONFIG.COMPANY_NAME}</div>
          <div class="company-sub">Work Order Management System</div>
        </div>
        <div class="doc-header-right">
          <div class="doc-type">Work Order</div>
          <div class="doc-id">${order.OrderID}</div>
        </div>
      </div>

      <!-- Order Info -->
      <div class="section">
        <div class="section-title">Order Information</div>
        <table class="info-table">
          <tr>
            <td class="label-cell">Requester Name</td>
            <td class="value-cell">${order.RequesterName}</td>
            <td class="label-cell">Department</td>
            <td class="value-cell">${order.Department}</td>
          </tr>
          <tr>
            <td class="label-cell">Order Date</td>
            <td class="value-cell">${formatDate(order.Date)}</td>
            <td class="label-cell">Status</td>
            <td class="value-cell"><span class="status-badge">${order.Status}</span></td>
          </tr>
          <tr>
            <td class="label-cell">Created At</td>
            <td class="value-cell">${formatDateTime(order.CreatedAt)}</td>
            <td class="label-cell">Completed At</td>
            <td class="value-cell">${order.CompletedAt ? formatDateTime(order.CompletedAt) : "-"}</td>
          </tr>
        </table>
      </div>

      <!-- Purpose -->
      <div class="section">
        <div class="section-title">Purpose</div>
        <div class="text-box">${order.Purpose || "-"}</div>
      </div>

      ${order.Notes ? `
      <!-- Notes -->
      <div class="section">
        <div class="section-title">Notes</div>
        <div class="text-box">${order.Notes}</div>
      </div>` : ""}

      <!-- Items -->
      <div class="section">
        <div class="section-title">Items (${items.length} item${items.length !== 1 ? "s" : ""})</div>
        <table class="items-table">
          <thead>
            <tr>
              <th class="row-num">#</th>
              <th>Item Name</th>
              <th class="center qty-col">Quantity</th>
              <th class="center unit-col">Unit</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, i) => `
              <tr>
                <td class="row-num">${i + 1}</td>
                <td><strong>${item.ItemName}</strong></td>
                <td class="center">${item.Quantity}</td>
                <td class="center">${item.Unit}</td>
                <td>${item.Notes || "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <!-- Signatures -->
      <div class="sig-grid">
        <div class="sig-block">
          <div class="sig-line">
            <div class="sig-label">Requested By</div>
          </div>
        </div>
        <div class="sig-block">
          <div class="sig-line">
            <div class="sig-label">Approved By</div>
          </div>
        </div>
        <div class="sig-block">
          <div class="sig-line">
            <div class="sig-label">Received By</div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="doc-footer">
        <span>Printed: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <span>${CONFIG.COMPANY_NAME} &mdash; Work Order Management System</span>
      </div>

    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 600);
  showToast("Work order export ready", "success");
}

// ========================================
// API Settings
// ========================================

function saveApiUrl() {
  const url = document.getElementById("api-url-input").value.trim();
  if (!url) {
    showToast("Please enter a URL", "error");
    return;
  }
  localStorage.setItem("wo_api_url", url);
  CONFIG.API_URL = url;
  API.init();
  useMockData = false;
  showToast("API URL saved. Reloading data...", "success");
  loadData();
}

async function testApiConnection() {
  const statusEl = document.getElementById("api-status");
  statusEl.textContent = "Testing connection...";
  statusEl.className = "text-xs mt-2 text-surface-500";

  const res = await API.getDashboardStats();
  if (res.success) {
    statusEl.textContent = "Connection successful!";
    statusEl.className = "text-xs mt-2 text-emerald-600 font-medium";
  } else {
    statusEl.textContent = "Connection failed: " + res.message;
    statusEl.className = "text-xs mt-2 text-red-500 font-medium";
  }
}

// ========================================
// UI Helpers
// ========================================

function statusBadge(status) {
  const cls = {
    "Pending": "badge-pending",
    "In Progress": "badge-in-progress",
    "Completed": "badge-completed",
    "Cancelled": "badge-cancelled"
  };
  return `<span class="badge ${cls[status] || "badge-pending"}">${status}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function showConfirm(title, message, onConfirm) {
  const dialog = document.getElementById("confirm-dialog");
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  dialog.classList.remove("hidden");

  const btn = document.getElementById("confirm-btn");
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.id = "confirm-btn";
  newBtn.addEventListener("click", () => {
    closeConfirm();
    onConfirm();
  });
}

function closeConfirm() {
  document.getElementById("confirm-dialog").classList.add("hidden");
}

function showLoading() {
  // Can add global loading indicator if needed
}

function hideLoading() {
  // Can remove global loading indicator if needed
}
