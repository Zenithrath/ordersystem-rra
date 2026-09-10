// ========================================
// Work Order Management System - Backend
// Google Apps Script Web App (Optimized)
// ========================================

const SHEET_ORDERS = "ORDERS";
const SHEET_ITEMS = "ORDER_ITEMS";
const CACHE_TTL = 180; // 3 minutes

// ========================================
// HTTP Handlers
// ========================================

function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : "getDashboardStats";
  let result;

  try {
    switch (action) {
      case "getOrders":
        result = getOrders(e.parameter);
        break;
      case "getOrderDetail":
        result = getOrderDetail(e.parameter.id);
        break;
      case "getDashboardStats":
        result = getDashboardStats();
        break;
      case "getDepartments":
        result = getDepartments();
        break;
      case "createOrder":
        var data = JSON.parse(e.parameter.data);
        result = createOrder(data);
        break;
      case "updateOrder":
        var data = JSON.parse(e.parameter.data);
        result = updateOrder(data);
        break;
      case "updateOrderStatus":
        result = updateOrderStatus({
          orderId: e.parameter.orderId,
          status: e.parameter.status
        });
        break;
      case "deleteOrder":
        result = deleteOrder(e.parameter.id);
        break;
      case "exportExcel":
        result = exportExcel(e.parameter);
        break;
      default:
        result = { success: false, message: "Unknown action: " + action };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// Sheet Helpers
// ========================================

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_ORDERS) {
      sheet.appendRow([
        "OrderID", "Date", "RequesterName", "Department",
        "Purpose", "Notes", "Status", "CreatedAt", "CompletedAt", "CreatedBy"
      ]);
    } else if (name === SHEET_ITEMS) {
      sheet.appendRow(["OrderID", "ItemName", "Quantity", "Unit", "Notes"]);
    }
  }
  return sheet;
}

function generateOrderID() {
  const sheet = getSheet(SHEET_ORDERS);
  const today = new Date();
  const dateStr = Utilities.formatDate(today, "Asia/Jakarta", "yyyyMMdd");
  const prefix = "WO-" + dateStr + "-";

  const lastRow = sheet.getLastRow();
  let maxNum = 0;

  if (lastRow > 1) {
    // Only read last 100 rows for ID generation (orders won't exceed this daily)
    const readStart = Math.max(2, lastRow - 99);
    const readCount = lastRow - readStart + 1;
    const ids = sheet.getRange(readStart, 1, readCount, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const orderId = ids[i][0];
      if (orderId && typeof orderId === "string" && orderId.startsWith(prefix)) {
        const num = parseInt(orderId.split("-")[2], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }

  return prefix + String(maxNum + 1).padStart(3, "0");
}

// Batch read: reads orders + items once, returns as objects
function readAllData() {
  const ordersSheet = getSheet(SHEET_ORDERS);
  const itemsSheet = getSheet(SHEET_ITEMS);

  const ordersRange = ordersSheet.getDataRange();
  const itemsRange = itemsSheet.getDataRange();

  const ordersValues = ordersRange.getValues();
  const itemsValues = itemsRange.getValues();

  const ordersHeaders = ordersValues[0];
  const itemsHeaders = itemsValues[0];

  const orders = [];
  for (let i = 1; i < ordersValues.length; i++) {
    const obj = {};
    ordersHeaders.forEach((h, j) => { obj[h] = ordersValues[i][j]; });
    orders.push(obj);
  }

  const items = [];
  for (let i = 1; i < itemsValues.length; i++) {
    const obj = {};
    itemsHeaders.forEach((h, j) => { obj[h] = itemsValues[i][j]; });
    items.push(obj);
  }

  return { orders, items };
}

function buildOrderMap(orders, items) {
  const itemCounts = {};
  items.forEach(it => {
    itemCounts[it.OrderID] = (itemCounts[it.OrderID] || 0) + 1;
  });

  return orders.map(order => ({
    ...order,
    ItemCount: itemCounts[order.OrderID] || 0
  }));
}

// Build order map WITH full items (for detail view)
function buildOrderMapWithItems(orders, items) {
  const itemMap = {};
  items.forEach(it => {
    if (!itemMap[it.OrderID]) itemMap[it.OrderID] = [];
    itemMap[it.OrderID].push(it);
  });

  return orders.map(order => ({
    ...order,
    ItemCount: (itemMap[order.OrderID] || []).length,
    Items: itemMap[order.OrderID] || []
  }));
}

// ========================================
// Core Functions
// ========================================

function getOrders(params) {
  const { orders, items } = readAllData();
  let enriched = buildOrderMap(orders, items); // lightweight: ItemCount only, no Items array

  // Search
  if (params.q) {
    const q = params.q.toLowerCase();
    // Collect order IDs that have matching item names
    const matchingItemIds = new Set();
    items.forEach(it => {
      if (it.ItemName && it.ItemName.toLowerCase().includes(q)) {
        matchingItemIds.add(it.OrderID);
      }
    });

    enriched = enriched.filter(o =>
      (o.OrderID && o.OrderID.toLowerCase().includes(q)) ||
      (o.RequesterName && o.RequesterName.toLowerCase().includes(q)) ||
      matchingItemIds.has(o.OrderID)
    );
  }

  // Filter: status
  if (params.status) {
    enriched = enriched.filter(o => o.Status === params.status);
  }

  // Filter: department
  if (params.department) {
    enriched = enriched.filter(o => o.Department === params.department);
  }

  // Filter: month + year
  if (params.month && params.year) {
    const m = parseInt(params.month) - 1;
    const y = parseInt(params.year);
    enriched = enriched.filter(o => {
      const d = new Date(o.Date);
      return d.getMonth() === m && d.getFullYear() === y;
    });
  } else if (params.year) {
    const y = parseInt(params.year);
    enriched = enriched.filter(o => new Date(o.Date).getFullYear() === y);
  }

  // Sort
  const sortField = params.sort || "date";
  const sortDir = params.dir === "asc" ? 1 : -1;
  enriched.sort((a, b) => {
    if (sortField === "date") {
      return sortDir * (new Date(a.Date) - new Date(b.Date));
    } else if (sortField === "orderId") {
      return sortDir * a.OrderID.localeCompare(b.OrderID);
    } else if (sortField === "status") {
      return sortDir * a.Status.localeCompare(b.Status);
    }
    return 0;
  });

  // Pagination
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 25));
  const total = enriched.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const paged = enriched.slice(start, start + pageSize);

  return {
    success: true,
    data: paged,
    pagination: { page, pageSize, total, totalPages }
  };
}

function getOrderDetail(orderId) {
  if (!orderId) return { success: false, message: "Order ID is required" };

  const { orders, items } = readAllData();
  const order = orders.find(o => o.OrderID === orderId);
  if (!order) return { success: false, message: "Order not found" };

  const orderItems = items.filter(it => it.OrderID === orderId);
  return { success: true, data: { ...order, Items: orderItems, ItemCount: orderItems.length } };
}

function getDashboardStats() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("dashboard_stats");
  if (cached) return JSON.parse(cached);

  const { orders, items } = readAllData();
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const stats = {
    totalOrders: orders.length,
    pendingOrders: orders.filter(o => o.Status === "Pending").length,
    completedOrders: orders.filter(o => o.Status === "Completed").length,
    inProgressOrders: orders.filter(o => o.Status === "In Progress").length,
    cancelledOrders: orders.filter(o => o.Status === "Cancelled").length,
    ordersThisMonth: orders.filter(o => {
      const d = new Date(o.Date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length
  };

  // Recent 5 orders with item counts
  const itemMap = {};
  items.forEach(it => {
    if (!itemMap[it.OrderID]) itemMap[it.OrderID] = 0;
    itemMap[it.OrderID]++;
  });

  const recentOrders = orders
    .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt))
    .slice(0, 5)
    .map(o => ({ ...o, ItemCount: itemMap[o.OrderID] || 0 }));

  stats.recentOrders = recentOrders;

  const result = { success: true, data: stats };
  cache.put("dashboard_stats", JSON.stringify(result), CACHE_TTL);
  return result;
}

function getDepartments() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("departments");
  if (cached) return JSON.parse(cached);

  const result = {
    success: true,
    data: [
      "Engineering", "Project Management", "Procurement",
      "Operations", "Finance", "HR & Admin", "IT",
      "Marketing", "Logistics", "Other"
    ]
  };
  cache.put("departments", JSON.stringify(result), 3600);
  return result;
}

function createOrder(body) {
  const { date, requesterName, department, purpose, notes, items, createdBy } = body;

  if (!requesterName || !department || !items || items.length === 0) {
    return { success: false, message: "Missing required fields" };
  }

  const orderId = generateOrderID();
  const now = new Date().toISOString();
  const orderDate = date || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");

  const ordersSheet = getSheet(SHEET_ORDERS);
  ordersSheet.appendRow([
    orderId, orderDate, requesterName, department,
    purpose || "", notes || "", "Pending", now, "", createdBy || "system"
  ]);

  const itemsSheet = getSheet(SHEET_ITEMS);
  const itemRows = items.map(item => [
    orderId, item.itemName, item.quantity || 0, item.unit || "pcs", item.notes || ""
  ]);
  if (itemRows.length > 0) {
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemRows.length, 5).setValues(itemRows);
  }

  // Invalidate cache
  CacheService.getScriptCache().remove("dashboard_stats");

  return { success: true, message: "Order created successfully", data: { orderId } };
}

function updateOrder(body) {
  const { orderId, date, requesterName, department, purpose, notes, items } = body;
  if (!orderId) return { success: false, message: "Order ID is required" };

  const ordersSheet = getSheet(SHEET_ORDERS);
  const data = ordersSheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) return { success: false, message: "Order not found" };

  if (date) ordersSheet.getRange(rowIndex, 2).setValue(date);
  if (requesterName) ordersSheet.getRange(rowIndex, 3).setValue(requesterName);
  if (department) ordersSheet.getRange(rowIndex, 4).setValue(department);
  if (purpose !== undefined) ordersSheet.getRange(rowIndex, 5).setValue(purpose);
  if (notes !== undefined) ordersSheet.getRange(rowIndex, 6).setValue(notes);

  if (items && Array.isArray(items)) {
    const itemsSheet = getSheet(SHEET_ITEMS);
    const itemData = itemsSheet.getDataRange().getValues();
    const rowsToDelete = [];

    for (let i = 1; i < itemData.length; i++) {
      if (itemData[i][0] === orderId) rowsToDelete.push(i + 1);
    }
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      itemsSheet.deleteRow(rowsToDelete[i]);
    }

    const itemRows = items.map(item => [
      orderId, item.itemName, item.quantity || 0, item.unit || "pcs", item.notes || ""
    ]);
    if (itemRows.length > 0) {
      itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemRows.length, 5).setValues(itemRows);
    }
  }

  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order updated successfully" };
}

function updateOrderStatus(body) {
  const { orderId, status } = body;
  if (!orderId || !status) return { success: false, message: "Order ID and status are required" };

  const validStatuses = ["Pending", "In Progress", "Completed", "Cancelled"];
  if (!validStatuses.includes(status)) return { success: false, message: "Invalid status" };

  const ordersSheet = getSheet(SHEET_ORDERS);
  const data = ordersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      const row = i + 1;
      ordersSheet.getRange(row, 7).setValue(status);
      ordersSheet.getRange(row, 9).setValue(status === "Completed" ? new Date().toISOString() : "");

      CacheService.getScriptCache().remove("dashboard_stats");
      return { success: true, message: "Status updated to " + status };
    }
  }

  return { success: false, message: "Order not found" };
}

function deleteOrder(orderId) {
  if (!orderId) return { success: false, message: "Order ID is required" };

  const ordersSheet = getSheet(SHEET_ORDERS);
  const data = ordersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      ordersSheet.deleteRow(i + 1);
      break;
    }
  }

  const itemsSheet = getSheet(SHEET_ITEMS);
  const itemData = itemsSheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = 1; i < itemData.length; i++) {
    if (itemData[i][0] === orderId) rowsToDelete.push(i + 1);
  }
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    itemsSheet.deleteRow(rowsToDelete[i]);
  }

  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order deleted successfully" };
}

// ========================================
// Professional Excel Export
// ========================================

function exportExcel(params) {
  const { orders, items } = readAllData();
  let filtered = buildOrderMapWithItems(orders, items);

  // Apply same filters as getOrders
  if (params.q) {
    const q = params.q.toLowerCase();
    const matchingItemIds = new Set();
    items.forEach(it => {
      if (it.ItemName && it.ItemName.toLowerCase().includes(q)) matchingItemIds.add(it.OrderID);
    });
    filtered = filtered.filter(o =>
      (o.OrderID && o.OrderID.toLowerCase().includes(q)) ||
      (o.RequesterName && o.RequesterName.toLowerCase().includes(q)) ||
      matchingItemIds.has(o.OrderID)
    );
  }
  if (params.status) filtered = filtered.filter(o => o.Status === params.status);
  if (params.department) filtered = filtered.filter(o => o.Department === params.department);
  if (params.month && params.year) {
    const m = parseInt(params.month) - 1;
    const y = parseInt(params.year);
    filtered = filtered.filter(o => {
      const d = new Date(o.Date);
      return d.getMonth() === m && d.getFullYear() === y;
    });
  }

  filtered.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));

  // Create temporary spreadsheet
  const tempSS = SpreadsheetApp.create("Work Orders Export");
  const tempSheet = tempSS.getActiveSheet();
  tempSheet.setName("Work Orders");

  // Title row
  tempSheet.getRange("A1").setValue("PT. RRA — Work Orders Report");
  tempSheet.getRange("A1").setFontSize(14).setFontWeight("bold").setFontColor("#115e59");
  tempSheet.getRange("A1:H1").merge();

  // Subtitle
  const now = new Date();
  const dateStr = Utilities.formatDate(now, "Asia/Jakarta", "dd MMM yyyy HH:mm");
  tempSheet.getRange("A2").setValue("Generated: " + dateStr);
  tempSheet.getRange("A2").setFontSize(9).setFontColor("#64748b");
  tempSheet.getRange("A2:H2").merge();

  // Summary row
  tempSheet.getRange("A3").setValue("Total Orders: " + filtered.length);
  tempSheet.getRange("A3").setFontSize(9).setFontColor("#64748b");
  tempSheet.getRange("A3:H3").merge();

  // Headers
  const headers = ["Order ID", "Date", "Requester", "Department", "Purpose", "Items", "Status", "Notes"];
  tempSheet.getRange(5, 1, 1, headers.length).setValues([headers]);
  tempSheet.getRange(5, 1, 1, headers.length)
    .setBackground("#0d9488")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center");

  // Data rows
  const rows = filtered.map(o => [
    o.OrderID,
    o.Date,
    o.RequesterName,
    o.Department,
    o.Purpose || "",
    (o.Items || []).map(it => it.ItemName + " (" + it.Quantity + " " + it.Unit + ")").join(", "),
    o.Status,
    o.Notes || ""
  ]);

  if (rows.length > 0) {
    tempSheet.getRange(6, 1, rows.length, headers.length).setValues(rows);
  }

  // Alternating row colors
  for (let i = 0; i < rows.length; i++) {
    if (i % 2 === 0) {
      tempSheet.getRange(6 + i, 1, 1, headers.length).setBackground("#f0fdfa");
    }
  }

  // Borders
  const dataRange = tempSheet.getRange(5, 1, rows.length + 1, headers.length);
  dataRange.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);

  // Column widths
  tempSheet.setColumnWidth(1, 160); // Order ID
  tempSheet.setColumnWidth(2, 100); // Date
  tempSheet.setColumnWidth(3, 140); // Requester
  tempSheet.setColumnWidth(4, 130); // Department
  tempSheet.setColumnWidth(5, 180); // Purpose
  tempSheet.setColumnWidth(6, 250); // Items
  tempSheet.setColumnWidth(7, 100); // Status
  tempSheet.setColumnWidth(8, 180); // Notes

  // Status color coding
  for (let i = 0; i < rows.length; i++) {
    const statusCell = tempSheet.getRange(6 + i, 7);
    const status = rows[i][6];
    if (status === "Pending") {
      statusCell.setBackground("#fef3c7").setFontColor("#92400e");
    } else if (status === "In Progress") {
      statusCell.setBackground("#dbeafe").setFontColor("#1e40af");
    } else if (status === "Completed") {
      statusCell.setBackground("#d1fae5").setFontColor("#065f46");
    } else if (status === "Cancelled") {
      statusCell.setBackground("#fee2e2").setFontColor("#991b1b");
    }
  }

  // Freeze header row
  tempSheet.setFrozenRows(5);

  // Auto-filter
  if (rows.length > 0) {
    tempSheet.getRange(5, 1, rows.length + 1, headers.length).createFilter();
  }

  // Text wrapping for items and notes columns
  tempSheet.getRange(6, 6, rows.length, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  tempSheet.getRange(6, 8, rows.length, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

  // Summary sheet
  const summarySheet = tempSS.insertSheet("Summary");
  summarySheet.getRange("A1").setValue("Summary");
  summarySheet.getRange("A1").setFontSize(13).setFontWeight("bold");

  const summaryData = [
    ["Metric", "Value"],
    ["Total Orders", filtered.length],
    ["Pending", filtered.filter(o => o.Status === "Pending").length],
    ["In Progress", filtered.filter(o => o.Status === "In Progress").length],
    ["Completed", filtered.filter(o => o.Status === "Completed").length],
    ["Cancelled", filtered.filter(o => o.Status === "Cancelled").length],
    ["", ""],
    ["Department Breakdown", ""],
  ];

  // Department counts
  const deptCounts = {};
  filtered.forEach(o => { deptCounts[o.Department] = (deptCounts[o.Department] || 0) + 1; });
  Object.keys(deptCounts).sort().forEach(dept => {
    summaryData.push([dept, deptCounts[dept]]);
  });

  summarySheet.getRange(1, 1, summaryData.length, 2).setValues(summaryData);
  summarySheet.getRange(1, 1, 1, 2).setBackground("#0d9488").setFontColor("#ffffff").setFontWeight("bold");
  summarySheet.setColumnWidth(1, 180);
  summarySheet.setColumnWidth(2, 100);

  // Get XLSX blob and convert to base64
  const xlsxBlob = tempSS.getAs("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const base64 = Utilities.base64Encode(xlsxBlob.getBytes());

  return {
    success: true,
    data: base64,
    filename: "Work_Orders_" + Utilities.formatDate(now, "Asia/Jakarta", "yyyyMMdd_HHmmss") + ".xlsx"
  };
}
