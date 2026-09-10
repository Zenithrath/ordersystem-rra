// ========================================
// Work Order Management System - Frontend
// Optimized with skeleton, polling, pagination
// ========================================

// --- State ---
let currentPage = 1;
let currentPageSize = 25;
let currentFilters = {};
let currentSort = { field: "date", dir: "desc" };
let allOrders = [];
let allOrdersTotal = 0;
let allOrdersTotalPages = 0;
let currentOrder = null;
let editingOrderId = null;
let isLoadingOrders = false;
let selectedOrders = new Set();
let isSubmitting = false;

const DEBOUNCE_MS = 350;

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("form-date").value = new Date().toISOString().slice(0, 10);
  loadDashboard();
  loadFilters();
  addItemRow();
});

// --- Navigation ---
function navigateTo(page) {
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));

  if (page === "dashboard") {
    document.getElementById("page-dashboard").classList.remove("hidden");
    document.getElementById("nav-dashboard").classList.add("active");
    document.getElementById("page-title").textContent = "Overview";
    loadDashboard();
  } else if (page === "orders") {
    document.getElementById("page-orders").classList.remove("hidden");
    document.getElementById("nav-orders").classList.add("active");
    document.getElementById("page-title").textContent = "Orders";
    loadOrders();
  }

  // Close mobile sidebar
  document.getElementById("sidebar").classList.add("-translate-x-full");
  document.getElementById("sidebar-overlay").classList.add("hidden");
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  sidebar.classList.toggle("-translate-x-full");
  overlay.classList.toggle("hidden");
}

// ========================================
// Dashboard
// ========================================

function loadDashboard() {
  ApiService.getDashboardStats().then((res) => {
    if (!res.success) return;
    const d = res.data;

    animateValue("stat-total", d.totalOrders);
    animateValue("stat-pending", d.pendingOrders);
    animateValue("stat-completed", d.completedOrders);
    animateValue("stat-month", d.ordersThisMonth);

    renderRecentOrders(d.recentOrders || []);
  });
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;

  const duration = 400;
  const start = performance.now();

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function renderRecentOrders(orders) {
  const container = document.getElementById("recent-orders-list");
  if (!orders.length) {
    container.innerHTML = `
      <div class="px-5 py-8 text-center text-sm text-surface-400">
        <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 text-surface-300"></i>
        No orders yet
      </div>`;
    lucide.createIcons();
    return;
  }

  container.innerHTML = orders
    .map(
      (o) => `
    <div class="px-5 py-3.5 flex items-center justify-between hover:bg-surface-50/50 cursor-pointer transition-colors" onclick="openOrderDetail('${o.OrderID}')">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${statusBg(o.Status)} ${statusText(o.Status)}">
          ${o.Status.charAt(0)}
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-surface-800 truncate">${o.OrderID}</p>
          <p class="text-xs text-surface-400 truncate">${o.Users || ""} &middot; ${o.Department}</p>
        </div>
      </div>
      <div class="text-right shrink-0 ml-3">
        <span class="badge badge-${statusClass(o.Status)}">${o.Status}</span>
        <p class="text-[11px] text-surface-400 mt-1 truncate max-w-[120px]" title="${o.ItemNames || ""}">${o.ItemNames || o.ItemCount + " items"}</p>
      </div>
    </div>
  `,
    )
    .join("");
  lucide.createIcons();
}

// ========================================
// Orders Table
// ========================================

function showOrdersSkeleton() {
  const tbody = document.getElementById("orders-tbody");
  tbody.innerHTML = Array.from(
    { length: 5 },
    () => `
    <tr>
      <td class="px-5 py-4 w-10"><div class="skeleton h-4 w-4 rounded"></div></td>
      <td class="px-5 py-4"><div class="skeleton h-4 w-28 rounded"></div></td>
      <td class="px-5 py-4 hidden sm:table-cell"><div class="skeleton h-4 w-20 rounded"></div></td>
      <td class="px-5 py-4"><div class="skeleton h-4 w-24 rounded"></div></td>
      <td class="px-5 py-4 hidden md:table-cell"><div class="skeleton h-4 w-24 rounded"></div></td>
      <td class="px-5 py-4 hidden lg:table-cell"><div class="skeleton h-4 w-20 rounded"></div></td>
      <td class="px-5 py-4"><div class="skeleton h-4 w-32 rounded"></div></td>
      <td class="px-5 py-4 text-center"><div class="skeleton h-5 w-16 rounded-full mx-auto"></div></td>
      <td class="px-5 py-4 text-center"><div class="skeleton h-4 w-6 rounded"></div></td>
      <td class="px-5 py-4 text-right"><div class="skeleton h-4 w-12 rounded ml-auto"></div></td>
    </tr>
  `,
  ).join("");
}

function loadOrders() {
  if (isLoadingOrders) return;
  isLoadingOrders = true;

  showOrdersSkeleton();

  const params = {
    page: currentPage,
    pageSize: currentPageSize,
    sort: currentSort.field,
    dir: currentSort.dir,
    ...currentFilters,
  };

  ApiService.getOrders(params).then((res) => {
    isLoadingOrders = false;
    if (!res.success) {
      showToast(res.message || "Failed to load orders", "error");
      return;
    }

    allOrders = res.data;
    allOrdersTotal = res.pagination.total;
    allOrdersTotalPages = res.pagination.totalPages;
    currentPage = res.pagination.page;

    renderOrdersTable();
    renderPagination();
    updateSelectedUI();
  });
}

function renderOrdersTable() {
  const tbody = document.getElementById("orders-tbody");

  if (!allOrders.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="px-5 py-12 text-center text-sm text-surface-400">
          <i data-lucide="search" class="w-10 h-10 mx-auto mb-2 text-surface-300"></i>
          No orders found
        </td>
      </tr>`;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = allOrders
    .map((o) => {
      const checked = selectedOrders.has(o.OrderID) ? "checked" : "";
      const itemNames = o.ItemNames || (o.Items || []).map((it) => it.ItemName).join(", ");
      return `
    <tr class="${selectedOrders.has(o.OrderID) ? "bg-primary-50/50" : ""}">
      <td class="px-5 py-4 w-10">
        <input type="checkbox" value="${o.OrderID}" ${checked} onchange="toggleSelectOrder('${o.OrderID}', this)" class="w-4 h-4 rounded border-surface-300 text-primary-500 focus:ring-primary-500/20 cursor-pointer" />
      </td>
      <td class="px-5 py-4 text-sm font-medium text-surface-800 cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">${o.OrderID}</td>
      <td class="px-5 py-4 text-sm text-surface-500 hidden sm:table-cell cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">${formatDate(o.Date)}</td>
      <td class="px-5 py-4 hidden md:table-cell cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">
        <p class="text-sm text-surface-500">${o.Department}</p>
      </td>
      <td class="px-5 py-4 cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">
        <p class="text-sm text-surface-800 truncate max-w-[120px]" title="${o.Users || ""}">${o.Users || "-"}</p>
      </td>
      <td class="px-5 py-4 hidden lg:table-cell cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">
        <p class="text-sm text-surface-500 truncate max-w-[150px]" title="${
          (o.Items || [])
            .map((it) => it.Description)
            .filter((d) => d)
            .join(", ") || ""
        }">${
          (o.Items || [])
            .map((it) => it.Description)
            .filter((d) => d)
            .join(", ") || "-"
        }</p>
      </td>
      <td class="px-5 py-4 cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">
        <p class="text-sm text-surface-600 truncate max-w-[200px]" title="${itemNames}">${itemNames || "-"}</p>
      </td>
      <td class="px-5 py-4 text-center cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">
        <span class="badge badge-${statusClass(o.Status)}">${o.Status}</span>
      </td>
      <td class="px-5 py-4 text-right">
        <button onclick="event.stopPropagation(); openOrderDetail('${o.OrderID}')" class="text-xs font-medium text-primary-500 hover:text-primary-600 transition-colors">
          View
        </button>
      </td>
    </tr>
    `;
    })
    .join("");
}

function renderPagination() {
  const info = document.getElementById("pagination-info");
  const btns = document.getElementById("pagination-buttons");

  const start = (currentPage - 1) * currentPageSize + 1;
  const end = Math.min(currentPage * currentPageSize, allOrdersTotal);
  info.textContent = allOrdersTotal > 0 ? `Showing ${start}–${end} of ${allOrdersTotal}` : "No results";

  // Page size selector + page buttons
  let html = `
    <select onchange="changePageSize(this.value)" class="px-2 py-1 text-xs border border-surface-200 rounded-lg mr-2">
      <option value="10" ${currentPageSize === 10 ? "selected" : ""}>10</option>
      <option value="25" ${currentPageSize === 25 ? "selected" : ""}>25</option>
      <option value="50" ${currentPageSize === 50 ? "selected" : ""}>50</option>
      <option value="100" ${currentPageSize === 100 ? "selected" : ""}>100</option>
    </select>
  `;

  if (allOrdersTotalPages <= 1) {
    btns.innerHTML = html;
    return;
  }

  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(allOrdersTotalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

  if (currentPage > 1) {
    html += `<button onclick="goToPage(${currentPage - 1})" class="px-2.5 py-1 text-xs rounded-lg border border-surface-200 hover:bg-surface-50 transition-colors">&laquo;</button>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    const active = i === currentPage ? "bg-primary-500 text-white border-primary-500" : "border-surface-200 hover:bg-surface-50";
    html += `<button onclick="goToPage(${i})" class="px-2.5 py-1 text-xs rounded-lg border ${active} transition-colors">${i}</button>`;
  }

  if (currentPage < allOrdersTotalPages) {
    html += `<button onclick="goToPage(${currentPage + 1})" class="px-2.5 py-1 text-xs rounded-lg border border-surface-200 hover:bg-surface-50 transition-colors">&raquo;</button>`;
  }

  btns.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadOrders();
}

function changePageSize(size) {
  currentPageSize = parseInt(size);
  currentPage = 1;
  loadOrders();
}

// ========================================
// Selection & Bulk Export
// ========================================

function toggleSelectAll(cb) {
  if (cb.checked) {
    allOrders.forEach((o) => selectedOrders.add(o.OrderID));
  } else {
    allOrders.forEach((o) => selectedOrders.delete(o.OrderID));
  }
  renderOrdersTable();
  updateSelectedUI();
}

function toggleSelectOrder(orderId, cb) {
  if (cb.checked) {
    selectedOrders.add(orderId);
  } else {
    selectedOrders.delete(orderId);
  }
  renderOrdersTable();
  updateSelectedUI();
}

function updateSelectedUI() {
  const count = selectedOrders.size;
  const btnPdf = document.getElementById("btn-export-selected-pdf");
  const btnExcel = document.getElementById("btn-export-selected-excel");
  const btnDelete = document.getElementById("btn-delete-selected");

  if (count > 0) {
    btnPdf.classList.remove("hidden");
    btnExcel.classList.remove("hidden");
    btnDelete.classList.remove("hidden");
    document.getElementById("selected-count-pdf").textContent = count;
    document.getElementById("selected-count-excel").textContent = count;
    document.getElementById("selected-count-delete").textContent = count;
  } else {
    btnPdf.classList.add("hidden");
    btnExcel.classList.add("hidden");
    btnDelete.classList.add("hidden");
  }

  // Update select-all checkbox state
  const selectAll = document.getElementById("select-all");
  if (allOrders.length > 0 && count === allOrders.length) {
    selectAll.checked = true;
    selectAll.indeterminate = false;
  } else if (count > 0) {
    selectAll.indeterminate = true;
  } else {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
}

function getSelectedOrders() {
  if (selectedOrders.size === 0) return allOrders;
  return allOrders.filter((o) => selectedOrders.has(o.OrderID));
}

function exportSelectedExcel() {
  const selected = getSelectedOrders();
  if (selected.length === 0) {
    showToast("No orders selected", "info");
    return;
  }
  generateExcelFromData(selected);
}

function deleteSelected() {
  const selected = Array.from(selectedOrders);
  if (selected.length === 0) return;

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4";
  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
          <i data-lucide="alert-triangle" class="w-5 h-5 text-red-600"></i>
        </div>
        <h3 class="text-lg font-semibold text-surface-800">Hapus Order?</h3>
      </div>
      <p class="text-sm text-surface-600 mb-6">Yakin ingin menghapus <strong>${selected.length}</strong> order yang dipilih? Tindakan ini tidak dapat dibatalkan.</p>
      <div class="flex gap-3 justify-end">
        <button id="popup-cancel" class="px-4 py-2 text-sm font-medium text-surface-600 bg-surface-100 rounded-xl hover:bg-surface-200 transition-colors">Batal</button>
        <button id="popup-confirm" class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors">Ya, Hapus</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  lucide.createIcons();

  overlay.querySelector("#popup-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#popup-confirm").onclick = async () => {
    overlay.remove();
    let deleted = 0;
    for (const orderId of selected) {
      try {
        await ApiService.deleteOrder(orderId);
        deleted++;
      } catch (e) {
        console.error("Delete error:", e);
      }
    }
    selectedOrders.clear();
    updateSelectedUI();
    loadOrders(currentPage);
    loadDashboardStats();
    showToast(`${deleted} order berhasil dihapus`, "success");
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}

function exportSelectedPDF() {
  const selected = getSelectedOrders();
  if (selected.length === 0) {
    showToast("No orders selected", "info");
    return;
  }
  generatePDFFromData(selected);
}

function generatePDFFromData(orders) {
  if (!orders.length) return;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Work Orders</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 30px; color: #333; }
        h1 { font-size: 18px; color: #115e59; margin-bottom: 4px; }
        .subtitle { font-size: 11px; color: #64748b; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #0d9488; color: white; padding: 8px 10px; font-size: 10px; text-align: left; }
        td { padding: 8px 10px; font-size: 11px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) td { background: #f8fafc; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 9px; font-weight: 600; }
        .badge-pending { background: #fef3c7; color: #92400e; }
        .badge-in-progress { background: #dbeafe; color: #1e40af; }
        .badge-completed { background: #d1fae5; color: #065f46; }
        .badge-cancelled { background: #fee2e2; color: #991b1b; }
        .items-cell { font-size: 10px; color: #475569; max-width: 200px; }
        .footer { margin-top: 16px; font-size: 9px; color: #94a3b8; text-align: center; }
        @media print { body { padding: 15px; } }
      </style>
    </head>
    <body>
      <h1>PT. RRA — Work Orders</h1>
      <div class="subtitle">${orders.length} orders &middot; Generated ${new Date().toLocaleDateString("id-ID")}</div>
      <table>
        <thead><tr><th>Order ID</th><th>Date</th><th>Requester</th><th>Department</th><th>Items</th><th>Status</th></tr></thead>
        <tbody>
          ${orders
            .map(
              (o) => `
            <tr>
              <td>${o.OrderID}</td>
              <td>${formatDate(o.Date)}</td>
              <td>${o.Users || "-"}</td>
              <td>${o.Department}</td>
              <td class="items-cell">${o.ItemNames || (o.Items || []).map((it) => it.ItemName).join(", ") || "-"}</td>
              <td><span class="badge badge-${statusClass(o.Status)}">${o.Status}</span></td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      <div class="footer">Work Order Management System</div>
    </body></html>
  `);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 400);
}

// ========================================
// Filters & Search
// ========================================

let debounceTimer = null;
function debounceSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    currentFilters.q = document.getElementById("search-input").value.trim();
    currentPage = 1;
    loadOrders();
  }, DEBOUNCE_MS);
}

function applyFilters() {
  currentFilters.status = document.getElementById("filter-status").value;
  currentFilters.department = document.getElementById("filter-department").value;
  currentFilters.month = document.getElementById("filter-month").value;
  currentFilters.year = document.getElementById("filter-year").value;

  const sortVal = document.getElementById("filter-sort").value;
  if (sortVal === "date-desc") {
    currentSort = { field: "date", dir: "desc" };
  } else if (sortVal === "date-asc") {
    currentSort = { field: "date", dir: "asc" };
  } else if (sortVal === "orderId-asc") {
    currentSort = { field: "orderId", dir: "asc" };
  } else if (sortVal === "orderId-desc") {
    currentSort = { field: "orderId", dir: "desc" };
  }

  currentPage = 1;
  loadOrders();
}

function clearFilters() {
  document.getElementById("search-input").value = "";
  document.getElementById("filter-status").value = "";
  document.getElementById("filter-department").value = "";
  document.getElementById("filter-month").value = "";
  document.getElementById("filter-year").value = "";
  document.getElementById("filter-sort").value = "date-desc";
  currentFilters = {};
  currentSort = { field: "date", dir: "desc" };
  currentPage = 1;
  selectedOrders.clear();
  updateSelectedUI();
  loadOrders();
}

function refreshOrders() {
  ApiService.invalidateOrders();
  loadOrders();
  showToast("Refreshing...", "info");
}

function loadFilters() {
  const deptSelect = document.getElementById("filter-department");
  CONFIG.DEPARTMENTS.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    deptSelect.appendChild(opt);
  });

  // Populate form department dropdown
  const formDept = document.getElementById("form-department");
  CONFIG.DEPARTMENTS.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    formDept.appendChild(opt);
  });
}

// ========================================
// Order Detail Drawer
// ========================================

function openOrderDetail(orderId) {
  // Try local cache first
  const local = allOrders.find((o) => o.OrderID === orderId);
  if (local) {
    currentOrder = local;
    renderDrawer(local);
  } else {
    ApiService.getOrderDetail(orderId).then((res) => {
      if (!res.success) {
        showToast(res.message, "error");
        return;
      }
      currentOrder = res.data;
      renderDrawer(res.data);
    });
  }

  const drawer = document.getElementById("detail-drawer");
  const panel = document.getElementById("drawer-panel");
  drawer.classList.remove("hidden");
  requestAnimationFrame(() => {
    drawer.classList.add("open");
    panel.classList.remove("translate-x-full");
  });
}

function closeDrawer() {
  const drawer = document.getElementById("detail-drawer");
  const panel = document.getElementById("drawer-panel");
  drawer.classList.remove("open");
  panel.classList.add("translate-x-full");
  setTimeout(() => {
    drawer.classList.add("hidden");
    editingOrderId = null;
  }, 300);
}

function renderDrawer(order) {
  const body = document.getElementById("drawer-body");
  const footer = document.getElementById("drawer-footer");

  body.innerHTML = `
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <div>
          <h4 class="text-lg font-bold text-surface-800">${order.OrderID}</h4>
          <p class="text-xs text-surface-400 mt-0.5">${formatDate(order.Date)}</p>
        </div>
        <span class="badge badge-${statusClass(order.Status)}">${order.Status}</span>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">NO. PR</p>
          <p class="text-sm text-surface-800">${order.NoPR || order.OrderID}</p>
        </div>
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">USER</p>
          <p class="text-sm text-surface-800">${order.Users || "-"}</p>
        </div>
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">DEP</p>
          <p class="text-sm text-surface-800">${order.Department}</p>
        </div>
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">DESCRIPTION</p>
          <p class="text-sm text-surface-800">${order.Purpose || "-"}</p>
        </div>
      </div>
      <div>
        <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-2">Items</p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-[10px] font-medium text-surface-400 uppercase border-b border-surface-100">
                <th class="text-left py-2 px-2">NO</th>
                <th class="text-left py-2 px-2">USER</th>
                <th class="text-left py-2 px-2">DESCRIPTION</th>
                <th class="text-left py-2 px-2">SPECIFICATION</th>
                <th class="text-center py-2 px-2">QTY</th>
                <th class="text-center py-2 px-2">UOM</th>
                <th class="text-center py-2 px-2">SALDO</th>
              </tr>
            </thead>
            <tbody>
              ${(order.Items || [])
                .map(
                  (it, idx) => `
                <tr class="border-b border-surface-50">
                  <td class="py-2 px-2 text-surface-500">${idx + 1}</td>
                  <td class="py-2 px-2 text-surface-700">${it.User || "-"}</td>
                  <td class="py-2 px-2 text-surface-600">${it.Description || "-"}</td>
                  <td class="py-2 px-2 font-medium text-surface-800">${it.ItemName}</td>
                  <td class="py-2 px-2 text-center text-surface-700">${it.Quantity}</td>
                  <td class="py-2 px-2 text-center text-surface-500">${it.Unit}</td>
                  <td class="py-2 px-2 text-center text-surface-500">${it.SaldoQty || 0} ${it.SaldoUom || it.Unit || ""}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const isEditable = order.Status !== "Completed" && order.Status !== "Cancelled";
  footer.innerHTML = `
    <div class="flex flex-wrap gap-2">
      ${
        isEditable
          ? `
        <button onclick="editOrder('${order.OrderID}')" class="px-3 py-2 text-xs font-medium text-surface-700 bg-white border border-surface-200 rounded-xl hover:bg-surface-50 transition-colors">
          Edit
        </button>
        <button onclick="changeStatus('${order.OrderID}', 'In Progress')" class="px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors">
          Mark In Progress
        </button>
        <button onclick="changeStatus('${order.OrderID}', 'Completed')" class="px-3 py-2 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors">
          Mark Completed
        </button>
        <button onclick="changeStatus('${order.OrderID}', 'Cancelled')" class="px-3 py-2 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
          Cancel
        </button>
      `
          : ""
      }
      <button onclick="exportWorkOrderPDF()" class="px-3 py-2 text-xs font-medium text-surface-600 bg-surface-50 border border-surface-200 rounded-xl hover:bg-surface-100 transition-colors ml-auto">
        Export PDF
      </button>
      <button onclick="exportCurrentOrderExcel()" class="px-3 py-2 text-xs font-medium text-surface-600 bg-surface-50 border border-surface-200 rounded-xl hover:bg-surface-100 transition-colors">
        Export Excel
      </button>
      <button onclick="confirmDeleteOrder('${order.OrderID}')" class="px-3 py-2 text-xs font-medium text-red-500 hover:text-red-600 transition-colors">
        Delete
      </button>
    </div>
  `;
}

// ========================================
// Order Actions (Optimistic)
// ========================================

function changeStatus(orderId, newStatus) {
  const oldOrder = allOrders.find((o) => o.OrderID === orderId);
  const oldStatus = oldOrder ? oldOrder.Status : null;

  // Optimistic update
  if (oldOrder) oldOrder.Status = newStatus;
  if (currentOrder && currentOrder.OrderID === orderId) {
    currentOrder.Status = newStatus;
    renderDrawer(currentOrder);
  }
  renderOrdersTable();

  ApiService.updateOrderStatus(orderId, newStatus).then((res) => {
    if (!res.success) {
      // Rollback
      if (oldOrder) oldOrder.Status = oldStatus;
      if (currentOrder && currentOrder.OrderID === orderId) {
        currentOrder.Status = oldStatus;
        renderDrawer(currentOrder);
      }
      renderOrdersTable();
      showToast(res.message || "Failed to update status", "error");
    } else {
      showToast("Status updated to " + newStatus, "success");
    }
  });
}

function confirmDeleteOrder(orderId) {
  showConfirm("Delete Order", "This will permanently delete order " + orderId + ". Continue?", () => {
    ApiService.deleteOrder(orderId).then((res) => {
      if (res.success) {
        allOrders = allOrders.filter((o) => o.OrderID !== orderId);
        renderOrdersTable();
        closeDrawer();
        showToast("Order deleted", "success");
        loadDashboard();
      } else {
        showToast(res.message || "Failed to delete", "error");
      }
    });
  });
}

// ========================================
// Create / Edit Order
// ========================================

function addItemRow() {
  const container = document.getElementById("items-container");
  const row = document.createElement("div");
  row.className = "item-row flex-col gap-1";
  row.innerHTML = `
    <div class="flex items-center gap-2 w-full">
      <div class="flex flex-col flex-1 min-w-0">
        <label class="text-[10px] font-medium text-surface-400 uppercase tracking-wider mb-0.5">User</label>
        <input type="text" placeholder="Nama user" required class="item-user px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 w-full" />
      </div>
      <div class="flex flex-col flex-1 min-w-0">
        <label class="text-[10px] font-medium text-surface-400 uppercase tracking-wider mb-0.5">Description</label>
        <input type="text" placeholder="Keperluan" class="item-description px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 w-full" />
      </div>
      <div class="flex flex-col flex-[2] min-w-0">
        <label class="text-[10px] font-medium text-surface-400 uppercase tracking-wider mb-0.5">Specification</label>
        <input type="text" placeholder="Nama barang / spesifikasi" required class="item-name px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 w-full" />
      </div>
      <button type="button" onclick="this.closest('.item-row').remove()" class="w-9 h-9 flex items-center justify-center text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0 mt-4">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </div>
    <div class="flex items-center gap-2 w-full">
      <div class="flex flex-col">
        <label class="text-[10px] font-medium text-surface-400 uppercase tracking-wider mb-0.5">Order Qty</label>
        <input type="number" placeholder="Qty" min="0" value="1" required class="item-qty px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 w-20" />
      </div>
      <div class="flex flex-col">
        <label class="text-[10px] font-medium text-surface-400 uppercase tracking-wider mb-0.5">UOM</label>
        <select class="item-unit px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
          ${CONFIG.UNITS.map((u) => `<option value="${u}">${u}</option>`).join("")}
        </select>
      </div>
      <div class="flex flex-col">
        <label class="text-[10px] font-medium text-surface-400 uppercase tracking-wider mb-0.5">Saldo Qty</label>
        <input type="number" placeholder="Stok" min="0" value="0" class="item-saldo-qty px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 w-20" />
      </div>
      <div class="flex flex-col">
        <label class="text-[10px] font-medium text-surface-400 uppercase tracking-wider mb-0.5">UOM</label>
        <select class="item-saldo-uom px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
          ${CONFIG.UNITS.map((u) => `<option value="${u}">${u}</option>`).join("")}
        </select>
      </div>
    </div>
  `;
  container.appendChild(row);
  lucide.createIcons();
}

function getFormData() {
  const items = [];
  document.querySelectorAll("#items-container .item-row").forEach((row) => {
    const name = row.querySelector(".item-name").value.trim();
    if (name) {
      items.push({
        user: row.querySelector(".item-user").value.trim(),
        description: row.querySelector(".item-description").value.trim(),
        itemName: name,
        quantity: parseInt(row.querySelector(".item-qty").value) || 1,
        unit: row.querySelector(".item-unit").value,
        saldoQty: parseInt(row.querySelector(".item-saldo-qty").value) || 0,
        saldoUom: row.querySelector(".item-saldo-uom").value,
        clear: false,
      });
    }
  });

  return {
    date: document.getElementById("form-date").value,
    department: document.getElementById("form-department").value,
    items,
  };
}

function submitOrder() {
  if (isSubmitting) return;

  const data = getFormData();

  if (!data.requesterName || !data.department) {
    showToast("Please fill in all required fields", "error");
    return;
  }
  if (data.items.length === 0) {
    document.getElementById("items-error").classList.remove("hidden");
    return;
  }
  document.getElementById("items-error").classList.add("hidden");

  isSubmitting = true;
  const btn = document.getElementById("btn-submit-order");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  const isEditing = !!editingOrderId;
  const apiCall = isEditing ? ApiService.updateOrder({ orderId: editingOrderId, ...data }) : ApiService.createOrder(data);

  apiCall.then((res) => {
    isSubmitting = false;
    btn.disabled = false;
    btn.textContent = isEditing ? "Update Order" : "Create Order";

    if (res.success) {
      showToast(isEditing ? "Order updated" : "Order created successfully", "success");
      resetForm();
      loadDashboard();
      if (document.getElementById("page-orders").classList.contains("hidden") === false) {
        loadOrders();
      }
    } else {
      showToast(res.message || "Failed to save order", "error");
    }
  });
}

function editOrder(orderId) {
  const order = allOrders.find((o) => o.OrderID === orderId) || currentOrder;
  if (!order) return;

  editingOrderId = orderId;

  // Close drawer WITHOUT clearing editingOrderId
  const drawer = document.getElementById("detail-drawer");
  const panel = document.getElementById("drawer-panel");
  drawer.classList.remove("open");
  panel.classList.add("translate-x-full");
  setTimeout(() => drawer.classList.add("hidden"), 300);

  navigateTo("dashboard");

  setTimeout(() => {
    document.getElementById("form-order-id").value = orderId;
    document.getElementById("form-date").value = order.Date || "";
    document.getElementById("form-department").value = order.Department || "";

    const container = document.getElementById("items-container");
    container.innerHTML = "";
    (order.Items || []).forEach((it) => {
      addItemRow();
      const rows = container.querySelectorAll(".item-row");
      const lastRow = rows[rows.length - 1];
      lastRow.querySelector(".item-user").value = it.User || "";
      lastRow.querySelector(".item-description").value = it.Description || "";
      lastRow.querySelector(".item-name").value = it.ItemName || "";
      lastRow.querySelector(".item-qty").value = it.Quantity || 1;
      lastRow.querySelector(".item-unit").value = it.Unit || "pcs";
      lastRow.querySelector(".item-saldo-qty").value = it.SaldoQty || 0;
      lastRow.querySelector(".item-saldo-uom").value = it.SaldoUom || it.Unit || "pcs";
    });

    document.getElementById("btn-submit-order").textContent = "Update Order";
    document.getElementById("btn-submit-order").scrollIntoView({ behavior: "smooth" });
  }, 400);
}

function resetForm() {
  editingOrderId = null;
  document.getElementById("form-order-id").value = "";
  document.getElementById("form-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("form-department").value = "";
  document.getElementById("items-container").innerHTML = "";
  document.getElementById("items-error").classList.add("hidden");
  document.getElementById("btn-submit-order").textContent = "Create Order";
  addItemRow();
}

// ========================================
// Excel Export (with xlsx-js-style)
// ========================================

function exportExcel() {
  showToast("Generating Excel...", "info");
  const filters = {};
  const q = document.getElementById("search-input").value.trim();
  const status = document.getElementById("filter-status").value;
  const dept = document.getElementById("filter-department").value;
  const month = document.getElementById("filter-month").value;
  const year = document.getElementById("filter-year").value;
  if (q) filters.q = q;
  if (status) filters.status = status;
  if (dept) filters.department = dept;
  if (month) filters.month = month;
  if (year) filters.year = year;

  ApiService.exportExcel(filters)
    .then((res) => {
      if (res && res.success && res.data && res.data.length > 0) {
        generateExcelFromData(res.data);
      } else {
        showToast("No data to export", "info");
      }
    })
    .catch((err) => {
      console.error("Export error:", err);
      showToast("Export failed: " + (err.message || "Unknown error"), "error");
    });
}

async function loadLogoBase64() {
  try {
    if (typeof window !== "undefined" && window.LOGO_BASE64) return window.LOGO_BASE64;
  } catch (err) {}
  try {
    const res = await fetch("logorra.png");
    if (!res.ok) return "";
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return String(dataUrl || "").split(",")[1] || "";
  } catch (err) {
    console.warn("Logo load failed:", err);
    return "";
  }
}

async function generateExcelFromData(orders) {
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    throw new Error("Tidak ada data untuk diexport.");
  }

  const logoBase64 = await loadLogoBase64();

  const wb = new ExcelJS.Workbook();

  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  const WIDTHS = [4, 22, 9, 33, 53, 6, 7, 5, 6, 14, 9];

  const whiteFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
  const thinBorder = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };
  const thickRightBorder = {
    top: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "medium", color: { argb: "FF000000" } },
  };
  const bottomBorder2px = {
    bottom: { style: "medium", color: { argb: "FF000000" } },
  };

  const headerFont = { name: "Calibri", size: 10, bold: true, color: { argb: "FF000000" } };
  const headerAlign = { horizontal: "center", vertical: "middle", wrapText: true };
  const bodyFont = { name: "Calibri", size: 10, color: { argb: "FF000000" } };
  const bodyAlignLeft = { horizontal: "left", vertical: "middle", wrapText: true };
  const bodyAlignCenter = { horizontal: "center", vertical: "middle", wrapText: true };

  function fillWhite(row, colCount) {
    for (let c = 1; c <= colCount; c++) {
      row.getCell(c).fill = whiteFill;
    }
  }

  function getItems(order) {
    if (Array.isArray(order.Items)) return order.Items;
    if (Array.isArray(order.items)) return order.items;
    return [];
  }

  let logoId = null;
  if (logoBase64) {
    try {
      logoId = wb.addImage({ base64: logoBase64, extension: "png" });
    } catch (err) {
      console.warn("Logo embed failed:", err);
      logoId = null;
    }
  }

  const usedNames = {};
  function sheetNameFor(raw, idx) {
    let name = String(raw || "ORDER-" + (idx + 1)).substring(0, 31).replace(/[\\\/\*\?\[\]:]/g, "").trim();
    if (!name) name = "ORDER-" + (idx + 1);
    if (!usedNames[name]) {
      usedNames[name] = 1;
      return name;
    }
    usedNames[name] += 1;
    return (name.substring(0, 28) + "-" + usedNames[name]).substring(0, 31);
  }

  orders.forEach((order, orderIdx) => {
    const items = getItems(order);
    const orderId = order.OrderID || order.orderID || order.NoPR || order.noPR || "ORDER-" + (orderIdx + 1);

    const ws = wb.addWorksheet(sheetNameFor(orderId, orderIdx), {
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToWidth: 1,
        fitToHeight: 0,
      },
      pageMargins: {
        left: 0.25,
        right: 0.25,
        top: 0.4,
        bottom: 0.4,
        header: 0.1,
        footer: 0.1,
      },
    });
    ws.columns = WIDTHS.map((w) => ({ width: w }));
    ws.views = [{ showGridLines: false }];

    const parsed = order.Date || order.date ? new Date(order.Date || order.date) : new Date();
    const valid = isNaN(parsed.getTime()) ? new Date() : parsed;
    const year = valid.getFullYear();
    const dayNum = valid.getDate();
    const monthName = months[valid.getMonth()];
    const formattedDate = `${dayNames[valid.getDay()]}, ${String(dayNum).padStart(2, "0")} ${monthName} ${year}`;

    // =========================================================
    // ROW 1: Logo image (logorra.png) top-left, no border
    // =========================================================

    const row1 = ws.getRow(1);
    row1.height = 20;
    fillWhite(row1, 11);
    if (logoId !== null) {
      ws.addImage(logoId, {
        tl: { col: 0, row: 0.3 },
        ext: { width: 228, height: 40 },
      });
    }

    // =========================================================
    // ROW 2: Title "REKAP FORM REQUISITION" (merged C2:G2)
    // =========================================================

    ws.mergeCells("C2:G2");
    const row2 = ws.getRow(2);
    row2.height = 20;
    fillWhite(row2, 11);
    row2.getCell(3).value = "REKAP FORM REQUISITION";
    row2.getCell(3).font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF000000" } };
    row2.getCell(3).alignment = { horizontal: "center", vertical: "middle" };

    // =========================================================
    // ROW 3: TAHUN label + value box (full border)
    // =========================================================

    const row3 = ws.getRow(3);
    row3.height = 21;
    fillWhite(row3, 11);
    ws.mergeCells("G3:H3");
    row3.getCell(7).value = "TAHUN";
    row3.getCell(7).font = { name: "Calibri", size: 10, color: { argb: "FF000000" } };
    row3.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
    ws.mergeCells("I3:K3");
    row3.getCell(9).value = year;
    row3.getCell(9).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF000000" } };
    row3.getCell(9).alignment = { horizontal: "center", vertical: "middle" };
    row3.getCell(9).border = thinBorder;

    // =========================================================
    // ROW 4: TANGGAL label + day box + month box (full border)
    // =========================================================

    const row4 = ws.getRow(4);
    row4.height = 21;
    fillWhite(row4, 11);
    ws.mergeCells("G4:H4");
    row4.getCell(7).value = "TANGGAL";
    row4.getCell(7).font = { name: "Calibri", size: 10, color: { argb: "FF000000" } };
    row4.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
    row4.getCell(9).value = dayNum;
    row4.getCell(9).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF000000" } };
    row4.getCell(9).alignment = { horizontal: "center", vertical: "middle" };
    row4.getCell(9).border = thinBorder;
    ws.mergeCells("J4:K4");
    row4.getCell(10).value = String(monthName).toUpperCase();
    row4.getCell(10).font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF000000" } };
    row4.getCell(10).alignment = { horizontal: "center", vertical: "middle" };
    row4.getCell(10).border = thinBorder;

    // =========================================================
    // ROW 5: Date string (merged A5:D5, bottom border 2px)
    // =========================================================

    ws.mergeCells("A5:D5");
    const row5 = ws.getRow(5);
    row5.height = 30;
    fillWhite(row5, 11);
    row5.getCell(1).value = formattedDate;
    row5.getCell(1).font = { name: "Calibri", size: 10, color: { argb: "FF000000" } };
    row5.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    row5.getCell(1).border = bottomBorder2px;

    // =========================================================
    // ROWS 6-7: TABLE HEADERS
    // =========================================================

    ws.mergeCells("A6:A7"); // NO
    ws.mergeCells("B6:B7"); // USER
    ws.mergeCells("C6:C7"); // DEP
    ws.mergeCells("D6:D7"); // DESCRIPTION
    ws.mergeCells("E6:E7"); // SPECIFICATION
    ws.mergeCells("J6:J7"); // NO. PR
    ws.mergeCells("K6:K7"); // CLEAR
    ws.mergeCells("F6:G6"); // ORDER
    ws.mergeCells("H6:I6"); // SALDO

    const r6 = ws.getRow(6);
    r6.height = 28;
    fillWhite(r6, 11);
    r6.getCell(1).value = "NO";
    r6.getCell(2).value = "USER";
    r6.getCell(3).value = "DEP";
    r6.getCell(4).value = "DESCRIPTION";
    r6.getCell(5).value = "SPECIFICATION";
    r6.getCell(6).value = "ORDER";
    r6.getCell(8).value = "SALDO";
    r6.getCell(10).value = "NO. PR";
    r6.getCell(11).value = "CLEAR";

    const r7 = ws.getRow(7);
    r7.height = 20;
    fillWhite(r7, 11);
    r7.getCell(6).value = "QTY";
    r7.getCell(7).value = "UOM";
    r7.getCell(8).value = "QTY";
    r7.getCell(9).value = "UOM";

    [r6, r7].forEach((row) => {
      for (let c = 1; c <= 11; c++) {
        const cell = row.getCell(c);
        cell.font = headerFont;
        cell.alignment = headerAlign;
        cell.border = thinBorder;
      }
    });
    r6.getCell(6).border = thickRightBorder;
    r6.getCell(7).border = thickRightBorder;
    r6.getCell(8).border = thickRightBorder;

    // =========================================================
    // DATA ROWS (numbering restarts at 1 per sheet)
    // =========================================================

    let rowNum = 8;
    let itemNumber = 1;

    function writeDataRow(item, fallbackUser, fallbackDept) {
      const row = ws.getRow(rowNum);
      row.height = 20;
      fillWhite(row, 11);
      row.getCell(1).value = itemNumber++;
      row.getCell(2).value = item.User || item.user || fallbackUser || "";
      row.getCell(3).value = fallbackDept || item.Department || item.department || "";
      row.getCell(4).value = item.Description || item.description || "";
      row.getCell(5).value = item.ItemName || item.itemName || item.Specification || item.specification || "";
      row.getCell(6).value = item.Quantity || item.quantity || 0;
      row.getCell(7).value = item.Unit || item.unit || "PCS";
      row.getCell(8).value = item.SaldoQty || item.saldoQty || 0;
      row.getCell(9).value = item.SaldoUom || item.saldoUom || item.Unit || item.unit || "PCS";
      row.getCell(10).value = order.NoPR || order.noPR || orderId;
      row.getCell(11).value = item.Clear || item.clear ? "V" : "";
      for (let c = 1; c <= 11; c++) {
        const cell = row.getCell(c);
        cell.font = bodyFont;
        cell.alignment = [1, 6, 7, 8, 9, 10].includes(c) ? bodyAlignCenter : bodyAlignLeft;
        cell.border = thinBorder;
      }
      row.getCell(6).border = thickRightBorder;
      row.getCell(7).border = thickRightBorder;
      row.getCell(8).border = thickRightBorder;
      rowNum++;
    }

    if (items.length === 0) {
      writeDataRow(order, "", order.Department || order.department || "");
    } else {
      const fallbackUser = order.User || order.user || "";
      const fallbackDept = order.Department || order.department || "";
      items.forEach((item) => writeDataRow(item, fallbackUser, fallbackDept));
    }

    // =========================================================
    // EMPTY ROWS (signature area) — white, no border
    // =========================================================

    for (let i = 0; i < 5; i++) {
      const row = ws.getRow(rowNum);
      row.height = 20;
      fillWhite(row, 11);
      rowNum++;
    }

    ws.pageSetup.printArea = `A1:K${rowNum - 1}`;
  });

  // =========================================================
  // EXPORT
  // =========================================================

  const cleanId = (v) => String(v || "").replace(/[\\\/:*?"<>|]/g, "").trim();
  const firstId = cleanId(orders[0] && (orders[0].OrderID || orders[0].orderID || orders[0].NoPR)) || "ORDER";
  const lastId = cleanId(orders[orders.length - 1] && (orders[orders.length - 1].OrderID || orders[orders.length - 1].orderID || orders[orders.length - 1].NoPR)) || firstId;
  const filename = orders.length > 1 && lastId !== firstId
    ? `Rekap_Order_${firstId}-${lastId}.xlsx`
    : `Rekap_Order_${firstId}.xlsx`;

  wb.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Excel downloaded", "success");
  }).catch((err) => {
    console.error("Excel export error:", err);
    showToast("Export failed: " + err.message, "error");
  });

  return { success: true, filename: filename };
}

// ========================================
// PDF Export (Print-friendly)
// ========================================

function exportCurrentOrderExcel() {
  if (!currentOrder) return;
  Promise.resolve(generateExcelFromData([currentOrder])).catch((err) => {
    console.error("Excel export error:", err);
    showToast("Export failed: " + (err.message || "Unknown error"), "error");
  });
}

function exportWorkOrderPDF() {
  if (!currentOrder) return;
  const o = currentOrder;

  const base = location.href.substring(0, location.href.lastIndexOf("/") + 1);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const parsed = o.Date ? new Date(o.Date) : new Date();
  const d = isNaN(parsed.getTime()) ? new Date() : parsed;
  const docDate = `${dayNames[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Rekap_Order_${o.OrderID}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: Calibri, Arial, sans-serif; padding: 16px; color: #000; background: #fff; font-size: 9pt; }
        .top { display: flex; justify-content: space-between; align-items: flex-start; }
        .logo img { width: 228px; height: 40px; object-fit: contain; }
        .info { text-align: right; font-size: 10pt; }
        .info .lbl { display: inline-block; width: 70px; text-align: right; margin-right: 8px; }
        .info .val { display: inline-block; min-width: 110px; text-align: center; font-weight: bold; border: 1px solid #000; padding: 1px 8px; }
        .title { text-align: center; font-size: 14pt; font-weight: bold; margin: 12px 0 4px; }
        .docdate { font-size: 10pt; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th, td { border: 1px solid #000; padding: 3px 4px; font-size: 8.5pt; vertical-align: middle; }
        th { text-align: center; font-weight: bold; }
        td.c { text-align: center; }
        .sig { display: flex; justify-content: flex-end; margin-top: 28px; page-break-inside: avoid; }
        .sig-box { width: 30%; text-align: center; font-size: 10pt; }
        .sig-box .space { height: 70px; }
        .sig-box .name { border-top: 1px solid #000; display: inline-block; min-width: 160px; padding-top: 2px; }
        .footer { margin-top: 24px; font-size: 8pt; color: #555; text-align: center; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="top">
        <div class="logo"><img src="${base}logorra.png" alt="RRA" /></div>
        <div class="info">
          <div><span class="lbl">TAHUN</span><span class="val">${d.getFullYear()}</span></div>
          <div style="margin-top:4px"><span class="lbl">TANGGAL</span><span class="val">${d.getDate()} ${months[d.getMonth()].toUpperCase()}</span></div>
        </div>
      </div>
      <div class="title">REKAP FORM REQUISITION</div>
      <div class="docdate">${docDate}</div>
      <table>
        <thead>
          <tr>
            <th rowspan="2">NO</th><th rowspan="2">USER</th><th rowspan="2">DEP</th>
            <th rowspan="2">DESCRIPTION</th><th rowspan="2">SPECIFICATION</th>
            <th colspan="2">ORDER</th><th colspan="2">SALDO</th>
            <th rowspan="2">NO. PR</th><th rowspan="2">CLEAR</th>
          </tr>
          <tr><th>QTY</th><th>UOM</th><th>QTY</th><th>UOM</th></tr>
        </thead>
        <tbody>
          ${(o.Items || [])
            .map(
              (it, i) => `
            <tr><td class="c">${i + 1}</td><td>${it.User || ""}</td><td>${o.Department || ""}</td><td>${it.Description || ""}</td><td>${it.ItemName}</td><td class="c">${it.Quantity}</td><td class="c">${it.Unit}</td><td class="c">${it.SaldoQty || 0}</td><td class="c">${it.SaldoUom || it.Unit || ""}</td><td class="c">${o.NoPR || o.OrderID}</td><td class="c">${it.Clear || it.clear ? "V" : ""}</td></tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      <div class="sig">
        <div class="sig-box"><div>Disetujui,</div><div class="space"></div><div class="name">( .................... )</div></div>
      </div>
    </body></html>
  `);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// ========================================
// Helpers
// ========================================

function statusClass(status) {
  return { Pending: "pending", "In Progress": "in-progress", Completed: "completed", Cancelled: "cancelled" }[status] || "pending";
}
function statusBg(status) {
  return { Pending: "bg-amber-100", "In Progress": "bg-blue-100", Completed: "bg-emerald-100", Cancelled: "bg-red-100" }[status] || "bg-surface-100";
}
function statusText(status) {
  return { Pending: "text-amber-600", "In Progress": "text-blue-600", Completed: "text-emerald-600", Cancelled: "text-red-600" }[status] || "text-surface-600";
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// --- Toast ---
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const icons = { success: "check-circle", error: "alert-circle", info: "info" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i data-lucide="${icons[type] || "info"}" class="w-4 h-4 shrink-0"></i><span>${message}</span>`;
  container.appendChild(toast);
  lucide.createIcons();
  setTimeout(() => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Confirm Dialog ---
let confirmCallback = null;
function showConfirm(title, message, onConfirm) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("confirm-dialog").classList.remove("hidden");
  confirmCallback = onConfirm;
}
function closeConfirm() {
  document.getElementById("confirm-dialog").classList.add("hidden");
  confirmCallback = null;
}
document.getElementById("confirm-btn").addEventListener("click", () => {
  if (confirmCallback) confirmCallback();
  closeConfirm();
});
