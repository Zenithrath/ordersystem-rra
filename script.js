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
          <p class="text-xs text-surface-400 truncate">${o.RequesterName} &middot; ${o.Department}</p>
        </div>
      </div>
      <div class="text-right shrink-0 ml-3">
        <span class="badge badge-${statusClass(o.Status)}">${o.Status}</span>
        <p class="text-[11px] text-surface-400 mt-1 truncate max-w-[120px]" title="${o.ItemNames || ''}">${o.ItemNames || o.ItemCount + ' items'}</p>
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
      <td class="px-5 py-4"><div class="skeleton h-4 w-32 rounded"></div></td>
      <td class="px-5 py-4 text-center"><div class="skeleton h-5 w-16 rounded-full mx-auto"></div></td>
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
        <td colspan="8" class="px-5 py-12 text-center text-sm text-surface-400">
          <i data-lucide="search" class="w-10 h-10 mx-auto mb-2 text-surface-300"></i>
          No orders found
        </td>
      </tr>`;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = allOrders
    .map(
      (o) => {
        const checked = selectedOrders.has(o.OrderID) ? "checked" : "";
        const itemNames = o.ItemNames || (o.Items || []).map(it => it.ItemName).join(", ");
        return `
    <tr class="${selectedOrders.has(o.OrderID) ? 'bg-primary-50/50' : ''}">
      <td class="px-5 py-4 w-10">
        <input type="checkbox" value="${o.OrderID}" ${checked} onchange="toggleSelectOrder('${o.OrderID}', this)" class="w-4 h-4 rounded border-surface-300 text-primary-500 focus:ring-primary-500/20 cursor-pointer" />
      </td>
      <td class="px-5 py-4 text-sm font-medium text-surface-800 cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">${o.OrderID}</td>
      <td class="px-5 py-4 text-sm text-surface-500 hidden sm:table-cell cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">${formatDate(o.Date)}</td>
      <td class="px-5 py-4 cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">
        <p class="text-sm text-surface-800">${o.RequesterName}</p>
      </td>
      <td class="px-5 py-4 hidden md:table-cell cursor-pointer" onclick="openOrderDetail('${o.OrderID}')">
        <p class="text-sm text-surface-500">${o.Department}</p>
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
      },
    )
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
    allOrders.forEach(o => selectedOrders.add(o.OrderID));
  } else {
    allOrders.forEach(o => selectedOrders.delete(o.OrderID));
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
  return allOrders.filter(o => selectedOrders.has(o.OrderID));
}

function exportSelectedExcel() {
  const selected = getSelectedOrders();
  if (selected.length === 0) { showToast("No orders selected", "info"); return; }
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
      } catch (e) { console.error("Delete error:", e); }
    }
    selectedOrders.clear();
    updateSelectedUI();
    loadOrders(currentPage);
    loadDashboardStats();
    showToast(`${deleted} order berhasil dihapus`, "success");
  };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function exportSelectedPDF() {
  const selected = getSelectedOrders();
  if (selected.length === 0) { showToast("No orders selected", "info"); return; }
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
          ${orders.map(o => `
            <tr>
              <td>${o.OrderID}</td>
              <td>${formatDate(o.Date)}</td>
              <td>${o.RequesterName}</td>
              <td>${o.Department}</td>
              <td class="items-cell">${o.ItemNames || (o.Items || []).map(it => it.ItemName).join(", ") || "-"}</td>
              <td><span class="badge badge-${statusClass(o.Status)}">${o.Status}</span></td>
            </tr>
          `).join("")}
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
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">Date</p>
          <p class="text-sm text-surface-800">${formatDate(order.Date)}</p>
        </div>
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">Requester</p>
          <p class="text-sm text-surface-800">${order.RequesterName}</p>
        </div>
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">Department</p>
          <p class="text-sm text-surface-800">${order.Department}</p>
        </div>
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">Purpose</p>
          <p class="text-sm text-surface-800">${order.Purpose || "-"}</p>
        </div>
      </div>
      ${
        order.Notes
          ? `
        <div>
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-1">Notes</p>
          <p class="text-sm text-surface-700 bg-surface-50 rounded-xl p-3">${order.Notes}</p>
        </div>
      `
          : ""
      }
      <div>
        <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-2">Items</p>
        <div class="space-y-2">
          ${(order.Items || [])
            .map(
              (it) => `
            <div class="flex items-center justify-between bg-surface-50 rounded-xl px-3 py-2.5">
              <div class="min-w-0">
                <p class="text-sm font-medium text-surface-800 truncate">${it.ItemName}</p>
                ${it.Notes ? `<p class="text-xs text-surface-400 truncate">${it.Notes}</p>` : ""}
              </div>
              <span class="text-sm font-semibold text-surface-700 shrink-0 ml-3">${it.Quantity} ${it.Unit}</span>
            </div>
          `,
            )
            .join("")}
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
  row.className = "item-row";
  row.innerHTML = `
    <input type="text" placeholder="Item name" required class="item-name px-3 py-2.5 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400" />
    <input type="number" placeholder="Qty" min="1" value="1" required class="item-qty px-3 py-2.5 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400" />
    <select class="item-unit px-3 py-2.5 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
      ${CONFIG.UNITS.map((u) => `<option value="${u}">${u}</option>`).join("")}
    </select>
    <input type="text" placeholder="Notes (optional)" class="item-notes px-3 py-2.5 text-sm bg-surface-50 border border-surface-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400" />
    <button type="button" onclick="this.parentElement.remove()" class="w-9 h-9 flex items-center justify-center text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0">
      <i data-lucide="trash-2" class="w-4 h-4"></i>
    </button>
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
        itemName: name,
        quantity: parseInt(row.querySelector(".item-qty").value) || 1,
        unit: row.querySelector(".item-unit").value,
        notes: row.querySelector(".item-notes").value.trim(),
      });
    }
  });

  return {
    date: document.getElementById("form-date").value,
    requesterName: document.getElementById("form-requester").value.trim(),
    department: document.getElementById("form-department").value,
    purpose: document.getElementById("form-purpose").value.trim(),
    notes: document.getElementById("form-notes").value.trim(),
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
    document.getElementById("form-requester").value = order.RequesterName || "";
    document.getElementById("form-department").value = order.Department || "";
    document.getElementById("form-purpose").value = order.Purpose || "";
    document.getElementById("form-notes").value = order.Notes || "";

    const container = document.getElementById("items-container");
    container.innerHTML = "";
    (order.Items || []).forEach((it) => {
      addItemRow();
      const rows = container.querySelectorAll(".item-row");
      const lastRow = rows[rows.length - 1];
      lastRow.querySelector(".item-name").value = it.ItemName || "";
      lastRow.querySelector(".item-qty").value = it.Quantity || 1;
      lastRow.querySelector(".item-unit").value = it.Unit || "pcs";
      lastRow.querySelector(".item-notes").value = it.Notes || "";
    });

    document.getElementById("btn-submit-order").textContent = "Update Order";
    document.getElementById("btn-submit-order").scrollIntoView({ behavior: "smooth" });
  }, 400);
}

function resetForm() {
  editingOrderId = null;
  document.getElementById("form-order-id").value = "";
  document.getElementById("form-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("form-requester").value = "";
  document.getElementById("form-department").value = "";
  document.getElementById("form-purpose").value = "";
  document.getElementById("form-notes").value = "";
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
  // Export currently filtered/paginated data from local state
  generateExcelFromData(allOrders);
}

function generateExcelFromData(orders) {
  if (!orders.length) {
    showToast("No data to export", "info");
    return;
  }

  const rows = orders.map(o => ({
    "Order ID": o.OrderID,
    "Date": o.Date,
    "Requester": o.RequesterName,
    "Department": o.Department,
    "Purpose": o.Purpose || "",
    "Items": o.ItemNames || (o.Items || []).map(it => it.ItemName + " (" + it.Quantity + " " + it.Unit + ")").join(", "),
    "Status": o.Status,
    "Notes": o.Notes || ""
  }));

  const wb = XLSX.utils.book_new();
  const headers = ["Order ID", "Date", "Requester", "Department", "Purpose", "Items", "Status", "Notes"];

  const thinBorder = {
    top: { style: "thin", color: { rgb: "E2E8F0" } },
    bottom: { style: "thin", color: { rgb: "E2E8F0" } },
    left: { style: "thin", color: { rgb: "E2E8F0" } },
    right: { style: "thin", color: { rgb: "E2E8F0" } },
  };

  const headerBorder = {
    top: { style: "thin", color: { rgb: "0F766E" } },
    bottom: { style: "thin", color: { rgb: "0F766E" } },
    left: { style: "thin", color: { rgb: "0F766E" } },
    right: { style: "thin", color: { rgb: "0F766E" } },
  };

  const statusStyles = {
    "Pending":     { fg: "FEF3C7", fc: "92400E" },
    "In Progress": { fg: "DBEAFE", fc: "1E40AF" },
    "Completed":   { fg: "D1FAE5", fc: "065F46" },
    "Cancelled":   { fg: "FEE2E2", fc: "991B1B" },
  };

  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = [
    { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 16 },
    { wch: 22 }, { wch: 40 }, { wch: 12 }, { wch: 22 },
  ];

  headers.forEach((_, ci) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
    ws[addr].s = {
      fill: { fgColor: { rgb: "0D9488" } },
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
      alignment: { horizontal: "center" },
      border: headerBorder,
    };
  });

  rows.forEach((r, ri) => {
    const rowNum = ri + 1;
    const vals = [r["Order ID"], r["Date"], r["Requester"], r["Department"], r["Purpose"], r["Items"], r["Status"], r["Notes"]];
    vals.forEach((v, ci) => {
      const addr = XLSX.utils.encode_cell({ r: rowNum, c: ci });
      ws[addr] = { v: v || "", t: "s" };

      const cellStyle = {
        border: thinBorder,
        alignment: { wrapText: ci === 5 || ci === 7 },
      };

      if (ri % 2 === 0) {
        cellStyle.fill = { fgColor: { rgb: "F0FDF4" } };
      }

      if (ci === 6) {
        const sc = statusStyles[v];
        if (sc) {
          cellStyle.fill = { fgColor: { rgb: sc.fg } };
          cellStyle.font = { color: { rgb: sc.fc }, bold: true, sz: 10 };
        }
      }

      ws[addr].s = cellStyle;
    });
  });

  ws["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 7, r: rows.length } });
  XLSX.utils.book_append_sheet(wb, ws, "Work Orders");

  // Summary sheet
  const statusCounts = {};
  const deptCounts = {};
  rows.forEach((r) => {
    statusCounts[r.Status] = (statusCounts[r.Status] || 0) + 1;
    deptCounts[r.Department] = (deptCounts[r.Department] || 0) + 1;
  });

  const summaryData = [
    ["Metric", "Value"],
    ["Total Orders", rows.length],
    ["Pending", statusCounts["Pending"] || 0],
    ["In Progress", statusCounts["In Progress"] || 0],
    ["Completed", statusCounts["Completed"] || 0],
    ["Cancelled", statusCounts["Cancelled"] || 0],
    ["", ""],
    ["Department Breakdown", ""],
  ];
  Object.keys(deptCounts).sort().forEach((dept) => {
    summaryData.push([dept, deptCounts[dept]]);
  });

  const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
  ws2["!cols"] = [{ wch: 22 }, { wch: 12 }];

  ["A1", "B1"].forEach((addr) => {
    if (ws2[addr]) ws2[addr].s = {
      fill: { fgColor: { rgb: "0D9488" } },
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
      border: headerBorder,
    };
  });

  for (let ri = 1; ri < summaryData.length; ri++) {
    for (let ci = 0; ci < 2; ci++) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws2[addr]) ws2[addr].s = { border: thinBorder };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws2, "Summary");

  const filename = "Work_Orders_" + new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, filename + ".xlsx");
  showToast("Excel downloaded", "success");
}

// ========================================
// PDF Export (Print-friendly)
// ========================================

function exportWorkOrderPDF() {
  if (!currentOrder) return;
  const o = currentOrder;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Order ${o.OrderID}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0d9488; padding-bottom: 16px; margin-bottom: 24px; }
        .title { font-size: 20px; font-weight: bold; color: #115e59; }
        .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
        .badge-pending { background: #fef3c7; color: #92400e; }
        .badge-in-progress { background: #dbeafe; color: #1e40af; }
        .badge-completed { background: #d1fae5; color: #065f46; }
        .badge-cancelled { background: #fee2e2; color: #991b1b; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .label { font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; margin-bottom: 4px; }
        .value { font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th { background: #0d9488; color: white; padding: 10px 12px; font-size: 11px; text-align: left; }
        td { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) td { background: #f8fafc; }
        .notes { font-size: 12px; color: #475569; background: #f8fafc; padding: 12px; border-radius: 8px; }
        .footer { margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 10px; color: #94a3b8; text-align: center; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="title">Order</div>
          <div class="subtitle">PT. RRA — Order Management System</div>
        </div>
        <div style="text-align:right">
          <div class="badge badge-${statusClass(o.Status)}">${o.Status}</div>
          <div class="subtitle" style="margin-top:8px">${o.OrderID}</div>
        </div>
      </div>
      <div class="grid">
        <div><div class="label">Order Date</div><div class="value">${formatDate(o.Date)}</div></div>
        <div><div class="label">Requester</div><div class="value">${o.RequesterName}</div></div>
        <div><div class="label">Department</div><div class="value">${o.Department}</div></div>
        <div><div class="label">Purpose</div><div class="value">${o.Purpose || "-"}</div></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th><th>Notes</th></tr></thead>
        <tbody>
          ${(o.Items || [])
            .map(
              (it, i) => `
            <tr><td>${i + 1}</td><td>${it.ItemName}</td><td>${it.Quantity}</td><td>${it.Unit}</td><td>${it.Notes || ""}</td></tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      ${o.Notes ? `<div class="notes"><strong>Notes:</strong> ${o.Notes}</div>` : ""}
      <div class="footer">Generated ${new Date().toLocaleDateString("id-ID")} &middot; Order Management System</div>
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
